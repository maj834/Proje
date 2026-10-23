import sys, json, warnings; warnings.filterwarnings('ignore'); sys.path.insert(0,'/home/user/Proje/tools/arastirma')
import lab, numpy as np, pandas as pd, lightgbm as lgb
d=lab.load(include_test=True)
ALL=['m5','m21','m63','m126','m252x','rs5','rs21','rs63','rs126','rs252','d20','d50','d200','e50s','e200s','hi252','lo252','hi63','dsh','rsi','macdh','adx','dmi','bbp','bbw','vol21','vol63','vr','atrp','beta','idio','max21','min21','tv5','tv21','upv','clv','size','amih','shk','shkUp','shkDn','gap','r1','mkt21','mkt63','mktd200','mktvol','mktrsi']
def fit(E):
    g=lgb.LGBMRegressor(num_leaves=8,learning_rate=0.03,n_estimators=200,min_child_samples=1000,subsample=0.8,subsample_freq=1,colsample_bytree=0.7,n_jobs=3,verbose=-1,random_state=1)
    return g.fit(E[ALL].astype(float),E.groupby('tarih')['ex20'].rank(pct=True).fillna(.5))
g=fit(d[d.donem=='egitim'])
d['p']=g.predict(d[ALL].astype(float))
T=d[d.donem=='test']
for c in ('skor','p'):
    print(c,{y:lab.ic(T,c,y)['ic'] for y in ('ex10','ex20','ex40')},lab.quint(T,c,'ex20'))
    for h in (10,20):
        s=lab.sinyal(d,c,h=h);print('  h',h,s['test'])
# b100 subset
B=T[T.b100==1]
for c in ('skor','p'):print('b100',c,{y:lab.ic(B,c,y)['ic'] for y in ('ex10','ex20')})
