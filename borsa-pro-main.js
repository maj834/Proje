// Borsa Pro: buyuk analiz penceresi (etkilesimli grafik, tarayici, strateji lab, portfoy, alarmlar, yapay zeka yorumu).
// Bu dosya yalniz pencere, IPC, kalicilik ve alarm izleyicisidir; veri ve analiz modulleri disaridan verilir
// (market, engine, calendar, power, data, lab, analyst). Her IPC girdisi dogrulanir, yalniz Pro penceresi cagirabilir.
// Pil: bekleyen alarm yoksa ve pencere kapaliysa hicbir zamanlayici calismaz; seans kapaliyken fiyat sorulmaz,
// ekran kilitli / Mac uykudayken izleyici durur. Yatirim tavsiyesi degildir.
const fs=require('fs'),crypto=require('crypto');

const TFS=['1dk','5dk','15dk','1s','1g','1h'],MKTS=['BIST','US'],KINDS=['above','below','verdict'],LABELS=['AL','SAT','BEKLE'];
const UNIVERSES=['BIST30','BIST50','BIST100','WATCH'],PROVIDERS=['groq','claude','grok'],PNAME={groq:'Groq',claude:'Claude',grok:'Grok'};
const MAX_WATCH=60,MAX_ALARMS=100,MAX_POS=200,MAX_ROWS=800;
const IV=60000,IV_BAT=180000,VERDICT_MS=15*60000,OV_TTL=60000,DEPTH_FRESH=5*60000,CTX_TTL=15*60000,AN_TTL=2*60000,AI_TTL=10*60000,
  PX_FRESH=3*60000,BENCH_TTL=30*60000;
const DEF_WATCH=['THYAO','ASELS','GARAN','AKBNK','BIMAS','EREGL','KCHOL','TUPRS','SISE','FROTO'];
const BG={dark:'#101316',light:'#f5f7f9'};               // theme.css --bg: acilista beyaz parlama olmasin
const ID=/^[a-f0-9]{8,32}$/;
const CODE_ERR='Geçerli bir hisse kodu yaz (ör. THYAO).';

// --- saf yardimcilar (testli) ------------------------------------------------
const fin=v=>typeof v==='number'&&Number.isFinite(v);
const r2=v=>fin(v)?Math.round(v*100)/100:null;
const r4=v=>fin(v)?+v.toFixed(4):null;
const obj=o=>o&&typeof o==='object'&&!Array.isArray(o)?o:{};
const str=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const msg=e=>String(e&&e.message||e||'Bilinmeyen hata').slice(0,300);
const newId=()=>crypto.randomBytes(8).toString('hex');
const istDay=t=>new Date(t+3*3600000).toISOString().slice(0,10);
const err=(error,x)=>({ok:false,error,...(x||{})});
// Sayi: number ya da arayuzden gelen "12,5" / "1.234,50" yazisi; [lo,hi] disi null
function num(v,lo,hi){
  if(typeof v==='string'){v=v.trim().replace(/\s/g,'');if(!v||v.length>24)return null;
    v=Number(/,\d{1,8}$/.test(v)?v.replace(/\./g,'').replace(',','.'):v.replace(/,/g,''))}
  return fin(v)&&v>=lo&&v<=hi?v:null}
const pos=(v,hi)=>{const n=num(v,0,hi);return n!=null&&n>0?n:null};
const TRU={'Ş':'S','Ç':'C','Ğ':'G','Ö':'O','Ü':'U','İ':'I'};
const upTr=s=>s.trim().toLocaleUpperCase('tr-TR').replace(/[ŞÇĞÖÜİ]/g,c=>TRU[c]).replace(/\s+/g,'');
// BIST duz kodu: "thyao" / "THYAO.IS" / "şişe" -> "THYAO" / "SISE"; gecersizse null
function code(s){if(typeof s!=='string'||s.length>24)return null;s=upTr(s).replace(/\.IS$/,'');
  return /^[A-Z0-9]{2,8}$/.test(s)&&/[A-Z]/.test(s)?s:null}
// market.yahooSymbol yoksa ayni kural
function ysymFallback(s,mkt){s=upTr(String(s||''));if(!s||!/^[A-Z0-9.=^-]{1,20}$/.test(s))return null;return /[.=^-]/.test(s)?s:mkt==='BIST'?s+'.IS':s}
const disp=y=>String(y).replace(/\.IS$/,'');

function cleanPrefs(p){p=obj(p);const o={};
  if(p.show&&typeof p.show==='object'&&!Array.isArray(p.show)){const s={};
    for(const [k,v] of Object.entries(p.show).slice(0,40))if(/^[a-zA-Z0-9]{1,20}$/.test(k)&&(typeof v==='boolean'||v==='auto'))s[k]=v;o.show=s}
  if(typeof p.tab==='string'&&/^[a-zA-Z0-9-]{1,24}$/.test(p.tab))o.tab=p.tab;
  if(UNIVERSES.includes(p.universe))o.universe=p.universe;
  if(p.provider==='auto'||PROVIDERS.includes(p.provider))o.provider=p.provider;
  if(TFS.includes(p.tf))o.tf=p.tf;
  if(MKTS.includes(p.market))o.market=p.market;
  if(typeof p.chartType==='string'&&/^[a-zA-Z-]{1,16}$/.test(p.chartType))o.chartType=p.chartType;
  return o}
function cleanAlarm(a){
  if(!a||typeof a!=='object'||typeof a.id!=='string'||!ID.test(a.id))return null;
  const symbol=code(a.symbol),kind=KINDS.includes(a.kind)?a.kind:null;if(!symbol||!kind)return null;
  const price=kind==='verdict'?null:pos(a.price,1e9);if(kind!=='verdict'&&price==null)return null;
  return {id:a.id,symbol,kind,price,note:str(a.note,200),created:fin(a.created)?a.created:0,fired:fin(a.fired)?a.fired:null,
    last:kind==='verdict'?(LABELS.includes(a.last)?a.last:null):pos(a.last,1e9),text:typeof a.text==='string'?a.text.slice(0,300):null}}
// Pozisyon dogrulama: {pos} ya da {error} (Turkce)
function checkPos(p){p=obj(p);
  const symbol=code(p.symbol);if(!symbol)return {error:CODE_ERR};
  const qty=pos(p.qty,1e10);if(qty==null)return {error:'Adet pozitif bir sayı olmalı.'};
  const cost=pos(p.cost,1e7);if(cost==null)return {error:'Maliyet pozitif bir sayı olmalı.'};
  let date=null;
  if(p.date!=null&&p.date!==''){const d=typeof p.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(p.date)?new Date(p.date+'T00:00:00Z'):null;
    if(!d||isNaN(d)||d.toISOString().slice(0,10)!==p.date)return {error:'Tarih YYYY-AA-GG biçiminde olmalı.'};date=p.date}
  const opt=(v,name)=>{if(v==null||v==='')return {v:null};const n=pos(v,1e7);return n==null?{error:name+' pozitif bir sayı olmalı.'}:{v:n}};
  const st=opt(p.stop,'Stop'),tg=opt(p.target,'Hedef');if(st.error)return st;if(tg.error)return tg;
  return {pos:{id:typeof p.id==='string'&&ID.test(p.id)?p.id:newId(),symbol,qty,cost,date,note:str(p.note,200),stop:st.v,target:tg.v}}}
const cleanPos=p=>p&&typeof p==='object'&&typeof p.id==='string'&&ID.test(p.id)?checkPos(p).pos||null:null;
// cfg().borsaPro -> dogrulanmis ayar (bozuk/eksik alanlar varsayilana doner)
function clean(c){c=obj(c);
  const watch=Array.isArray(c.watch)?[...new Set(c.watch.map(code).filter(Boolean))].slice(0,MAX_WATCH):DEF_WATCH.slice();
  const ids=new Set(),alarms=[],positions=[];
  for(const a of Array.isArray(c.alarms)?c.alarms:[]){const x=cleanAlarm(a);if(x&&!ids.has(x.id)&&alarms.length<MAX_ALARMS){ids.add(x.id);alarms.push(x)}}
  for(const p of Array.isArray(c.positions)?c.positions:[]){const x=cleanPos(p);if(x&&!ids.has(x.id)&&positions.length<MAX_POS){ids.add(x.id);positions.push(x)}}
  return {watch,tf:TFS.includes(c.tf)?c.tf:'1g',market:MKTS.includes(c.market)?c.market:'BIST',
    symbol:typeof c.symbol==='string'&&/^[A-Z0-9.=^-]{1,20}$/.test(c.symbol)?c.symbol:'THYAO',
    alarms,positions,capital:pos(c.capital,1e12),prefs:cleanPrefs(c.prefs)}}

// Portfoy ozeti (saf): px(sym) -> {price,prev,chgPct,stale}|null; today: Istanbul gunu (bugun alinan pozisyonun gunluk K/Z'si maliyetten)
function summarize(positions,px,today){
  const rows=[];let value=0,cost=0,day=0;
  for(const p of positions){const q=obj(px(p.symbol)),price=fin(q.price)&&q.price>0?q.price:null,prev=fin(q.prev)&&q.prev>0?q.prev:null;
    const c=p.cost*p.qty,v=(price??p.cost)*p.qty,pnl=price!=null?v-c:0;
    const d=price==null?0:p.date&&p.date===today?(price-p.cost)*p.qty:prev!=null?(price-prev)*p.qty:0;
    value+=v;cost+=c;day+=d;
    rows.push({...p,price,prev,chgPct:fin(q.chgPct)?q.chgPct:null,value:r2(v),pnl:r2(pnl),pnlPct:c?r2(pnl/c*100):null,dayPnl:r2(d),weight:0,
      riskTL:p.stop!=null&&price!=null?r2(Math.max(0,(price-p.stop)*p.qty)):null,stopHit:p.stop!=null&&price!=null&&price<=p.stop,
      toStopPct:p.stop!=null&&price!=null?r2((p.stop/price-1)*100):null,toTargetPct:p.target!=null&&price!=null?r2((p.target/price-1)*100):null,
      noPrice:price==null,stale:!!q.stale})}
  for(const r of rows)r.weight=value>0?r2(r.value/value*100):0;
  const pnl=value-cost,risk=rows.reduce((s,r)=>s+(r.riskTL||0),0);
  return {value:r2(value),cost:r2(cost),pnl:r2(pnl),pnlPct:cost?r2(pnl/cost*100):null,dayPnl:r2(day),dayPct:value-day>0?r2(day/(value-day)*100):null,
    risk:r2(risk),positions:rows}}

// Seans durumunun bir sonraki degisebilecegi an (ms sonra): 09:55 acilis, 12:46 (yarim gun), 18:16, gece yarisi (tatil/hafta sonu nedeni).
// Seans kapaliyken izleyici dakika basi yoklamaz; yalniz bu anlarda uyanir. En fazla 3 saat (saat kaymasina karsi).
function nextChangeMs(t,cal){cal=cal||{};
  const O=fin(cal.OPEN)?cal.OPEN:595,C=(fin(cal.CLOSE)?cal.CLOSE:1095)+1,HC=(fin(cal.HALF_CLOSE)?cal.HALF_CLOSE:765)+1;
  const m=((t/60000+180)%1440+1440)%1440,next=[O,HC,C,1440].filter(b=>b>m+1e-6).sort((a,b)=>a-b)[0];
  return Math.min(3*3600000,Math.max(1000,Math.ceil((next-m)*60000)+1000))}

const fmt=v=>fin(v)?v.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:v<1?4:2}):'—';
const FROM={AL:'AL\'dan',SAT:'SAT\'tan',BEKLE:'BEKLE\'den'},TO={AL:'AL\'a',SAT:'SAT\'a',BEKLE:'BEKLE\'ye'};
function alarmText(a,p,r){const note=a.note?' · '+a.note:'';
  if(a.kind==='verdict')return a.symbol+' günlük kararı '+(FROM[a.last]||a.last)+' '+(TO[r.label]||r.label)+' döndü'+(fin(r.score)?' (skor '+r.score+')':'')+note;
  return a.symbol+' '+fmt(a.price)+' seviyesinin '+(a.kind==='above'?'üstüne çıktı':'altına indi')+' (son '+fmt(p)+')'+note}

// Sinirli eszamanlilik: her ogeye fn (hatalar yutulur)
async function each(items,n,fn){let i=0;
  await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(i<items.length){const x=items[i++];try{await fn(x)}catch(e){}}}))}
// Hata/zaman asiminda null donen sarmalayici (thunk senkron hata da atabilir)
function soft(f,ms){let p;try{p=f()}catch(e){return Promise.resolve(null)}
  if(!p||typeof p.then!=='function')return Promise.resolve(p??null);
  return new Promise(r=>{const t=setTimeout(()=>r(null),ms);if(t.unref)t.unref();p.then(v=>{clearTimeout(t);r(v)},()=>{clearTimeout(t);r(null)})})}
function withTimeout(p,ms,m){return new Promise((ok,no)=>{const t=setTimeout(()=>no(new Error(m||'Zaman aşımı.')),ms);if(t.unref)t.unref();
  Promise.resolve(p).then(v=>{clearTimeout(t);ok(v)},e=>{clearTimeout(t);no(e)})})}

function registerBorsaPro({ipcMain,app,BrowserWindow,path,screen,Notification,shell,nativeTheme,cfg,save,isOn=()=>true,market,engine,calendar,power,
  data,lab,analyst,ext={},say=()=>{},now=()=>Date.now(),timers,meta=null,quant=null,history=null,fund=null,radar=null,planner=null,apis=null,secrets=null,demo=null,okul=null}){
  const T=timers||{setTimeout:(f,ms)=>setTimeout(f,ms),clearTimeout:h=>clearTimeout(h)};
  ext=obj(ext);
  let win=null,enabled=false,timer=null,ticking=false,lastTick=0,statusKey=null,scanning=null,scanMem,loadSeq=0,ov=null,ovWait=null,bench=null,benchWait=null;
  const lastPx=new Map(),lastMem=new Map(),vCand=new Map(),vAt=new Map(),ctx=new Map(),aiCache=new Map(),aiWait=new Map(),anCache=new Map();

  // --- ayar ------------------------------------------------------------------
  const conf=()=>clean((cfg()||{}).borsaPro);
  const put=o=>save({borsaPro:{...conf(),...o}});
  const riskPct=()=>{try{const v=+(ext.riskPct?ext.riskPct():1);return v>=0.1&&v<=10?v:1}catch(e){return 1}};
  const battery=()=>{try{return !!power.state().battery}catch(e){return false}};
  const away=()=>{try{return !!power.away()}catch(e){return false}};
  const mstatus=()=>{try{const d=new Date(now());if(typeof calendar.status!=='function')return {open:!!calendar.isOpen(d),reason:null};
    const s=obj(calendar.status(d));return {open:!!s.open,reason:s.reason||null}}catch(e){return {open:false,reason:null}}};
  const skey=s=>s.open+'|'+s.reason;
  const ysym=(s,mkt)=>{if(typeof s!=='string'||!s.trim()||s.length>30)return null;
    try{return market&&typeof market.yahooSymbol==='function'?market.yahooSymbol(s,mkt)||null:ysymFallback(s,mkt)}catch(e){return null}};
  const lib=k=>(meta&&meta[k])||(data&&data[k])||null;
  const univ=()=>{const u=obj(lib('U')),o={};for(const k of ['BIST30','BIST50','BIST100'])o[k]=Array.isArray(u[k])?u[k]:[];return o};
  const counts=()=>{const u=univ();return {BIST30:u.BIST30.length,BIST50:u.BIST50.length,BIST100:u.BIST100.length,WATCH:conf().watch.length}};
  const providers=()=>{try{const p=analyst&&analyst.providers?analyst.providers():[];return Array.isArray(p)?p.filter(x=>PROVIDERS.includes(x)):[]}catch(e){return []}};
  const remember=(sym,q)=>{if(sym&&q&&fin(q.price)&&q.price>0&&!q.error)lastPx.set(sym,{price:q.price,prev:fin(q.prev)?q.prev:null,chgPct:fin(q.chgPct)?q.chgPct:null,stale:!!q.stale,at:now()})};
  const freshPx=sym=>{const q=lastPx.get(sym);return q&&!q.stale&&now()-q.at<PX_FRESH?q.price:null};

  // --- pencere -----------------------------------------------------------------
  const alive=()=>!!win&&!win.isDestroyed();
  const send=d=>{try{if(alive())win.webContents.send('bp:evt',d)}catch(e){}};
  const isWin=x=>{const wc=x&&x.sender?x.sender:x;return alive()&&!!wc&&wc===win.webContents};
  function open(symbol){
    if(!isOn())return;const s=symbol!=null?code(String(symbol)):null;
    if(alive()){if(win.isMinimized&&win.isMinimized())win.restore();win.show();win.focus();if(s)send({type:'symbol',symbol:s});return}
    if(s)put({symbol:s,market:'BIST'});                     // yeni pencere bp:state ile bu sembolu acar
    const dark=!!(nativeTheme&&nativeTheme.shouldUseDarkColors);let W=1360,H=860;
    try{const a=screen.getPrimaryDisplay().workAreaSize;W=Math.min(W,Math.max(1024,a.width));H=Math.min(H,Math.max(640,a.height))}catch(e){}
    const w=win=new BrowserWindow({width:W,height:H,minWidth:1024,minHeight:640,title:'Borsa Pro',show:false,backgroundColor:dark?BG.dark:BG.light,
      webPreferences:{preload:path.join(__dirname,'borsa-pro-preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
    Promise.resolve(w.loadFile(path.join(__dirname,'borsa-pro.html'))).catch(e=>console.error('borsa-pro: sayfa yuklenemedi:',msg(e)));w.once('ready-to-show',()=>{if(!w.isDestroyed()){w.show();w.focus()}});
    w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',e=>e.preventDefault());
    // Kapaninca tarama durur; izleyici yalniz bekleyen alarm varsa kalir
    w.on('closed',()=>{if(win===w)win=null;cancelScan();statusKey=null;schedule()});
    schedule();
  }
  const close=()=>{if(alive())win.close()};
  if(nativeTheme&&typeof nativeTheme.on==='function')nativeTheme.on('updated',()=>{try{if(alive())win.setBackgroundColor(nativeTheme.shouldUseDarkColors?BG.dark:BG.light)}catch(e){}});

  // --- piyasa verisi -----------------------------------------------------------
  function benchRows(){
    if(bench&&now()-bench.at<BENCH_TTL)return Promise.resolve(bench.rows);if(benchWait)return benchWait;
    const p=benchWait=soft(()=>market.candles('XU100','1g','BIST'),12000).then(r=>{const rows=r&&Array.isArray(r.rows)&&r.rows.length?r.rows:null;
      if(rows)bench={at:now(),rows};return rows||(bench?bench.rows:null)}).finally(()=>{if(benchWait===p)benchWait=null});
    return p}
  const nameOf=(sym,bist)=>{if(!bist||!data||typeof data.search!=='function')return null;
    try{const h=(data.search(sym)||[]).find(x=>x&&x.symbol===sym);return h&&h.name||null}catch(e){return null}};
  // Derinlik (Telegram botu): yalniz ayni hisse ve 5 dk'dan tazeyse kisa ozet
  function depthSummary(sym){
    let d;try{d=ext.depth?ext.depth():null}catch(e){d=null}
    if(!d||typeof d!=='object'||d.symbol!==sym||!fin(d.at)||now()-d.at>DEPTH_FRESH)return null;
    const top=(a,n)=>(Array.isArray(a)?a:[]).filter(x=>x&&typeof x==='object').slice(0,n);
    const lvl=x=>({price:fin(x.price)?x.price:null,qty:fin(x.qty)?x.qty:null}),inst=x=>({name:String(x.name||'').slice(0,40),net:fin(x.net)?x.net:null,cost:fin(x.cost)?x.cost:null});
    const pr=obj(d.pressure),fl=obj(d.flow),sg=d.signal&&typeof d.signal==='object'?d.signal:null;
    const tp=obj(d.tape),tv=x=>{x=obj(x);return {buy:fin(x.buy)?x.buy:null,sell:fin(x.sell)?x.sell:null,delta:fin(x.delta)?x.delta:null,vwap:fin(x.vwap)?x.vwap:null}};
    const lv=d.live&&typeof d.live==='object'?d.live:null;
    return {at:d.at,source:typeof d.source==='string'?d.source:null,last:fin(d.last)?d.last:null,change:fin(d.change)?d.change:null,
      ceiling:fin(d.ceiling)?d.ceiling:null,floor:fin(d.floor)?d.floor:null,buyRatio:fin(d.buyRatio)?d.buyRatio:null,
      pressure:fin(pr.score)?pr.score:null,parts:Array.isArray(pr.parts)?pr.parts.slice(0,6):[],trend:d.trend&&typeof d.trend.text==='string'?d.trend.text:null,
      trendDir:d.trend&&fin(d.trend.dir)?d.trend.dir:0,history:(Array.isArray(d.history)?d.history:[]).filter(h=>h&&fin(h.p)).slice(-40).map(h=>({t:fin(h.t)?h.t:null,p:h.p})),
      flow:d.flow?{net:fin(fl.net)?fl.net:null,change:fin(fl.change)?fl.change:null,top:fl.top&&typeof fl.top==='object'?inst(fl.top):null}:null,
      signal:sg?{dir:fin(sg.dir)?sg.dir:0,why:Array.isArray(sg.why)?sg.why.slice(0,4).map(String):[]}:null,
      live:lv?{dir:fin(lv.dir)?lv.dir:0,score:fin(lv.score)?lv.score:null,why:Array.isArray(lv.why)?lv.why.slice(0,4).map(String):[]}:null,
      tape:tp&&(tp.enough!=null||tp.score!=null)?{enough:!!tp.enough,score:fin(tp.score)?tp.score:null,dir:fin(tp.dir)?tp.dir:0,why:Array.isArray(tp.why)?tp.why.slice(0,3).map(String):[],
        w5:tp.w5?tv(tp.w5):null,w15:tp.w15?tv(tp.w15):null,top:tp.top&&typeof tp.top==='object'?{name:String(tp.top.name||'').slice(0,40),net:fin(tp.top.net)?tp.top.net:null}:null,
        cvd:(Array.isArray(tp.cvd)?tp.cvd:[]).slice(-30).map(x=>fin(x&&x.v)?x.v:null).filter(v=>v!=null)}:null,
      bids:top(d.bids,10).map(lvl),asks:top(d.asks,10).map(lvl),buyers:top(d.buyers,8).map(inst),sellers:top(d.sellers,8).map(inst),
      trades:top(d.trades,12).map(t=>({time:typeof t.time==='string'?t.time.slice(0,8):null,price:fin(t.price)?t.price:null,qty:fin(t.qty)?t.qty:null,side:t.side==='sell'?'sell':t.side==='buy'?'buy':null,buyer:typeof t.buyer==='string'?t.buyer.slice(0,30):null,seller:typeof t.seller==='string'?t.seller.slice(0,30):null})),
      walls:top(d.walls,6).map(x=>({side:x.side==='ask'?'ask':'bid',...lvl(x),ratio:fin(x.ratio)?x.ratio:null}))}}
  // Telegram derinlik botu: getir / canli takip / durum / terminal / kurulum. Depth verisi yalniz bu hisse ve 5 dk'dan tazeyse doner.
  async function depthOp(o){o=obj(o);const op=['fetch','auto','state','terminal','setup'].includes(o.op)?o.op:'state';
    const sym=o.symbol!=null?code(o.symbol):null,info=()=>{try{return ext.depthInfo?ext.depthInfo():null}catch(e){return null}};
    if(op==='setup'){if(ext.setupTg)ext.setupTg();return {ok:true}}
    if(op==='terminal')return ext.openTerminal?await ext.openTerminal():err('Bot terminali kullanılamıyor.');
    if(op==='auto'){const sec=[0,20,30,45,60,120].includes(o.sec)?o.sec:0;if(sec&&!sym)return err(CODE_ERR);
      return {ok:true,tg:ext.depthAuto?ext.depthAuto(sec,sym):info(),depth:sym?depthSummary(sym):null}}
    if(op==='fetch'){if(!sym)return err(CODE_ERR);if(!ext.fetchDepth)return err('Derinlik kaynağı yok.');
      const r=obj(await ext.fetchDepth(sym));const tg=info();
      if(r.ok===false)return {ok:false,error:r.error||'Derinlik alınamadı.',wait:!!r.wait,busy:!!r.busy,needTg:!!r.needTg||!!(tg&&!tg.connected),tg,depth:depthSummary(sym)};
      return {ok:true,tg,depth:depthSummary(sym)}}
    return {ok:true,tg:info(),depth:sym?depthSummary(sym):null}}
  // main.js yeni derinlik geldiginde cagirir: pencere aciksa ozet olayi
  function onDepth(sym){const s=code(String(sym||''));if(!s||!alive())return;const d=depthSummary(s);if(d)send({type:'depth',symbol:s,depth:d})}

  const demoCtl=require('./bp-demo-main').create({lib:demo,app,path,market,calendar,now,isOn,
    active:kind=>kind==='battery'?battery():enabled&&isOn()&&!away(),timers:T,send,Notification,open,timeout:withTimeout});

  // Tek sembolun tam analizi (pencere, Neo ve yapay zeka baglami ortak). y: Yahoo sembolu, sym: gosterilen kod
  async function loadCore(y,sym,tf,mkt){
    const bist=/\.IS$/.test(y);let es={};
    if(bist)try{es=obj(ext.extSignals&&ext.extSignals(sym))}catch(e){}
    // Uzun gecmis (olasilik motoru) ve temel veriler yan kaynaktir: gelmezse analiz yine yapilir
    // Hisse Radar (kullanicinin GitHub botlari: cok modelli yapay zeka konsensusu, Claude beklentisi, olasilik, backtest); anahtar gerekmez
    const [mt,qt,bn,bot,yn,hist,fr,rd]=await Promise.all([market.multi(y,{tf,market:mkt}),soft(()=>market.quote&&market.quote(y,mkt),10000),
      bist?benchRows():null,bist?soft(()=>ext.botNews&&ext.botNews(sym),8000):null,soft(()=>market.yahooNews&&market.yahooNews(y,mkt),8000),
      quant&&history?soft(()=>history.get(y),15000):null,typeof market.fundamentals==='function'?soft(()=>market.fundamentals(y,mkt),12000):null,
      bist&&radar&&typeof radar.forSymbol==='function'?soft(()=>radar.forSymbol(sym),8000):null]);
    const m=obj(mt),frames={...obj(m.frames)},errors=(Array.isArray(m.errors)?m.errors:[]).map(String).slice(0,8);
    let rows=Array.isArray(frames[tf])?frames[tf]:[];
    if(!rows.length){const e=errors.find(x=>x.startsWith(tf+': '));return err(e?e.slice(tf.length+2):'Bu sembol için veri alınamadı.',{errors})}
    const qs=obj(m.quotes),q0=obj(qs[tf]||qs['1g']),q1=qt&&typeof qt==='object'&&fin(qt.price)?qt:null;
    // Gunluk mum onbellegi 30 dk eski olabilir: ayni gunun son mumu taze fiyatla guncellenir (karar guncel kalsin; onbellek bozulmaz)
    const D=frames['1g'];
    if(q1&&!q1.stale&&fin(q1.time)&&Array.isArray(D)&&D.length){const L=D[D.length-1];
      if(L&&istDay(q1.time)===istDay(L.t)&&q1.time>=L.t&&L.c!==q1.price){frames['1g']=[...D.slice(0,-1),{...L,c:q1.price,h:Math.max(L.h,q1.price),l:Math.min(L.l,q1.price)}];
        if(tf==='1g')rows=frames['1g']}}
    const qb=q1&&(!q1.stale||!fin(q0.price))?{...q0,...q1}:q0,lastC=rows[rows.length-1];
    const price=fin(qb.price)?qb.price:lastC.c,prev=fin(qb.prev)&&qb.prev>0?qb.prev:null;
    const quote={price,prev,chg:prev!=null?r4(price-prev):null,chgPct:prev!=null?r2((price-prev)/prev*100):null,currency:qb.currency||(bist?'TRY':null),
      name:qb.name||null,exchange:qb.exchange||null,time:fin(qb.time)?qb.time:lastC.t,dayHigh:fin(qb.dayHigh)?qb.dayHigh:null,dayLow:fin(qb.dayLow)?qb.dayLow:null,
      volume:fin(qb.volume)?qb.volume:null,stale:!!qb.stale};
    if(bist&&q1&&!q1.stale)remember(sym,quote);              // yalniz taze fiyat (mum onbellegi 30 dk eski olabilir; alarm baslangici bozulmasin)
    let pro;try{pro=engine.proAnalyze(frames,{primary:tf,depth:es.depth||null,news:es.news||null,riskPct:riskPct()})}catch(e){pro=err('Analiz yapılamadı: '+msg(e))}
    if(!pro||typeof pro!=='object')pro=err('Analiz yapılamadı.');
    const daily=Array.isArray(frames['1g'])&&frames['1g'].length?frames['1g']:null;
    let stats=null;if(daily&&data&&typeof data.stats==='function')try{stats=data.stats(daily,bn||null)||null}catch(e){}
    const out=rows.length>MAX_ROWS?rows.slice(-MAX_ROWS):rows,t0=out[0].t;let signals=[];
    try{signals=(engine.systemSignals(rows)||[]).filter(s=>s&&rows[s.i]&&rows[s.i].t>=t0).map(s=>({t:rows[s.i].t,dir:s.dir,why:s.why}))}catch(e){}
    const fsum={},tr=pro.ok&&pro.trend&&pro.trend.frames||{};
    for(const k of TFS){if(!Array.isArray(frames[k])||!frames[k].length)continue;let t=tr[k];
      if(!t&&!pro.ok&&typeof engine.tfTrend==='function')try{t=engine.tfTrend(frames[k])}catch(e){}
      if(t)fsum[k]={dir:t.dir,text:t.text,adx:t.adx??null}}
    // Olasilik ve analist motoru: hissenin kendi gecmisinde benzer durumlar, plan olasiligi, beklenen aralik, rejim, not
    let qa=null,techFrames=null;
    if(quant&&typeof quant.analyze==='function')try{const sc=readScan();
      // Uzun gecmisin son donemi taze gunluk mumlarla degistirilir (gunluk son mum anlik fiyatla guncel; gecmis 12 saat onbellekli)
      const D0=daily||null,H0=Array.isArray(hist)&&hist.length?hist:null,H=H0&&D0&&D0.length?[...H0.filter(r=>r.t<D0[0].t),...D0]:H0;
      const bn2=b0=>b0&&b0.calendar||[];
      qa=quant.analyze({rows,daily:D0||rows,hist:H,pro:pro.ok?pro:null,bench:bn||null,breadth:sc&&sc.breadth||null,now:now(),
        liquidityTL:stats&&fin(stats.avgVolTL20)?stats.avgVolTL20:null,events:bn2(bot&&typeof bot==='object'?bot:null).map(e=>({day:e.day,kind:e.kind,title:e.title})),
        radar:rd&&rd.consensus?rd.consensus:null});
    }catch(e){qa=null;console.error('borsa-pro: olasilik:',msg(e))}
    // Her zaman dilimi icin teknik ozet (hareketli ortalama + osilator oylari); olasilik hatasindan bagimsiz
    if(quant&&typeof quant.techSummary==='function'){techFrames={};
      for(const k of TFS)if(Array.isArray(frames[k])&&frames[k].length>=30)try{const t=quant.techSummary(frames[k]);
        if(t)techFrames[k]={overall:t.overall,ma:{buy:t.ma.buy,sell:t.ma.sell,neutral:t.ma.neutral,label:t.ma.label},osc:{buy:t.osc.buy,sell:t.osc.sell,neutral:t.osc.neutral,label:t.osc.label}}}catch(e){}}
    let fd=null;if(fr&&typeof fr==='object'&&!fr.error){fd={raw:fr,score:null};if(fund&&typeof fund.scoreFundamentals==='function')try{fd.score=fund.scoreFundamentals(fr,{last:price})}catch(e){}}
    const b=bot&&typeof bot==='object'?bot:null;
    const news={bot:b?{list:Array.isArray(b.list)?b.list.slice(0,12):[],calendar:Array.isArray(b.calendar)?b.calendar.slice(0,8):[],akd:b.akd||null}:null,
      yahoo:(yn&&Array.isArray(yn.items)?yn.items:[]).slice(0,10)};
    const depth=bist?depthSummary(sym):null,name=nameOf(sym,bist)||quote.name||sym;
    if(!pro.ok&&pro.error)errors.push('Analiz: '+pro.error);
    const res={ok:true,symbol:sym,yahoo:y,market:mkt,name,tf,currency:quote.currency,rows:out,pro,stats,quote,signals,frames:fsum,news,depth,errors,
      quant:qa,techFrames,fund:fd,radar:rd&&typeof rd==='object'?rd:null,stale:quote.stale||errors.some(e=>/eski veri|çevrimdışı/i.test(e))};
    if(qa&&typeof quant.report==='function')try{res.report=quant.report(res)}catch(e){}
    const k=mkt+':'+sym;ctx.delete(k);ctx.set(k,{at:now(),symbol:sym,name,tf,market:mkt,quote,pro,stats,news,depth,daily,labSum:undefined,quant:qa,fund:fd,radar:rd&&typeof rd==='object'?rd:null});
    while(ctx.size>8)ctx.delete(ctx.keys().next().value);
    return res}
  async function load(o){o=obj(o);const c=conf(),mkt=MKTS.includes(o.market)?o.market:c.market,tf=TFS.includes(o.tf)?o.tf:c.tf;
    const y=ysym(o.symbol==null?c.symbol:o.symbol,mkt);if(!y)return err(CODE_ERR);
    const seq=++loadSeq,r=await loadCore(y,disp(y),tf,mkt);
    if(r.ok&&seq===loadSeq)put({symbol:r.symbol,tf,market:mkt});   // yalniz en son istenen sembol kalici olur
    return r}

  async function quotes(a){
    const mkt=a&&!Array.isArray(a)&&MKTS.includes(a.market)?a.market:'BIST';
    const list=(Array.isArray(a)?a:a&&Array.isArray(a.symbols)?a.symbols:[]).filter(s=>typeof s==='string'&&s.trim()&&s.length<=20).slice(0,MAX_WATCH);
    if(!list.length)return [];
    const r=await data.quotes(list,{market:mkt});if(!Array.isArray(r))return [];
    if(mkt==='BIST')for(const q of r)if(q)remember(q.symbol,q);
    return r}

  function watch(o){o=obj(o);let w=conf().watch;const done=x=>({ok:true,watch:x});
    if(o.op==='add'){const s=code(o.symbol);if(!s)return err(CODE_ERR,{watch:w});if(w.includes(s))return done(w);
      if(w.length>=MAX_WATCH)return err('İzleme listesi en fazla '+MAX_WATCH+' hisse olabilir.',{watch:w});w=[...w,s]}
    else if(o.op==='remove'){const s=code(o.symbol);if(!s)return err(CODE_ERR,{watch:w});w=w.filter(x=>x!==s)}
    else if(o.op==='set'){if(!Array.isArray(o.list))return err('Liste geçersiz.',{watch:w});w=[...new Set(o.list.map(code).filter(Boolean))].slice(0,MAX_WATCH)}
    else return done(w);
    put({watch:w});return done(w)}

  // --- tarayici ------------------------------------------------------------------
  const scanFile=()=>path.join(app.getPath('userData'),'bp-scan.json');
  function readScan(){if(scanMem!==undefined)return scanMem;scanMem=null;
    try{const j=JSON.parse(fs.readFileSync(scanFile(),'utf8'));if(j&&typeof j==='object'&&Array.isArray(j.rows))scanMem=j}catch(e){}
    return scanMem}
  async function writeScan(r){scanMem=r;
    try{const f=scanFile(),tmp=f+'.'+process.pid+'.tmp';await fs.promises.writeFile(tmp,JSON.stringify(r));await fs.promises.rename(tmp,f)}
    catch(e){console.error('borsa-pro: tarama kaydedilemedi:',e.message)}}
  const presetIds=row=>{const P=lib('PRESETS');if(!Array.isArray(P)||!data||typeof data.matches!=='function')return undefined;
    return P.filter(p=>{try{return p&&p.id&&data.matches(row,p.id)}catch(e){return false}}).map(p=>p.id)};
  const cancelScan=()=>{if(scanning)try{scanning.ctl.abort()}catch(e){}};
  async function scan(o){o=obj(o);
    if(!UNIVERSES.includes(o.universe))return err('Geçersiz tarama evreni.');
    if(scanning)return err('Tarama zaten sürüyor.');
    const uni=o.universe,syms=uni==='WATCH'?conf().watch:univ()[uni];
    if(!syms.length)return err(uni==='WATCH'?'İzleme listen boş; önce hisse ekle.':'Endeks listesi bulunamadı.');
    const tf=TFS.includes(o.tf)?o.tf:'1g',ctl=new AbortController(),s=scanning={ctl,done:0,total:syms.length,universe:uni,tf};
    try{
      const bn=await benchRows();
      if(ctl.signal.aborted)return {ok:true,at:now(),tf,total:syms.length,rows:[],errors:[],cancelled:true,universe:uni};
      const r=obj(await data.scan(syms,{tf,market:'BIST',signal:ctl.signal,concurrency:battery()?2:3,bench:bn||null,
        onProgress:p=>{p=obj(p);if(fin(p.done))s.done=p.done;if(fin(p.total))s.total=p.total;send({type:'scan',done:s.done,total:s.total,symbol:p.symbol??null})}}));
      const rows=(Array.isArray(r.rows)?r.rows:[]).filter(x=>x&&typeof x==='object').map(x=>{const ps=presetIds(x);return ps?{...x,presets:ps}:x});
      let br=null;try{br=data.breadth?data.breadth(rows):null}catch(e){}
      let sectors=null;const ss=lib('sectorStats');if(typeof ss==='function')try{sectors=ss(rows)}catch(e){}
      const res={...r,rows,errors:Array.isArray(r.errors)?r.errors:[],universe:uni,breadth:br,sectors,cancelled:!!r.cancelled||ctl.signal.aborted};
      if(!res.cancelled&&rows.length)await writeScan(res);
      return {...res,ok:!(r.error&&!rows.length)}
    }catch(e){return err('Tarama tamamlanamadı: '+msg(e))}
    finally{if(scanning===s)scanning=null}}

  async function overview(){
    if(ov&&now()-ov.at<OV_TTL)return ov.v;if(ovWait)return ovWait;
    const p=ovWait=(async()=>{try{const v=await data.overview();if(!Array.isArray(v))throw new Error('Piyasa özeti alınamadı.');ov={at:now(),v};return v}
      catch(e){return ov?ov.v:err(msg(e))}finally{if(ovWait===p)ovWait=null}})();
    return p}
  // Ek veri kaynaklari: doviz (ExchangeRate-API), kripto (CoinGecko), haber (NewsAPI) ve Hisse Radar piyasa ozeti.
  // Anahtarlar ana surecte sifreli saklanir (secrets); pencereye yalniz "kayitli mi" bilgisi gider.
  const FEEDS=['news','fx','gecko'];
  const feedStatus=()=>{let st={};if(apis&&typeof apis.status==='function')try{st=obj(apis.status())}catch(e){}
    const out={};for(const p of FEEDS){const x=obj(st[p]);out[p]={configured:!!x.configured,left:fin(x.left)?x.left:null,lastError:typeof x.lastError==='string'?x.lastError.slice(0,200):null,lastOk:fin(x.lastOk)?x.lastOk:null}}
    return out};
  async function feeds(o){o=obj(o);const op=o.op;
    if(op==='status')return {ok:true,status:feedStatus(),radar:radar&&typeof radar.status==='function'?(()=>{try{return radar.status()}catch(e){return null}})():null};
    if(op==='key'){if(!FEEDS.includes(o.provider))return err('Bilinmeyen kaynak.');if(!secrets||typeof secrets.set!=='function')return err('Anahtar kaydı bu sürümde yok.');
      const k=typeof o.key==='string'?o.key.trim():'';if(k&&!/^[A-Za-z0-9_\-]{16,80}$/.test(k))return err('Anahtar biçimi geçersiz görünüyor.');
      try{secrets.set(o.provider,k)}catch(e){return err('Anahtar kaydedilemedi: '+msg(e))}
      if(k&&apis&&typeof apis.test==='function'){const t=obj(await soft(()=>apis.test(o.provider),15000));return {ok:true,saved:true,test:{ok:!!t.ok,msg:typeof t.msg==='string'?t.msg.slice(0,200):null},status:feedStatus()}}
      return {ok:true,saved:true,status:feedStatus()}}
    if(op==='test'){if(!FEEDS.includes(o.provider))return err('Bilinmeyen kaynak.');if(!apis||typeof apis.test!=='function')return err('Veri kaynakları bu sürümde yok.');
      const t=obj(await soft(()=>apis.test(o.provider),15000));return {ok:!!t.ok,msg:typeof t.msg==='string'?t.msg.slice(0,200):(t.ok?'Çalışıyor.':'Yanıt yok.'),status:feedStatus()}}
    if(op==='market'){const has=p=>feedStatus()[p].configured;
      const [fx,cr,rm]=await Promise.all([apis&&has('fx')&&typeof apis.fx==='function'?soft(()=>apis.fx('USD'),15000):null,
        apis&&has('gecko')&&typeof apis.crypto==='function'?soft(()=>apis.crypto({}),15000):null,
        radar&&typeof radar.market==='function'?soft(()=>radar.market(),10000):null]);
      return {ok:true,fx:fx&&typeof fx==='object'?fx:null,crypto:cr&&typeof cr==='object'?cr:null,radar:rm&&typeof rm==='object'?rm:null,status:feedStatus(),at:now()}}
    if(op==='news'){const sym=code(String(o.symbol||''));if(!sym)return err(CODE_ERR);if(!apis||typeof apis.news!=='function'&&typeof apis.newsFor!=='function')return err('Haber kaynağı bu sürümde yok.');
      if(!feedStatus().news.configured)return err('NewsAPI anahtarı kayıtlı değil: Piyasa sekmesindeki Veri kaynakları bölümünden ekle.',{needKey:true});
      const nm=nameOf(sym,true)||sym;
      const r=obj(await soft(()=>typeof apis.newsFor==='function'?apis.newsFor(sym,nm):apis.news('"'+nm+'" OR '+sym,{lang:'tr',days:7,max:10}),15000));
      if(!r.ok)return err(typeof r.error==='string'?r.error:'Haberler alınamadı.',{left:fin(r.left)?r.left:null});
      return {ok:true,symbol:sym,items:(Array.isArray(r.items)?r.items:[]).slice(0,12),left:fin(r.left)?r.left:null}}
    return err('Geçersiz işlem.')}
  function search(q){q=typeof q==='string'?q:q&&typeof q.q==='string'?q.q:'';q=q.trim().slice(0,40);if(!q)return [];
    const r=data.search(q);return Array.isArray(r)?r.slice(0,12):[]}

  // --- strateji lab ----------------------------------------------------------------
  function labOpts(o){o=obj(o);const r={},c=num(o.cost,0,5),a=num(o.atrStop,0,10),k=pos(o.capital,1e12);
    if(c!=null)r.cost=c;if(a!=null)r.atrStop=a;if(typeof o.longOnly==='boolean')r.longOnly=o.longOnly;if(k!=null)r.capital=k;return r}
  async function labRun(o){o=obj(o);const mkt=MKTS.includes(o.market)?o.market:'BIST',y=ysym(o.symbol,mkt);if(!y)return err(CODE_ERR);
    const tf=TFS.includes(o.tf)?o.tf:'1g',c=await market.candles(y,tf,mkt),rows=c&&Array.isArray(c.rows)?c.rows:[];
    if(rows.length<30)return err('Strateji testi için yeterli mum yok ('+rows.length+'/30).');
    const res=obj(lab.compare(rows,labOpts(o.opts)));
    return {ok:true,...res,symbol:disp(y),tf,market:mkt,n:rows.length,from:rows[0].t,to:rows[rows.length-1].t,stale:!!(c&&c.stale)}}

  // --- yapay zeka --------------------------------------------------------------------
  function pickProvider(want){const ps=providers();
    if(want&&want!=='auto'){if(!PROVIDERS.includes(want))return {error:'Geçersiz yapay zekâ sağlayıcısı.'};
      if(!ps.includes(want))return {error:PNAME[want]+' API anahtarı kayıtlı değil.'};return {p:want}}
    if(!ps.length)return {error:'Yapay zekâ yorumu için Groq (ücretsiz), Claude ya da Grok API anahtarı gerekli; Neo ya da Ayarlar bölümünden ekleyebilirsin.'};
    return {p:ps[0]}}
  async function getCtx(y,tf,mkt){const k=mkt+':'+disp(y),c=ctx.get(k);
    if(c&&now()-c.at<CTX_TTL&&(!tf||c.tf===tf))return c;
    const r=await loadCore(y,disp(y),tf||'1g',mkt);if(!r.ok)throw new Error(r.error);return ctx.get(k)}
  function positionOf(sym){const ps=conf().positions.filter(p=>p.symbol===sym);if(!ps.length)return null;
    const qty=ps.reduce((s,p)=>s+p.qty,0),cost=ps.reduce((s,p)=>s+p.qty*p.cost,0)/qty,st=ps.map(p=>p.stop).filter(fin),tg=ps.map(p=>p.target).filter(fin);
    return {qty,cost:r4(cost),stop:st.length?Math.max(...st):null,target:tg.length?Math.min(...tg):null}}
  function aiCtx(c){
    if(c.labSum===undefined){c.labSum=null;if(c.daily&&c.daily.length>=60&&lab&&typeof lab.compare==='function')try{const r=obj(lab.compare(c.daily,{}));
      c.labSum={best:r.best??null,results:(Array.isArray(r.results)?r.results:[]).map(x=>({id:x.id,name:x.name,stats:x.stats}))}}catch(e){}}
    const bot=c.news&&c.news.bot,yh=c.news&&c.news.yahoo||[];
    const news=[...(bot?bot.list:[]).map(n=>({title:String(n.summary||n.title||'').slice(0,300),score:fin(n.score)?n.score:null,ts:n.ts||null})),
      ...yh.map(n=>({title:String(n.title||'').slice(0,300),score:null,ts:n.time||null}))].filter(n=>n.title).slice(0,10);
    return {symbol:c.symbol,name:c.name,tf:c.tf,quote:c.quote,pro:c.pro&&c.pro.ok?c.pro:null,stats:c.stats,lab:c.labSum,news,akd:bot&&bot.akd||null,
      depth:c.depth,position:positionOf(c.symbol),quant:c.quant||null,fund:c.fund?{...(c.fund.score||{}),raw:c.fund.raw}:null,radar:c.radar||null}}
  async function ai(o){o=obj(o);const mkt=MKTS.includes(o.market)?o.market:'BIST',y=ysym(o.symbol,mkt);if(!y)return err(CODE_ERR);
    const tf=TFS.includes(o.tf)?o.tf:null,pv=pickProvider(o.provider);if(pv.error)return err(pv.error);
    const key=[mkt,disp(y),tf||'',pv.p].join('|'),hit=aiCache.get(key);
    if(hit&&o.force!==true&&now()-hit.at<AI_TTL)return {...hit.v,cached:true};
    if(aiWait.has(key))return aiWait.get(key);
    const p=(async()=>{const c=await getCtx(y,tf,mkt),r=await analyst.brief(aiCtx(c),{provider:pv.p});
      const v=r&&typeof r==='object'?{...r,symbol:c.symbol,tf:c.tf}:err('Yapay zekâ yanıt vermedi.');
      if(v.ok)aiCache.set(key,{at:now(),v});return v})().finally(()=>aiWait.delete(key));
    aiWait.set(key,p);return p}
  // Yapay zeka analist raporu (not, hedef, olasilikli senaryolar). Analist modulu desteklemiyorsa anlasilir hata.
  async function aiReport(o){o=obj(o);const mkt=MKTS.includes(o.market)?o.market:'BIST',y=ysym(o.symbol,mkt);if(!y)return err(CODE_ERR);
    if(!analyst||typeof analyst.report!=='function')return err('Yapay zekâ raporu bu sürümde yok.');
    const tf=TFS.includes(o.tf)?o.tf:null,pv=pickProvider(o.provider);if(pv.error)return err(pv.error);
    const key=['rapor',mkt,disp(y),tf||'',pv.p].join('|'),hit=aiCache.get(key);
    if(hit&&o.force!==true&&now()-hit.at<AI_TTL)return {...hit.v,cached:true};
    if(aiWait.has(key))return aiWait.get(key);
    const p=(async()=>{const c=await getCtx(y,tf,mkt),r=await analyst.report(aiCtx(c),{provider:pv.p});
      const v=r&&typeof r==='object'?{...r,symbol:c.symbol,tf:c.tf}:err('Yapay zekâ yanıt vermedi.');
      if(v.ok)aiCache.set(key,{at:now(),v});return v})().finally(()=>aiWait.delete(key));
    aiWait.set(key,p);return p}
  async function ask(o){o=obj(o);const mkt=MKTS.includes(o.market)?o.market:'BIST',y=ysym(o.symbol,mkt);if(!y)return err(CODE_ERR);
    const q=str(o.question,1000);if(!q)return err('Soru boş olamaz.');
    const pv=pickProvider(o.provider);if(pv.error)return err(pv.error);
    const hist=(Array.isArray(o.history)?o.history:[]).filter(h=>h&&(h.role==='user'||h.role==='assistant')&&typeof h.content==='string'&&h.content.trim())
      .slice(-12).map(h=>({role:h.role,content:h.content.slice(0,4000)}));
    const c=await getCtx(y,null,mkt),r=await analyst.ask(aiCtx(c),hist,q,{provider:pv.p});
    return r&&typeof r==='object'?r:err('Yapay zekâ yanıt vermedi.')}

  // --- sermaye planlayici ---------------------------------------------------------------
  // Adaylar: son taramada AL olanlar (skora gore), tarama yoksa izleme listesi. Her aday icin tam analiz (onbellekli) -> planner.plan
  let planBusy=null;
  async function planRun(o){o=obj(o);if(!planner||typeof planner.plan!=='function')return err('Sermaye planlayıcı bu sürümde yok.');
    if(planBusy)return err('Plan hesaplanıyor; birkaç saniye bekle.');
    const capital=pos(o.capital,1e10);if(capital==null||capital<500)return err('Sermaye en az 500 TL olmalı.');
    const risk=['temkinli','dengeli','atak'].includes(o.risk)?o.risk:'dengeli',horizon=o.horizon==='1a'?'1a':'1h',maxPos=Math.max(1,Math.min(6,Math.round(+o.maxPos||3)));
    const commission=num(o.commission,0,2)??0.2,sc=readScan();
    let syms=sc&&Array.isArray(sc.rows)?sc.rows.filter(r=>r&&r.verdict&&r.verdict.label==='AL').sort((a,b)=>(b.score??b.verdict.score)-(a.score??a.verdict.score)).map(r=>r.symbol):[];
    const source=syms.length?'tarama':'izleme';if(!syms.length)syms=conf().watch.slice();
    syms=[...new Set(syms)].slice(0,Math.max(8,maxPos*3)).slice(0,10);
    if(!syms.length)return err('Aday yok: önce Tarayıcı\'da tarama yap ya da izleme listesine hisse ekle.');
    const p=planBusy=(async()=>{const cands=[],skipped=[];let i=0;
      for(const s of syms){i++;send({type:'plan',done:i-1,total:syms.length,symbol:s});
        try{const c=await getCtx(s+'.IS','1g','BIST');const P=c.pro,Q=c.quant||{},R=Q.ranges&&Array.isArray(Q.ranges.horizons)?Q.ranges.horizons:[];
          const rh=h=>{const x=R.find(q=>q.h===h);return x?{p16:x.p16,p50:x.p50,p84:x.p84}:null};
          const lib0=lib('sectorOf'),sector=typeof lib0==='function'?lib0(s):null;
          cands.push({symbol:s,name:c.name,sector,price:fin(c.quote&&c.quote.price)?c.quote.price:P&&P.last,verdict:P&&P.verdict?{label:P.verdict.label,score:P.verdict.score,confidence:P.verdict.confidence}:null,
            rating:Q.rating?{label:Q.rating.label,confidence:Q.rating.confidence}:null,plan:P&&P.plan||null,odds:Q.odds||null,ranges:{h5:rh(5),h20:rh(20)},
            liquidityTL:c.stats&&fin(c.stats.avgVolTL20)?c.stats.avgVolTL20:null,radar:c.radar&&c.radar.consensus?c.radar.consensus:null,warnings:Q.rating&&Array.isArray(Q.rating.warnings)?Q.rating.warnings:[]})}
        catch(e){skipped.push({symbol:s,why:'Veri alınamadı: '+msg(e)})}}
      send({type:'plan',done:syms.length,total:syms.length,symbol:null});
      const r=obj(planner.plan({capital,risk,horizon,maxPos,commission,candidates:cands}));
      return {ok:r.ok!==false,...r,source,rejected:[...(Array.isArray(r.rejected)?r.rejected:[]),...skipped],at:now()}})();
    try{return await p}catch(e){return err('Plan hesaplanamadı: '+msg(e))}finally{planBusy=null}}
  // Portfoye ekle: planin secimleri pozisyon olarak (maliyet = giris referansi, stop ve hedef ile)
  function planApply(o){o=obj(o);const picks=Array.isArray(o.picks)?o.picks.slice(0,6):[];let list=conf().positions,added=0;const errs=[];
    for(const k of picks){const v=checkPos({symbol:k.symbol,qty:k.lots,cost:k.ref??k.entry,stop:k.stop,target:k.t1,note:'Sermaye planı'});
      if(v.error){errs.push(k.symbol+': '+v.error);continue}if(list.length>=MAX_POS)break;list=[...list,v.pos];added++}
    if(added)put({positions:list});
    if(o.alarms===true)for(const k of picks){if(fin(k.stop))alarm({op:'add',alarm:{symbol:k.symbol,kind:'below',price:k.stop,note:'Plan stop'}});
      if(fin(k.t1))alarm({op:'add',alarm:{symbol:k.symbol,kind:'above',price:k.t1,note:'Plan hedef 1'}})}
    return {ok:true,added,errors:errs,positions:list,alarms:conf().alarms}}

  // --- alarmlar ------------------------------------------------------------------------
  const pending=a=>a.kind==='verdict'||!a.fired;
  const alarmsView=(list=conf().alarms)=>list.map(a=>a.kind!=='verdict'&&lastMem.has(a.id)?{...a,last:lastMem.get(a.id)}:a);
  function alarm(o){o=obj(o);let list=conf().alarms;
    if(o.op==='add'){const a=obj(o.alarm),sym=code(a.symbol);if(!sym)return err(CODE_ERR,{alarms:alarmsView(list)});
      const kind=KINDS.includes(a.kind)?a.kind:null;if(!kind)return err('Alarm türü geçersiz.',{alarms:alarmsView(list)});
      const price=kind==='verdict'?null:pos(a.price,1e9);if(kind!=='verdict'&&price==null)return err('Alarm için geçerli bir fiyat yaz.',{alarms:alarmsView(list)});
      if(list.some(x=>pending(x)&&x.symbol===sym&&x.kind===kind&&x.price===price))return {ok:true,dup:true,alarms:alarmsView(list)};
      if(list.length>=MAX_ALARMS)return err('En fazla '+MAX_ALARMS+' alarm kurulabilir; tetiklenenleri temizle.',{alarms:alarmsView(list)});
      // Bilinen taze fiyat baslangic sayilir: kurulduktan hemen sonraki gecis kacmasin
      list=[...list,{id:newId(),symbol:sym,kind,price,note:str(a.note,200),created:now(),fired:null,last:kind==='verdict'?null:freshPx(sym),text:null}]}
    else if(o.op==='remove'){const id=typeof o.id==='string'?o.id:obj(o.alarm).id;if(typeof id!=='string'||!ID.test(id))return err('Alarm bulunamadı.',{alarms:alarmsView(list)});
      list=list.filter(x=>x.id!==id);lastMem.delete(id);vCand.delete(id)}
    else if(o.op==='clear'){list=o.all===true?[]:list.filter(pending);if(o.all===true){lastMem.clear();vCand.clear()}}
    else if(o.op==='reset'){const id=typeof o.id==='string'?o.id:null;   // id yoksa tetiklenen tum alarmlar yeniden kurulur
      if(id&&!list.some(x=>x.id===id))return err('Alarm bulunamadı.',{alarms:alarmsView(list)});
      list=list.map(x=>{if(id?x.id!==id:!x.fired)return x;lastMem.delete(x.id);vCand.delete(x.id);
        return {...x,fired:null,text:null,last:x.kind==='verdict'?null:freshPx(x.symbol)}})}
    else return {ok:true,alarms:alarmsView(list)};
    put({alarms:list});schedule();return {ok:true,alarms:alarmsView(list)}}

  async function dailyLabel(sym){
    const mt=obj(await market.multi(sym,{tf:'1g',market:'BIST',extra:['1h']})),fr=obj(mt.frames);
    if(!Array.isArray(fr['1g'])||!fr['1g'].length)throw new Error('Veri yok');
    const p=engine.proAnalyze(fr,{primary:'1g',riskPct:riskPct()});if(!p||!p.ok||!p.verdict)throw new Error(p&&p.error||'Analiz yok');
    return {label:p.verdict.label,score:p.verdict.score,price:p.last}}
  function fire(f){
    try{if(Notification&&(typeof Notification.isSupported!=='function'||Notification.isSupported())){
      const n=new Notification({title:'Borsa Pro · '+f.alarm.symbol,body:f.text});if(n&&typeof n.on==='function')n.on('click',()=>open(f.alarm.symbol));n.show()}}catch(e){}
    send({type:'alarm',alarm:f.alarm,price:f.price,text:f.text});
    try{if(typeof say==='function')say(f.text)}catch(e){}}
  // Izleyici turu: fiyat alarmlari market.quote ile (onceki -> yeni fiyat esigi gecince), karar alarmlari en fazla 15 dk'da bir
  async function tick(){
    if(ticking)return;ticking=true;lastTick=now();
    try{
      checkStatus();
      if(!enabled||!isOn()||away()||!mstatus().open)return;
      const act=conf().alarms.filter(pending),got={},lbl={};
      const ps=[...new Set(act.filter(a=>a.kind!=='verdict').map(a=>a.symbol))];
      await each(ps,3,async s=>{const q=await withTimeout(market.quote(s,'BIST'),20000);if(q&&fin(q.price)&&q.price>0&&!q.stale){got[s]=q;remember(s,q)}});
      const vs=[...new Set(act.filter(a=>a.kind==='verdict').map(a=>a.symbol))].filter(s=>now()-(vAt.get(s)||0)>=VERDICT_MS);
      await each(vs,2,async s=>{vAt.set(s,now());lbl[s]=await withTimeout(dailyLabel(s),30000)});
      if(!enabled||!isOn())return;
      // Sonuclar guncel listeye uygulanir: beklerken silinen ya da degisen alarm atlanir
      const fires=[];let dirty=false;
      const list=conf().alarms.map(a=>{
        if(!pending(a))return a;
        if(a.kind==='verdict'){const r=lbl[a.symbol];if(!r)return a;
          if(a.last==null){vCand.delete(a.id);dirty=true;return {...a,last:r.label}}
          if(r.label===a.last){vCand.delete(a.id);return a}
          // Esik cevresinde gidip gelen karar bildirim yagdirmasin: yeni etiket bir sonraki kontrolde de gorulurse tetik
          const c=vCand.get(a.id);if(!c||c.label!==r.label){vCand.set(a.id,{label:r.label,at:now()});return a}
          vCand.delete(a.id);dirty=true;const text=alarmText(a,r.price,r),n={...a,last:r.label,fired:now(),text};fires.push({alarm:n,price:r.price,text});return n}
        const q=got[a.symbol];if(!q)return a;
        const p=q.price,prev=lastMem.has(a.id)?lastMem.get(a.id):a.last,beyond=v=>a.kind==='above'?v>=a.price:v<=a.price;lastMem.set(a.id,p);
        if(prev==null){dirty=true;return {...a,last:p}}                      // ilk okuma: fiyat zaten otesindeyse tetik yok
        if(!beyond(prev)&&beyond(p)){dirty=true;const text=alarmText(a,p),n={...a,last:p,fired:now(),text};fires.push({alarm:n,price:p,text});return n}
        // Diske yalniz esigin hangi tarafinda oldugu degisince yazilir (her dakika yazma yok; yeniden acilista gecis yine yakalanir)
        if(a.last==null||beyond(a.last)!==beyond(p)){dirty=true;return {...a,last:p}}
        return a});
      if(dirty)put({alarms:list});
      for(const f of fires)fire(f);
    }finally{ticking=false;schedule()}}
  function checkStatus(){const s=mstatus(),k=skey(s);if(!alive()){statusKey=null;return}if(k!==statusKey){const first=statusKey==null;statusKey=k;if(!first)send({type:'status',marketStatus:s})}}
  // Tek zamanlayici: seans acik ve bekleyen alarm varsa 60 sn (pilde 180 sn) turu; degilse yalniz seans durumunun degisecegi ana
  // (pencere acikken durum rozeti icin ya da alarmlar seans acilisini beklerken). Hicbiri yoksa zamanlayici yok.
  function schedule(){
    if(timer!=null){T.clearTimeout(timer);timer=null}
    if(!enabled||!isOn()||away())return;
    const pend=conf().alarms.some(pending),w=alive();if(!pend&&!w)return;
    let ms,run;
    if(pend&&mstatus().open){const iv=battery()?IV_BAT:IV;ms=Math.max(2000,lastTick?iv-(now()-lastTick):2000);run=tick}
    else{ms=nextChangeMs(now(),calendar);run=()=>{checkStatus();schedule()}}
    timer=T.setTimeout(()=>{timer=null;return run()},ms)}

  // --- portfoy ----------------------------------------------------------------------------
  async function portfolioView(list,wait){
    const syms=[...new Set(list.map(p=>p.symbol))];
    if(syms.length)await soft(async()=>{const r=await data.quotes(syms,{market:'BIST',spark:false});if(Array.isArray(r))for(const q of r)if(q)remember(q.symbol,q)},wait);
    return {positions:list,summary:summarize(list,s=>lastPx.get(s),istDay(now()))}}
  async function portfolio(o){o=obj(o);let list=conf().positions;const p=obj(o.pos);
    if(o.op==='add'){const v=checkPos({...p,id:undefined});if(v.error)return err(v.error);
      if(list.length>=MAX_POS)return err('En fazla '+MAX_POS+' pozisyon tutulabilir.');list=[...list,v.pos]}
    else if(o.op==='update'){const id=typeof p.id==='string'?p.id:o.id,i=list.findIndex(x=>x.id===id);if(i<0)return err('Pozisyon bulunamadı.');
      const ch={};for(const k of ['symbol','qty','cost','date','note','stop','target'])if(k in p)ch[k]=p[k];
      const v=checkPos({...list[i],...ch,id});if(v.error)return err(v.error);list=list.map((x,j)=>j===i?v.pos:x)}
    else if(o.op==='remove'){const id=typeof p.id==='string'?p.id:o.id;if(!list.some(x=>x.id===id))return err('Pozisyon bulunamadı.');list=list.filter(x=>x.id!==id)}
    else if(o.op!=null&&o.op!=='get'&&o.op!=='refresh')return err('Geçersiz işlem.');
    if(o.op==='add'||o.op==='update'||o.op==='remove')put({positions:list});
    return {ok:true,...await portfolioView(list,8000)}}

  function capital(v){if(v===undefined)return {ok:true,capital:conf().capital};
    if(v===null||v===''){put({capital:null});return {ok:true,capital:null}}
    const n=pos(v,1e12);if(n==null)return err('Sermaye pozitif bir sayı olmalı.');put({capital:n});return {ok:true,capital:n}}
  // Yalniz bilinen ve gecerli anahtarlar birlesir; gecersiz deger kayitli olani silmez
  function prefs(o){const cur=conf().prefs;if(!o||typeof o!=='object'||Array.isArray(o))return cur;
    const inc=cleanPrefs(o),p=cleanPrefs({...cur,...inc,...(inc.show?{show:{...(cur.show||{}),...inc.show}}:{})});put({prefs:p});return p}
  // Borsa Okulu (okul-client): icerik Supabase'den (herkese acik okuma), ilerleme yerelde; "ogretmene sor" uygulamanin yapay zekasiyla
  const OKUL_OPS=['list','get','today','quiz','answer','progress','markRead','ask','open'];
  async function okulOp(o){o=obj(o);const op=o.op,a=o.args;
    if(!OKUL_OPS.includes(op))return err('Geçersiz işlem.');
    if(op==='open')return openUrl(a);
    if(!okul)return err('Borsa Okulu bu sürümde yok.');
    const A=obj(a),slug=typeof a==='string'?a:A.slug;
    try{let r;
      if(op==='list')r=await okul.list(A);else if(op==='get')r=await okul.get(slug);else if(op==='today')r=await okul.today();
      else if(op==='quiz')r=await okul.quiz(A);else if(op==='answer')r=await okul.answer(slug,A.secim);else if(op==='progress')r=await okul.progress();
      else if(op==='markRead')r=await okul.markRead(slug);
      else{const soru=typeof a==='string'?a:A.soru;if(typeof soru!=='string'||!soru.trim())return err('Soru boş.');
        let baglam=A.baglam;if(A.symbol){const c=ctx.get('BIST:'+code(String(A.symbol)));if(c)baglam={...obj(baglam),hisse:{symbol:c.symbol,name:c.name,fiyat:c.quote&&c.quote.price,karar:c.pro&&c.pro.verdict&&{label:c.pro.verdict.label,score:c.pro.verdict.score},not:c.quant&&c.quant.rating&&c.quant.rating.label}}}
        r=await okul.ask(soru.slice(0,1500),{baglam})}
      return r==null?{ok:true}:r}
    catch(e){return err('Borsa Okulu: '+msg(e))}}
  function openUrl(o){const u=typeof o==='string'?o:obj(o).url;if(typeof u!=='string'||u.length>2048)return err('Geçersiz bağlantı.');
    let p;try{p=new URL(u)}catch(e){return err('Geçersiz bağlantı.')}
    if(p.protocol!=='https:'||p.username||p.password)return err('Yalnızca https bağlantıları açılabilir.');
    shell.openExternal(p.href);return {ok:true}}

  async function state(){const c=conf(),s=mstatus();if(alive())statusKey=skey(s);
    return {watch:c.watch,tf:c.tf,market:c.market,symbol:c.symbol,alarms:alarmsView(c.alarms),portfolio:await portfolioView(c.positions,4000),
      capital:c.capital,riskPct:riskPct(),prefs:c.prefs,providers:providers(),lastScan:readScan(),marketStatus:s,universes:counts(),
      scanning:scanning?{done:scanning.done,total:scanning.total,universe:scanning.universe,tf:scanning.tf}:null,
      presets:Array.isArray(lib('PRESETS'))?lib('PRESETS'):[],tags:obj(lib('TAGS')),strategies:lab&&Array.isArray(lab.STRATEGIES)?lab.STRATEGIES:[]}}

  // --- IPC: hepsi 'bp:' onekli; once gonderen, sonra ozellik acik mi; hata Turkce {ok:false,error} ---------------
  const H={'bp:state':state,'bp:load':load,'bp:quotes':quotes,'bp:watch':watch,'bp:scan':scan,
    'bp:scanCancel':()=>{const was=!!scanning;cancelScan();return {ok:true,cancelled:was}},
    'bp:overview':overview,'bp:feeds':feeds,'bp:search':search,'bp:lab':labRun,'bp:ai':ai,'bp:report':aiReport,'bp:ask':ask,'bp:depth':depthOp,'bp:plan':planRun,'bp:planApply':planApply,'bp:alarm':alarm,'bp:portfolio':portfolio,
    'bp:demo':demoCtl.op,'bp:capital':capital,'bp:prefs':prefs,'bp:open':openUrl,'bp:okul':okulOp};
  for(const [ch,f] of Object.entries(H))ipcMain.handle(ch,async(e,a)=>{
    if(!isWin(e))return err('İzin yok');if(!isOn())return err('Borsa özelliği kapalı.');
    try{const r=await f(a);return isOn()?r:err('Borsa özelliği kapalı.')}
    catch(x){console.error('borsa-pro',ch,x&&x.message);return err(msg(x))}});

  // --- Neo ve Merkez ----------------------------------------------------------------------
  // Neo (sesli asistan) icin kisa Turkce ozet: gunluk (+haftalik) karar, gerekce, plan, en yakin destek/direnc
  async function analyzeSymbol(sym,tf='1g'){
    if(!isOn())throw new Error('Borsa özelliği kapalı.');
    const s=code(typeof sym==='string'?sym:String(sym??''));if(!s)throw new Error('Hisse kodu anlaşılmadı.');
    if(!TFS.includes(tf))tf='1g';const k=s+'|'+tf,c=anCache.get(k);if(c&&now()-c.at<AN_TTL)return c.v;
    const r=await loadCore(s+'.IS',s,tf,'BIST');if(!r.ok)throw new Error(r.error);
    const p=r.pro;if(!p||!p.ok||!p.verdict)throw new Error(p&&p.error||'Analiz yapılamadı.');
    const v=p.verdict,pl=p.plan,q=r.quote||{},lv=obj(p.levels),sp=Array.isArray(lv.support)?lv.support[0]:null,rs=Array.isArray(lv.resistance)?lv.resistance[0]:null;
    const out={symbol:s,price:r2(fin(q.price)?q.price:p.last),chgPct:fin(q.chgPct)?q.chgPct:null,karar:v.label,skor:v.score,guven:v.confidence,
      gerekceler:(Array.isArray(v.reasons)?v.reasons:[]).slice(0,3),
      plan:pl&&!pl.wait?{giris:Array.isArray(pl.entry)?pl.entry.map(r2):null,stop:r2(pl.stop),hedef1:r2(pl.t1),hedef2:r2(pl.t2),rr:pl.rr??null}:null,
      destek:sp?r2(sp.mid):null,direnc:rs?r2(rs.mid):null,trend:p.trend&&p.trend.primary?p.trend.primary.text:null};
    if(pl&&pl.wait)out.tetik={yukari:r2(pl.triggerUp),asagi:r2(pl.triggerDown)};
    const Q=r.quant,R=Q&&Q.rating;
    if(R){out.analistNotu=R.label;out.notGuven=R.confidence;if(R.target)out.birAyHedef={baz:r2(R.target.base),aralik68:[r2(R.target.low),r2(R.target.high)],potansiyelYuzde:R.target.upside}}
    if(Q&&Q.odds)out.planOlasilik={hedef1StoptanOnceYuzde:Q.odds.p1,stopYuzde:Q.odds.pStop,ornek:Q.odds.n};
    anCache.set(k,{at:now(),v:out});if(anCache.size>30)anCache.delete(anCache.keys().next().value);
    return out}
  function status(){
    if(scanning)return 'Tarama sürüyor… '+scanning.done+'/'+scanning.total;
    const n=conf().alarms.filter(pending).length;
    if(n)return n+' alarm izleniyor'+(mstatus().open?'':' · seans kapalı');
    return alive()?'Borsa Pro açık':null}
  function enable(){if(!isOn())return;enabled=true;schedule();demoCtl.enable()}
  function disable(){enabled=false;demoCtl.disable();cancelScan();if(timer!=null){T.clearTimeout(timer);timer=null}
    if(alive())win.close();win=null;ov=null;ctx.clear();aiCache.clear();anCache.clear();vCand.clear();statusKey=null}

  // Guc durumu degisince (pil/priz, kilit, uyku) zamanlayici yeniden kurulur; uyanista seans durumu tazelenir
  try{if(power&&typeof power.on==='function')power.on(()=>{schedule();demoCtl.schedule(true);if(!away())checkStatus()})}catch(e){}
  if(app&&typeof app.whenReady==='function')app.whenReady().then(()=>{try{if(power&&typeof power.init==='function')power.init()}catch(e){}if(isOn())enable()});
  if(app&&typeof app.on==='function')app.on('will-quit',()=>{demoCtl.disable();cancelScan();if(timer!=null){T.clearTimeout(timer);timer=null}});
  return {open,close,enable,disable,status,analyzeSymbol,isWin,onDepth,plan:planRun};
}
module.exports={registerBorsaPro,clean,cleanAlarm,cleanPos,checkPos,cleanPrefs,code,summarize,nextChangeMs,alarmText,num,
  TFS,KINDS,UNIVERSES,MAX_WATCH,MAX_ALARMS,DEF_WATCH};
