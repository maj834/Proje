"""Arastirma laboratuvari: veri seti yukleme, donem ayrimi ve standart olcumler.

Donemler (zaman sirasina gore, ortusme yok):
  egitim     : <= 2023-12-31   (model kurma)
  dogrulama  : 2024-01-01 .. 2025-06-11  (secim / ayar)
  test       : >= 2025-06-12   (yalniz son karsilastirma; tools/eval-engine.js test donemiyle ayni)
Varsayilan yukleme test donemini DISARIDA birakir. Test yalniz son adayi olcmek icin acilir (include_test=True).

Olcumler:
  ic(df, col, y)        : tarih bazinda capraz kesit Spearman IC ortalamasi, t-istatistigi (ortusmeyen tarihlerle), havuz Spearman
  quint(df, col, y)     : her tarihte 5'li dilim -> dilim ortalamasi, en ust/en alt farki, isabet oranlari
  hit(df, mask, h)      : secili orneklerde h gunluk yukselme (ret>0) ve endekse gore fazla getiri pozitif orani, kapsama
  report(df, col)       : donem x vade ozet tablosu
"""
import os, numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DEF = os.environ.get('AR_DS', '/tmp/claude-0/-home-user/d9287a0a-8eca-5a41-a246-1179222da5ce/scratchpad/ar/ds.parquet')
CUT1, CUT2 = '2024-01-01', '2025-06-12'
H = [5, 10, 20, 40]


def period(t):
    return np.where(t < CUT1, 'egitim', np.where(t < CUT2, 'dogrulama', 'test'))


def load(path=DEF, include_test=False, drop_broken=True, min_price=0.5, min_size=None):
    df = pd.read_parquet(path)
    df['donem'] = period(df['tarih'].values)
    if not include_test:
        df = df[df['donem'] != 'test']
    if drop_broken and 'kirik' in df:
        df = df[df['kirik'] != 1]
    if min_price:
        df = df[df['fiyat'] >= min_price]
    if min_size is not None:
        df = df[df['size'] >= min_size]
    return df.reset_index(drop=True)


def _rank_corr(g, a, b):
    x = g[[a, b]].dropna()
    if len(x) < 20:
        return np.nan
    return x[a].rank().corr(x[b].rank())


def ic(df, col, y='ex20'):
    h = int(''.join(ch for ch in y if ch.isdigit()) or 20)
    s = df.groupby('tarih').apply(lambda g: _rank_corr(g, col, y), include_groups=False).dropna()
    if not len(s):
        return dict(ic=np.nan, t=np.nan, n=0, pooled=np.nan)
    step = max(1, h // 5)  # ornekler 5 gunde bir; h gunluk getiriler ortusmesin
    s2 = s.iloc[::step]
    t = s2.mean() / (s2.std(ddof=1) / np.sqrt(len(s2))) if len(s2) > 2 and s2.std() > 0 else np.nan
    x = df[[col, y]].dropna()
    pooled = x[col].rank().corr(x[y].rank()) if len(x) > 30 else np.nan
    return dict(ic=round(s.mean(), 4), t=round(t, 2), n=len(s), pooled=round(pooled, 4))


def quint(df, col, y='ex20', q=5):
    x = df[['tarih', col, y] + [c for c in ('ret' + y[2:],) if c in df and c != y]].dropna(subset=[col, y]).copy()
    x['d'] = x.groupby('tarih')[col].transform(lambda s: pd.qcut(s.rank(method='first'), q, labels=False) if len(s) >= q * 4 else np.nan)
    x = x.dropna(subset=['d'])
    g = x.groupby('d')[y].mean()
    hr = x.groupby('d')[y].apply(lambda s: (s > 0).mean())
    out = dict(dilim=[round(v, 4) for v in g.values], pozitif=[round(v, 3) for v in hr.values], ustalt=round(g.iloc[-1] - g.iloc[0], 4))
    rc = 'ret' + y[2:]
    if rc in x and rc != y:
        out['yukselme'] = [round(v, 3) for v in x.groupby('d')[rc].apply(lambda s: (s > 0).mean()).values]
    return out


def hit(df, mask, h=20):
    x = df[mask]
    r, e = x['ret%d' % h].dropna(), x['ex%d' % h].dropna()
    base_r = (df['ret%d' % h].dropna() > 0).mean()
    return dict(n=len(x), kapsama=round(len(x) / max(1, len(df)), 3), yukselme=round((r > 0).mean(), 3), taban=round(base_r, 3),
                fazlaPoz=round((e > 0).mean(), 3), ortFazla=round(e.mean(), 4), ortGetiri=round(r.mean(), 4),
                tarih=x['tarih'].nunique())


def report(df, col, ys=('ex10', 'ex20', 'ex40')):
    rows = []
    for p, g in df.groupby('donem', sort=False):
        for y in ys:
            a = ic(g, col, y)
            qq = quint(g, col, y)
            rows.append(dict(donem=p, y=y, ic=a['ic'], t=a['t'], ustalt=qq['ustalt'], ust_poz=qq['pozitif'][-1], alt_poz=qq['pozitif'][0],
                             ust_yuk=qq.get('yukselme', [None])[-1]))
    return pd.DataFrame(rows)


if __name__ == '__main__':
    d = load()
    print(d.shape, d['donem'].value_counts().to_dict())
    print(report(d, 'rs126'))


def sinyal(df, col, q=0.2, h=20, fit='egitim'):
    """Uygulamadaki gibi MUTLAK esik: esikler `fit` doneminde col'un ust/alt q dilimlerinden; her donemde AL/SAT isabeti.
    AL isabeti = ret_h > 0 orani (ve ex_h > 0), SAT isabeti = ret_h < 0 orani (ve ex_h < 0)."""
    f = df[df['donem'] == fit][col].dropna()
    hi, lo = f.quantile(1 - q), f.quantile(q)
    out = dict(esik_al=round(float(hi), 5), esik_sat=round(float(lo), 5))
    for p, g in df.groupby('donem', sort=False):
        g = g.dropna(subset=[col, 'ret%d' % h])
        al, sat = g[g[col] >= hi], g[g[col] <= lo]
        out[p] = dict(n=len(g), taban_yuk=round((g['ret%d' % h] > 0).mean(), 3),
                      AL_n=len(al), AL_yuk=round((al['ret%d' % h] > 0).mean(), 3), AL_fazla=round((al['ex%d' % h] > 0).mean(), 3), AL_ort=round(al['ex%d' % h].mean(), 4),
                      SAT_n=len(sat), SAT_dus=round((sat['ret%d' % h] < 0).mean(), 3), SAT_eksik=round((sat['ex%d' % h] < 0).mean(), 3), SAT_ort=round(sat['ex%d' % h].mean(), 4))
    return out
