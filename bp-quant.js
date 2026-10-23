// Borsa Pro olasilik ve analist motoru. Hissenin KENDI gecmisinde benzer durumlar ne siklikla olustu, sonra ne oldu:
// - skor calismasi: bugunku teknik skora yakin gunlerden sonra 5/10/20 mum getirileri (tum gunlerle kiyas)
// - kurulum calismasi: ayni trend + RSI bolgesi + MACD yonu kosullarindaki gunlerden sonra getiriler
// - sistem karnesi (karne): sistem skorunun yuruyen (walk-forward) yon isabeti; AL/SAT ayri, son 1 yil ayri, taban oranla kiyas
// - plan olasiligi: ATR'ye gore ayni uzakliktaki hedefe stoptan once ulasma orani (gecmisteki her gunden simulasyon)
// - beklenen aralik: h mumluk getirilerin dagilimi; oynaklik ufka gore (ortalamaya donus) olceklenir, merkez buzulur (%68 / %90)
// - mevsimsellik (anlamlilik testiyle), teknik ozet tablosu (hareketli ortalama + osilator oylari), piyasa rejimi (XU100)
// - analist notu (Guclu Al/Al/Tut/Azalt/Sat), kalibre guven, uyarilar (likidite, olay, haftalik trend), hedef ve Turkce rapor
// Ileriye bakma yoktur: her ornek yalniz o gune kadarki veriyle hesaplanir, sonucu sonraki mumlardan okunur; sonucu henuz
// belli olmayan son gunler hicbir oran hesabina girmez (sansur yanliligi olmasin).
// Istatistik durustlugu (neden boyle):
// - Ornekler ortusur: ardisik gunlerin h mumluk pencereleri ayni mumlari paylasir, ham n bagimsiz gozlem sayisi degildir.
//   Her yerde "etkin n" (neff) da verilir; guven araliklari (Wilson) ve buzulme bununla hesaplanir.
// - Kucuk ornekli oranlar taban orana Beta onseliyle (K_PRIOR gozlem esdegeri) buzulur; ortalama farklari (edge) ve
//   suruklenme normal-normal modelle onsele buzulur. Boylece az veriyle cikan uc degerler notu ve guveni sisirmez.
// - Guven yuzdesi bir olasiliktir: notun yonunde 20 mum sonra kapanis olasiligi (ayrinti: rating.calibration).
// Yatirim tavsiyesi degildir.
(function(root,factory){
  const node=typeof module!=='undefined'&&module.exports,api=factory(node?require('./engine'):root.Engine);
  if(node)module.exports=api;else root.BPQuant=api;
})(this,function(E){
'use strict';
const fin=v=>typeof v==='number'&&Number.isFinite(v);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const r1=v=>fin(v)?Math.round(v*10)/10:null,r2=v=>fin(v)?Math.round(v*100)/100:null,r4=v=>fin(v)?+v.toFixed(4):null;
// Once yuvarla, -0'i 0 yap: tr-TR bicimi "-0" / "-0,0" yazmasin
const nf=(v,d=2)=>{if(!fin(v))return '—';const k=10**d;let x=Math.round(v*k)/k;if(x===0)x=0;return x.toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d})};
// Yuvarlanmis deger sifirsa isaret yok (−%0,0 gorunmesin)
const pc=(v,d=1)=>{if(!fin(v))return '—';const k=10**d,x=Math.round(v*k)/k;return (x>0?'+':x<0?'−':'')+'%'+nf(Math.abs(x),d)};
const sn=(v,d=2)=>{if(!fin(v))return '—';const k=10**d,x=Math.round(v*k)/k;return (x>0?'+':'')+nf(x,d)};
const lc1=s=>s?s.charAt(0).toLocaleLowerCase('tr-TR')+s.slice(1):'';
const pick=(a,h)=>Array.isArray(a)?a.find(x=>x&&x.h===h)||null:null;
const DAY=86400000,TZ=3*3600000;

// --- sabitler (her biri istatistik gerekcesiyle) ------------------------------------------------------
const K_PRIOR=30;      // Beta onsel gucu (gozlem esdegeri). Onsel sd ~ 0,5/sqrt(31) ~ 9 puan: teknik kurallarin gercek isabet farki nadiren daha buyuk
const TAU_EDGE20=1.5;  // 20 mumluk kosullu getiri farkinin onsel sd'si (%). Diger ufuklarda sqrt(h/20) ile olceklenir
const TAU_DRIFT=0.20;  // yillik suruklenme (log) onsel sd'si: bir hissenin gercek beklenen getirisi piyasadan ~%20 sapabilir
const VOL_PHI=0.97;    // gunluk varyans kaliciligi (GARCH benzeri, yari omur ~23 mum): bugunku sok ufuk uzadikca uzun doneme doner
const EWMA_L=0.94;     // RiskMetrics anlik oynaklik (etkin pencere ~17 mum, 20 mumluk pencerenin "hayalet" sicramasi yok)
const TH=0.35;         // sistem sinyal esigi (engine.systemSignals ile ayni)
const LIQ_MIN=5e6;     // TL; 20 gun ortalama islem hacmi bunun altindaysa likidite uyarisi
const EVENT_DAYS=7;    // olay uyarisi penceresi (gun, bugun dahil)

// Gecerli, siralanmis, tekrarsiz mumlar. Zamanli seride zamani gecersiz satir siralamayi bozacagi icin atilir (hic zaman yoksa
// sira korunur). Tutarsiz OHLC (yuksek govdenin altinda / dusuk ustunde) kopyada onarilir; girdi degistirilmez.
function clean(rows){
  const src=(Array.isArray(rows)?rows:[]).filter(r=>r&&[r.o,r.h,r.l,r.c].every(fin)&&r.c>0&&r.l>0&&r.o>0&&r.h>=r.l);
  const timed=src.some(r=>fin(r.t)),xs=timed?src.filter(r=>fin(r.t)).sort((a,b)=>a.t-b.t):src,out=[];let last=-Infinity;
  for(let r of xs){if(r.h<Math.max(r.o,r.c)||r.l>Math.min(r.o,r.c))r={...r,h:Math.max(r.h,r.o,r.c),l:Math.min(r.l,r.o,r.c)};
    if(timed&&r.t===last){out[out.length-1]=r;continue}last=r.t;out.push(r)}
  return out}

// Siralanmis dizide yuzdelik (dogrusal ara deger)
function q(sorted,p){if(!sorted.length)return null;const i=(sorted.length-1)*p,a=Math.floor(i),b=Math.ceil(i);return sorted[a]+(sorted[b]-sorted[a])*(i-a)}
function dist(xs){const v=(Array.isArray(xs)?xs:[]).filter(fin);if(!v.length)return {n:0,mean:null,median:null,win:null,p10:null,p25:null,p75:null,p90:null,sd:null};
  const s=v.slice().sort((a,b)=>a-b),m=v.reduce((a,b)=>a+b,0)/v.length,sd=v.length>1?Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/(v.length-1)):0;
  return {n:v.length,mean:r2(m),median:r2(q(s,0.5)),win:r1(v.filter(x=>x>0).length/v.length*100),p10:r2(q(s,0.1)),p25:r2(q(s,0.25)),p75:r2(q(s,0.75)),p90:r2(q(s,0.9)),sd:r2(sd)}}
const fwd=(c,i,h)=>i+h<c.length?(c[i+h]/c[i]-1)*100:null;
const sdOf=a=>{if(a.length<2)return 0;const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1))};

// --- istatistik yardimcilari ---------------------------------------------------------------------------
// Etkin ornek sayisi: h mumluk pencereleri ortusen gunler (ardisik fark < h) bir kume; kume katkisi min(gun sayisi, 1+(son-ilk)/h).
// Surekli L gunluk bir seride ~L/h: ortusen h mumluk getirilerin ortalamasinda varyans sisirme carpani ~h'dir
// (1+2*sum_{k<h}(1-k/h) = h). Isaretler (yukseldi mi) getiriden daha az iliskili oldugundan bu tahmin temkinlidir. idx artan sirali.
function neff(idx,h){if(!idx||!idx.length)return 0;h=Math.max(1,h);let n=0,a=idx[0],p=idx[0],k=1;
  for(let j=1;j<=idx.length;j++){if(j<idx.length&&idx[j]-p<h){p=idx[j];k++;continue}
    n+=Math.min(k,1+(p-a)/h);if(j<idx.length){a=p=idx[j];k=1}}
  return n}
// Wilson %95 araligi (oran p, ornek n; n etkin ve kesirli olabilir). Kucuk n'de normal yaklasimdan cok daha durust.
function wilson(p,n,z=1.96){if(!(n>0)||!fin(p))return null;const z2=z*z,d=1+z2/n,c=(p+z2/(2*n))/d,h=z*Math.sqrt(Math.max(0,p*(1-p)/n+z2/(4*n*n)))/d;
  return [Math.max(0,c-h),Math.min(1,c+h)]}
// Beta-binom buzulme (sonsal ortalama): n etkin gozlemde oran p, onsel ortalama p0 (taban oran), onsel guc k
const shrink=(p,n,p0,k=K_PRIOR)=>fin(p)&&n>0?(p*n+p0*k)/(n+k):p0;
// Normal-normal buzulme: tahmin x (standart hata se), onsel ortalama m0, onsel sd tau -> sonsal ortalama m0+(x-m0)*tau^2/(tau^2+se^2)
const shrinkN=(x,se,m0,tau)=>{if(!fin(x))return null;if(!(se>0)||!(tau>0))return x;const w=tau*tau/(tau*tau+se*se);return m0+(x-m0)*w};

// Her mum icin teknik skor (-1..1): engine.systemSignals ile ayni agirliklar (trend + momentum). Ilk 50 mum null.
// Nedensel: out[i] yalniz 0..i mumlarindan hesaplanir (EMA/RSI/MACD ozyinelemeli). Esitlikte oy 0 (islem durdurma gibi duz
// donemlerde sahte SAT olmasin); engine.systemSignals'tan yalniz bu tam esitlik durumunda ayrilir.
const cmp=(a,b)=>a>b?1:a<b?-1:0;
function scoreSeries(rows){
  const c=rows.map(r=>r.c),e20=E.emaS(c,20),e50=E.emaS(c,50),e200=E.emaS(c,200),R=E.rsi(c,14),M=E.macdS(c).hist,out=new Array(c.length).fill(null);
  for(let i=50;i<c.length;i++){if(!fin(e20[i])||!fin(e50[i])||!fin(e50[i-5]))continue;let s=0,w=0;const add=(v,wt)=>{s+=v*wt;w+=wt};
    add(cmp(c[i],e20[i]),0.15);add(cmp(e20[i],e50[i]),0.25);add(Math.sign(e50[i]-e50[i-5]),0.15);if(fin(e200[i]))add(cmp(c[i],e200[i]),0.15);
    if(fin(M[i]))add(Math.sign(M[i]),0.15);if(fin(R[i]))add(R[i]>=70?-0.5:R[i]>=55?1:R[i]<=30?0.5:R[i]<=45?-1:0,0.15);out[i]=s/w}
  return out}

// Bir gun kumesinin h mumluk sonuc istatistigi + taban (tum gunler) kiyasi, etkin n, Wilson araligi ve buzulmus fark
function outcome(c,idx,all,h,reg){
  const xs=idx.map(i=>fwd(c,i,h)),d=dist(xs),base=dist(all.map(i=>fwd(c,i,h))),rb=reg&&reg.length>=60?dist(reg.map(i=>fwd(c,i,h))):null;
  const ne=neff(idx,h),p=xs.length?xs.filter(x=>x>0).length/xs.length:null,ci=wilson(p,ne);
  const edge=fin(d.mean)&&fin(base.mean)?d.mean-base.mean:null,se=ne>0&&fin(d.sd)?d.sd/Math.sqrt(ne):null;
  const p0=(rb&&fin(rb.win)?rb.win:fin(base.win)?base.win:50)/100;
  return {h,...d,baseMean:base.mean,baseWin:base.win,edge:r2(edge),neff:r1(ne),winLo:ci?r1(ci[0]*100):null,winHi:ci?r1(ci[1]*100):null,
    baseWinReg:rb?rb.win:null,baseMeanReg:rb?rb.mean:null,winShr:fin(p)?r1(shrink(p,ne,p0)*100):null,
    edgeSE:r2(se),edgeShr:r2(shrinkN(edge,se,0,TAU_EDGE20*Math.sqrt(h/20)))}}

// Skor calismasi: bugunku skora +-band yakin gecmis gunler (yeterli ornek yoksa band genisler) -> h mum sonraki getiri dagilimi.
// Rejim kosullu taban: bugunku EMA200 tarafindaki gunlerin yukselme orani (baseWinReg); benzer gunlerin cogu ayni rejimde
// oldugundan bu, buzulme icin tum gunlerden daha bilgili bir onseldir. edgeShr: tum gunlere gore farkin buzulmus hali.
function scoreStudy(rows,{horizons=[5,10,20],band=0.12,minN=25}={},_S){
  rows=clean(rows);const N=rows.length;if(N<120)return null;
  const S=Array.isArray(_S)&&_S.length===N?_S:scoreSeries(rows),c=rows.map(r=>r.c),now=S[N-1];if(!fin(now))return null;
  const H=Math.max(...horizons),e200=E.emaS(c,200),side=i=>fin(e200[i])?Math.sign(c[i]-e200[i]):0,sNow=side(N-1);
  let b=band,used=band,idx=[];
  // 1e-9: skorlar agirlik toplamlari; 0.52-0.40 gibi farklar kayan noktada 0.12'yi az farkla asmasin
  for(;b<=0.5+1e-9;b+=0.06){used=b;idx=[];for(let i=50;i<N-H;i++)if(fin(S[i])&&Math.abs(S[i]-now)<=b+1e-9)idx.push(i);if(idx.length>=minN)break}
  if(idx.length<10)return null;
  const all=[],reg=[];for(let i=50;i<N-H;i++)if(fin(S[i])){all.push(i);if(sNow&&side(i)===sNow)reg.push(i)}
  return {score:r2(now),band:r2(Math.min(used,0.5)),n:idx.length,regime:sNow,horizons:horizons.map(h=>outcome(c,idx,all,h,reg))}}

// Kurulum: trend (EMA200'e gore), RSI bolgesi, MACD histogram yonu. Ayni kosullu gunlerden sonra getiriler (+ taban kiyasi).
const RSI_Z=[[0,30,'RSI ≤ 30'],[30,45,'RSI 30–45'],[45,55,'RSI 45–55'],[55,70,'RSI 55–70'],[70,101,'RSI ≥ 70']];
const zoneOf=r=>fin(r)?RSI_Z.findIndex(z=>r>=z[0]&&r<z[1]):-1;
function setupStudy(rows,{horizons=[10,20],minN=20}={}){
  rows=clean(rows);const N=rows.length;if(N<220)return null;
  const c=rows.map(r=>r.c),e200=E.emaS(c,200),R=E.rsi(c,14),M=E.macdS(c).hist,H=Math.max(...horizons);
  const F=c.map((_,i)=>({t:fin(e200[i])?cmp(c[i],e200[i]):0,z:zoneOf(R[i]),m:fin(M[i])?Math.sign(M[i]):0}));
  const now=F[N-1];if(!now.t||now.z<0)return null;
  const all=[];for(let i=200;i<N-H;i++)all.push(i);
  const levels=[[x=>x.t===now.t&&x.z===now.z&&x.m===now.m,true,true],[x=>x.t===now.t&&x.z===now.z,true,false],[x=>x.t===now.t&&Math.abs(x.z-now.z)<=1,false,false]];
  for(const [ok,exactZ,useM] of levels){const idx=[];for(let i=200;i<N-H;i++)if(ok(F[i]))idx.push(i);
    if(idx.length<minN)continue;
    const desc=[now.t>0?'Fiyat EMA200 üstünde':'Fiyat EMA200 altında',exactZ?RSI_Z[now.z][2]:'RSI '+RSI_Z[Math.max(0,now.z-1)][0]+'–'+(RSI_Z[Math.min(4,now.z+1)][1]>100?100:RSI_Z[Math.min(4,now.z+1)][1]),
      useM?(now.m>0?'MACD pozitif':now.m<0?'MACD negatif':null):null].filter(Boolean).join(' · ');
    return {desc,n:idx.length,relaxed:!useM,horizons:horizons.map(h=>outcome(c,idx,all,h,null))}}
  return null}

// Sistem karnesi (yuruyen isabet): her gun YALNIZ o gune kadarki veriyle hesaplanan sistem skoru (scoreSeries, nedensel)
// esigi gecince sinyal sayilir (>= +th AL, <= -th SAT); h mum sonraki kapanisla yon dogru mu (AL: getiri > 0, SAT: < 0).
// Sonucu belli olmayan son h gun sayilmaz. baz: ayni donemde tum gunlerin ayni yonde kapanma orani -> isabet ancak bunun
// ustundeyse beceridir (yukselen hissede AL isabeti %60 olabilir ama taban da %60 ise katki yok). fark = isabet - baz (puan).
// son250: son 250 mumdaki sinyaller (son ~1 yil) ayri. neff/lo/hi: ortusme duzeltmeli etkin n ve Wilson %95 araligi.
function karne(rows,{horizons=[5,10,20],th=TH,recent=250}={},_S){
  rows=clean(rows);const N=rows.length;if(N<120)return null;
  const S=Array.isArray(_S)&&_S.length===N?_S:scoreSeries(rows),c=rows.map(r=>r.c);
  const side=(a,dir,p0,h)=>{const n=a.length;if(!n)return {n:0,isabet:null,ortGetiri:null,neff:0,lo:null,hi:null,baz:r1(fin(p0)?p0*100:null),fark:null};
    const hit=a.filter(x=>dir>0?x[1]>0:x[1]<0).length,p=hit/n,ne=neff(a.map(x=>x[0]),h),ci=wilson(p,ne);
    return {n,isabet:r1(p*100),ortGetiri:r2(a.reduce((s,x)=>s+x[1],0)/n),neff:r1(ne),lo:ci?r1(ci[0]*100):null,hi:ci?r1(ci[1]*100):null,
      baz:r1(fin(p0)?p0*100:null),fark:fin(p0)?r1((p-p0)*100):null,_hit:hit,_ne:ne}};
  // genel etkin n: AL ve SAT pencereleri birbiriyle de ortusur; birlesik sinyal gunlerinden hesaplanir (iki tarafin toplami degil)
  const one=(h,lo)=>{const al=[],sat=[],sig=[];let nAll=0,up=0,dn=0;
    for(let i=Math.max(50,lo);i+h<N;i++){if(!fin(S[i]))continue;const r=(c[i+h]/c[i]-1)*100;nAll++;if(r>0)up++;else if(r<0)dn++;
      if(S[i]>=th){al.push([i,r]);sig.push(i)}else if(S[i]<=-th){sat.push([i,r]);sig.push(i)}}
    const pu=nAll?up/nAll:null,pd=nAll?dn/nAll:null,A=side(al,1,pu,h),B=side(sat,-1,pd,h),n=al.length+sat.length;
    let G={n:0,isabet:null,neff:0,lo:null,hi:null,baz:null,fark:null};
    if(n){const p=((A._hit||0)+(B._hit||0))/n,ne=neff(sig,h),ci=wilson(p,ne),p0=nAll?(al.length*pu+sat.length*pd)/n:null;
      G={n,isabet:r1(p*100),neff:r1(ne),lo:ci?r1(ci[0]*100):null,hi:ci?r1(ci[1]*100):null,baz:r1(fin(p0)?p0*100:null),fark:fin(p0)?r1((p-p0)*100):null}}
    for(const x of [A,B]){delete x._hit;delete x._ne}
    return {n,al:A,sat:B,genel:G,gun:nAll}};
  return {th,bars:N,from:fin(rows[0].t)?rows[0].t:null,
    horizons:horizons.map(h=>{const a=one(h,0),r=one(h,N-recent);return {h,n:a.n,gun:a.gun,al:a.al,sat:a.sat,genel:a.genel,son250:{n:r.n,gun:r.gun,al:r.al,sat:r.sat,genel:r.genel}}}),
    now:{score:r2(S[N-1]),sinyal:fin(S[N-1])?(S[N-1]>=th?'AL':S[N-1]<=-th?'SAT':null):null}}}

// Plan olasiligi: bugunku plan ATR cinsinden (stop uzakligi, hedef uzakliklari) gecmisin her gunune uygulanir.
// Ayni mumda hem hedef hem stop gorulurse stop sayilir (temkinli). maxBars icinde hicbiri yoksa "sure doldu".
// Yalniz penceresi tamamen gozlenen gunler sayilir: yarim pencerede yalniz erken sonuclananlari almak sansur yanliligidir.
// trendCond: bugunle ayni trend tarafindaki (EMA200) gunlerle sinirla (yeterli ornek varsa).
// ev: islem basina ortalama R; sonucsuz islemler pencere sonu kapanisiyla degerlenir.
// Duzeltme: suruklenmesiz rastgele yuruyuste hedefin stoptan once gelme olasiligi tam basabas (dS/(dS+d1)) oranidir
// (opsiyonel durdurma teoremi). Gecmis oran etkin n ile buna Beta-buzulur -> p1Adj/evAdj (ornek gurultusunden arindirilmis).
function planOdds(rows,plan,{maxBars=40,minN=40}={}){
  rows=clean(rows);const N=rows.length;if(N<120||!plan||plan.wait||!Array.isArray(plan.entry))return null;
  const dir=plan.dir<0?-1:1,ref=dir>0?plan.entry[1]:plan.entry[0],A=E.atrS(rows,14),atr=A[N-1];
  if(!fin(ref)||!fin(atr)||atr<=0||!fin(plan.stop)||!fin(plan.t1))return null;
  const dS=Math.abs(ref-plan.stop)/atr,d1=Math.abs(plan.t1-ref)/atr,d2=fin(plan.t2)?Math.abs(plan.t2-ref)/atr:null;if(!(dS>0)||!(d1>0))return null;
  const c=rows.map(r=>r.c),e200=E.emaS(c,200),side=fin(e200[N-1])?Math.sign(c[N-1]-e200[N-1]):0;
  const sim=(filter)=>{let n=0,h1=0,h2=0,st=0,no=0,b1=0,dur=0,rNo=0;const ids=[];
    for(let i=20;i+maxBars<=N-1;i++){if(!fin(A[i])||A[i]<=0||(filter&&!filter(i)))continue;const s0=c[i],a=A[i];
      const stop=s0-dir*dS*a,t1=s0+dir*d1*a,t2=d2!=null?s0+dir*d2*a:null;let o1=null,o2=null,j1=null;
      for(let j=i+1;j<=i+maxBars;j++){const r=rows[j],hitS=dir>0?r.l<=stop:r.h>=stop;
        const got1=dir>0?r.h>=t1:r.l<=t1,got2=t2!=null&&(dir>0?r.h>=t2:r.l<=t2);
        if(hitS){if(o1==null){o1='stop';j1=j}if(o2==null)o2='stop';break}
        if(o1==null&&got1){o1='t1';j1=j;b1+=j-i}if(o2==null&&got2)o2='t2';
        if(o1!=null&&(o2!=null||t2==null))break}
      n++;ids.push(i);if(o1==='t1')h1++;else if(o1==='stop')st++;else{no++;rNo+=dir*(c[i+maxBars]-s0)/(dS*a)}if(o2==='t2')h2++;
      dur+=j1!=null?j1-i:maxBars}
    return {n,h1,h2,st,no,b1,dur,rNo,ids}};
  let cond='trend',s=side?sim(i=>fin(e200[i])&&Math.sign(c[i]-e200[i])===side):null;
  if(!s||s.n<minN){cond='tum';s=sim(null)}
  if(s.n<20)return null;
  const p1=s.h1/s.n,pS=s.st/s.n,pN=s.no/s.n,R1=d1/dS,rNone=s.no?s.rNo/s.no:0,ev=p1*R1-pS+pN*rNone;
  // Ortusme: islemler ortalama "dur" mum surer -> etkin n
  const avgDur=s.dur/s.n,ne=neff(s.ids,Math.max(1,Math.round(avgDur))),ci=wilson(p1,ne);
  const res=s.h1+s.st,be=dS/(dS+d1),neR=ne*res/s.n,qS=res?shrink(s.h1/res,neR,be):be,lam=ne/(ne+K_PRIOR);
  const p1A=qS*(1-pN),pSA=(1-qS)*(1-pN),evA=p1A*R1-pSA+pN*rNone*lam;
  return {n:s.n,cond,maxBars,dir,p1:r1(p1*100),p2:d2!=null?r1(s.h2/s.n*100):null,pStop:r1(pS*100),pNone:r1(pN*100),avgBars1:s.h1?r1(s.b1/s.h1):null,
    stopAtr:r2(dS),t1Atr:r2(d1),rr:r2(R1),ev:r2(ev),breakEven:r1(1/(1+R1)*100),
    neff:r1(ne),p1Lo:ci?r1(ci[0]*100):null,p1Hi:ci?r1(ci[1]*100):null,p1Adj:r1(p1A*100),pStopAdj:r1(pSA*100),evAdj:r2(evA),rNone:r2(rNone),avgBars:r1(avgDur)}}

// Beklenen aralik: son lookback mumdaki h mumluk log getirilerin yuzdelikleri (sisman kuyruklar korunur).
// - Yayilim: anlik oynaklik EWMA (lambda 0,94). Varyans uzun doneme geometrik doner (VOL_PHI) -> h ufkunun ortalama varyansi
//   vL^2 + (vN^2 - vL^2) * (1-phi^h)/(h(1-phi)); kisa ufukta bugunku oynaklik, uzun ufukta uzun donem agir basar.
// - Merkez: gecmis medyan getiri (suruklenme) cok gurultulu bir tahmindir (3 yilda 20 mumluk medyanin standart hatasi ~%2).
//   Onsele (piyasa XU100 ayni ufuk medyani; yoksa 0) normal-normal buzulur: w = tau^2/(tau^2+se^2), tau = TAU_DRIFT*h/252.
function ranges(rows,{horizons=[5,20],lookback=750,bench=null}={}){
  rows=clean(rows);const N=rows.length;if(N<80)return null;
  const c=rows.map(r=>r.c),lr=[];for(let i=1;i<N;i++)lr.push(Math.log(c[i]/c[i-1]));
  const L=lr.slice(-lookback),vLong=sdOf(L);let v2=vLong*vLong;for(const x of L)v2=EWMA_L*v2+(1-EWMA_L)*x*x;
  const vNow=Math.sqrt(v2),ratio=vLong>0?clamp(vNow/vLong,0.6,1.8):1,last=c[N-1];
  const bc=bench?clean(bench).map(r=>r.c):[];
  const prior=h=>{if(bc.length<250)return 0;const xs=[];for(let i=Math.max(0,bc.length-1-lookback);i+h<bc.length;i++)xs.push(Math.log(bc[i+h]/bc[i]));return xs.length>=30?q(xs.sort((a,b)=>a-b),0.5):0};
  const out=horizons.map(h=>{const from=Math.max(0,N-1-lookback),xs=[];for(let i=from;i+h<N;i++)xs.push(Math.log(c[i+h]/c[i]));
    if(xs.length<30)return null;const s=xs.sort((a,b)=>a-b),med=q(s,0.5);
    const g=(1-VOL_PHI**h)/(h*(1-VOL_PHI)),vh=Math.sqrt(Math.max(0,vLong*vLong+(vNow*vNow-vLong*vLong)*g)),rh=vLong>0?clamp(vh/vLong,0.6,1.8):1;
    const se=1.2533*sdOf(s)/Math.sqrt(Math.max(1,xs.length/h)),m0=prior(h),tau=TAU_DRIFT*h/252,loc=shrinkN(med,se,m0,tau),w=se>0?tau*tau/(tau*tau+se*se):1;
    const P=v=>r4(last*Math.exp(loc+(v-med)*rh));
    return {h,p05:P(q(s,0.05)),p16:P(q(s,0.16)),p50:P(med),p84:P(q(s,0.84)),p95:P(q(s,0.95)),n:xs.length,ratio:r2(rh),
      drift:{raw:r2((Math.exp(med)-1)*100),prior:r2((Math.exp(m0)-1)*100),used:r2((Math.exp(loc)-1)*100),w:r2(w)}}}).filter(Boolean);
  return {last,volNow:r1(vNow*Math.sqrt(252)*100),volLong:r1(vLong*Math.sqrt(252)*100),ratio:r2(ratio),horizons:out}}

// Mevsimsellik (gunluk mumlar): takvim ayi bazinda ortalama getiri ve pozitif yil orani. En az 24 ay.
// t: ay ortalamasinin tum aylar ortalamasindan farki / (tum aylarin sd'si / sqrt(yil)); sig: |t| >= 2 ve en az 5 yil.
// 12 ay ayni anda sinandigi icin tek bir "anlamli" ay bile sans eseri cikabilir (coklu karsilastirma); rapor bunu soyler.
function seasonality(rows,{now=Date.now()}={}){
  rows=clean(rows).filter(r=>fin(r.t));if(rows.length<300)return null;
  const ym=t=>{const d=new Date(t+TZ);return d.getUTCFullYear()*12+d.getUTCMonth()};const ends=new Map();
  for(const r of rows)ends.set(ym(r.t),r.c);
  const keys=[...ends.keys()].sort((a,b)=>a-b),cur=ym(now),rets=[];
  for(let k=1;k<keys.length;k++){if(keys[k]-keys[k-1]!==1||keys[k]===cur)continue;rets.push({m:keys[k]%12,r:(ends.get(keys[k])/ends.get(keys[k-1])-1)*100})}
  if(rets.length<24)return null;
  const allR=rets.map(x=>x.r),mAll=allR.reduce((a,b)=>a+b,0)/allR.length,sdAll=sdOf(allR);
  const months=Array.from({length:12},(_,m)=>{const xs=rets.filter(x=>x.m===m).map(x=>x.r),n=xs.length,avg=n?xs.reduce((a,b)=>a+b,0)/n:null;
    const t=n>=2&&sdAll>0?(avg-mAll)/(sdAll/Math.sqrt(n)):null;
    return {m,n,avg:r2(avg),win:n?r1(xs.filter(x=>x>0).length/n*100):null,t:r2(t),sig:fin(t)&&Math.abs(t)>=2&&n>=5}});
  return {months,years:r1(rets.length/12),current:cur%12,avgAll:r2(mAll)}}

// --- teknik ozet tablosu (tek zaman dilimi) -------------------------------------------------------------
function cci(rows,n=20){const tp=rows.map(r=>(r.h+r.l+r.c)/3),out=new Array(rows.length).fill(null);
  for(let i=n-1;i<rows.length;i++){const w=tp.slice(i-n+1,i+1),m=w.reduce((a,b)=>a+b,0)/n,md=w.reduce((a,b)=>a+Math.abs(b-m),0)/n;out[i]=md?(tp[i]-m)/(0.015*md):0}return out}
function williams(rows,n=14){return rows.map((r,i)=>{if(i<n-1)return null;let hi=-Infinity,lo=Infinity;for(let j=i-n+1;j<=i;j++){hi=Math.max(hi,rows[j].h);lo=Math.min(lo,rows[j].l)}return hi===lo?-50:(hi-r.c)/(hi-lo)*-100})}
function stochK(rows,n=14,s=3){const raw=rows.map((r,i)=>{if(i<n-1)return null;let hi=-Infinity,lo=Infinity;for(let j=i-n+1;j<=i;j++){hi=Math.max(hi,rows[j].h);lo=Math.min(lo,rows[j].l)}return hi===lo?50:(r.c-lo)/(hi-lo)*100});return E.smaS(raw,s)}
const LBL=s=>s>=0.5?'Güçlü Al':s>=0.1?'Al':s<=-0.5?'Güçlü Sat':s<=-0.1?'Sat':'Nötr';
function techSummary(rows){
  rows=clean(rows);const N=rows.length;if(N<30)return null;const c=rows.map(r=>r.c),x=c[N-1],L=a=>a[N-1];
  const ma=[];for(const n of [5,10,20,50,100,200]){for(const [k,f] of [['SMA',E.smaS],['EMA',E.emaS]]){const v=L(f(c,n));if(!fin(v))continue;
    ma.push({name:k+' '+n,value:r4(v),vote:cmp(x,v)})}}
  const osc=[],add=(name,value,vote)=>{if(fin(value))osc.push({name,value:r2(value),vote})};
  const rsi=L(E.rsi(c,14));add('RSI (14)',rsi,rsi<30?1:rsi>70?-1:0);
  const k=L(stochK(rows));add('Stokastik %K (14, 3)',k,k<20?1:k>80?-1:0);
  const sr=E.stochRsi(c);add('Stokastik RSI (14)',L(sr.k),L(sr.k)<20?1:L(sr.k)>80?-1:0);
  // Esitlikte (duz seri) oy 0: MACD = sinyal, DI+ = DI-, boga gucu 0 iken sahte SAT oyu olmasin
  const m=E.macdS(c);add('MACD (12, 26)',L(m.macd),fin(L(m.macd))&&fin(L(m.signal))?cmp(L(m.macd),L(m.signal)):0);
  const A=E.adxS(rows,14);add('ADX (14)',L(A.adx),L(A.adx)>=25?cmp(L(A.pdi),L(A.mdi)):0);
  const w=L(williams(rows));add('Williams %R (14)',w,w<-80?1:w>-20?-1:0);
  const cc=L(cci(rows));add('CCI (20)',cc,cc<-100?1:cc>100?-1:0);
  if(N>10){const mo=(x/c[N-11]-1)*100;add('Momentum (10)',mo,Math.sign(mo))}
  const e13=L(E.emaS(c,13));if(fin(e13)){const bp=rows[N-1].h-e13+rows[N-1].l-e13;add('Boğa/Ayı gücü (13)',bp,Math.sign(bp))}
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

// Gunlukten haftalik mum (Istanbul saati, Pazartesi baslangicli hafta). Haftalik dilim gelmediyse 'Guclu Al' kapisi icin.
function weekly(rows){const out=[];let key=null;
  for(const r of clean(rows)){if(!fin(r.t))continue;const s=r.t+TZ,k=Math.floor(s/DAY)-((new Date(s).getUTCDay()+6)%7);
    if(k!==key){key=k;out.push({t:r.t,o:r.o,h:r.h,l:r.l,c:r.c,v:fin(r.v)?r.v:0})}
    else{const w=out[out.length-1];w.h=Math.max(w.h,r.h);w.l=Math.min(w.l,r.l);w.c=r.c;w.v+=fin(r.v)?r.v:0}}
  return out}
function weeklyTrend(rows){if(typeof E.tfTrend!=='function')return null;const w=weekly(rows);if(w.length<30)return null;
  const t=E.tfTrend(w);return t?{dir:t.dir,text:t.text,src:'günlükten'}:null}

// --- olay takvimi ve Hisse Radar ------------------------------------------------------------------------
// Istanbul takvim gunu (epoch gun sayisi). 'YYYY-MM-DD' takvim gunudur; zamanli metin/sayi Istanbul saatine cevrilir.
function dayNum(d){if(d instanceof Date)d=d.getTime();
  if(typeof d==='string'){const s=d.trim(),m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);if(m)return Date.UTC(+m[1],+m[2]-1,+m[3])/DAY;const t=Date.parse(s);return fin(t)?Math.floor((t+TZ)/DAY):null}
  return fin(d)?Math.floor((d+TZ)/DAY):null}
const EVK=[[/bilan[cç]o|finansal sonu|mali tablo|k[aâ]r a[cç][ıi]klama|earning/,'bilanco','Bilanço','açıklama sonrası sert fiyat boşluğu olabilir; teknik seviyeler ve olasılıklar bu riski içermez.'],
  [/temett|k[aâ]r pay|divid/,'temettu','Temettü','hak kullanım günü fiyat temettü tutarı kadar düşer; stop ve hedefleri buna göre değerlendir.'],
  [/genel kurul/,'genelKurul','Genel kurul','temettü ve sermaye kararları fiyatı etkileyebilir.'],
  [/bedelsiz|b[öo]l[üu]nme|split/,'bolunme','Bedelsiz/bölünme','fiyat bölünme oranında düzeltilir; teknik seviyeler kayar.']];
// Bugun dahil EVENT_DAYS gun icindeki bilanco/temettu/genel kurul (ve bedelsiz) olaylari; tur basina en yakini. Once kind, sonra baslik.
function upcoming(events,now=Date.now()){const today=dayNum(now),best=new Map();if(today==null||!Array.isArray(events))return [];
  for(const e of events){if(!e||typeof e!=='object')continue;const d=dayNum(e.day!=null?e.day:e.date!=null?e.date:e.t);if(d==null)continue;const k=d-today;
    if(k<0||k>EVENT_DAYS)continue;const lo=v=>String(v||'').toLocaleLowerCase('tr-TR'),m=EVK.find(x=>x[0].test(lo(e.kind)))||EVK.find(x=>x[0].test(lo(e.title)));if(!m)continue;
    if(!best.has(m[1])||best.get(m[1]).days>k)best.set(m[1],{m,days:k,d})}
  return [...best.values()].sort((a,b)=>a.days-b.days).map(({m,days,d})=>{const dt=new Date(d*DAY),p=v=>String(v).padStart(2,'0');
    const ds=p(dt.getUTCDate())+'.'+p(dt.getUTCMonth()+1)+'.'+dt.getUTCFullYear();
    return {kind:m[1],name:m[2],day:dt.toISOString().slice(0,10),days,text:m[2]+' '+(days===0?'bugün':days===1?'yarın':days+' gün sonra')+' ('+ds+'): '+m[3]}})}
// Hisse Radar konsensusu -> kucuk agirlikli ek bilesen. Agirlik = 0,1 * guvenilirlik * guven/100 (en fazla 0,1; toplamin ~%9'u):
// olculmus isabet ({n,oran}) varsa 50'ye buzulmus oran %50 -> 0, %60+ -> tam; yoksa isabet agirlikli konsensus 0,6, esit 0,4.
// Tum RadarSym verilirse isabet, karari veren modellerin olculmus isabetlerinin (n >= 20) n agirlikli ortalamasidir; modeller ayni
// gunleri degerlendirdigi icin n toplanmaz (en buyugu). Konsensus guveni uyumu zaten icerir (hisse-radar: guven = agirlikli
// guven * uyum); uyum yalniz guven yoksa ayrica carpilir. Hissenin kendi gecmisinde dogrulanmadigi icin kalibre guvene girmez.
const RK={AL:1,TUT:0,SAT:-1};
function radarIsabet(models,karar){const ms=(Array.isArray(models)?models:[]).filter(m=>m&&String(m.karar||'').toLocaleUpperCase('tr-TR')===karar&&m.isabet&&fin(m.isabet.n)&&m.isabet.n>=20&&fin(m.isabet.oran));
  if(!ms.length)return null;const W=ms.reduce((a,m)=>a+m.isabet.n,0),o=ms.reduce((a,m)=>a+m.isabet.n*(m.isabet.oran>1?m.isabet.oran/100:m.isabet.oran),0)/W;
  return {n:Math.max(...ms.map(m=>m.isabet.n)),oran:o}}
function radarPart(r){let models=null;if(r&&r.consensus&&typeof r.consensus==='object'){models=r.models;r=r.consensus}if(!r||typeof r!=='object')return null;
  const k=String(r.karar||'').toLocaleUpperCase('tr-TR').trim(),v=fin(r.skor)?clamp(r.skor,-1,1):k in RK?RK[k]*0.5:null;if(v==null)return null;
  const g=fin(r.guven)?clamp(r.guven/100,0,1):0.5,is=r.isabet&&typeof r.isabet==='object'?r.isabet:k in RK?radarIsabet(models,k):null;let rel,src;
  if(is&&fin(is.oran)&&fin(is.n)&&is.n>0){const o=is.oran>1?is.oran/100:is.oran;rel=clamp((shrink(o,is.n,0.5)-0.5)/0.1,0,1);src='isabet'}
  else{rel=r.agirlik==='isabet'?0.6:0.4;src=r.agirlik==='isabet'?'model-isabeti':'esit'}
  if(fin(r.uyum)&&!fin(r.guven))rel*=0.5+0.5*clamp(r.uyum,0,1);
  const karar=k in RK?k:v>0.15?'AL':v<-0.15?'SAT':'TUT';
  return {v,w:0.1*rel*g,karar,dir:RK[karar],guven:fin(r.guven)?r.guven:null,rel:r2(rel),src}}

// --- kalibre guven -------------------------------------------------------------------------------------
// Guven = notun yonunde (Tut'ta daha olasi yonde) 20 mum sonra kapanis olasiligi. Girdiler P(yukselis) cinsinden:
// (1) benzer skor calismasinin yukselme orani, (2) karne: notun yonundeki sistem sinyallerinin isabeti (bugun sistem ayni yonde
// sinyal veriyorsa tam, vermiyorsa yari agirlik; Tut'ta yon iddiasi olmadigindan karne kullanilmaz). Her biri kendi etkin n'iyle
// taban orana (rejim kosullu: bugunku EMA200 tarafindaki gunlerin yukselme orani) Beta-buzulur, sonra etkin n agirlikli
// harmanlanir. Iki girdi ayni gunleri paylasabildiginden kanit toplanmaz (n = en buyugu). Veri yoksa null (sezgisel yedek).
function calibrate({dir=0,score,karne:kr}={}){
  const s20=score&&pick(score.horizons,20),k20=kr&&pick(kr.horizons,20);
  const p0=s20&&fin(s20.baseWinReg)?s20.baseWinReg/100:s20&&fin(s20.baseWin)?s20.baseWin/100:k20&&k20.al&&fin(k20.al.baz)?k20.al.baz/100:null;
  if(p0==null)return null;const ins=[];
  if(s20&&fin(s20.win)&&s20.neff>0)ins.push({kaynak:'benzerSkor',p:s20.win/100,n:s20.n,neff:s20.neff,rel:1});
  if(dir&&k20){const row=dir>0?k20.al:k20.sat;if(row&&row.n>=10&&fin(row.isabet)&&row.neff>0){const rel=kr.now&&kr.now.sinyal===(dir>0?'AL':'SAT')?1:0.5;
    ins.push({kaynak:'karne',p:dir>0?row.isabet/100:1-row.isabet/100,n:row.n,neff:row.neff,rel})}}
  if(!ins.length)return null;let sw=0,sp=0;
  for(const x of ins){const ne=x.neff*x.rel;x.shr=shrink(x.p,ne,p0);sw+=ne;sp+=x.shr*ne}
  const pUp=sp/sw,p=dir>0?pUp:dir<0?1-pUp:Math.max(pUp,1-pUp);
  return {method:'beta-harman',p:r4(p),pUp:r4(pUp),base:r4(p0),h:20,k:K_PRIOR,n:Math.max(...ins.map(x=>x.n)),neff:r1(Math.max(...ins.map(x=>x.neff*x.rel))),
    inputs:ins.map(x=>({kaynak:x.kaynak,oran:r1(x.p*100),n:x.n,neff:r1(x.neff),agirlik:x.rel,buzulmus:r1(x.shr*100)})),
    note:'Güven, notun yönünde 20 mum sonra kapanış olasılığıdır; geçmiş oranlar örtüşme düzeltmeli örnek sayısıyla taban orana büzülerek harmanlandı.'}}

// --- analist notu ve rapor ------------------------------------------------------------------------------
const NOTES=['Sat','Azalt','Tut','Al','Güçlü Al'];
// Bilesenler (ham agirlik, eksikler cikar, kalanlar yeniden olceklenir): teknik karar 0,4 * f, benzer skor 0,2, kurulum 0,1,
// plan 0,12, piyasa 0,1, teknik tablo 0,08 * f, Hisse Radar <= 0,1.
// Uyarlanir agirlik f: sistem skorunun bu hissedeki 20 mumluk yuruyen genel isabeti (karne) n >= 40 iken %50'nin altindaysa
// teknik bilesenler (teknik karar + teknik ozet tablosu; ikisi de ayni gostergelere dayanir) zayiflar:
// p* = isabetin 50'ye buzulmus hali (etkin n, K_PRIOR), f = 1 - min(0,5, (50 - p*)/20). Ornek: %40 isabet, etkin n 30 -> p* 45, f 0,75.
// Yalniz asagi yonlu: yuksek isabet agirligi artirmaz (gecmise asiri uyum riski; yukselen hissede yuksek isabet taban oran olabilir).
// Benzer skor ve kurulum bilesenleri ham ortalama yerine tum gunlere gore BUZULMUS farki (edgeShr/tau) kullanir: hissenin genel
// suruklenmesi her gunu "Al" gostermesin, yalniz kosulun kattigi bilgi sayilsin.
// Kapilar: 'Guclu Al' icin haftalik trend yukari sart (pro.trend.frames['1h'], yoksa gunlukten uretilen haftalik), yoksa 'Al';
// haftalik trend yukaridayken 'Sat' -> 'Azalt'. Kalibre olasilik %50'nin altindaysa uc not bir kademe yumusar.
function rating({pro,score,setup,odds,rng,reg,tech,karne:kr,radar,liquidityTL,events,weekly:wk,now=Date.now()}={}){
  if(!pro||!pro.ok||!pro.verdict)return null;const V=pro.verdict,parts=[],why=[],warnings=[];
  const add=(key,v,w,t)=>{if(!fin(v)||!(w>0))return;v=clamp(v,-1,1);parts.push({key,v,w});if(t)why.push({t,v:v*w})};
  const k20=kr&&pick(kr.horizons,20),G=k20&&k20.genel;let f=1,adaptive=null;
  if(G&&G.n>=40&&fin(G.isabet)&&G.isabet<50){const ps=shrink(G.isabet/100,fin(G.neff)?G.neff:0,0.5)*100;f=1-clamp((50-ps)/20,0,0.5);
    adaptive={factor:r2(f),isabet:G.isabet,n:G.n,neff:G.neff,h:20}}
  add('teknik',V.score/100,0.4*f,'Teknik karar '+V.label+' (skor '+sn(V.score,0)+')'+(f<1?'; sistem isabeti düşük, ağırlık ×'+nf(f,2):''));
  const s20=score&&pick(score.horizons,20),spr=x=>Math.max(2,(x.p90-x.p10)/4),ev20=x=>fin(x.edgeShr)?x.edgeShr/TAU_EDGE20:fin(x.mean)?x.mean/spr(x):null;
  if(s20&&fin(s20.mean))add('benzer',ev20(s20),0.2,'Benzer skorlu günlerden sonra 20 mum ort. '+pc(s20.mean)+(fin(s20.baseMean)?' (tüm günler '+pc(s20.baseMean)+')':'')+
    '; yükselme %'+nf(s20.win,0)+', n='+s20.n+(fin(s20.neff)?' (etkin ≈'+nf(s20.neff,0)+')':''));
  const u20=setup&&pick(setup.horizons,20);
  if(u20&&fin(u20.mean))add('kurulum',ev20(u20),0.1,'Aynı kurulumda ('+setup.desc+') 20 mum ort. '+pc(u20.mean)+(fin(u20.baseMean)?' (tüm günler '+pc(u20.baseMean)+')':''));
  if(odds&&fin(odds.ev)){const e=fin(odds.evAdj)?odds.evAdj:odds.ev;
    add('plan',(odds.dir<0?-1:1)*clamp(e/0.6,-1,1),0.12,'Plan: hedef 1 stoptan önce %'+nf(odds.p1,0)+' (başabaş %'+nf(odds.breakEven,0)+', '+(fin(odds.evAdj)?'düzeltilmiş ':'')+'beklenen '+sn(e,2)+'R)')}
  if(reg&&fin(reg.dir))add('rejim',reg.dir*0.8,0.1,'Piyasa: '+reg.label);
  if(tech&&tech.overall)add('tablo',tech.overall.score,0.08*f,'Teknik özet tablosu: '+tech.overall.label);
  const rp=radarPart(radar);if(rp)add('radar',rp.v,rp.w,'Hisse Radar yapay zekâ konsensüsü '+rp.karar+(fin(rp.guven)?' (güven %'+nf(rp.guven,0)+')':''));
  const W=parts.reduce((a,p)=>a+p.w,0)||1,tot=parts.reduce((a,p)=>a+p.v*p.w,0)/W;
  let idx=tot>=0.42?4:tot>=0.14?3:tot>-0.14?2:tot>-0.42?1:0;
  const wf=pro.trend&&pro.trend.frames&&pro.trend.frames['1h'],wt=wf&&fin(wf.dir)?wf:wk&&fin(wk.dir)?wk:null;
  if(idx===4&&!(wt&&wt.dir>0)){idx=3;warnings.push(wt?'Haftalık trend yükselişte değil; not "Güçlü Al" yerine "Al".':'Haftalık trend doğrulanamadı; not "Güçlü Al" yerine "Al".')}
  if(idx===0&&wt&&wt.dir>0){idx=1;warnings.push('Haftalık trend yükselişte; not "Sat" yerine "Azalt".')}
  const dir=idx>=3?1:idx<=1?-1:0;let cal=calibrate({dir,score,karne:kr}),conf;
  if(cal){conf=Math.round(clamp(cal.p*100,5,95));
    if(cal.p<0.5&&(idx===4||idx===0)){warnings.push('Geçmiş oranlar notun yönünü desteklemiyor (olasılık %'+nf(cal.p*100,0)+'); not bir kademe yumuşatıldı.');idx=idx===4?3:1}}
  else{// Sezgisel yedek (gecmis yetersiz): bilesen uyumu; olculmedigi icin en fazla %65
    const agree=parts.filter(p=>Math.abs(p.v)>0.05&&Math.sign(p.v)===Math.sign(tot)).reduce((a,p)=>a+p.w,0)/W;
    conf=Math.round(clamp(40+25*agree+Math.min(10,Math.abs(tot)*20),0,65));
    cal={method:'sezgisel',p:null,pUp:null,base:null,h:20,k:K_PRIOR,n:0,neff:0,inputs:[],note:'Geçmiş veri yetersiz; güven bileşen uyumuna dayalı sezgisel bir değerdir (en fazla %65).'}}
  if(fin(liquidityTL)&&liquidityTL<LIQ_MIN)warnings.push('Düşük likidite: 20 günlük ortalama işlem hacmi ≈ '+(liquidityTL>=1e6?nf(liquidityTL/1e6,1)+' milyon':nf(liquidityTL/1e3,0)+' bin')+' TL (5 milyon TL altı); emirler fiyatı etkileyebilir, stop kayabilir.');
  const evs=upcoming(events,now);for(const e of evs)warnings.push(e.text);
  if(rp&&rp.dir&&dir&&rp.dir!==dir&&rp.w>0)warnings.push('Hisse Radar yapay zekâ konsensüsü '+rp.karar+'; analist notuyla çelişiyor.');
  if(adaptive)warnings.push('Teknik sistemin bu hissedeki geçmiş isabeti düşük (%'+nf(adaptive.isabet,0)+', n='+adaptive.n+'); teknik ağırlık azaltıldı.');
  // Hedef: 1 ay (20 mum) beklenen aralik, benzer skor calismasinin buzulmus farkiyla (en fazla +-%4) butunuyle kaydirilir
  const R20=rng&&pick(rng.horizons,20),last=fin(pro.last)?pro.last:rng&&rng.last;let target=null;
  if(R20&&fin(last)&&last>0&&fin(R20.p50)){const e=s20?(fin(s20.edgeShr)?s20.edgeShr:fin(s20.edge)?s20.edge:0):0,k=1+clamp(e,-4,4)/100,X=v=>fin(v)?r4(v*k):null;
    target={base:X(R20.p50),low:X(R20.p16),high:X(R20.p84),low90:X(R20.p05),high90:X(R20.p95),upside:r1((R20.p50*k/last-1)*100),h:20}}
  why.sort((a,b)=>Math.abs(b.v)-Math.abs(a.v));
  return {label:NOTES[idx],idx,score:r2(tot),confidence:conf,target,drivers:why.slice(0,5).map(w=>({text:w.t,dir:Math.sign(w.v)||0})),
    warnings,calibration:cal,adaptive,weekly:wt?{dir:wt.dir,src:wt===wf?'haftalık':wt.src||'günlükten'}:null,
    events:evs.map(e=>({kind:e.kind,name:e.name,day:e.day,days:e.days})),
    components:parts.map(p=>({key:p.key,v:r2(p.v),w:r4(p.w),pay:r1(p.w/W*100)}))}}

// Tumu: rows (birincil dilim), daily (gunluk; yoksa rows), hist (uzun gunluk gecmis; yoksa daily), pro, bench (XU100 gunluk), breadth,
// liquidityTL (20 gun ort. TL hacim), events ([{day,kind,title}] sirket takvimi), radar (Hisse Radar konsensusu {karar,skor,guven,...})
function analyze({rows,daily,hist,pro,bench,breadth,now=Date.now(),liquidityTL=null,events=null,radar=null}={}){
  const H=clean(hist&&hist.length>=(daily||[]).length?hist:daily||rows),P=clean(rows);
  const plan=pro&&pro.ok?pro.plan:null,S=H.length>=120?scoreSeries(H):null;
  const score=scoreStudy(H,{},S),setup=setupStudy(H),kr=karne(H,{},S),rng=ranges(H,{bench}),seas=seasonality(H,{now}),tech=techSummary(P),reg=regime(bench,breadth);
  // Plan olasiligi plan hangi dilimdeyse o dilimin gecmisinde (gun ici planda gun ici mumlar; gunlukte uzun gecmis)
  const odds=plan?planOdds(pro.tf==='1g'?H:P,plan):null;
  const wk=pro&&pro.ok&&!(pro.trend&&pro.trend.frames&&pro.trend.frames['1h'])?weeklyTrend(H):null;
  const rate=rating({pro,score,setup,odds,rng,reg,tech,karne:kr,radar,liquidityTL,events,weekly:wk,now});
  return {score,setup,odds,ranges:rng,seasonality:seas,tech,regime:reg,karne:kr,rating:rate,histN:H.length,histFrom:H.length&&fin(H[0].t)?H[0].t:null}}

// Kurala dayali analist raporu (yapay zeka olmadan da). d: bp:load sonucu + quant. Eksik alanlar bolumu atlatir, metne
// NaN/undefined sizmaz.
const MON=['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const TFN={'1dk':'1 dk','5dk':'5 dk','15dk':'15 dk','1s':'saatlik','1g':'günlük','1h':'haftalık'};
function report(d){
  const P=d&&d.pro&&d.pro.ok?d.pro:null,Q=d&&d.quant;if(!P||!Q||!P.verdict)return null;
  const V=P.verdict,pl=P.plan,R=Q.rating,qt=d.quote||{},px=fin(qt.price)?qt.price:P.last,fp=v=>nf(v,Math.abs(v)>=1?2:4),tfn=TFN[P.tf]||'';
  const S=[],sec=(h,...lines)=>{const l=lines.flat().filter(x=>typeof x==='string'&&x);if(l.length)S.push({h,lines:l})};
  const arr=a=>Array.isArray(a)?a:[],LV=P.levels||{},lvR=arr(LV.resistance)[0],lvS=arr(LV.support)[0],tr=P.trend||{},mo=P.momentum||{},vo=P.volume||{},vl=P.volatility||{};
  const zone=z=>fp(z.lo)+'–'+fp(z.hi);
  sec('Özet',[
    (d.name&&d.name!==d.symbol?d.name+' ('+d.symbol+')':d.symbol||'')+' '+fp(px)+(fin(qt.chgPct)?' ('+pc(qt.chgPct,2)+')':'')+'. Analist notu: '+(R?R.label+' (güven %'+R.confidence+')':V.label)+'; '+(tfn?tfn+' ':'')+'teknik karar '+V.label+', skor '+sn(V.score,0)+'.',
    tr.primary&&tr.primary.text?tr.primary.text+(tr.structure&&tr.structure.text?'; '+lc1(tr.structure.text):'')+'.':null,
    lvR&&lvS?'Fiyat en yakın destek '+zone(lvS)+' ('+pc((lvS.hi/px-1)*100)+') ile en yakın direnç '+zone(lvR)+' ('+pc((lvR.lo/px-1)*100)+') arasında.'
      :lvS?'En yakın destek '+zone(lvS)+' ('+pc((lvS.hi/px-1)*100)+'); yukarıda belirgin direnç yok.'
      :lvR?'En yakın direnç '+zone(lvR)+' ('+pc((lvR.lo/px-1)*100)+'); aşağıda belirgin destek yok.':null]);
  if(R&&arr(R.warnings).length)sec('Uyarılar',arr(R.warnings));
  if(R&&R.target){const T=R.target,G=Q.ranges,h0=G&&arr(G.horizons)[0],g20=G&&pick(G.horizons,20),dr=g20&&g20.drift;
    sec('Hedef ve beklenen aralık (1 ay ≈ 20 mum)',[
      'Baz senaryo '+fp(T.base)+' ('+pc(T.upside)+'). %68 olasılık aralığı '+fp(T.low)+' – '+fp(T.high)+', %90 aralığı '+fp(T.low90)+' – '+fp(T.high90)+'.',
      h0&&fin(h0.n)?'Aralık, hissenin son '+nf(h0.n/250,1)+' yıllık getiri dağılımından ve bugünkü oynaklıktan (yıllık %'+nf(G.volNow,0)+', uzun dönem %'+nf(G.volLong,0)+') hesaplandı; oynaklığın uzun döneme dönme eğilimi hesaba katıldı.':null,
      dr&&fin(dr.raw)&&fin(dr.used)?'Geçmiş 1 aylık medyan getiri ('+pc(dr.raw)+') gürültülü bir tahmin olduğundan '+(fin(dr.prior)&&dr.prior!==0?'piyasa ortalamasına ('+pc(dr.prior)+')':'sıfıra')+' doğru büzüldü: merkez '+pc(dr.used)+'.':null])}
  if(pl&&!pl.wait&&Array.isArray(pl.entry)){const o=Q.odds;sec('İşlem planı',[
    (pl.dir>0?'Alış':'Satış')+': giriş '+fp(pl.entry[0])+'–'+fp(pl.entry[1])+', stop '+fp(pl.stop)+(pl.stopType?' ('+pl.stopType+')':'')+', hedef 1 '+fp(pl.t1)+(fin(pl.t2)?', hedef 2 '+fp(pl.t2):'')+(fin(pl.rr)?', risk/ödül 1:'+nf(pl.rr,2):'')+'.',
    o?'Geçmişte aynı ATR uzaklıklarıyla kurulan '+o.n+' durumda hedef 1 stoptan önce %'+nf(o.p1,0)+' oranında geldi (stop %'+nf(o.pStop,0)+', '+o.maxBars+' mumda sonuçsuz %'+nf(o.pNone,0)+'). Başabaş için gereken oran %'+nf(o.breakEven,0)+'; beklenen değer '+sn(o.ev,2)+'R'+(o.cond==='trend'?' (bugünkü trend tarafındaki günlerle).':'.'):null,
    o&&fin(o.neff)&&fin(o.evAdj)?'Ardışık günler örtüştüğü için etkin örnek ≈ '+nf(o.neff,0)+(fin(o.p1Lo)?'; hedef 1 oranının %95 aralığı %'+nf(o.p1Lo,0)+'–%'+nf(o.p1Hi,0):'')+'. Rastgele yürüyüşte bu oran başabaşa eşittir; geçmiş oran buna doğru büzülünce beklenen değer '+sn(o.evAdj,2)+'R.':null,
    typeof pl.warning==='string'?pl.warning:null])}
  else if(pl&&pl.wait)sec('Bekleme planı',['Net yön yok. AL senaryosu: '+(fin(pl.triggerUp)?fp(pl.triggerUp)+' üzerinde kapanış':'—')+'; SAT senaryosu: '+(fin(pl.triggerDown)?fp(pl.triggerDown)+' altında kapanış':'—')+'.']);
  const s=Q.score,u=Q.setup,lines=[];
  if(s)for(const h of arr(s.horizons))lines.push('Benzer skorlu günlerden ('+sn(s.score*100,0)+' ±'+nf(s.band*100,0)+'; n='+h.n+(fin(h.neff)?', etkin ≈ '+nf(h.neff,0):'')+') '+h.h+' mum sonra: ort. '+pc(h.mean)+', medyan '+pc(h.median)+
    ', yükselme %'+nf(h.win,0)+(fin(h.winLo)&&fin(h.winHi)?' (%95 aralık %'+nf(h.winLo,0)+'–%'+nf(h.winHi,0)+')':'')+'. Tüm günler: ort. '+pc(h.baseMean)+', yükselme %'+nf(h.baseWin,0)+'.');
  if(u)lines.push('Aynı kurulum ('+u.desc+', n='+u.n+'): '+arr(u.horizons).map(h=>h.h+' mumda ort. '+pc(h.mean)+', yükselme %'+nf(h.win,0)+(fin(h.baseWin)?' (tüm günler %'+nf(h.baseWin,0)+')':'')).join('; ')+'.');
  sec('Geçmişte benzer durumlar',lines);
  const K=Q.karne,cal=R&&R.calibration,kl=[];
  if(K){const k20=pick(K.horizons,20),fx=x=>x&&x.n?'%'+nf(x.isabet,0)+' (n='+x.n+(fin(x.neff)?', etkin ≈ '+nf(x.neff,0):'')+(fin(x.baz)?'; taban %'+nf(x.baz,0):'')+')':'sinyal yok';
    if(k20){kl.push('Sistem skoru ±'+nf(K.th*100,0)+' eşiğini geçtiğinde 20 mum sonra yön isabeti: AL sonrası yükselme '+fx(k20.al)+', SAT sonrası düşüş '+fx(k20.sat)+'.');
      const r=k20.son250,fs=x=>x&&x.n?'%'+nf(x.isabet,0)+' (n='+x.n+')':'sinyal yok';if(r&&r.n)kl.push('Son 1 yıl: AL '+fs(r.al)+', SAT '+fs(r.sat)+'.')}
    const oth=arr(K.horizons).filter(h=>h.h!==20&&h.genel&&h.genel.n);
    if(oth.length)kl.push('Diğer ufuklar (genel isabet / taban): '+oth.map(h=>h.h+' mum %'+nf(h.genel.isabet,0)+' / %'+nf(h.genel.baz,0)).join(', ')+'. İsabet ancak tabanın üstündeyse beceri gösterir.')}
  if(R&&R.adaptive)kl.push('Sistemin bu hissedeki 20 mumluk genel isabeti %'+nf(R.adaptive.isabet,0)+' (yazı-turanın altında): teknik bileşenlerin ağırlığı ×'+nf(R.adaptive.factor,2)+'.');
  if(R&&cal)kl.push(cal.method==='sezgisel'?'Güven %'+R.confidence+': geçmiş veri yetersiz olduğundan sezgisel (bileşen uyumu, en fazla %65).'
    :'Güven %'+R.confidence+': notun yönünde 20 mum sonra kapanış olasılığı. '+arr(cal.inputs).map(x=>(x.kaynak==='karne'?'Sistem karnesi':'Benzer skor')+' %'+nf(x.oran,0)+' (etkin ≈ '+nf(x.neff,0)+(x.agirlik<1?', yarı ağırlık':'')+')').join(' ve ')+
      (fin(cal.base)?', taban orana (%'+nf(cal.base*100,0)+')':'')+' büzülerek harmanlandı.');
  sec('Güven ve sistem karnesi',kl);
  const T=Q.tech;if(T&&T.overall&&T.ma&&T.osc)sec('Teknik özet tablosu'+(tfn?' ('+tfn+')':''),['Genel: '+T.overall.label+'. Hareketli ortalamalar: '+T.ma.label+' ('+T.ma.buy+' al, '+T.ma.sell+' sat). Osilatörler: '+T.osc.label+' ('+T.osc.buy+' al, '+T.osc.sell+' sat, '+T.osc.neutral+' nötr).']);
  const cm=arr(V.components).filter(c=>fin(c.impact)&&Math.abs(c.impact)>=3).sort((a,b)=>Math.abs(b.impact)-Math.abs(a.impact)).slice(0,5);
  sec('Kararı belirleyenler',cm.map(c=>(c.impact>0?'+ ':'− ')+c.name+(arr(c.why)[0]?': '+c.why[0]:'')));
  const st=d.stats;if(st)sec('Performans ve risk',[
    'Getiri: 1 ay '+pc(st.perf&&st.perf.d20)+', 3 ay '+pc(st.perf&&st.perf.d60)+', 1 yıl '+pc(st.perf&&st.perf.d250)+'. 52 hafta zirvesine '+pc(st.hi52Dist)+'.',
    st.rs&&fin(st.rs.d20)?'XU100\'e göre 1 ay '+pc(st.rs.d20)+', 3 ay '+pc(st.rs.d60)+'; beta '+nf(st.beta,2)+'.':null,
    'Yıllık oynaklık %'+nf(st.volAnn,0)+'; ATR %'+nf(vl.atrPct,1)+'.']);
  const g=Q.regime;if(g)sec('Piyasa rejimi',[g.label+': '+g.trend+'; XU100 20 gün '+pc(g.r20)+', zirveden '+pc(g.drawdown)+(fin(g.breadthPct)?', son taramada yükselen hisse oranı %'+nf(g.breadthPct,0):'')+'.']);
  const rc=R&&arr(R.components).find(c=>c.key==='radar'),cs=d.radar&&d.radar.consensus;
  if(cs&&typeof cs==='object'&&cs.karar)sec('Hisse Radar (yapay zekâ konsensüsü)',['Konsensüs '+cs.karar+(fin(cs.skor)?' (skor '+sn(cs.skor,2):' (')+(fin(cs.guven)?(fin(cs.skor)?', ':'')+'güven %'+nf(cs.guven,0):'')+(fin(cs.n)?(fin(cs.skor)||fin(cs.guven)?', ':'')+cs.n+' model':'')+')'.replace(' ()','')+'; '+
    (rc?'analist notundaki payı küçük (%'+nf(rc.pay,0)+'), hissenin geçmişinde doğrulanmadığı için güvene katılmaz.':'ölçülen isabeti yazı-turanın üstünde olmadığından nota katılmadı.')]);
  const se=Q.seasonality;if(se&&Array.isArray(se.months)){const c0=se.months[se.current],nx=se.months[(se.current+1)%12];
    if(c0&&c0.n)sec('Mevsimsellik',[MON[c0.m]+' ayı geçmişte ort. '+pc(c0.avg)+' (pozitif yıl %'+nf(c0.win,0)+', '+c0.n+' yıl)'+(nx&&nx.n?'; '+MON[nx.m]+' ort. '+pc(nx.avg)+' (%'+nf(nx.win,0)+')':'')+'.',
      c0.sig||(nx&&nx.sig)?'Fark yıl sayısına göre belirgin (|t| ≥ 2); yine de 12 ay birlikte sınandığından şans payı vardır.':'Farklar yıl sayısına göre istatistiksel olarak belirgin değil; tek başına karar gerekçesi olmamalı.'])}
  const risks=[],o=Q.odds;
  if(fin(mo.rsi)&&mo.rsi>=70)risks.push('RSI aşırı alım bölgesinde ('+nf(mo.rsi,0)+'): kısa vadeli geri çekilme riski.');
  if(fin(mo.rsi)&&mo.rsi<=30)risks.push('RSI aşırı satımda ('+nf(mo.rsi,0)+'): düşüş trendi sürebilir, dönüş teyidi beklenmeli.');
  for(const dv of arr(mo.divergences))if(dv&&dv.text&&dv.dir!==V.dir&&V.dir)risks.push(dv.text+' kararla çelişiyor.');
  if(g&&g.dir<0&&V.dir>0)risks.push('Piyasa geneli zayıf; AL kurulumlarında başarı oranı düşebilir.');
  if(pl&&!pl.wait&&fin(pl.rr)&&pl.rr<1.5)risks.push('Risk/ödül zayıf (1:'+nf(pl.rr,2)+').');
  if(o&&fin(o.ev)&&o.ev<0)risks.push('Geçmiş simülasyonda bu plan negatif beklenen değer verdi ('+sn(o.ev,2)+'R).');
  else if(o&&fin(o.evAdj)&&o.evAdj<0)risks.push('Örnek belirsizliği hesaba katılınca planın beklenen değeri negatif ('+sn(o.evAdj,2)+'R).');
  if(vl.bb&&vl.bb.squeeze)risks.push('Bollinger sıkışması: her iki yöne sert hareket olabilir.');
  if(d.stale)risks.push('Veri çevrimdışı/eski olabilir.');
  sec('Riskler',risks.length?risks:['Belirgin ek risk işareti yok; yine de stop disiplini esastır.']);
  const watch=[];if(lvR)watch.push('Direnç '+zone(lvR)+': üstünde kapanış yükselişi teyit eder.');if(lvS)watch.push('Destek '+zone(lvS)+': altında kapanış görünümü bozar.');
  if(fin(vo.ratio))watch.push('Hacim (20 mum ortalamasının '+nf(vo.ratio,1)+' katı): kırılımlarda hacim teyidi.');
  sec('Takip edilecekler',watch);
  const text=[(d.symbol||'')+' · Borsa Pro analist raporu · '+new Date(fin(P.time)?P.time:Date.now()).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'}),'',
    ...S.flatMap(x=>[x.h.toLocaleUpperCase('tr-TR'),...x.lines.map(l=>'• '+l),'']),'Bu rapor teknik ve istatistiksel analiz çıktısıdır; yatırım tavsiyesi değildir. Geçmiş performans geleceği garanti etmez.'].join('\n');
  return {sections:S,text}}

return {clean,dist,scoreSeries,scoreStudy,setupStudy,karne,planOdds,ranges,seasonality,techSummary,regime,weekly,weeklyTrend,calibrate,rating,analyze,report,
  cci,williams,stochK,LBL,NOTES,
  _util:{nf,pc,sn,neff,wilson,shrink,shrinkN,dayNum,upcoming,radarPart,C:{K_PRIOR,TAU_EDGE20,TAU_DRIFT,VOL_PHI,EWMA_L,TH,LIQ_MIN,EVENT_DAYS}}};
});
