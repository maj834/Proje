// Borsa Pro - Strateji Lab: kural tabanli stratejilerin geriye donuk testi. Saf JS, ag yok.
// Node'da require('./bp-strategy'), tarayicida <script src="engine.js"> + <script src="bp-strategy.js"> -> window.BPStrategy.
// Ileriye bakma yok: sinyal mumun KAPANISINDA olusur, islem SONRAKI mumun ACILISINDA yapilir. Son mumdaki sinyal uygulanmaz
// (lastSignal'da gorunur). Stop: giris fiyati -/+ atrStop*ATR(14); ATR sinyal mumunda bilinen degerdir ve giriste sabitlenir.
// Mumun dusugu (aciga satista yuksegi) stopa degerse stop fiyatindan, acilis stopun otesindeyse (bosluk) acilistan cikilir.
// Maliyet: gidis-donus % (komisyon+kayma), her islemin brut getirisinden dusulur; sermaye egrisine giriste yansir.
// Sermaye bilesik (her islemde tum sermaye, kaldiracsiz); pozisyon disinda nakit sabit (faiz yok). Sharpe'ta risksiz faiz 0.
// Gecmis performans gelecegi garanti etmez; yatirim tavsiyesi degildir.
(function(root,factory){
  const node=typeof module!=='undefined'&&module.exports,api=factory(node?require('./engine'):root.Engine);
  if(node)module.exports=api;else root.BPStrategy=api;
})(this,function(E){

const NO_ENGINE=!E||typeof E.atrS!=='function'||typeof E.systemSignals!=='function'; // tarayicida engine.js once yuklenmeli
const DAY=864e5,YEAR=365.25*DAY,TR_OFF=3*3600e3;
const MIN_BARS=50,FEW_BARS=120,MIN_YEARS=60/365.25,MAX_TRADES=50,MAX_PTS=400,MIN_TRADES=5,PF_CAP=4;
const fin=v=>typeof v==='number'&&Number.isFinite(v);
const rnd=(v,d)=>fin(v)?(Math.round(v*10**d)/10**d||0):null;
const sum=a=>{let s=0;for(const x of a)s+=x;return s},mean=a=>a.length?sum(a)/a.length:null;
const median=a=>{const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
const zeros=n=>new Array(n).fill(0);
const numOpt=(v,d,lo,hi)=>{if(typeof v==='string'&&v.trim())v=+v.trim().replace(',','.');return fin(v)?Math.min(hi,Math.max(lo,v)):d};
const fmt=(v,d=1)=>v===Infinity?'∞':Number(v).toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d});
const pct=(v,d=1)=>fin(v)?(v<0?'-':'')+'%'+fmt(Math.abs(v),d):'—';

const STRATEGIES=[
  {id:'sistem',name:'Sistem (trend+momentum)',warmup:51,
    desc:'EMA20/50/200 dizilimi, EMA50 eğimi, MACD ve RSI\'dan oluşan skor ±0,35 eşiğini geçince al, ters eşikte sat (Pro analizdeki sistem sinyalleri).'},
  {id:'ema',name:'EMA 20/50 kesişimi',warmup:51,desc:'EMA20, EMA50\'yi yukarı kesince al; aşağı kesince sat.'},
  {id:'rsi',name:'RSI 30/70 dönüşü',warmup:16,desc:'RSI(14) 30\'un altından yukarı dönünce al; 70\'in üstünden aşağı dönünce sat.'},
  {id:'donchian',name:'Donchian 20 kırılımı',warmup:21,
    desc:'Kapanış önceki 20 mumun en yükseğini aşınca al; önceki 10 mumun en düşüğünün altına inince çık (Turtle). Açığa satışta tersi.'},
  {id:'macd',name:'MACD kesişimi',warmup:35,desc:'MACD(12, 26, 9) çizgisi sinyal çizgisini yukarı kesince al; aşağı kesince sat.'},
  {id:'bb',name:'Bollinger dönüşü',warmup:21,desc:'Kapanış alt bandın (20, 2σ) altından banda geri dönünce al; üst bandın üstünden geri dönünce sat.'},
  {id:'supertrend',name:'SuperTrend (10, 3)',warmup:11,desc:'ATR(10)×3 bantlı SuperTrend yukarı dönünce al; aşağı dönünce sat.'}];
const byId=id=>STRATEGIES.find(s=>s.id===id)||null;

// --- veri temizligi ---
// Gecersiz satirlar (kapanis/zaman yok, sifir/eksi fiyat) atilir; eksik acilis onceki kapanisla, eksik h/l govdeyle onarilir,
// h>=max(o,c) ve l<=min(o,c) zorlanir. Zaman sirasi bozuksa siralanir, ayni zamanli satirlardan sonuncusu kalir.
// k: satirin giris dizisindeki indeksi (raporlanan i0/i1/i alanlari bu indekslerdir).
function clean(rows){
  const out=[];if(!Array.isArray(rows))return out;
  let pc=null,sorted=true;
  for(let k=0;k<rows.length;k++){const r=rows[k];if(!r||typeof r!=='object')continue;
    const t=r.t,c=r.c;if(!fin(t)||!fin(c)||c<=0)continue;
    const o=fin(r.o)&&r.o>0?r.o:pc!=null?pc:c;
    const h=Math.max(fin(r.h)&&r.h>0?r.h:-Infinity,o,c),l=Math.min(fin(r.l)&&r.l>0?r.l:Infinity,o,c);
    if(out.length&&t<=out[out.length-1].t)sorted=false;
    out.push({t,o,h,l,c,v:fin(r.v)&&r.v>0?r.v:0,k});pc=c}
  if(sorted)return out;
  out.sort((a,b)=>a.t-b.t||a.k-b.k);const d=[];
  for(const r of out){if(d.length&&d[d.length-1].t===r.t)d[d.length-1]=r;else d.push(r)}
  return d}

// --- zaman: bar sikligi ve yil sayisi ---
// Medyan aralik >= 3 gun: yil/aralik (haftalik ~52,2). Gunluk: 252 islem gunu (verinin %10'undan fazlasi hafta sonundaysa 365).
// Gun ici: Istanbul takvim gunu basina medyan bar sayisi x islem gunu. years: ilk ve son mumun zaman farki (sermaye egrisi
// ilk mumun kapanisindan son mumun kapanisina uzanir).
function timing(ts){
  const N=ts.length,d=[];for(let i=1;i<N;i++){const x=ts[i]-ts[i-1];if(x>0)d.push(x)}
  const years=N>1?Math.max(0,(ts[N-1]-ts[0])/YEAR):0;
  if(!d.length)return {barMs:null,barsPerYear:252,years,kind:'?'};
  const bar=median(d);let we=0;for(const t of ts){const w=new Date(t+TR_OFF).getUTCDay();if(w===0||w===6)we++}
  const days=we/N>0.1?365:252;
  if(bar>=3*DAY)return {barMs:bar,barsPerYear:YEAR/bar,years,kind:bar>=20*DAY?'ay':'hafta'};
  if(bar>=20*3600e3)return {barMs:bar,barsPerYear:days,years,kind:'gun'};
  const per=new Map();for(const t of ts){const k=Math.floor((t+TR_OFF)/DAY);per.set(k,(per.get(k)||0)+1)}
  return {barMs:bar,barsPerYear:days*median([...per.values()]),years,kind:'gunici'}}

// --- sinyal yardimcilari ---
// Fark dizisinin isaret degisimi: +-eps bandi icindeki degerler (kayan nokta gurultusu) durumu degistirmez.
// Ilk kesin durum olay degildir; sonraki her isaret degisimi o mumda +1/-1 olaydir.
function flips(d,eps){const o=zeros(d.length);let st=0;
  for(let i=0;i<d.length;i++){const v=d[i];if(!fin(v))continue;const e=typeof eps==='number'?eps:eps[i];
    const x=v>e?1:v<-e?-1:0;if(x&&x!==st){if(st)o[i]=x;st=x}}
  return o}
const diff=(a,b)=>a.map((v,i)=>fin(v)&&fin(b[i])?v-b[i]:null);
// SuperTrend (TradingView ta.supertrend ile ayni): ATR(n) Wilder, kaynak hl2; bantlar yalniz trend yonunde daralir.
// dir: 1 yukari (fiyat alt bandin ustunde), -1 asagi. Ilk gecerli mumda yon asagi kabul edilir.
function supertrend(rows,n=10,f=3){
  const N=rows.length,atr=E.atrS(rows,n),st=new Array(N).fill(null),dir=st.slice(),up=st.slice(),lo=st.slice();
  let pU=null,pL=null,pD=null;
  for(let i=0;i<N;i++){const a=atr[i];if(!fin(a))continue;
    const m=(rows[i].h+rows[i].l)/2,c=rows[i].c;let U=m+f*a,L=m-f*a;
    if(pL!=null&&!(L>pL||rows[i-1].c<pL))L=pL;
    if(pU!=null&&!(U<pU||rows[i-1].c>pU))U=pU;
    const d=pD==null?-1:pD<0?(c>U?1:-1):(c<L?-1:1);
    up[i]=U;lo[i]=L;dir[i]=d;st[i]=d>0?L:U;pU=U;pL=L;pD=d}
  return {st,dir,up,lo}}

// Strateji kurallari. x: prep() baglami. Donus: {s (giris/ters sinyal), ex? (yalniz cikis), why, exWhy?}
// s[i]=+1: uzun (aciga satistaysa kapat ve uzun); -1: uzunu kapat (longOnly degilse aciga sat). ex[i]=-1 uzunu, +1 kisayi kapatir.
const SIG={
  sistem(x){const s=zeros(x.N);for(const g of E.systemSignals(x.R))if(g.i>=0&&g.i<x.N&&(g.dir===1||g.dir===-1))s[g.i]=g.dir;
    return {s,why:{1:'Sistem AL',[-1]:'Sistem SAT'}}},
  ema(x){return {s:flips(diff(E.emaS(x.c,20),E.emaS(x.c,50)),x.eps),why:{1:'EMA20, EMA50\'yi yukarı kesti',[-1]:'EMA20, EMA50\'yi aşağı kesti'}}},
  rsi(x){const r=E.rsi(x.c,14),u=flips(r.map(v=>fin(v)?v-30:null),1e-9),d=flips(r.map(v=>fin(v)?v-70:null),1e-9);
    return {s:u.map((v,i)=>v>0?1:d[i]<0?-1:0),why:{1:'RSI 30\'un üstüne döndü',[-1]:'RSI 70\'in altına döndü'}}},
  // Kanal disinda kapanis durumu; olay = durumun yeni basladigi mum (taze kirilim). Kanal: onceki 20 (cikis: 10) mumun h/l'si.
  donchian(x){const {R,N,eps}=x,s=zeros(N),ex=zeros(N);let p20=0,p10=0;
    for(let i=10;i<N;i++){const c=R[i].c;let h=-Infinity,l=Infinity;
      for(let j=i-10;j<i;j++){if(R[j].h>h)h=R[j].h;if(R[j].l<l)l=R[j].l}
      const b10=c<l-eps[i]?-1:c>h+eps[i]?1:0;if(b10&&b10!==p10)ex[i]=b10;p10=b10;
      if(i>=20){for(let j=i-20;j<i-10;j++){if(R[j].h>h)h=R[j].h;if(R[j].l<l)l=R[j].l}
        const b20=c>h+eps[i]?1:c<l-eps[i]?-1:0;if(b20&&b20!==p20)s[i]=b20;p20=b20}}
    return {s,ex,why:{1:'Kapanış 20 mumluk zirveyi aştı',[-1]:'Kapanış 20 mumluk dibin altına indi'},
      exWhy:{1:'Kapanış 10 mumluk zirveyi aştı (açığı kapat)',[-1]:'Kapanış 10 mumluk dibin altına indi (çık)'}}},
  macd(x){return {s:flips(E.macdS(x.c).hist,x.eps),why:{1:'MACD sinyal çizgisini yukarı kesti',[-1]:'MACD sinyal çizgisini aşağı kesti'}}},
  bb(x){const B=E.bollinger(x.c,20,2),u=flips(diff(x.c,B.lo),x.eps),d=flips(diff(x.c,B.up),x.eps);
    return {s:u.map((v,i)=>v>0?1:d[i]<0?-1:0),why:{1:'Alt Bollinger bandının içine döndü',[-1]:'Üst Bollinger bandının içine döndü'}}},
  supertrend(x){const d=supertrend(x.R,10,3).dir,s=zeros(x.N);
    for(let i=1;i<x.N;i++)if(d[i]!=null&&d[i-1]!=null&&d[i]!==d[i-1])s[i]=d[i];
    return {s,why:{1:'SuperTrend yukarı döndü',[-1]:'SuperTrend aşağı döndü'}}}};

// Ortak baglam: temiz satirlar, kapanislar, gurultu esigi, ATR(14), zaman bilgisi, strateji sinyal onbellegi.
function prep(rows){const R=clean(rows),c=R.map(r=>r.c);
  return {R,N:R.length,c,eps:c.map(v=>v*1e-9),atr:R.length&&!NO_ENGINE?E.atrS(R,14):[],tm:timing(R.map(r=>r.t)),S:{}}}
const sigs=(x,id)=>x.S[id]||(x.S[id]=SIG[id](x));
// Kural olaylari (grafik isaretleri ve son sinyal): her giris/ters sinyal; yalniz-cikis olaylari (ex) ancak cikilacak bir
// yon varsa (son olay AL iken uzun cikisi; aciga satis aciksa son olay SAT iken kisa kapatma) gosterilir.
function events(x,id,longOnly=true){const S=sigs(x,id),out=[];let st=0;
  for(let i=0;i<x.N;i++){let d=S.s[i]||0,w=d?S.why[d]:null;
    if(!d&&S.ex&&S.ex[i]){const e=S.ex[i];if(e<0?st>0:!longOnly&&st<0){d=e;w=S.exWhy[e]}}
    if(d){out.push({i,dir:d,why:w});st=d}}
  return out}

// --- simulasyon ---
// Her mumda sira: (1) bekleyen emir acilista (cikis, sonra giris), (2) stop kontrolu (mum araligi), (3) kapanista sinyal
// -> bir sonraki mumun acilisi icin emir, (4) kapanista sermaye degeri. atr[j-1]: giris mumundan onceki (sinyal) mumun ATR'si.
function simulate(R,S,o,atr){
  const N=R.length,cost=o.cost,k=o.atrStop,cap=o.capital,s=S.s||[],ex=S.ex||null,o0=N?R[0].o:1;
  let cash=cap,tr=null,pend=null,open=null;const T=[],eq=new Array(N),bh=new Array(N);
  const net=px=>tr.dir*(px/tr.p0-1)*100-cost;
  const exit=(j,px,why,atOpen)=>{const ret=net(px);cash=Math.max(0,tr.eq0*(1+ret/100));
    T.push({i0:tr.i0,i1:j,p0:tr.p0,p1:px,ret,bars:j-tr.i0+(atOpen?0:1),exit:why,dir:tr.dir,stop:tr.stop});tr=null};
  const enter=(j,dir)=>{if(!(cash>0))return;const p0=R[j].o,a=j>0&&atr?atr[j-1]:null;
    const stop=k>0&&fin(a)&&a>0?p0-dir*k*a:null;tr={i0:j,p0,eq0:cash,dir,stop:stop!=null&&stop>0?stop:null}};
  for(let j=0;j<N;j++){const r=R[j];
    if(pend){if(pend.x&&tr)exit(j,r.o,'sinyal',true);if(pend.e&&!tr)enter(j,pend.e);pend=null}
    if(tr&&tr.stop!=null){const L=tr.dir>0;
      if(L?r.l<=tr.stop:r.h>=tr.stop){const gap=L?r.o<=tr.stop:r.o>=tr.stop;exit(j,gap?r.o:tr.stop,'stop',gap)}}
    if(j<N-1){const sg=s[j]||0,xg=ex?ex[j]||0:0;let x=false,e=0;
      if(tr){x=tr.dir>0?sg<0||xg<0:sg>0||xg>0;if(x&&sg&&sg!==tr.dir&&(sg>0||!o.longOnly))e=sg}
      else if(sg>0||(sg<0&&!o.longOnly))e=sg;
      if(x||e)pend={x,e}}
    eq[j]=tr?Math.max(0,tr.eq0*(1+net(r.c)/100)):cash;bh[j]=cap*r.c/o0}
  if(tr){const j=N-1;open={i0:tr.i0,p0:tr.p0,ret:net(R[j].c),dir:tr.dir,stop:tr.stop,bars:j-tr.i0+1};exit(j,R[j].c,'son',false)}
  return {T,eq,bh,open}}

// --- istatistik ---
// v: mum kapanislarindaki sermaye. maxDD: tepe-dip dusus (%, pozitif; tepe baslangic sermayesinden baslar).
// Sharpe: ardisik kapanis getirilerinin ortalama/standart sapma (orneklem) x sqrt(yillik bar sayisi), risksiz faiz 0.
// CAGR: gercek zaman araligindan; 60 gunden kisa veride (yilliklandirma yaniltici) null.
function perf(v,cap,tm){
  const N=v.length;if(!N)return {totalRet:null,cagr:null,maxDD:null,sharpe:null};
  const end=v[N-1];let pk=cap,dd=0;for(const x of v){if(x>pk)pk=x;if(pk>0&&(pk-x)/pk>dd)dd=(pk-x)/pk}
  const rs=[];for(let i=1;i<N;i++)if(v[i-1]>0)rs.push(v[i]/v[i-1]-1);
  let sharpe=null;if(rs.length>=2){const m=mean(rs),sd=Math.sqrt(sum(rs.map(r=>(r-m)**2))/(rs.length-1));if(sd>1e-12)sharpe=m/sd*Math.sqrt(tm.barsPerYear)}
  const cagr=tm.years>=MIN_YEARS?(end>0?((end/cap)**(1/tm.years)-1)*100:-100):null;
  return {totalRet:(end/cap-1)*100,cagr,maxDD:dd*100,sharpe}}
// Kar faktoru: kazanclar toplami / kayiplar toplami. Kayip yok ve kazanc varsa Infinity; islem yoksa (ya da hepsi basabas) null.
function tradeStats(T,N){
  const n=T.length,r=T.map(t=>t.ret),w=r.filter(v=>v>0),l=r.filter(v=>v<0),gw=sum(w),gl=-sum(l),b=T.map(t=>t.bars);
  return {n,winRate:n?w.length/n*100:null,avgRet:mean(r),avgWin:mean(w),avgLoss:mean(l),
    pf:!n?null:gl>0?gw/gl:gw>0?Infinity:null,exposure:N?sum(b)/N*100:null,avgBars:mean(b)}}
const emptyStats=()=>({trades:0,winRate:null,avgRet:null,avgWin:null,avgLoss:null,profitFactor:null,totalRet:null,bhRet:null,cagr:null,
  maxDD:null,sharpe:null,exposure:null,avgBars:null,lastSignal:null,inPosition:false,openTrade:null,bhCagr:null,bhMaxDD:null,
  years:null,barsPerYear:null,n:0});

function norm(o){o=o&&typeof o==='object'?o:{};const cp=numOpt(o.capital,NaN,-Infinity,Infinity);
  return {cost:numOpt(o.cost,0.2,0,10),atrStop:numOpt(o.atrStop,2,0,20),longOnly:o.longOnly!==false&&o.longOnly!=='false',capital:cp>0?cp:100}}
function blank(id,o,error,n){const d=byId(id);
  return {id:String(id),name:d?d.name:String(id),desc:d?d.desc:'',trades:[],equity:[],bh:[],stats:{...emptyStats(),n:n||0},opts:o,n:n||0,error}}

function runCtx(x,id,opts){
  const o=norm(opts),def=byId(id);
  if(!def||!SIG[id])return blank(id,o,'Bilinmeyen strateji: '+id,x.N);
  if(NO_ENGINE)return blank(id,o,'Analiz motoru (engine.js) yüklenmedi.',x.N);
  if(x.N<MIN_BARS)return blank(id,o,'Strateji testi için en az '+MIN_BARS+' mum gerekli (şu an '+x.N+').',x.N);
  const R=x.R,N=x.N,m=simulate(R,sigs(x,id),o,x.atr),P=perf(m.eq,o.capital,x.tm),B=perf(m.bh,o.capital,x.tm),ts=tradeStats(m.T,N);
  const ev=events(x,id,o.longOnly),ls=ev[ev.length-1],op=m.open;
  const trades=m.T.map(t=>({i0:R[t.i0].k,i1:R[t.i1].k,t0:R[t.i0].t,t1:R[t.i1].t,p0:rnd(t.p0,4),p1:rnd(t.p1,4),ret:rnd(t.ret,2),
    bars:t.bars,exit:t.exit,dir:t.dir,stop:rnd(t.stop,4)}));
  const out={id,name:def.name,desc:def.desc,trades,
    equity:m.eq.map((v,j)=>({t:R[j].t,v:rnd(v,4)})),bh:m.bh.map((v,j)=>({t:R[j].t,v:rnd(v,4)})),
    stats:{trades:ts.n,winRate:rnd(ts.winRate,1),avgRet:rnd(ts.avgRet,2),avgWin:rnd(ts.avgWin,2),avgLoss:rnd(ts.avgLoss,2),
      profitFactor:ts.pf===Infinity?Infinity:rnd(ts.pf,2),totalRet:rnd(P.totalRet,2),bhRet:rnd(B.totalRet,2),cagr:rnd(P.cagr,2),
      maxDD:rnd(P.maxDD,2),sharpe:rnd(P.sharpe,2),exposure:rnd(ts.exposure,1),avgBars:rnd(ts.avgBars,1),
      lastSignal:ls?{dir:ls.dir,t:R[ls.i].t,price:rnd(R[ls.i].c,4),i:R[ls.i].k,ago:N-1-ls.i,why:ls.why}:null,
      inPosition:!!op,openTrade:op?{t0:R[op.i0].t,p0:rnd(op.p0,4),ret:rnd(op.ret,2),dir:op.dir,stop:rnd(op.stop,4),i0:R[op.i0].k,bars:op.bars}:null,
      bhCagr:rnd(B.cagr,2),bhMaxDD:rnd(B.maxDD,2),years:rnd(x.tm.years,3),barsPerYear:rnd(x.tm.barsPerYear,1),n:N},
    opts:o,n:N};
  if(N<FEW_BARS)out.warning='Az veri ('+N+' mum): sonuçlar istatistiksel olarak zayıf.';
  return out}

// Tek strateji. rows: {t,o,h,l,c,v} eskiden yeniye. Hata/eksik veride atmaz; {error} alanli bos sonuc doner.
function run(rows,id,opts){return runCtx(prep(rows),id,opts)}

// Grafik isaretleri: [{i (giris dizisi indeksi), dir, t, price (sinyal mumu kapanisi), why:[metin]}]. opts.longOnly (varsayilan true).
function signalsFor(rows,id,opts){
  if(!SIG[id]||NO_ENGINE)return [];const x=prep(rows);if(x.N<2)return [];
  return events(x,id,norm(opts).longOnly).map(e=>({i:x.R[e.i].k,dir:e.dir,t:x.R[e.i].t,price:rnd(x.R[e.i].c,4),why:[e.why]}))}

// --- karsilastirma ---
// LTTB (Largest Triangle Three Buckets) seyreltme: gorsel sekli (tepe/dipleri) koruyan en fazla max indeks; uclar dahil.
function thinIdx(v,max){const n=v.length;if(n<=max||max<3)return n<=max?[...Array(n).keys()]:n?[0,n-1]:[];
  const out=[0],every=(n-2)/(max-2);let a=0;
  for(let i=0;i<max-2;i++){
    const s=Math.floor((i+1)*every)+1,e=Math.min(Math.floor((i+2)*every)+1,n),len=Math.max(1,e-s);
    let ax=0,ay=0;for(let j=s;j<e;j++){ax+=j;ay+=v[j]}ax/=len;ay/=len;
    const lo=Math.floor(i*every)+1,hi=Math.floor((i+1)*every)+1;let best=-1,bi=lo;
    for(let j=lo;j<hi;j++){const ar=Math.abs((a-ax)*(v[j]-v[a])-(a-j)*(ay-v[a]));if(ar>best){best=ar;bi=j}}
    out.push(bi);a=bi}
  out.push(n-1);return out}
const mergeIdx=(a,b)=>[...new Set([...a,...b])].sort((x,y)=>x-y);
// Siralama skoru: en az 5 islem, kar faktoru > 1 ve toplam getiri > 0 sartiyla
//   score = (min(PF, 4) - 1) / (1 + maksDD/20) * islem/(islem+5)
// PF 4'te sinirlanir (az islemli Infinity/asiri PF'ler baskin olmasin); %20 dusus skoru yariya indirir; az islem cezalanir.
function scoreOf(st){
  if(!st||!(st.trades>=MIN_TRADES)||!(st.profitFactor>1)||!(st.totalRet>0))return null;
  const pf=Math.min(st.profitFactor,PF_CAP),dd=fin(st.maxDD)?Math.max(0,st.maxDD):100;
  return rnd((pf-1)/(1+dd/20)*st.trades/(st.trades+5),4)}
function pickBest(results){let b=null;const tot=r=>r.stats&&fin(r.stats.totalRet)?r.stats.totalRet:0;
  for(const r of Array.isArray(results)?results:[]){if(!r)continue;const sc=r.score!=null?r.score:scoreOf(r.stats);if(!fin(sc)||!(sc>0))continue;
    if(!b||sc>b.sc||(sc===b.sc&&tot(r)>tot(b.r)))b={r,sc}}
  return b?b.r.id:null}

// Tum stratejiler. results: run ozetleri (islemler en yeni 50, sermaye/al-tut egrileri en fazla 400 nokta, ayni zaman noktalari).
function compare(rows,opts){
  const x=prep(rows),o=norm(opts),full=STRATEGIES.map(s=>runCtx(x,s.id,o));
  const nf=v=>v.toLocaleString('tr-TR',{maximumFractionDigits:2});
  const rule='Sinyal mum kapanışında, işlem ertesi mumun açılışında (ileriye bakma yok); maliyet %'+nf(o.cost)+
    ' gidiş-dönüş; '+(o.atrStop>0?'stop '+nf(o.atrStop)+' ATR':'stop yok')+'; '+(o.longOnly?'yalnız alış':'alış ve açığa satış')+
    '. Geçmiş performans geleceği garanti etmez; yatırım tavsiyesi değildir.';
  if(full[0].error){const e=full[0].error; // yetersiz veri ya da motor yok: tum stratejilerde ayni hata
    return {results:full.map(r=>({...r,score:null,tradesOmitted:0})),best:null,bh:{ret:null,cagr:null,maxDD:null,curve:[]},note:e,error:e,n:x.N,opts:o}}
  const b0=full[0],bi=thinIdx(b0.bh.map(p=>p.v),MAX_PTS/2);
  const results=full.map(r=>{const idx=mergeIdx(bi,thinIdx(r.equity.map(p=>p.v),MAX_PTS/2));
    return {...r,trades:r.trades.slice(-MAX_TRADES),tradesOmitted:Math.max(0,r.trades.length-MAX_TRADES),
      equity:idx.map(i=>r.equity[i]),bh:idx.map(i=>r.bh[i]),score:scoreOf(r.stats)}});
  const best=pickBest(results),bs=best&&results.find(r=>r.id===best),st=b0.stats;
  let note=bs?'En iyi: '+bs.name+' — '+bs.stats.trades+' işlem, kâr faktörü '+fmt(bs.stats.profitFactor,2)+', maks. düşüş '+pct(bs.stats.maxDD)+
      ', toplam getiri '+pct(bs.stats.totalRet)+' (al-tut '+pct(st.bhRet)+'). Seçim: en az '+MIN_TRADES+' işlem ve maliyet sonrası kâr şartıyla kâr faktörü ile maksimum düşüşün dengesi. '
    :'Hiçbir strateji en az '+MIN_TRADES+' işlem ve maliyet sonrası kâr (kâr faktörü > 1) şartını sağlamadı; al-tut '+pct(st.bhRet)+'. ';
  if(x.N<FEW_BARS)note+='Az veri ('+x.N+' mum): sonuçlar istatistiksel olarak zayıf. ';
  return {results,best,bh:{ret:st.bhRet,cagr:st.bhCagr,maxDD:st.bhMaxDD,curve:bi.map(i=>b0.bh[i])},note:note+rule,n:x.N,opts:o}}

return {STRATEGIES,run,compare,signalsFor,
  _util:{clean,timing,flips,supertrend,prep,sigs,events,simulate,perf,tradeStats,norm,thinIdx,mergeIdx,scoreOf,pickBest,
    MIN_BARS,MAX_TRADES,MAX_PTS,MIN_TRADES,PF_CAP}};
});
