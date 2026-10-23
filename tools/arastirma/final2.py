import sys, json, warnings; warnings.filterwarnings('ignore'); sys.path.insert(0,'/home/user/Proje/tools/arastirma')
import lab, numpy as np, pandas as pd, lightgbm as lgb
d=lab.load(include_test=True)
ALL=['m5','m21','m63','m126','m252x','rs5','rs21','rs63','rs126','rs252','d20','d50','d200','e50s','e200s','hi252','lo252','hi63','dsh','rsi','macdh','adx','dmi','bbp','bbw','vol21','vol63','vr','atrp','beta','idio','max21','min21','tv5','tv21','upv','clv','size','amih','shk','shkUp','shkDn','gap','r1','mkt21','mkt63','mktd200','mktvol','mktrsi']
P=dict(num_leaves=8,learning_rate=0.03,n_estimators=200,min_child_samples=1000,subsample=0.8,subsample_freq=1,colsample_bytree=0.7,n_jobs=3,verbose=-1,random_state=1)
def fit(E):return lgb.LGBMRegressor(**P).fit(E[ALL].astype(float),E.groupby('tarih')['ex20'].rank(pct=True).fillna(.5))
g=fit(d[d.donem=='egitim']);d['p']=g.predict(d[ALL].astype(float))
E=d[d.donem=='egitim'];qs=np.quantile(E['p'],np.linspace(0,1,101))
d['v']=np.interp(d['p'],qs,np.linspace(-1,1,101))
for w in ():
    d['b']=w*d['v']+(1-w)*d['skor']/100
    print(w,{p:round(lab.ic(d[d.donem==p],'b','ex20')['ic'],4) for p in ('dogrulama','test')})
# out-of-sample calibration (dogrulama+test) by v bucket
O=d[d.donem!='egitim'].copy();O['k']=pd.cut(O['v'],[-1.01,-.6,-.2,.2,.6,1.01])
cal=O.groupby('k').agg(n=('ex20','size'),up20=('ret20',lambda s:(s>0).mean()),pos20=('ex20',lambda s:(s>0).mean()),ex20=('ex20','mean'),up10=('ret10',lambda s:(s>0).mean()),ex10=('ex10','mean'))
print(cal.round(3))
# final model on all data
F=fit(d[d.ret20.notna()]);pf=F.predict(d[ALL].astype(float));qf=np.quantile(pf,np.linspace(0,1,101))
dump=F.booster_.dump_model()
def tree(n):
    if 'leaf_value' in n:return round(n['leaf_value'],6)
    return [ALL.index(n['split_feature']) if isinstance(n['split_feature'],int)==False else n['split_feature'],round(n['threshold'],6),1 if n.get('default_left') else 0,tree(n['left_child']),tree(n['right_child'])]
names=dump['feature_names']
def tree2(n):
    if 'leaf_value' in n:return round(n['leaf_value'],6)
    mt={'None':0,'Zero':1,'NaN':2}[n.get('missing_type','None')]
    return [n['split_feature'],float('%.9g'%n['threshold']),(1 if n.get('default_left') else 0)+2*mt,tree2(n['left_child']),tree2(n['right_child'])]
M=dict(ozellik=names,agac=[tree2(t['tree_structure']) for t in dump['tree_info']],q=[float('%.6g'%x) for x in qf],
  kalib=[[float(r.k.left),float(r.k.right),int(r.n),round(r.up20,3),round(r.pos20,3),round(r.ex20,4),round(r.up10,3),round(r.ex10,4)] for r in cal.reset_index().itertuples()])
json.dump(M,open('model.json','w'),separators=(',',':'))
print('agac',len(M['agac']),'boyut',len(json.dumps(M,separators=(',',':')))//1024,'KB')
# parity sample
s=d[d.donem=='test'].head(5);print(json.dumps({'X':s[ALL].astype(float).where(s[ALL].notna(),None).values.tolist(),'y':F.predict(s[ALL].astype(float)).tolist()}),file=open('parity.json','w'))
