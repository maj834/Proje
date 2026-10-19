// Borsa Pro olasilik ve analist motoru. Hissenin KENDI gecmisinde benzer durumlar ne siklikla olustu, sonra ne oldu:
// - skor calismasi: bugunku teknik skora yakin gunlerden sonra 5/10/20 mum getirileri (tum gunlerle kiyas)
// - kurulum calismasi: ayni trend + RSI bolgesi + MACD yonu kosullarindaki gunlerden sonra getiriler
// - plan olasiligi: ATR'ye gore ayni uzakliktaki hedefe stoptan once ulasma orani (gecmisteki her gunden simulasyon)
// - beklenen aralik: h mumluk getirilerin dagilimi, bugunku oynakliga gore olceklenmis (%68 / %90)
// - mevsimsellik, teknik ozet tablosu (hareketli ortalama + osilator oylari), piyasa rejimi (XU100)
// - analist notu (Guclu Al/Al/Tut/Azalt/Sat), hedef araligi ve kurala dayali Turkce rapor
// Ileriye bakma yoktur: her ornek yalniz o gune kadarki veriyle hesaplanir, sonucu sonraki mumlardan okunur.
// Ornekler ortusur (ardisik gunler benzer); n bu yuzden bagimsiz gozlem sayisi degildir. Yatirim tavsiyesi degildir.
(function(root,factory){
  const node=typeof module!=='undefined'&&module.exports,api=factory(node?require('./engine'):root.Engine);
  if(node)module.exports=api;else root.BPQuant=api;
})(this,function(E){
'use strict';
const fin=v=>typeof v==='number'&&Number.isFinite(v);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const r1=v=>fin(v)?Math.round(v*10)/10:null,r2=v=>fin(v)?Math.round(v*100)/100:null,r4=v=>fin(v)?+v.toFixed(4):null;
const nf=(v,d=2)=>fin(v)?v.toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
// Yuvarlanmis deger sifirsa isaret yok (−%0,0 gorunmesin)
const pc=(v,d=1)=>{if(!fin(v))return '—';const k=10**d,x=Math.round(v*k)/k;return (x>0?'+':x<0?'−':'')+'%'+nf(Math.abs(x),d)};
const DAY=86400000;

// Gecerli, siralanmis, tekrarsiz mumlar
function clean(rows){const out=[];let last=-Infinity;
  for(const r of (Array.isArray(rows)?rows:[]).filter(r=>r&&[r.o,r.h,r.l,r.c].every(fin)&&r.c>0&&r.l>0&&r.h>=r.l).sort((a,b)=>(a.t||0)-(b.t||0))){
    if(fin(r.t)&&r.t===last){out[out.length-1]=r;continue}last=r.t;out.push(r)}
  return out}

// Siralanmis dizide yuzdelik (dogrusal ara deger)
function q(sorted,p){if(!sorted.length)return null;const i=(sorted.length-1)*p,a=Math.floor(i),b=Math.ceil(i);return sorted[a]+(sorted[b]-sorted[a])*(i-a)}
function dist(xs){const v=xs.filter(fin);if(!v.length)return {n:0,mean:null,median:null,win:null,p10:null,p25:null,p75:null,p90:null};
  const s=v.slice().sort((a,b)=>a-b),m=v.reduce((a,b)=>a+b,0)/v.length;
  return {n:v.length,mean:r2(m),median:r2(q(s,0.5)),win:r1(v.filter(x=>x>0).length/v.length*100),p10:r2(q(s,0.1)),p25:r2(q(s,0.25)),p75:r2(q(s,0.75)),p90:r2(q(s,0.9))}}
const fwd=(c,i,h)=>i+h<c.length?(c[i+h]/c[i]-1)*100:null;

// Her mum icin teknik skor (-1..1): engine.systemSignals ile ayni agirliklar (trend + momentum). Ilk 50 mum null.
function scoreSeries(rows){
  const c=rows.map(r=>r.c),e20=E.emaS(c,20),e50=E.emaS(c,50),e200=E.emaS(c,200),R=E.rsi(c,14),M=E.macdS(c).hist,out=new Array(c.length).fill(null);
  for(let i=50;i<c.length;i++){if(!fin(e20[i])||!fin(e50[i])||!fin(e50[i-5]))continue;let s=0,w=0;const add=(v,wt)=>{s+=v*wt;w+=wt};
    add(c[i]>e20[i]?1:-1,0.15);add(e20[i]>e50[i]?1:-1,0.25);add(Math.sign(e50[i]-e50[i-5]),0.15);if(fin(e200[i]))add(c[i]>e200[i]?1:-1,0.15);
    if(fin(M[i]))add(Math.sign(M[i]),0.15);if(fin(R[i]))add(R[i]>=70?-0.5:R[i]>=55?1:R[i]<=30?0.5:R[i]<=45?-1:0,0.15);out[i]=s/w}
  return out}

// Skor calismasi: bugunku skora +-band yakin gecmis gunler (yeterli ornek yoksa band genisler) -> h mum sonraki getiri dagilimi
function scoreStudy(rows,{horizons=[5,10,20],band=0.12,minN=25}={}){
  rows=clean(rows);const N=rows.length;if(N<120)return null;
  const S=scoreSeries(rows),c=rows.map(r=>r.c),now=S[N-1];if(!fin(now))return null;
  let b=band,idx=[];const H=Math.max(...horizons);
  for(;b<=0.5;b+=0.06){idx=[];for(let i=50;i<N-H;i++)if(fin(S[i])&&Math.abs(S[i]-now)<=b)idx.push(i);if(idx.length>=minN)break}
  if(idx.length<10)return null;
  const all=[];for(let i=50;i<N-H;i++)if(fin(S[i]))all.push(i);
  return {score:r2(now),band:r2(Math.min(b,0.5)),n:idx.length,horizons:horizons.map(h=>{const d=dist(idx.map(i=>fwd(c,i,h))),base=dist(all.map(i=>fwd(c,i,h)));
    return {h,...d,baseMean:base.mean,baseWin:base.win,edge:fin(d.mean)&&fin(base.mean)?r2(d.mean-base.mean):null}})}}

// Kurulum: trend (EMA200'e gore), RSI bolgesi, MACD histogram yonu. Ayni kosullu gunlerden sonra getiriler.
const RSI_Z=[[0,30,'RSI ≤ 30'],[30,45,'RSI 30–45'],[45,55,'RSI 45–55'],[55,70,'RSI 55–70'],[70,101,'RSI ≥ 70']];
const zoneOf=r=>fin(r)?RSI_Z.findIndex(z=>r>=z[0]&&r<z[1]):-1;
function setupStudy(rows,{horizons=[10,20],minN=20}={}){
  rows=clean(rows);const N=rows.length;if(N<220)return null;
  const c=rows.map(r=>r.c),e200=E.emaS(c,200),R=E.rsi(c,14),M=E.macdS(c).hist,H=Math.max(...horizons);
  const f=i=>({t:fin(e200[i])?(c[i]>e200[i]?1:-1):0,z:zoneOf(R[i]),m:fin(M[i])?Math.sign(M[i]):0});
  const now=f(N-1);if(!now.t||now.z<0)return null;
  const levels=[[x=>x.t===now.t&&x.z===now.z&&x.m===now.m,true,true],[x=>x.t===now.t&&x.z===now.z,true,false],[x=>x.t===now.t&&Math.abs(x.z-now.z)<=1,false,false]];
  for(const [ok,exactZ,useM] of levels){const idx=[];for(let i=200;i<N-H;i++)if(ok(f(i)))idx.push(i);
    if(idx.length<minN)continue;
    const desc=[now.t>0?'Fiyat EMA200 üstünde':'Fiyat EMA200 altında',exactZ?RSI_Z[now.z][2]:'RSI '+RSI_Z[Math.max(0,now.z-1)][0]+'–'+(RSI_Z[Math.min(4,now.z+1)][1]>100?100:RSI_Z[Math.min(4,now.z+1)][1]),
      useM?(now.m>0?'MACD pozitif':now.m<0?'MACD negatif':null):null].filter(Boolean).join(' · ');
    return {desc,n:idx.length,relaxed:!useM,horizons:horizons.map(h=>({h,...dist(idx.map(i=>fwd(c,i,h)))}))}}
  return null}

// Plan olasiligi: bugunku plan ATR cinsinden (stop uzakligi, hedef uzakliklari) gecmisin her gunune uygulanir.
// Ayni mumda hem hedef hem stop gorulurse stop sayilir (temkinli). maxBars icinde hicbiri yoksa "sure doldu".
// trendCond: bugunle ayni trend tarafindaki (EMA200) gunlerle sinirla (yeterli ornek varsa).
function planOdds(rows,plan,{maxBars=40,minN=40}={}){
  rows=clean(rows);const N=rows.length;if(N<120||!plan||plan.wait||!Array.isArray(plan.entry))return null;
  const dir=plan.dir<0?-1:1,ref=dir>0?plan.entry[1]:plan.entry[0],A=E.atrS(rows,14),atr=A[N-1];
  if(!fin(ref)||!fin(atr)||atr<=0||!fin(plan.stop)||!fin(plan.t1))return null;
  const dS=Math.abs(ref-plan.stop)/atr,d1=Math.abs(plan.t1-ref)/atr,d2=fin(plan.t2)?Math.abs(plan.t2-ref)/atr:null;if(!(dS>0)||!(d1>0))return null;
  const c=rows.map(r=>r.c),e200=E.emaS(c,200),side=fin(e200[N-1])?Math.sign(c[N-1]-e200[N-1]):0;
  const sim=(filter)=>{let n=0,h1=0,h2=0,st=0,no=0,b1=0;
    for(let i=20;i<N-1;i++){if(!fin(A[i])||A[i]<=0||(filter&&!filter(i)))continue;const s0=c[i],a=A[i];
      const stop=s0-dir*dS*a,t1=s0+dir*d1*a,t2=d2!=null?s0+dir*d2*a:null;let r1=null,r2=null;
      for(let j=i+1;j<=Math.min(N-1,i+maxBars);j++){const r=rows[j],hitS=dir>0?r.l<=stop:r.h>=stop;
        const got1=dir>0?r.h>=t1:r.l<=t1,got2=t2!=null&&(dir>0?r.h>=t2:r.l<=t2);
        if(hitS){if(r1==null)r1='stop';if(r2==null)r2='stop';break}
        if(r1==null&&got1){r1='t1';b1+=j-i}if(r2==null&&got2)r2='t2';
        if(r1!=null&&(r2!=null||t2==null))break}
      if(i+maxBars>N-1&&r1==null)continue;            // sonucu henuz belli olmayan son gunler sayilmaz
      n++;if(r1==='t1')h1++;else if(r1==='stop')st++;else no++;if(r2==='t2')h2++}
    return {n,h1,h2,st,no,b1}};
  let cond='trend',s=side?sim(i=>fin(e200[i])&&Math.sign(c[i]-e200[i])===side):null;
  if(!s||s.n<minN){cond='tum';s=sim(null)}
  if(s.n<20)return null;
  const p1=s.h1/s.n,pS=s.st/s.n,R1=d1/dS;
  return {n:s.n,cond,maxBars,dir,p1:r1(p1*100),p2:d2!=null?r1(s.h2/s.n*100):null,pStop:r1(pS*100),pNone:r1(s.no/s.n*100),avgBars1:s.h1?r1(s.b1/s.h1):null,
    stopAtr:r2(dS),t1Atr:r2(d1),rr:r2(R1),ev:r2(p1*R1-pS),breakEven:r1(1/(1+R1)*100)}}

// Beklenen aralik: son lookback mumdaki h mumluk log getirilerin yuzdelikleri; yayilim bugunku 20 mum oynakligi / uzun donem oranla olceklenir
function ranges(rows,{horizons=[5,20],lookback=750}={}){
  rows=clean(rows);const N=rows.length;if(N<80)return null;
  const c=rows.map(r=>r.c),lr=[];for(let i=1;i<N;i++)lr.push(Math.log(c[i]/c[i-1]));
  const sd=a=>{const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/Math.max(1,a.length-1))};
  const L=lr.slice(-lookback),vNow=sd(lr.slice(-20)),vLong=sd(L),ratio=vLong>0?clamp(vNow/vLong,0.6,1.8):1,last=c[N-1];
  const out=horizons.map(h=>{const from=Math.max(0,N-1-lookback),xs=[];for(let i=from;i+h<N;i++)xs.push(Math.log(c[i+h]/c[i]));
    if(xs.length<30)return null;const s=xs.sort((a,b)=>a-b),med=q(s,0.5),sc=v=>med+(v-med)*ratio,P=v=>r4(last*Math.exp(sc(v)));
    return {h,p05:P(q(s,0.05)),p16:P(q(s,0.16)),p50:P(med),p84:P(q(s,0.84)),p95:P(q(s,0.95)),n:xs.length}}).filter(Boolean);
  return {last,volNow:r1(vNow*Math.sqrt(252)*100),volLong:r1(vLong*Math.sqrt(252)*100),ratio:r2(ratio),horizons:out}}

// Mevsimsellik (gunluk mumlar): takvim ayi bazinda ortalama getiri ve pozitif yil orani. En az 24 ay.
function seasonality(rows,{now=Date.now()}={}){
  rows=clean(rows).filter(r=>fin(r.t));if(rows.length<300)return null;
  const ym=t=>{const d=new Date(t+3*3600000);return d.getUTCFullYear()*12+d.getUTCMonth()};const ends=new Map();
  for(const r of rows)ends.set(ym(r.t),r.c);
  const keys=[...ends.keys()].sort((a,b)=>a-b),cur=ym(now),rets=[];
  for(let k=1;k<keys.length;k++){if(keys[k]-keys[k-1]!==1||keys[k]===cur)continue;rets.push({m:keys[k]%12,r:(ends.get(keys[k])/ends.get(keys[k-1])-1)*100})}
  if(rets.length<24)return null;
  const months=Array.from({length:12},(_,m)=>{const xs=rets.filter(x=>x.m===m).map(x=>x.r);return {m,n:xs.length,avg:xs.length?r2(xs.reduce((a,b)=>a+b,0)/xs.length):null,win:xs.length?r1(xs.filter(x=>x>0).length/xs.length*100):null}});
  return {months,years:r1(rets.length/12),current:cur%12}}

// --- teknik ozet tablosu (tek zaman dilimi) -------------------------------------------------------------
function cci(rows,n=20){const tp=rows.map(r=>(r.h+r.l+r.c)/3),out=new Array(rows.length).fill(null);
  for(let i=n-1;i<rows.length;i++){const w=tp.slice(i-n+1,i+1),m=w.reduce((a,b)=>a+b,0)/n,md=w.reduce((a,b)=>a+Math.abs(b-m),0)/n;out[i]=md?(tp[i]-m)/(0.015*md):0}return out}
function williams(rows,n=14){return rows.map((r,i)=>{if(i<n-1)return null;let hi=-Infinity,lo=Infinity;for(let j=i-n+1;j<=i;j++){hi=Math.max(hi,rows[j].h);lo=Math.min(lo,rows[j].l)}return hi===lo?-50:(hi-r.c)/(hi-lo)*-100})}
function stochK(rows,n=14,s=3){const raw=rows.map((r,i)=>{if(i<n-1)return null;let hi=-Infinity,lo=Infinity;for(let j=i-n+1;j<=i;j++){hi=Math.max(hi,rows[j].h);lo=Math.min(lo,rows[j].l)}return hi===lo?50:(r.c-lo)/(hi-lo)*100});return E.smaS(raw,s)}
const LBL=s=>s>=0.5?'Güçlü Al':s>=0.1?'Al':s<=-0.5?'Güçlü Sat':s<=-0.1?'Sat':'Nötr';
function techSummary(rows){
  rows=clean(rows);const N=rows.length;if(N<30)return null;const c=rows.map(r=>r.c),x=c[N-1],L=a=>a[N-1];
  const ma=[];for(const n of [5,10,20,50,100,200]){for(const [k,f] of [['SMA',E.smaS],['EMA',E.emaS]]){const v=L(f(c,n));if(!fin(v))continue;
    ma.push({name:k+' '+n,value:r4(v),vote:x>v?1:x<v?-1:0})}}
  const osc=[],add=(name,value,vote)=>{if(fin(value))osc.push({name,value:r2(value),vote})};
  const rsi=L(E.rsi(c,14));add('RSI (14)',rsi,rsi<30?1:rsi>70?-1:0);
  const k=L(stochK(rows));add('Stokastik %K (14, 3)',k,k<20?1:k>80?-1:0);
  const sr=E.stochRsi(c);add('Stokastik RSI (14)',L(sr.k),L(sr.k)<20?1:L(sr.k)>80?-1:0);
  const m=E.macdS(c);add('MACD (12, 26)',L(m.macd),fin(L(m.macd))&&fin(L(m.signal))?(L(m.macd)>L(m.signal)?1:-1):0);
  const A=E.adxS(rows,14);add('ADX (14)',L(A.adx),L(A.adx)>=25?(L(A.pdi)>L(A.mdi)?1:-1):0);
  const w=L(williams(rows));add('Williams %R (14)',w,w<-80?1:w>-20?-1:0);
  const cc=L(cci(rows));add('CCI (20)',cc,cc<-100?1:cc>100?-1:0);
  if(N>10){const mo=(x/c[N-11]-1)*100;add('Momentum (10)',mo,mo>0?1:mo<0?-1:0)}
  const e13=L(E.emaS(c,13));if(fin(e13)){const bp=rows[N-1].h-e13+rows[N-1].l-e13;add('Boğa/Ayı gücü (13)',bp,bp>0?1:-1)}
  const sum=a=>{const b=a.filter(v=>v.vote>0).length,s=a.filter(v=>v.vote<0).length,t=a.length||1,sc=(b-s)/t;return {buy:b,sell:s,neutral:a.length-b-s,score:r2(sc),label:LBL(sc)}};
  const M=sum(ma),O=sum(osc),all=(M.score*ma.length+O.score*osc.length)/Math.max(1,ma.length+osc.length);
  return {ma:{...M,items:ma},osc:{...O,items:osc},overall:{score:r2(all),label:LBL(all)}}}

// Piyasa rejimi (XU100 gunluk): trend, 20 gun getiri, zirveden dusus, oynaklik yuzdeligi; istege bagli genislik (tarama)
function regime(bench,breadth){
  const rows=clean(bench);if(rows.length<210)return null;const c=rows.map(r=>r.c),N=c.length,x=c[N-1];
  const e50=E.emaS(c,50)[N-1],e200=E.emaS(c,200)[N-1],hi=Math.max(...c.slice(-252)),r20=(x/c[N-21]-1)*100,dd=(x/hi-1)*100;
  const lr=[];for(let i=1;i<N;i++)lr.push(Math.log(c[i]/c[i-1]));const vol=i=>{const a=lr.slice(i-20,i),m=a.reduce((p,q)=>p+q,0)/a.length;return Math.sqrt(a.reduce((p,q)=>p+(q-m)**2,0)/19)};
  const vs=[];for(let i=20;i<=lr.length;i+=5)vs.push(vol(i));const vNow=vol(lr.length),vp=vs.filter(v=>v<=vNow).length/vs.length*100;
  let s=0;s+=x>e200?0.35:-0.35;s+=e50>e200?0.25:-0.25;s+=clamp(r20/8,-0.25,0.25);if(vp>85)s-=0.15;if(dd<-15)s-=0.15;
  let br=null;if(breadth&&fin(breadth.up)&&fin(breadth.down)&&breadth.up+breadth.down>=10){br=r1(breadth.up/(breadth.up+breadth.down)*100);s+=clamp((br-50)/100,-0.15,0.15)}
  const dir=s>=0.3?1:s<=-0.3?-1:0;
  return {dir,score:r2(s),label:dir>0?'Risk iştahı yüksek':dir<0?'Riskten kaçış':'Kararsız piyasa',last:x,
    trend:x>e200?(e50>e200?'XU100 yükseliş trendinde (EMA50 > EMA200)':'XU100 EMA200 üstünde, ortalamalar karışık'):(e50<e200?'XU100 düşüş trendinde (EMA50 < EMA200)':'XU100 EMA200 altında'),
    r20:r1(r20),drawdown:r1(dd),volPct:Math.round(vp),breadthPct:br}}

// --- analist notu ve rapor ------------------------------------------------------------------------------
const NOTES=['Sat','Azalt','Tut','Al','Güçlü Al'];
function rating({pro,score,setup,odds,rng,reg,tech}={}){
  if(!pro||!pro.ok)return null;const V=pro.verdict,parts=[],why=[];const add=(v,w,t)=>{if(fin(v)){parts.push([clamp(v,-1,1),w]);if(t)why.push({t,v:v*w})}};
  add(V.score/100,0.4,'Teknik karar '+V.label+' (skor '+(V.score>0?'+':'')+V.score+')');
  const s20=score&&score.horizons.find(h=>h.h===20);
  if(s20&&fin(s20.mean)){const spread=Math.max(2,(s20.p90-s20.p10)/4);add(s20.mean/spread,0.2,'Benzer skorlu günlerden sonra 20 mum ort. '+pc(s20.mean)+' (yükselme %'+nf(s20.win,0)+', n='+s20.n+')')}
  const u20=setup&&setup.horizons.find(h=>h.h===20);
  if(u20&&fin(u20.mean)){const spread=Math.max(2,(u20.p90-u20.p10)/4);add(u20.mean/spread,0.1,'Aynı kurulumda ('+setup.desc+') 20 mum ort. '+pc(u20.mean))}
  if(odds&&fin(odds.ev))add(odds.dir*clamp(odds.ev/0.6,-1,1),0.12,'Plan: hedef stoptan önce %'+nf(odds.p1,0)+' (başabaş %'+nf(odds.breakEven,0)+', beklenen '+(odds.ev>0?'+':'')+nf(odds.ev,2)+'R)');
  if(reg)add(reg.dir*0.8,0.1,'Piyasa: '+reg.label);
  if(tech)add(tech.overall.score,0.08,'Teknik özet tablosu: '+tech.overall.label);
  const W=parts.reduce((a,p)=>a+p[1],0)||1,tot=parts.reduce((a,p)=>a+p[0]*p[1],0)/W;
  const idx=tot>=0.42?4:tot>=0.14?3:tot>-0.14?2:tot>-0.42?1:0;
  // Guven: bilesenlerin ayni yonu gosterme orani + ornek buyuklugu
  const agree=parts.filter(p=>Math.abs(p[0])>0.05&&Math.sign(p[0])===Math.sign(tot)).reduce((a,p)=>a+p[1],0)/W;
  const nOk=Math.min(1,((score&&score.n)||0)/150);
  const conf=Math.round(clamp(35+45*agree+10*nOk+Math.min(10,Math.abs(tot)*20),0,95));
  // Hedef: 1 ay (20 mum) beklenen aralik; baz = medyan, benzer skor calismasi farkiyla kaydirilir (sinirli)
  const R20=rng&&rng.horizons.find(h=>h.h===20),last=fin(pro.last)?pro.last:rng&&rng.last;let target=null;
  if(R20&&fin(last)){const shift=s20&&fin(s20.edge)?clamp(s20.edge,-4,4)/100:0;
    target={base:r4(R20.p50*(1+shift)),low:R20.p16,high:R20.p84,low90:R20.p05,high90:R20.p95,upside:r1((R20.p50*(1+shift)/last-1)*100),h:20}}
  why.sort((a,b)=>Math.abs(b.v)-Math.abs(a.v));
  return {label:NOTES[idx],idx,score:r2(tot),confidence:conf,target,drivers:why.slice(0,5).map(w=>({text:w.t,dir:Math.sign(w.v)}))}}

// Tumu: rows (birincil dilim), daily (gunluk; yoksa rows), hist (uzun gunluk gecmis; yoksa daily), pro, bench (XU100 gunluk), breadth
function analyze({rows,daily,hist,pro,bench,breadth,now=Date.now()}={}){
  const H=clean(hist&&hist.length>=(daily||[]).length?hist:daily||rows),P=clean(rows);
  const plan=pro&&pro.ok?pro.plan:null;
  const score=scoreStudy(H),setup=setupStudy(H),rng=ranges(H),seas=seasonality(H,{now}),tech=techSummary(P),reg=regime(bench,breadth);
  // Plan olasiligi plan hangi dilimdeyse o dilimin gecmisinde (gun ici planda gun ici mumlar; gunlukte uzun gecmis)
  const odds=plan?planOdds(pro.tf==='1g'?H:P,plan):null;
  const rate=rating({pro,score,setup,odds,rng,reg,tech});
  return {score,setup,odds,ranges:rng,seasonality:seas,tech,regime:reg,rating:rate,histN:H.length,histFrom:H.length&&fin(H[0].t)?H[0].t:null}}

// Kurala dayali analist raporu (yapay zeka olmadan da). d: bp:load sonucu + quant
const MON=['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const TFN={'1dk':'1 dk','5dk':'5 dk','15dk':'15 dk','1s':'saatlik','1g':'günlük','1h':'haftalık'};
function report(d){
  const P=d&&d.pro&&d.pro.ok?d.pro:null,Q=d&&d.quant;if(!P||!Q)return null;
  const V=P.verdict,pl=P.plan,R=Q.rating,px=fin(d.quote&&d.quote.price)?d.quote.price:P.last,fp=v=>nf(v,Math.abs(v)>=1?2:4);
  const S=[],sec=(h,...lines)=>{const l=lines.flat().filter(Boolean);if(l.length)S.push({h,lines:l})};
  const lvR=P.levels.resistance[0],lvS=P.levels.support[0];
  sec('Özet',[
    (d.name&&d.name!==d.symbol?d.name+' ('+d.symbol+')':d.symbol)+' '+fp(px)+(d.quote&&fin(d.quote.chgPct)?' ('+pc(d.quote.chgPct,2)+')':'')+'. Analist notu: '+(R?R.label+' (güven %'+R.confidence+')':V.label)+'; '+TFN[P.tf]+' teknik karar '+V.label+', skor '+(V.score>0?'+':'')+V.score+'.',
    P.trend.primary?P.trend.primary.text+'; '+P.trend.structure.text.charAt(0).toLowerCase()+P.trend.structure.text.slice(1)+'.':null,
    lvR&&lvS?'Fiyat en yakın destek '+fp(lvS.lo)+'–'+fp(lvS.hi)+' ('+pc((lvS.hi/px-1)*100)+') ile en yakın direnç '+fp(lvR.lo)+'–'+fp(lvR.hi)+' ('+pc((lvR.lo/px-1)*100)+') arasında.'
      :lvS?'En yakın destek '+fp(lvS.lo)+'–'+fp(lvS.hi)+' ('+pc((lvS.hi/px-1)*100)+'); yukarıda belirgin direnç yok.'
      :lvR?'En yakın direnç '+fp(lvR.lo)+'–'+fp(lvR.hi)+' ('+pc((lvR.lo/px-1)*100)+'); aşağıda belirgin destek yok.':null]);
  if(R&&R.target)sec('Hedef ve beklenen aralık (1 ay ≈ 20 mum)',[
    'Baz senaryo '+fp(R.target.base)+' ('+pc(R.target.upside)+'). %68 olasılık aralığı '+fp(R.target.low)+' – '+fp(R.target.high)+', %90 aralığı '+fp(R.target.low90)+' – '+fp(R.target.high90)+'.',
    Q.ranges?'Aralık, hissenin son '+Math.round(Q.ranges.horizons[0].n/250*10)/10+' yıllık getiri dağılımından ve bugünkü oynaklıktan (yıllık %'+nf(Q.ranges.volNow,0)+', uzun dönem %'+nf(Q.ranges.volLong,0)+') hesaplandı.':null]);
  if(pl&&!pl.wait){const o=Q.odds;sec('İşlem planı',[
    (pl.dir>0?'Alış':'Satış')+': giriş '+fp(pl.entry[0])+'–'+fp(pl.entry[1])+', stop '+fp(pl.stop)+' ('+pl.stopType+'), hedef 1 '+fp(pl.t1)+', hedef 2 '+fp(pl.t2)+(fin(pl.rr)?', risk/ödül 1:'+nf(pl.rr,2):'')+'.',
    o?'Geçmişte aynı ATR uzaklıklarıyla kurulan '+o.n+' durumda hedef 1 stoptan önce %'+nf(o.p1,0)+' oranında geldi (stop %'+nf(o.pStop,0)+', '+o.maxBars+' mumda sonuçsuz %'+nf(o.pNone,0)+'). Başabaş için gereken oran %'+nf(o.breakEven,0)+'; beklenen değer '+(o.ev>0?'+':'')+nf(o.ev,2)+'R'+(o.cond==='trend'?' (bugünkü trend tarafındaki günlerle).':'.'):null,
    pl.warning||null])}
  else if(pl&&pl.wait)sec('Bekleme planı',['Net yön yok. AL senaryosu: '+(fin(pl.triggerUp)?fp(pl.triggerUp)+' üzerinde kapanış':'—')+'; SAT senaryosu: '+(fin(pl.triggerDown)?fp(pl.triggerDown)+' altında kapanış':'—')+'.']);
  const s=Q.score,u=Q.setup,lines=[];
  if(s)for(const h of s.horizons)lines.push('Benzer skorlu günlerden ('+(s.score>0?'+':'')+nf(s.score*100,0)+' ±'+nf(s.band*100,0)+', n='+h.n+') '+h.h+' mum sonra: ort. '+pc(h.mean)+', medyan '+pc(h.median)+', yükselme %'+nf(h.win,0)+' (tüm günler: '+pc(h.baseMean)+', %'+nf(h.baseWin,0)+').');
  if(u)lines.push('Aynı kurulum ('+u.desc+', n='+u.n+'): '+u.horizons.map(h=>h.h+' mumda ort. '+pc(h.mean)+', yükselme %'+nf(h.win,0)).join('; ')+'.');
  sec('Geçmişte benzer durumlar',lines);
  const T=Q.tech;if(T)sec('Teknik özet tablosu ('+TFN[P.tf]+')',['Genel: '+T.overall.label+'. Hareketli ortalamalar: '+T.ma.label+' ('+T.ma.buy+' al, '+T.ma.sell+' sat). Osilatörler: '+T.osc.label+' ('+T.osc.buy+' al, '+T.osc.sell+' sat, '+T.osc.neutral+' nötr).']);
  const cmp=P.verdict.components.filter(c=>Math.abs(c.impact)>=3).sort((a,b)=>Math.abs(b.impact)-Math.abs(a.impact)).slice(0,5);
  sec('Kararı belirleyenler',cmp.map(c=>(c.impact>0?'+ ':'− ')+c.name+': '+(c.why[0]||'')));
  const st=d.stats;if(st)sec('Performans ve risk',[
    'Getiri: 1 ay '+pc(st.perf&&st.perf.d20)+', 3 ay '+pc(st.perf&&st.perf.d60)+', 1 yıl '+pc(st.perf&&st.perf.d250)+'. 52 hafta zirvesine '+pc(st.hi52Dist)+'.',
    st.rs&&fin(st.rs.d20)?'XU100\'e göre 1 ay '+pc(st.rs.d20)+', 3 ay '+pc(st.rs.d60)+'; beta '+nf(st.beta,2)+'.':null,
    'Yıllık oynaklık %'+nf(st.volAnn,0)+'; ATR %'+nf(P.volatility.atrPct,1)+'.']);
  const g=Q.regime;if(g)sec('Piyasa rejimi',[g.label+': '+g.trend+'; XU100 20 gün '+pc(g.r20)+', zirveden '+pc(g.drawdown)+(fin(g.breadthPct)?', son taramada yükselen hisse oranı %'+nf(g.breadthPct,0):'')+'.']);
  const se=Q.seasonality;if(se){const cm=se.months[se.current],nx=se.months[(se.current+1)%12];
    sec('Mevsimsellik',[MON[cm.m]+' ayı geçmişte ort. '+pc(cm.avg)+' (pozitif yıl %'+nf(cm.win,0)+', '+cm.n+' yıl); '+MON[nx.m]+' ort. '+pc(nx.avg)+' (%'+nf(nx.win,0)+').'])}
  const risks=[];
  if(P.momentum.rsi>=70)risks.push('RSI aşırı alım bölgesinde ('+nf(P.momentum.rsi,0)+'): kısa vadeli geri çekilme riski.');
  if(P.momentum.rsi<=30)risks.push('RSI aşırı satımda ('+nf(P.momentum.rsi,0)+'): düşüş trendi sürebilir, dönüş teyidi beklenmeli.');
  for(const dv of P.momentum.divergences)if(dv.dir!==V.dir&&V.dir)risks.push(dv.text+' kararla çelişiyor.');
  if(g&&g.dir<0&&V.dir>0)risks.push('Piyasa geneli zayıf; AL kurulumlarında başarı oranı düşebilir.');
  if(pl&&!pl.wait&&fin(pl.rr)&&pl.rr<1.5)risks.push('Risk/ödül zayıf (1:'+nf(pl.rr,2)+').');
  if(Q.odds&&Q.odds.ev<0)risks.push('Geçmiş simülasyonda bu plan negatif beklenen değer verdi ('+nf(Q.odds.ev,2)+'R).');
  if(P.volatility.bb&&P.volatility.bb.squeeze)risks.push('Bollinger sıkışması: her iki yöne sert hareket olabilir.');
  if(d.stale)risks.push('Veri çevrimdışı/eski olabilir.');
  sec('Riskler',risks.length?risks:['Belirgin ek risk işareti yok; yine de stop disiplini esastır.']);
  const watch=[];if(lvR)watch.push('Direnç '+fp(lvR.lo)+'–'+fp(lvR.hi)+': üstünde kapanış yükselişi teyit eder.');if(lvS)watch.push('Destek '+fp(lvS.lo)+'–'+fp(lvS.hi)+': altında kapanış görünümü bozar.');
  if(fin(P.volume.ratio))watch.push('Hacim (20 mum ortalamasının '+nf(P.volume.ratio,1)+' katı): kırılımlarda hacim teyidi.');
  sec('Takip edilecekler',watch);
  const text=[(d.symbol||'')+' · Borsa Pro analist raporu · '+new Date(fin(P.time)?P.time:Date.now()).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'}),'',
    ...S.flatMap(x=>[x.h.toLocaleUpperCase('tr-TR'),...x.lines.map(l=>'• '+l),'']),'Bu rapor teknik ve istatistiksel analiz çıktısıdır; yatırım tavsiyesi değildir. Geçmiş performans geleceği garanti etmez.'].join('\n');
  return {sections:S,text}}

return {clean,dist,scoreSeries,scoreStudy,setupStudy,planOdds,ranges,seasonality,techSummary,regime,rating,analyze,report,cci,williams,stochK,LBL,NOTES};
});
