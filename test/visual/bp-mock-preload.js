// Gorsel kontrol icin window.bp taklidi: gercek analiz modulleri (engine, bp-data, bp-strategy) + sentetik piyasa verisi.
// shot.js bu preload'u sandbox:false ile yukler. Sekme: BP_TAB ortam degiskeni (grafik|tarama|lab|portfoy|alarm|piyasa).
const {contextBridge,ipcRenderer}=require('electron');
const path=require('path'),R=p=>require(path.join(__dirname,'..','..',p));
const engine=R('engine.js'),D=R('bp-data.js'),lab=R('bp-strategy.js'),{summarize}=R('borsa-pro-main.js'),demo=require('./bp-demo-data.js');
const hash=s=>[...String(s)].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7);
const STEP={'5dk':5*60000,'15dk':15*60000,'1s':3600000,'1g':86400000,'1h':7*86400000};
const N={'5dk':400,'15dk':300,'1s':400,'1g':480,'1h':260};
const series=(sym,tf)=>{const h=hash(sym),st=STEP[tf]||86400000;const n=N[tf]||400;
  return demo.rows({n,step:st,start:Date.now()-n*st*(st>=86400000?1.45:3.2),p0:20+h%400,seed:h+(tf.length*13),vol:st>=86400000?0.02:0.006})};
const market={TF:{'1g':1},yahooSymbol:s=>String(s).toUpperCase().replace(/\.IS$/,'')+(/[.=^-]/.test(s)?'':'.IS'),
  candles:async(s,tf)=>{const rows=series(String(s).replace('.IS',''),tf);return {rows,quote:{price:rows[rows.length-1].c,prev:rows[rows.length-2].c}}},
  quote:async s=>{const rows=series(String(s).replace('.IS',''),'1g'),p=rows[rows.length-1].c,prev=rows[rows.length-2].c;return {symbol:s,price:p,prev,chg:p-prev,chgPct:(p/prev-1)*100,time:Date.now()}},
  multi:async(s,{tf})=>{const fr={};for(const k of [tf,'1g','1h'])fr[k]=series(String(s).replace('.IS',''),k);return {frames:fr,quotes:{},errors:[]}}};
const data=D.createData({market,engine,sleep:()=>Promise.resolve()});
const bench=series('XU100','1g');
let watch=['THYAO','ASELS','GARAN','AKBNK','BIMAS','EREGL','KCHOL','TUPRS','SISE','FROTO','YKBNK','PGSUS'];
let alarms=[{id:'a1a1a1a1',symbol:'THYAO',kind:'above',price:0,note:'Direnç kırılımı',created:Date.now()-3600e3,fired:null,last:null},
  {id:'b2b2b2b2',symbol:'ASELS',kind:'verdict',price:null,note:'',created:Date.now()-7200e3,fired:null,last:'BEKLE'},
  {id:'c3c3c3c3',symbol:'GARAN',kind:'below',price:100,note:'Stop',created:Date.now()-86400e3,fired:Date.now()-5400e3,text:'GARAN 100,00 seviyesinin altına indi (son 99,40)'}];
let positions=[{id:'p1p1p1p1',symbol:'THYAO',qty:500,cost:0,date:'2026-09-01',note:'',stop:null,target:null},{id:'p2p2p2p2',symbol:'BIMAS',qty:120,cost:0,date:'2026-08-12',note:'',stop:null,target:null},
  {id:'p3p3p3p3',symbol:'EREGL',qty:2000,cost:0,date:'2026-10-02',note:'',stop:null,target:null}];
for(const p of positions){const r=series(p.symbol,'1g'),c=r[r.length-1].c;p.cost=+(c*(p.symbol==='EREGL'?1.06:0.9)).toFixed(2);p.stop=+(c*0.92).toFixed(2)}
alarms[0].price=+(series('THYAO','1g').slice(-1)[0].c*1.05).toFixed(2);
let lastScan=null,capital=250000,prefs={tab:process.env.BP_TAB||'grafik',universe:'BIST30',show:{}};
const px=s=>{const r=series(s,'1g');return {price:r[r.length-1].c,prev:r[r.length-2].c,chgPct:(r[r.length-1].c/r[r.length-2].c-1)*100}};
const port=()=>({positions,summary:summarize(positions,px,new Date().toISOString().slice(0,10))});
let evt=()=>{};
async function scanNow(u){const syms=u==='WATCH'?watch:D.U[u];const r=await data.scan(syms,{bench,onProgress:p=>evt({type:'scan',...p})});
  const rows=r.rows.map(x=>({...x,presets:D.PRESETS.filter(p=>data.matches(x,p.id)).map(p=>p.id)}));lastScan={...r,rows,universe:u,breadth:data.breadth(rows)};return lastScan}
async function load({symbol='THYAO',tf='1g'}={}){
  const sym=String(symbol).toUpperCase(),fr={};for(const k of [tf,'1g','1h'])fr[k]=series(sym,k);
  const rows=fr[tf],pro=engine.proAnalyze(fr,{primary:tf,news:[{score:2},{score:1}],depth:{pressure:24,flow:1e6,live:1}});
  const q=await market.quote(sym),fsum={};for(const k in pro.trend.frames){const t=pro.trend.frames[k];fsum[k]={dir:t.dir,text:t.text,adx:t.adx}}
  return {ok:true,symbol:sym,yahoo:sym+'.IS',market:'BIST',name:(D.NAMES&&D.NAMES[sym])||sym,tf,currency:'TRY',rows,pro,stats:data.stats(fr['1g'],bench),
    quote:{...q,currency:'TRY',dayHigh:null,dayLow:null,volume:null,stale:false},signals:engine.systemSignals(rows).map(s=>({t:rows[s.i].t,dir:s.dir,why:s.why})),frames:fsum,
    news:{bot:{list:[{title:'Şirket yeni uçak siparişi için anlaşma imzaladı',summary:'Şirket 2027 teslimli 20 yeni uçak için anlaşma imzaladı; kapasite artışı beklentisi olumlu.',score:3,importance:4,source:'KAP',ts:new Date(Date.now()-5*3600e3).toISOString()},
      {title:'BIST 100 güne yükselişle başladı',score:1,importance:4,source:'AA',general:true,ts:new Date(Date.now()-2*3600e3).toISOString()}],
      calendar:[{day:'2026-10-28',kind:'Bilanço',title:'3. çeyrek finansal tablolar'}],akd:{days:5,top:[{name:'Bank of America',net:1250000,buyDays:4}]}},yahoo:[]},
    depth:{at:Date.now()-60e3,pressure:24,trend:'Alış baskısı artıyor',flow:{net:1.2e6},signal:{dir:1,why:['Aktif alış ağırlıklı','BofA topluyor']},
      buyers:[{name:'Bank of America',net:820000},{name:'Yapı Kredi',net:310000}],sellers:[{name:'İş Yatırım',net:-540000},{name:'Garanti BBVA',net:-210000}]},errors:[],stale:false}}
contextBridge.exposeInMainWorld('bp',{
  state:async()=>{if(process.env.BP_SCAN&&!lastScan)await scanNow('BIST30');return {watch,tf:'1g',market:'BIST',symbol:process.env.BP_SYM||'THYAO',alarms,portfolio:port(),capital,riskPct:1,prefs,providers:process.env.BP_NOAI?[]:['groq','claude'],
    lastScan,marketStatus:{open:true,reason:null},universes:{BIST30:D.U.BIST30.length,BIST50:D.U.BIST50.length,BIST100:D.U.BIST100.length,WATCH:watch.length},
    presets:D.PRESETS,tags:D.TAGS,strategies:lab.STRATEGIES}},
  load,quotes:async l=>data.quotes(l),search:async q=>data.search(q),overview:async()=>data.overview(),
  watch:async o=>{if(o.op==='add')watch=[...new Set([...watch,String(o.symbol).toUpperCase()])];if(o.op==='remove')watch=watch.filter(x=>x!==o.symbol);return {ok:true,watch}},
  scan:async o=>({ok:true,...await scanNow(o.universe)}),
  scanCancel:async()=>({ok:true}),
  lab:async o=>{const rows=series(o.symbol,o.tf||'1g');return {ok:true,...lab.compare(rows,o.opts),symbol:o.symbol,tf:o.tf}},
  ai:async()=>({ok:true,provider:'groq',model:'openai/gpt-oss-120b',data:{ozet:'Günlük karar AL (skor +38): fiyat EMA20/50 üzerinde, haftalık trend yükselişte ve hacim yükselişi destekliyor. Fiyat en yakın direnç bölgesinin hemen altında.',
    gorunum:'olumlu',boga:'Direnç bölgesi üzerinde günlük kapanış gelirse Hedef 1 ve ardından Hedef 2 seviyeleri gündeme gelir.',ayi:'Destek bölgesinin altında kapanış, stop seviyesine doğru geri çekilme riskini artırır.',
    tetikler:['Direnç bölgesi üstünde kapanış (AL teyidi)','Destek altında kapanış (plan geçersiz)'],riskler:['RSI aşırı alıma yakın','Risk/ödül 1,5 altında'],izle:['Hacim / 20 gün ortalaması','Haftalık EMA20'],sonuc:'Koşullu olumlu görünüm; girişi geri çekilmede düşünmek daha dengeli. Yatırım tavsiyesi değildir.'},cost:0}),
  ask:async o=>({ok:true,answer:'Stop seviyesi giriş bölgesinin altındaki yapı desteğine göre belirlendi. Yatırım tavsiyesi değildir.'}),
  alarm:async o=>{if(o.op==='add')alarms=[...alarms,{id:Math.random().toString(16).slice(2,10),...o.alarm,created:Date.now(),fired:null,last:null}];if(o.op==='remove')alarms=alarms.filter(a=>a.id!==o.id);return {ok:true,alarms}},
  portfolio:async o=>{if(o.op==='remove')positions=positions.filter(p=>p.id!==o.id);return {ok:true,...port()}},
  capital:async v=>({ok:true,capital:v==null?null:+v}),prefs:async o=>({...prefs,...o}),open:async()=>({ok:true}),
  on:f=>{evt=f;return ()=>{}}});
