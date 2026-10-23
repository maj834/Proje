"""Yahoo gunluk fiyat gecmisi (GitHub Actions). Yahoo sunuculardan gelen duz isteklere 429 veriyor; curl_cffi ile tarayici
taklidi + cerez isitma (Hisse projesindeki yontem). Cikti bicimi tools/veri-cek.js 'fiyat' ile ayni: tools/veri/yfiyat-<k>.json.br
Kullanim: python3 tools/veri-cek-yahoo.py <parca> <parca_sayisi> [aralik=10y]"""
import json, os, subprocess, sys, time
import brotli
from curl_cffi import requests as creq

K, N = int(sys.argv[1]), int(sys.argv[2])
RANGE = sys.argv[3] if len(sys.argv) > 3 else '10y'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
syms = json.loads(subprocess.check_output(['node', '-e', "console.log(JSON.stringify(require('./bp-data.js').U.BIST500))"], cwd=ROOT))
syms = [s for i, s in enumerate(syms) if i % N == K]
idx = ['XU100.IS', 'XU030.IS', 'XBANK.IS', 'XUSIN.IS', 'XUMAL.IS', 'XUHIZ.IS', 'XUTEK.IS', 'XHOLD.IS', 'USDTRY=X', 'EURTRY=X', 'GC=F', 'BZ=F', '^GSPC', '^VIX', 'EEM'] if K == 0 else []
S = creq.Session(impersonate='chrome')
for u in ('https://fc.yahoo.com', 'https://finance.yahoo.com/quote/ASELS.IS/'):
    try:
        S.get(u, timeout=15)
    except Exception:
        pass
N429 = 0


def p6(v):
    return None if v is None else float('%.6g' % v)


def chart(y):
    global N429
    for k in range(4):
        for host in ('query1.finance.yahoo.com', 'query2.finance.yahoo.com'):
            try:
                r = S.get(f'https://{host}/v8/finance/chart/{y}?range={RANGE}&interval=1d&events=div%2Csplits&includePrePost=false', timeout=30)
                if r.status_code == 429:
                    N429 += 1
                    time.sleep(2 + 2 * k)
                    continue
                if r.status_code == 404:
                    return None
                if r.status_code == 200:
                    res = (r.json().get('chart') or {}).get('result')
                    return res[0] if res else None
            except Exception:
                time.sleep(2)
    return None


def conv(q):
    ts = q.get('timestamp') or []
    o = q['indicators']['quote'][0]
    ac = ((q['indicators'].get('adjclose') or [{}])[0] or {}).get('adjclose') or [None] * len(ts)
    out = dict(t=[], o=[], h=[], l=[], c=[], ac=[], v=[])
    for i, t in enumerate(ts):
        vals = [o['open'][i], o['high'][i], o['low'][i], o['close'][i]]
        if any(v is None for v in vals) or not vals[3] > 0:
            continue
        out['t'].append(int((t * 1000 + 3 * 3600e3) // 864e5))
        out['o'].append(p6(vals[0])); out['h'].append(p6(vals[1])); out['l'].append(p6(vals[2])); out['c'].append(p6(vals[3]))
        out['ac'].append(p6(ac[i] if ac[i] is not None else vals[3])); out['v'].append(int(o['volume'][i] or 0))
    ev = q.get('events') or {}
    out['splits'] = [[round(s['date'] * 1000 / 864e5), s.get('numerator'), s.get('denominator')] for s in (ev.get('splits') or {}).values()]
    out['div'] = [[round(d['date'] * 1000 / 864e5), p6(d.get('amount'))] for d in (ev.get('dividends') or {}).values()]
    return out


data, miss, t0 = {}, [], time.time()
for j, y in enumerate(idx + [s + '.IS' for s in syms]):
    q = chart(y)
    if q and len(q.get('timestamp') or []) > 60:
        data[y[:-3] if y.endswith('.IS') and y[:-3] in syms else y] = conv(q)
    else:
        miss.append(y)
    time.sleep(0.3)
    if (j + 1) % 20 == 0:
        print('fiyat', j + 1, '/', len(idx) + len(syms), int(time.time() - t0), 'sn', '429:', N429, flush=True)
print('fiyat', len(data), 'eksik', len(miss), '429:', N429, ' '.join(miss), flush=True)
os.makedirs(os.path.join(ROOT, 'tools', 'veri'), exist_ok=True)
buf = brotli.compress(json.dumps(dict(alindi=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), kaynak='Yahoo chart %s 1d (curl_cffi); t=UTC+3 gun no; ac=temettu/bolunme duzeltilmis' % RANGE, eksik=miss, data=data), separators=(',', ':')).encode(), quality=11)
open(os.path.join(ROOT, 'tools', 'veri', 'yfiyat-%d.json.br' % K), 'wb').write(buf)
print('yazildi', len(buf) / 1e6, 'MB')
