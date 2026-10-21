'use strict';
// bp-model.js: olculmus olasilik modeli. Gunluk mumlardan (yalniz gecmis veri) ozellik dizileri ve model tahmini.
// Ozellikler mutlak (tek hisse + XU100 ile hesaplanir; capraz kesit siralamasi gerekmez), ayni kod arastirma veri setini
// (tools/arastirma) ve uygulamadaki analizi besler: egitimde ve uygulamada birebir ayni hesap.
// rows: [{t(ms),o,h,l,c,v}] eskiden yeniye; bench: XU100 gunluk mumlari (ayni bicim) ya da null.
const fin=Number.isFinite;
const DAY=864e5,dayOf=t=>Math.floor((t+3*3600e3)/DAY);

function emaA(a,n){const k=2/(n+1),o=new Float64Array(a.length);let v=NaN;for(let i=0;i<a.length;i++){const x=a[i];v=fin(v)?x*k+v*(1-k):x;o[i]=v}return o}
// Wilder RSI (engine.js rsi ile ayni): ilk n farkin ortalamasiyla baslar
function rsiA(c,n=14){const o=new Float64Array(c.length).fill(NaN);if(c.length<=n)return o;let g=0,l=0;
  for(let i=1;i<=n;i++){const d=c[i]-c[i-1];if(d>0)g+=d;else l-=d}g/=n;l/=n;o[n]=l?100-100/(1+g/l):g?100:50;
  for(let i=n+1;i<c.length;i++){const d=c[i]-c[i-1];g=(g*(n-1)+Math.max(d,0))/n;l=(l*(n-1)+Math.max(-d,0))/n;o[i]=l?100-100/(1+g/l):g?100:50}return o}
// Wilder ATR ve ADX/DI
function adxA(h,l,c,n=14){const N=c.length,atr=new Float64Array(N).fill(NaN),adx=new Float64Array(N).fill(NaN),dmi=new Float64Array(N).fill(NaN);
  let tr=0,pd=0,md=0,dx=0,k=0;
  for(let i=1;i<N;i++){const t=Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])),up=h[i]-h[i-1],dn=l[i-1]-l[i];
    const p=up>dn&&up>0?up:0,m=dn>up&&dn>0?dn:0;
    if(i<=n){tr+=t;pd+=p;md+=m;if(i===n){atr[i]=tr/n}}else{tr=tr-tr/n+t;pd=pd-pd/n+p;md=md-md/n+m;atr[i]=tr/n}
    if(i>=n&&tr>0){const P=100*pd/tr,M=100*md/tr,d=P+M?100*Math.abs(P-M)/(P+M):0;dmi[i]=(P-M)/100;
      if(k<n){dx+=d;k++;if(k===n)adx[i]=dx/n}else{const prev=adx[i-1];adx[i]=fin(prev)?(prev*(n-1)+d)/n:NaN}}}
  return {atr,adx,dmi}}

// XU100 kapanislarini hisse gunlerine hizala (o gun ya da oncesindeki son kapanis)
function alignBench(rows,bench){const N=rows.length,o=new Float64Array(N).fill(NaN);if(!Array.isArray(bench)||!bench.length)return o;
  const b=bench.filter(r=>r&&fin(r.c)&&r.c>0).map(r=>[dayOf(r.t),r.c]).sort((x,y)=>x[0]-y[0]);let j=-1;
  for(let i=0;i<N;i++){const d=dayOf(rows[i].t);while(j+1<b.length&&b[j+1][0]<=d)j++;if(j>=0&&d-b[j][0]<=7)o[i]=b[j][1]}return o}

const NAMES=['m5','m21','m63','m126','m252x','rs5','rs21','rs63','rs126','rs252','d20','d50','d200','e50s','e200s','hi252','lo252','hi63','dsh',
  'rsi','macdh','adx','dmi','bbp','bbw','vol21','vol63','vr','atrp','beta','idio','max21','min21','tv5','tv21','upv','clv','size','amih',
  'shk','shkUp','shkDn','gap','r1','mkt21','mkt63','mktd200','mktvol','mktrsi'];

// Tum ozellik dizileri: {names, n, col:{ad: Float64Array}} (yetersiz gecmiste NaN)
function series(rows,bench){
  const N=rows.length,col={};for(const k of NAMES)col[k]=new Float64Array(N).fill(NaN);
  if(N<30)return {names:NAMES,n:N,col};
  const o=rows.map(r=>r.o),h=rows.map(r=>r.h),l=rows.map(r=>r.l),c=rows.map(r=>r.c),v=rows.map(r=>fin(r.v)&&r.v>0?r.v:0);
  const b=alignBench(rows,bench),hasB=b.some(fin);
  const lr=new Float64Array(N).fill(NaN),br=new Float64Array(N).fill(NaN);
  for(let i=1;i<N;i++){lr[i]=Math.log(c[i]/c[i-1]);if(fin(b[i])&&fin(b[i-1]))br[i]=Math.log(b[i]/b[i-1])}
  const e12=emaA(c,12),e26=emaA(c,26),e20=emaA(c,20),e50=emaA(c,50),e200=emaA(c,200),R=rsiA(c,14),X=adxA(h,l,c,14);
  const mac=new Float64Array(N);for(let i=0;i<N;i++)mac[i]=e12[i]-e26[i];const sig=emaA(mac,9);
  const be200=hasB?emaA(Array.from(b,x=>x),200):null,bR=hasB?rsiA(Array.from(b),14):null;
  const ret=(a,i,k)=>i-k>=0&&fin(a[i])&&fin(a[i-k])&&a[i-k]>0?a[i]/a[i-k]-1:NaN;
  for(let i=1;i<N;i++){
    const x=c[i];
    col.m5[i]=ret(c,i,5);col.m21[i]=ret(c,i,21);col.m63[i]=ret(c,i,63);col.m126[i]=ret(c,i,126);
    col.m252x[i]=i>=252?c[i-21]/c[i-252]-1:NaN;
    for(const k of [5,21,63,126,252])col['rs'+k][i]=ret(c,i,k)-ret(b,i,k);
    if(i>=20)col.d20[i]=x/e20[i]-1;if(i>=50)col.d50[i]=x/e50[i]-1;if(i>=200)col.d200[i]=x/e200[i]-1;
    if(i>=60)col.e50s[i]=e50[i]/e50[i-10]-1;if(i>=220)col.e200s[i]=e200[i]/e200[i-20]-1;
    if(i>=251){let mx=-Infinity,mi=Infinity,am=i;for(let j=i-251;j<=i;j++){if(h[j]>=mx){mx=h[j];am=j}if(l[j]<mi)mi=l[j]}
      col.hi252[i]=x/mx-1;col.lo252[i]=x/mi-1;col.dsh[i]=(i-am)/252}
    if(i>=62){let mx=-Infinity;for(let j=i-62;j<=i;j++)if(h[j]>mx)mx=h[j];col.hi63[i]=x/mx-1}
    col.rsi[i]=R[i];if(i>=35)col.macdh[i]=(mac[i]-sig[i])/x;col.adx[i]=X.adx[i];col.dmi[i]=X.dmi[i];
    if(fin(X.atr[i]))col.atrp[i]=X.atr[i]/x;
    if(i>=19){let s=0,s2=0;for(let j=i-19;j<=i;j++){s+=c[j];s2+=c[j]*c[j]}const m=s/20,sd=Math.sqrt(Math.max(0,s2/20-m*m));
      col.bbp[i]=sd>0?(x-(m-2*sd))/(4*sd):0.5;col.bbw[i]=m>0?4*sd/m:NaN}
    const sd=(k)=>{if(i<k)return NaN;let s=0,s2=0;for(let j=i-k+1;j<=i;j++){s+=lr[j];s2+=lr[j]*lr[j]}const m=s/k;return Math.sqrt(Math.max(0,s2/k-m*m))};
    col.vol21[i]=sd(21);col.vol63[i]=sd(63);col.vr[i]=col.vol63[i]>0?col.vol21[i]/col.vol63[i]:NaN;
    if(i>=63&&hasB){let n=0,sx=0,sy=0,sxx=0,sxy=0,syy=0;for(let j=i-62;j<=i;j++){const a=br[j],y=lr[j];if(!fin(a)||!fin(y))continue;n++;sx+=a;sy+=y;sxx+=a*a;sxy+=a*y;syy+=y*y}
      if(n>=40){const vx=sxx/n-(sx/n)**2,cxy=sxy/n-(sx/n)*(sy/n),vy=syy/n-(sy/n)**2,beta=vx>0?cxy/vx:NaN;col.beta[i]=beta;
        col.idio[i]=fin(beta)?Math.sqrt(Math.max(0,vy-beta*beta*vx)):NaN}}
    if(i>=21){let mx=-Infinity,mi=Infinity;for(let j=i-20;j<=i;j++){const r=c[j]/c[j-1]-1;if(r>mx)mx=r;if(r<mi)mi=r}col.max21[i]=mx;col.min21[i]=mi}
    const mv=(a,k)=>{if(i<k-1)return NaN;let s=0;for(let j=i-k+1;j<=i;j++)s+=a[j];return s/k};
    if(i>=125){const v5=mv(v,5),v21=mv(v,21),v63=mv(v,63),v126=mv(v,126);col.tv5[i]=v63>0&&v5>0?Math.log(v5/v63):NaN;col.tv21[i]=v126>0&&v21>0?Math.log(v21/v126):NaN}
    if(i>=21){let up=0,all=0,cl=0;for(let j=i-20;j<=i;j++){all+=v[j];if(c[j]>c[j-1])up+=v[j];const rg=h[j]-l[j];cl+=rg>0?((c[j]-l[j])-(h[j]-c[j]))/rg:0}
      col.upv[i]=all>0?up/all:NaN;col.clv[i]=cl/21}
    if(i>=63&&fin(b[i])){let dv=0,am=0,n=0;for(let j=i-62;j<=i;j++){const tv=c[j]*v[j];dv+=tv;if(tv>0){am+=Math.abs(c[j]/c[j-1]-1)/(tv/b[i]);n++}}
      col.size[i]=dv>0?Math.log(dv/63/b[i]):NaN;col.amih[i]=n>=40?Math.log(am/n+1e-12):NaN}
    // Haber izi: son 5 mumda |getiri| >= 2.5 x onceki 20 gunun ort. mutlak getirisi ve hacim >= 2 x ort. hacim olan en buyuk mum
    if(i>=26){let ma=0,mvv=0;for(let j=i-24;j<=i-5;j++){ma+=Math.abs(c[j]/c[j-1]-1);mvv+=v[j]}ma=ma/20||0.01;mvv=mvv/20||1;let best=0;
      for(let j=i-4;j<=i;j++){const r=c[j]/c[j-1]-1;if(Math.abs(r)>=2.5*ma&&v[j]>=2*mvv&&Math.abs(r)>Math.abs(best))best=r}
      col.shk[i]=best;col.shkUp[i]=best>0?1:0;col.shkDn[i]=best<0?1:0}
    col.gap[i]=o[i]/c[i-1]-1;col.r1[i]=x/c[i-1]-1;
    if(hasB){col.mkt21[i]=ret(b,i,21);col.mkt63[i]=ret(b,i,63);if(i>=200&&fin(b[i]))col.mktd200[i]=b[i]/be200[i]-1;
      if(i>=21){let s=0,s2=0,n=0;for(let j=i-20;j<=i;j++)if(fin(br[j])){s+=br[j];s2+=br[j]*br[j];n++}if(n>=15)col.mktvol[i]=Math.sqrt(Math.max(0,s2/n-(s/n)**2))}
      col.mktrsi[i]=bR[i]}}
  return {names:NAMES,n:N,col}}

// Son mumun ozellikleri: {ad: sayi|null}
function features(rows,bench){const s=series(rows,bench),o={};for(const k of NAMES){const v=s.col[k][s.n-1];o[k]=fin(v)?v:null}return o}

module.exports={NAMES,series,features,alignBench,emaA,rsiA,adxA,dayOf};
