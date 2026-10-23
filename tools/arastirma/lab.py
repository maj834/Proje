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


# ---------------------------------------------------------------- ileri yuruyen capraz dogrulama (walk-forward)
ALL = ['m5','m21','m63','m126','m252x','rs5','rs21','rs63','rs126','rs252','d20','d50','d200','e50s','e200s','hi252','lo252','hi63','dsh',
       'rsi','macdh','adx','dmi','bbp','bbw','vol21','vol63','vr','atrp','beta','idio','max21','min21','tv5','tv21','upv','clv','size','amih',
       'shk','shkUp','shkDn','gap','r1','mkt21','mkt63','mktd200','mktvol','mktrsi']
# Uygulamadaki (gonderilen) model ayari: tools/arastirma/final2.py
SHIP = dict(num_leaves=8, learning_rate=0.03, n_estimators=200, min_child_samples=1000, subsample=0.8, subsample_freq=1,
            colsample_bytree=0.7, verbose=-1, random_state=1)
# Kat yillari: her kat icin egitim = katin baslangicindan EMBARGO gun oncesine kadar (genisleyen pencere), tahmin = o donem.
FOLDS = [('2020-01-01', '2021-01-01'), ('2021-01-01', '2022-01-01'), ('2022-01-01', '2023-01-01'), ('2023-01-01', '2024-01-01'),
         ('2024-01-01', '2025-01-01'), ('2025-01-01', '2025-06-12')]
EMBARGO_DAYS = 45   # 40 islem gunluk hedef ortusmesin (takvim gunu)


def rank_target(df, y='ex20'):
    return df.groupby('tarih')[y].rank(pct=True)


def wf_predict(df, fit_predict, folds=FOLDS):
    """fit_predict(train_df, pred_df) -> np.array tahmin. df: lab.load() (test haric). Donus: katlardaki dis-ornek tahminleri (Series)."""
    out = pd.Series(np.nan, index=df.index)
    t = pd.to_datetime(df['tarih'])
    for a, b in folds:
        a_, b_ = pd.Timestamp(a), pd.Timestamp(b)
        tr = df[t < a_ - pd.Timedelta(days=EMBARGO_DAYS)]
        te = df[(t >= a_) & (t < b_)]
        if len(tr) < 5000 or not len(te):
            continue
        out.loc[te.index] = np.asarray(fit_predict(tr, te), dtype=float)
    return out


def wf_report(df, pred, ys=('ex10', 'ex20', 'ex40')):
    """Kat (yil) bazinda IC ve toplam; ayrica AL/SAT (ust/alt %20, tarih ici) isabet oranlari."""
    d = df.assign(_p=pred).dropna(subset=['_p'])
    d['_yil'] = d['tarih'].str[:4]
    rows = []
    for yil, g in d.groupby('_yil'):
        r = dict(yil=yil, n=len(g))
        for y in ys:
            r['ic_' + y] = ic(g, '_p', y)['ic']
        rows.append(r)
    tot = dict(yil='HEPSI', n=len(d))
    for y in ys:
        a = ic(d, '_p', y); tot['ic_' + y] = a['ic']; tot['t_' + y] = a['t']
    rows.append(tot)
    q = d.groupby('tarih')['_p'].rank(pct=True)
    al, sat = d[q >= 0.8], d[q <= 0.2]
    isabet = dict(AL_yuk20=round((al['ret20'] > 0).mean(), 3), AL_gec20=round((al['ex20'] > 0).mean(), 3), AL_ex20=round(al['ex20'].mean(), 4),
                  SAT_dus20=round((sat['ret20'] < 0).mean(), 3), SAT_geri20=round((sat['ex20'] < 0).mean(), 3), SAT_ex20=round(sat['ex20'].mean(), 4),
                  taban_yuk20=round((d['ret20'] > 0).mean(), 3))
    return pd.DataFrame(rows), isabet


def ship_fit_predict(tr, te, feats=ALL, params=SHIP, y='ex20'):
    import lightgbm as lgb
    m = lgb.LGBMRegressor(**params, n_jobs=2).fit(tr[feats].astype(float), rank_target(tr, y).fillna(0.5))
    return m.predict(te[feats].astype(float))


# ---------------------------------------------------------------- ham fiyat verisi (yeni ozellikler icin)
def load_prices(veri_dir='/home/user/Proje/tools/veri'):
    """tools/veri/yfiyat-*.json.br -> {sembol: DataFrame(gun,o,h,l,c,ac,v)}; veri-seti.js ile ayni kirilma (bolunme) duzeltmesi.
    Endeksler/makro: 'XU100.IS','XBANK.IS','XUSIN.IS','XU030.IS','USDTRY=X','EURTRY=X','GC=F','BZ=F','^GSPC','^VIX','EEM' (varsa)."""
    import glob, json, brotli
    data = {}
    for f in sorted(glob.glob(veri_dir + '/yfiyat-*.json.br')):
        data.update(json.loads(brotli.decompress(open(f, 'rb').read()))['data'])
    out = {}
    for s, d in data.items():
        df = pd.DataFrame({k: d[k] for k in ('t', 'o', 'h', 'l', 'c', 'ac', 'v')}).rename(columns={'t': 'gun'})
        c = df['c'].values.astype(float)
        adj = np.ones(len(df))
        for i in range(len(df) - 1, 0, -1):
            r = c[i] / c[i - 1]
            if r < 0.7 or r > 1.43:
                k = df['o'].values[i] / c[i - 1]
                g = k if abs(np.log(k)) > np.log(1.3) else r
                adj[:i] *= g
                c[:i] *= g
        for col in ('o', 'h', 'l'):
            df[col] = df[col].values * adj
        df['c'] = c
        df['v'] = df['v'] / adj
        out[s] = df
    return out
