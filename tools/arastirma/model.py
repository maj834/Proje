import sys, json, warnings; warnings.filterwarnings('ignore'); sys.path.insert(0,'/home/user/Proje/tools/arastirma')
import lab, numpy as np, pandas as pd
from sklearn.linear_model import Ridge
import lightgbm as lgb
d=lab.load()
ALL=['m5','m21','m63','m126','m252x','rs5','rs21','rs63','rs126','rs252','d20','d50','d200','e50s','e200s','hi252','lo252','hi63','dsh','rsi','macdh','adx','dmi','bbp','bbw','vol21','vol63','vr','atrp','beta','idio','max21','min21','tv5','tv21','upv','clv','size','amih','shk','shkUp','shkDn','gap','r1','mkt21','mkt63','mktd200','mktvol','mktrsi']
ROB=['vol21','atrp','idio','max21','min21','size','bbw','tv21','tv5','hi252','hi63','clv','amih','adx','dsh','shkDn','gap']
E=d[d.donem=='egitim'];V=d[d.donem=='dogrulama']
def prep(F):
    st={}
    for f in F:
        x=E[f].astype(float);lo,hi=x.quantile(.01),x.quantile(.99);xc=x.clip(lo,hi);st[f]=dict(lo=float(lo),hi=float(hi),mu=float(xc.mean()),sd=float(xc.std() or 1))
    return st
def X(df,st):
    return np.column_stack([((df[f].astype(float).clip(s['lo'],s['hi'])-s['mu'])/s['sd']).fillna(0).values for f,s in st.items()])
def ev(name,col):
    out={}
    for p,g in d.assign(_p=col).groupby('donem'):
        out[p]={'ic20':lab.ic(g,'_p','ex20')['ic'],'ic40':lab.ic(g,'_p','ex40')['ic'],'ic10':lab.ic(g,'_p','ex10')['ic']}
    s=lab.sinyal(d.assign(_p=col),'_p',h=20);s10=lab.sinyal(d.assign(_p=col),'_p',h=10)
    print(name,json.dumps(out),'\n  S20',{p:{k:s[p][k] for k in ('taban_yuk','AL_yuk','AL_fazla','AL_ort','SAT_dus','SAT_eksik','SAT_ort')} for p in ('egitim','dogrulama')},
      '\n  S10',{p:{k:s10[p][k] for k in ('taban_yuk','AL_yuk','AL_fazla','SAT_dus','SAT_eksik')} for p in ('egitim','dogrulama')})
y=E['ex20'].clip(E['ex20'].quantile(.01),E['ex20'].quantile(.99)).fillna(0)
ev('skor',d['skor'])
res={}
for nm,F in (('rob',ROB),('all',ALL)):
    st=prep(F)
    for a in (10,1000,30000):
        m=Ridge(alpha=a).fit(X(E,st),y);p=m.predict(X(d,st));ev(f'ridge_{nm}_{a}',p);res[(nm,a)]=(st,m)
# lightgbm
st=prep(ALL);ytr=E.groupby('tarih')['ex20'].rank(pct=True)
for nl,ne in ((8,200),(8,500)):
    g=lgb.LGBMRegressor(num_leaves=nl,learning_rate=0.03,n_estimators=ne,min_child_samples=1000,subsample=0.8,subsample_freq=1,colsample_bytree=0.7,n_jobs=3,verbose=-1)
    g.fit(E[ALL].astype(float),ytr.fillna(.5));ev(f'lgb_{nl}_{ne}',g.predict(d[ALL].astype(float)))
import pickle;pickle.dump(res,open('ridge.pkl','wb'))
