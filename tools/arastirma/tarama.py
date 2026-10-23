import sys; sys.path.insert(0,'/home/user/Proje/tools/arastirma')
import lab, numpy as np, pandas as pd
sys.path.insert(0,'.')
d=lab.load()
NAMES=[c for c in d.columns if c not in ('s','gun','tarih','b100','fiyat','kirik','skor','etiket','guven','donem') and not c.startswith(('ret','ex','c_'))]
rows=[]
for c in NAMES:
    r={'f':c}
    for p,g in d.groupby('donem'):
        for y in ('ex20','ex40'):
            a=lab.ic(g,c,y);r[p[:3]+y]=a['ic'];r[p[:3]+y+'t']=a['t']
    rows.append(r)
t=pd.DataFrame(rows).set_index('f')
t['tutarli']=np.sign(t['egiex20'])==np.sign(t['dogex20'])
print(t.sort_values('egiex20').round(3).to_string())
