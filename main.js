require('./smoke.js')(require('electron').app); // CEM_SMOKE=1: CI acilis testi (yoksa hicbir sey yapmaz)
const {app,BrowserWindow,Tray,screen,desktopCapturer,ipcMain,globalShortcut,nativeImage,safeStorage,systemPreferences,shell,Menu,Notification,clipboard,dialog}=require('electron');
const fs=require('fs'),path=require('path');
const engine=require('./engine');
const ai=require('./ai');
const grok=require('./grok');
const depthLib=require('./depth');
const tg=require('./tg');
const sync=require('./sync');
const market=require('./market');
const calendar=require('./calendar');
const shareLib=require('./share');
const APP_NAME='Cem App';
let hubUi=null,lockUi=null;
const modOn=id=>!hubUi||hubUi.enabled(id);
const cleanerUi=require('./cleaner-main').registerCleaner({ipcMain,dialog,shell,app,BrowserWindow,path});
const audioUi=require('./audio-main').registerAudio({ipcMain,app,BrowserWindow,path,cfg:()=>cfg(),save:o=>save(o),isOn:()=>modOn('ses')});
// Sistem durumu: menu cubugunda kendi tusu (sicaklik, FPS, CPU/GPU/RAM...)
const sysUi=require('./sistem-main').registerSystem({ipcMain,app,BrowserWindow,Tray,nativeImage,screen,path,Notification,cfg:()=>cfg(),save:o=>save(o),isOn:()=>modOn('sistem')});
// Pano gecmisi: kopyalananlar, ⌘⇧V
const panoUi=require('./pano-main').registerPano({ipcMain,app,BrowserWindow,path,clipboard,nativeImage,globalShortcut,screen,safeStorage,cfg:()=>cfg(),save:o=>save(o),isOn:()=>modOn('pano')});
global.panoUi=panoUi;
// Internet hiz testi ve misafir Wi-Fi QR
const hizUi=require('./hiz-main').registerHiz({ipcMain,app,BrowserWindow,path,cfg:()=>cfg(),save:o=>save(o),isOn:()=>modOn('hiz')});
global.hizUi=hizUi;
// Neo: "Hey Neo" sesli asistan. Araclari uygulamanin kendi ozellikleri. Beyin: ucretsiz Groq (varsayilan) ya da Claude API anahtari.
const neoUi=require('./neo-main').registerNeo({ipcMain,app,BrowserWindow,path,screen,globalShortcut,Notification,cfg:()=>cfg(),save:o=>save(o),
  shell,keys:{get:p=>p==='claude'?getKey():dec(cfg().groqKey),set:(p,k)=>p==='claude'?setKey(k):save({groqKey:enc(k)})},isOn:()=>modOn('neo'),actions:{
  feature:id=>{if(id==='merkez'){hubUi.open();return {ok:true}}if(!modOn(id))return {error:'Bu özellik Merkez\'de kapalı.'};const f=OPEN[id];if(!f)return {error:'Bu özellik henüz yok.'};f();return {ok:true}},
  status:()=>{const v=sysUi.view(),s=v.last;if(!s)return {error:modOn('sistem')?'Ölçüm henüz gelmedi.':'Sistem Durumu özelliği kapalı.'};
    return {cpu_temp_c:s.cpu.temp,cpu_hottest_c:s.cpu.tempMax,cpu_percent:s.cpu.usage,gpu_percent:s.gpu.usage,ram_used_gb:s.mem.used&&+(s.mem.used/1e9).toFixed(1),
      ram_total_gb:s.mem.total&&+(s.mem.total/1e9).toFixed(1),memory_pressure:s.mem.pressure,screen_fps:s.fps.screen,display_hz:s.fps.display,fans_rpm:s.fans,
      battery:s.battery,net_down_mbit:+(s.net.down*8/1e6).toFixed(1),net_up_mbit:+(s.net.up*8/1e6).toFixed(1),disk_free_gb:s.disk.free&&Math.round(s.disk.free/1e9),thermal:s.thermal}},
  appVolume:(name,pct)=>modOn('ses')?audioUi.setByName(name,pct):{error:'Ses özelliği Merkez\'de kapalı.'},
  macVolume:(pct,mute)=>modOn('ses')?audioUi.master(pct,mute):{error:'Ses özelliği Merkez\'de kapalı.'},
  stock:async sym=>{const code=bistCode(sym);if(!code)return {error:'Hisse kodu anlaşılmadı.'};
    const out={symbol:code};
    try{const c=await market.candles(code,'1g','BIST'),q=c.quote;out.price=q.price;out.prev_close=q.prev;out.change_pct=q.price&&q.prev?+((q.price/q.prev-1)*100).toFixed(2):null;
      out.day_high=q.dayHigh;out.day_low=q.dayLow;out.volume=q.volume;out.name=q.name;out.note='Yahoo verisi ~15 dk gecikmeli olabilir'}catch(e){out.price_error=e.message}
    if(lastDepth&&lastDepth.symbol===code&&Date.now()-lastDepth.at<15*60000){const d=lastDepth;out.depth={last:d.last,pressure_score:d.pressure?d.pressure.score:null,trend:d.trend&&d.trend.text,
      signal:d.signal&&d.signal.why,top_buyers:(d.buyers||[]).slice(0,3).map(b=>b.name+' '+b.net),top_sellers:(d.sellers||[]).slice(0,3).map(b=>b.name+' '+b.net)}}
    try{const n=await botNews(code);if(n){out.news=(n.list||[]).slice(0,4).map(x=>({title:x.summary||x.title,score:x.score,importance:x.importance}));
      out.upcoming=(n.calendar||[]).slice(0,3).map(x=>x.day+' '+x.kind+' '+x.title)}}catch(e){}
    return out},
  showStock:sym=>{const code=bistCode(sym);if(!code)return {error:'Hisse kodu anlaşılmadı.'};if(!modOn('borsa'))return {error:'Borsa özelliği kapalı.'};showPop();fetchDepth({symbol:code});return {ok:true,symbol:code}},
  timer:(min,label)=>{setTimeout(()=>{if(!modOn('neo'))return;new Notification({title:'Neo hatırlatma',body:label||'Süre doldu'}).show();neoUi.say('Hatırlatma: '+(label||'süre doldu'))},min*60000);
    return {ok:true,at:new Date(Date.now()+min*60000).toLocaleTimeString('tr-TR',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit'})}},
  openApp:name=>new Promise(r=>require('child_process').execFile('/usr/bin/open',['-a',name],{timeout:10000},e=>r(e?{error:'"'+name+'" uygulaması bulunamadı.'}:{ok:true}))),
  openUrl:url=>{shell.openExternal(url);return {ok:true}},
  speed:()=>global.hizUi&&modOn('hiz')?global.hizUi.run():{error:'İnternet Hız Testi Merkez\'de kapalı.'},
  clipboard:q=>global.panoUi&&modOn('pano')?global.panoUi.find(q):{error:'Pano Geçmişi Merkez\'de kapalı.'},
}});
// Kendi kendini guncelleme: GitHub Releases'tan yeni surum (yalnizca paketlenmis Mac uygulamasinda)
const updUi=require('./updater-main').registerUpdater({ipcMain,app,path,Notification,shell,cfg:()=>cfg(),save:o=>save(o),
  send:(ch,st)=>{hubUi&&hubUi.sendTo(ch,st)},isAllowed:e=>!!hubUi&&hubUi.isWin(e)});
// Ozellik pencereleri (Merkez ve Neo ortak)
const OPEN={borsa:()=>showPop(),ses:()=>audioUi.open(),paylas:()=>openShare(),temizlik:()=>cleanerUi.open(),kilit:()=>lockUi&&lockUi.open(),
  sistem:()=>sysUi.show(),neo:()=>neoUi.open(),pano:()=>panoUi.open(),hiz:()=>hizUi.open()};
// Borsa kisayollari unregisterAll ile yenilenir; Pano (⌘⇧V) ve Neo (⌥Bosluk) kisayollarini geri kur
const rearmOthers=()=>{try{panoUi.rearm()}catch(e){}try{neoUi.rearm()}catch(e){}};
// Merkez penceresi: ozellikleri ac/kapat. Kapatilan ozellik menude gorunmez ve arka planda calismaz.
hubUi=require('./hub-main').registerHub({ipcMain,app,BrowserWindow,path,cfg:()=>cfg(),save:o=>save(o),name:APP_NAME,actions:{
  open:id=>OPEN[id]?.(),
  toggle:(id,on)=>{
    if(id==='borsa'){if(on)registerShortcuts();else{globalShortcut.unregisterAll();rearmOthers();if(cfg().live)setLive(false);setDepthAuto(0);
      if(drawing)setDrawing(false);lastDepth=null;sendOv('depth',null);clearAnalysis();ov.hide();pop.hide()}}
    if(id==='ses'){if(on)audioUi.resume();else{audioUi.stop();audioUi.close()}}
    if(id==='temizlik'&&!on)cleanerUi.close();
    if(id==='sistem')on?sysUi.enable():sysUi.disable();
    if(id==='neo')on?neoUi.enable():neoUi.disable();
    if(id==='pano')on?panoUi.enable():panoUi.disable();
    if(id==='hiz')on?hizUi.enable():hizUi.disable();
    if(id==='kilit'&&!on&&lockUi){lockUi.lock();lockUi.close()}
    if(id==='paylas'&&!on){if(shareSess){shareSess.stop('user');shareSess=null}if(shareWin)shareWin.close()}
    send('state',state());
  },
  status:id=>id==='borsa'?(cfg().live?'Canlı mod açık':cfg().depthAuto>0?'Canlı takip açık':null)
    :id==='ses'?(n=>n?n+' uygulamada özel ayar':null)(Object.keys((cfg().sound||{}).apps||{}).length)
    :id==='paylas'?(shareSess&&shareSess.info().running?'Paylaşım açık':null)
    :id==='sistem'?sysUi.status()
    :id==='neo'?neoUi.status()
    :id==='pano'?panoUi.status()
    :id==='hiz'?hizUi.status():null}});

const INTERVALS=[2,5,10,30,60];
const HISTORY_MAX=30;
const SETTINGS_URL='x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
const SHOT_W=1568; // Claude'un yeniden boyutlandirmadan kabul ettigi genislik

let tray,pop,ov,timer=null,busy=false,fadeTimer,lastSig=null,ovDisplay=null,ovKey=null,drawing=false,lastResult=null,lastAi=null,lastLocal=null;
const alerted=new Map();

// --- ayarlar -------------------------------------------------------------
const F=()=>path.join(app.getPath('userData'),'cfg.json');
let C=null;
// Bozuk ayar dosyasi sessizce bosaltilmasin: yedegi alinir. Yazma gecici dosya + yeniden adlandirma ile (yarim yazim olmaz).
const cfg=()=>{if(!C){try{C=JSON.parse(fs.readFileSync(F()))}catch(e){if(e.code!=='ENOENT')try{fs.copyFileSync(F(),F()+'.bozuk-'+Date.now())}catch(_){}C={}}}return C};
const save=o=>{const c={...cfg(),...o};for(const k in c)if(c[k]===undefined)delete c[k];C=c;const t=F()+'.tmp';fs.writeFileSync(t,JSON.stringify(c),{mode:0o600});fs.renameSync(t,F())};

// API anahtari macOS Anahtar Zinciri destekli safeStorage ile sifrelenir.
function getKey(){
  const c=cfg();
  if(c.keyEnc&&safeStorage.isEncryptionAvailable()){
    try{return safeStorage.decryptString(Buffer.from(c.keyEnc,'base64'))}catch(e){return null}
  }
  if(c.key){setKey(c.key);return c.key} // eski surumden duz metin anahtari tasi
  return null;
}
function setKey(k){
  if(!k)return save({key:undefined,keyEnc:undefined});
  if(safeStorage.isEncryptionAvailable())save({keyEnc:safeStorage.encryptString(k).toString('base64'),key:undefined});
  else save({key:k});
}
const model=()=>ai.MODELS.some(m=>m.id===cfg().model)?cfg().model:ai.MODELS[0].id;
const interval=()=>INTERVALS.includes(cfg().interval)?cfg().interval:2;
const grokKey=()=>dec(cfg().grokKey)||null;
const engineName=()=>cfg().engine==='piyasa'?'piyasa':cfg().engine==='claude'&&getKey()?'claude':cfg().engine==='grok'&&grokKey()?'grok':'yerel';
// Gorsel okuma (derinlik ekrani / bot resmi) icin kullanilabilir yapay zeka: secili olan, yoksa anahtari olan.
const visionAI=()=>{const e=cfg().engine;if(e==='grok'&&grokKey())return 'grok';if(getKey())return 'claude';if(grokKey())return 'grok';return null};
async function readDepthImage(img){const v=visionAI();if(v==='grok'){try{return await grok.analyzeDepth({key:grokKey(),model:cfg().grokModel||null,img})}catch(e){throw new Error(grok.errorText(e))}}
  const r=await ai.analyzeDepth({key:getKey(),model:model(),img});addCost(r.cost);return r}
const mkt=()=>({symbol:cfg().symbol||'',tf:market.TF[cfg().tf]?cfg().tf:'1g',market:cfg().market==='US'?'US':'BIST'});
const avKey=()=>dec(cfg().avKey)||null;
// Canli mod, kullanici ayarlardan acikca izin vermedikce ucretsiz yerel motoru kullanir.
const liveEngine=()=>cfg().liveAi&&cfg().engine==='grok'&&grokKey()?'grok':cfg().liveAi&&getKey()?'claude':cfg().engine==='piyasa'&&cfg().symbol?'piyasa':'yerel';
const month=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul'}).format(new Date()).slice(0,7);
// Mum renkleri: 'auto' (varsayilan), 'green-red' ya da {up:'#rrggbb',down:'#rrggbb',tol}.
const HEX=/^#[0-9a-f]{6}$/i;
const candleColors=()=>{const c=cfg().candleColors;return c==='green-red'?c:c&&typeof c==='object'&&HEX.test(c.up)&&HEX.test(c.down)?{up:c.up,down:c.down,tol:+c.tol>0?+c.tol:60}:'auto'};
const IND_DEFAULT={ema:true,bb:false,fib:false};
const ind=()=>({...IND_DEFAULT,...(cfg().ind||{}),signals:cfg().signals!==false});
function addCost(c){
  const u=cfg().usage||{};const m=u.month===month()?u:{month:month(),cost:0,count:0};
  save({usage:{month:m.month,cost:m.cost+c,count:m.count+1,total:(u.total||0)+c}});
}

// --- ekran ---------------------------------------------------------------
const activeDisplay=()=>screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
// Otomatik (canli) analizde katmanin durdugu ekrana sadik kal; imlec baska monitore gecince katman ziplamasin.
const targetDisplay=silent=>(silent&&ovDisplay!=null&&screen.getAllDisplays().find(x=>x.id===ovDisplay))||activeDisplay();
// Cizimler Electron ekran id'si yerine kararli bir imzayla saklanir: monitor tekrar baglaninca id degisse de cizimler kaybolmaz.
const dkey=d=>d.size.width+'x'+d.size.height+'@'+d.scaleFactor+(d.label?' '+d.label:'');
// Eski surumlerin id anahtarli cizimlerini su anki ekranlarin imzasina tasir.
// Gecerli cizim: nesne, t metni, a en az iki sayilik dizi (bozuk kayit uygulamayi bozmasin)
const okDraw=x=>x&&typeof x==='object'&&typeof x.t==='string'&&Array.isArray(x.a)&&x.a.length>=2&&x.a.every(Number.isFinite);
function migrateDrawings(){
  const all=cfg().drawings;if(!all||typeof all!=='object')return;let ch=false;const out={};
  // Eski/bozuk kayitlari temizle
  for(const [k,v] of Object.entries(all)){const l=Array.isArray(v)?v.filter(okDraw):[];if(!Array.isArray(v)||l.length!==v.length)ch=true;out[k]=l}
  for(const d of screen.getAllDisplays()){const id=String(d.id),k=dkey(d);if(id===k||!Array.isArray(out[id]))continue;out[k]=[...(out[k]||[]),...out[id]].slice(0,200);delete out[id];ch=true}
  if(ch)save({drawings:out});
}
const screenAllowed=()=>process.platform!=='darwin'||systemPreferences.getMediaAccessStatus('screen')==='granted';

async function capture(d){
  const h=Math.round(SHOT_W*d.size.height/d.size.width);
  const srcs=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:SHOT_W,height:h}});
  const src=srcs.find(s=>s.display_id===String(d.id))||srcs[0];
  if(!src||src.thumbnail.isEmpty())throw new Error('Ekran görüntüsü alınamadı.');
  return src.thumbnail;
}
// Kucuk gri tonlu imza: canli modda ekran degismediyse analizi atla.
function signature(img){
  const b=img.resize({width:64,height:36}).toBitmap(),s=new Uint8Array(b.length/4);
  for(let i=0;i<s.length;i++)s[i]=(b[i*4]+b[i*4+1]+b[i*4+2])/3;
  return s;
}
// Degisen piksel orani (0 = ayni ekran, 1 = tamamen farkli).
function diff(a,b){
  if(!a||!b||a.length!==b.length)return 1;
  let n=0;for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>10)n++;
  return n/a.length;
}

// --- pencereler ----------------------------------------------------------
const send=(ch,d)=>pop&&!pop.isDestroyed()&&pop.webContents.send(ch,d);
const sendOv=(ch,d)=>ov&&!ov.isDestroyed()&&ov.webContents.send(ch,d);
// --- QR ile dosya paylasimi -------------------------------------------------------
let shareWin=null,shareSess=null;
function openShare(){
  if(shareWin){shareWin.show();shareWin.focus();return}
  shareWin=new BrowserWindow({width:400,height:780,minWidth:360,minHeight:520,title:'Dosya paylaşımı',show:false,
    webPreferences:{preload:path.join(__dirname,'share-preload.js'),sandbox:true}});
  shareWin.loadFile(path.join(__dirname,'share.html'));shareWin.once('ready-to-show',()=>{shareWin.show();shareWin.focus()});
  shareWin.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  shareWin.webContents.on('will-navigate',e=>e.preventDefault());
  shareWin.on('closed',()=>{shareWin=null;shareDenied.clear();if(shareSess){shareSess.stop('user');shareSess=null}});
}
async function shareState(){
  const i=shareSess?shareSess.info():{running:false,files:[],received:[]};
  const qr=i.url&&i.running?await require('qrcode').toString(i.url,{type:'svg',margin:1,errorCorrectionLevel:'M'}):null;
  return {ok:true,...i,qr};
}
// Telefondan gelen dosyalar icin onay: cihaz basina bir kez sorulur. Varsayilan dugme Reddet
// (yanlislikla Enter kabul etmesin); reddedilen cihaz bu oturumda bir daha sormaz, ayni cihazin
// es zamanli istekleri tek pencereyi bekler (pencere yagmuru olmasin).
const shareDenied=new Set(),shareAsking=new Map();
function shareAsk({ip,count,bytes,names}){
  if(shareDenied.has(ip))return Promise.resolve(false);
  if(shareAsking.has(ip))return shareAsking.get(ip);
  if(shareWin){shareWin.show();shareWin.focus()}
  const p=dialog.showMessageBox(shareWin||undefined,{type:'question',buttons:['Kabul et','Reddet'],defaultId:1,cancelId:1,
    message:'Telefondan '+count+' dosya gönderilmek isteniyor ('+shareLib.human(bytes)+')',
    detail:names.join('\n')+(count>names.length?'\n+'+(count-names.length)+' dosya daha':'')+'\n\nCihaz: '+ip+'\nKaydedileceği yer: İndirilenler'})
    .then(r=>{const ok=r.response===0;if(!ok)shareDenied.add(ip);return ok},()=>false)
    .finally(()=>shareAsking.delete(ip));
  shareAsking.set(ip,p);return p;
}
function shareEvt(e){
  if(shareWin&&!shareWin.isDestroyed())shareWin.webContents.send('shareEvt',e);
  if(e.type==='received'&&(!shareWin||!shareWin.isFocused())&&Notification.isSupported())new Notification({title:'Dosya alındı',body:e.name+' · İndirilenler'}).show();
}

function mk(){
  const pre=path.join(__dirname,'preload.js');
  pop=new BrowserWindow({width:380,height:560,show:false,frame:false,resizable:false,skipTaskbar:true,alwaysOnTop:true,transparent:true,
    vibrancy:'popover',visualEffectState:'active',roundedCorners:true,webPreferences:{preload:pre,sandbox:true}});
  pop.setContentProtection(true);pop.loadFile(path.join(__dirname,'popup.html'));
  pop.on('blur',()=>{if(!pop.webContents.isDevToolsOpened()&&!tgAskResolve)pop.hide()});
  ov=new BrowserWindow({transparent:true,frame:false,focusable:false,hasShadow:false,skipTaskbar:true,show:false,enableLargerThanScreen:true,
    webPreferences:{preload:pre,sandbox:true}});
  ov.setAlwaysOnTop(true,'screen-saver');ov.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
  ov.setIgnoreMouseEvents(true);ov.setContentProtection(true);ov.loadFile(path.join(__dirname,'overlay.html'));
  ov.webContents.once('did-finish-load',()=>placeOverlay(screen.getPrimaryDisplay()));
  for(const w of [pop,ov])w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
}
function showPop(){
  const t=tray.getBounds(),d=screen.getDisplayNearestPoint({x:t.x,y:t.y}).workArea,[w]=pop.getSize();
  const x=Math.min(Math.max(Math.round(t.x+t.width/2-w/2),d.x+8),d.x+d.width-w-8);
  pop.setPosition(x,Math.round(t.y+t.height+4));pop.show();
}
const toggle=()=>pop.isVisible()?pop.hide():showPop();

// Overlay tek bir ekranda durur ve o ekranin cizimlerini gosterir.
function placeOverlay(d){
  if(ovDisplay===d.id&&ovKey===dkey(d)){const b=ov.getBounds();if(b.x!==d.bounds.x||b.y!==d.bounds.y)ov.setBounds(d.bounds);return}   // ekran yer degistirdi
  ovDisplay=d.id;ovKey=dkey(d);ov.setBounds(d.bounds);
  sendOv('drawings',(cfg().drawings||{})[ovKey]||[]);
  syncOverlay();
}
function syncOverlay(){
  if(!modOn('borsa'))return ov.hide();
  const hasDraw=((cfg().drawings||{})[ovKey]||[]).length>0;
  if(drawing||hasDraw||lastResult||(lastDepth&&cfg().depthOverlay!==false))ov.showInactive();else ov.hide();
}
// --- bulut yedek (Supabase) kayitlari: yalnizca hesaplanmis ciktilar, ham derinlik/mesaj degil ---
let lastSigKey='';
function recordSignal(sig,a){
  // Canli sinyal derinlikten uretilir: hisse derinligin hissesidir; grafik alanlari yalnizca ayni hisseyse yazilir
  const sym=(lastDepth&&lastDepth.symbol)||'';a=sameStock(a,lastDepth)?a:{};
  if(!cfg().sbOn||!sig||!sym){if(!sig)lastSigKey='';return}
  const key=sym+':'+sig.dir;if(key===lastSigKey)return;lastSigKey=key; // yalnizca yon degisince kaydet
  sync.enqueue('signals',{symbol:sym,timeframe:a.timeframe||null,dir:sig.dir,strength:+sig.strength.toFixed(2),source:a.engine||'canli',why:sig.why||[],
    score:typeof a.score==='number'?a.score:null,pressure:lastDepth&&lastDepth.pressure?lastDepth.pressure.score:null,rr:a.rr??null,price:a.last_price??(lastDepth&&lastDepth.last)??null});
}
function recordDepth(d){
  if(!cfg().sbOn)return;
  if(d.pressure)sync.enqueue('pressure_log',{symbol:d.symbol,score:d.pressure.score,parts:d.pressure.parts,trend_dir:d.trend?d.trend.dir:0});
  if(d.flow&&d.flow.top)sync.enqueue('flow_log',{symbol:d.symbol,net:Math.round(d.flow.net),top_name:d.flow.top.name,top_net:Math.round(d.flow.top.net||0),top_cost:d.flow.top.cost??null});
}
function drawOverlay(a,d,anim){
  if(!modOn('borsa'))return;
  placeOverlay(d);lastResult=a;
  const live=liveSignal();recordSignal(live,a);
  sendOv('draw',{...a,anim,show:ind(),live});syncOverlay();
  if(lastDepth&&(a.engine==='claude'||a.engine==='grok'))pushDepthOverlay();
  clearTimeout(fadeTimer);
  if(!cfg().live&&!cfg().pin)fadeTimer=setTimeout(clearAnalysis,30000);
}
function clearAnalysis(){clearTimeout(fadeTimer);lastResult=null;sendOv('draw',null);syncOverlay()}

function setDrawing(on){
  if(on===drawing)return;
  drawing=on;
  if(on){placeOverlay(activeDisplay());pop.hide();ov.setIgnoreMouseEvents(false);ov.setFocusable(true);ov.show();ov.focus();app.focus({steal:true})}
  else{ov.setIgnoreMouseEvents(true);ov.setFocusable(false)}
  sendOv('mode',on);syncOverlay();
}

// Botun web terminali (mini app) icin ayri pencere.
let termWin=null;
function openTerminal(url){
  if(!termWin||termWin.isDestroyed()){
    termWin=new BrowserWindow({width:460,height:900,title:'Derinlik Terminali',webPreferences:{sandbox:true,partition:'persist:terminal'}});
    // Ucuncu taraf sayfa: yalnizca https baglantilari tarayicida acilir; kamera, konum, bildirim gibi izinler verilmez
    const ses=termWin.webContents.session;ses.setPermissionRequestHandler((w,p,cb)=>cb(false));ses.setPermissionCheckHandler(()=>false);
    termWin.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//i.test(url))shell.openExternal(url);return {action:'deny'}});
  }
  termWin.loadURL(url);termWin.show();
}

function trayIcon(){
  // "Template" adli ikon: macOS acik/koyu menu cubugunda rengi kendisi ayarlar (@2x Retina icin otomatik yuklenir).
  const img=nativeImage.createFromPath(path.join(__dirname,'assets','trayTemplate.png'));
  img.setTemplateImage(true);return img;
}
function trayTitle(){tray&&tray.setTitle(cfg().live?(liveEngine()==='claude'?' Canlı AI':' Canlı'):'')}

// --- bildirimler ---------------------------------------------------------
function checkAlerts(prev,a){
  if(!cfg().alerts||!prev||!prev.last||!a.last||!Notification.isSupported())return;
  const py=prev.last.y,y=a.last.y,now=Date.now(),sym=a.symbol||(lastAi&&lastAi.symbol)||'Grafik';
  const fire=(id,body)=>{if(now-(alerted.get(id)||0)<120000)return;alerted.set(id,now);new Notification({title:sym,body}).show()};
  for(const [i,l] of (prev.resistances||[]).entries())if(py>l.y&&y<l.y)fire('r'+Math.round(l.y*200),'▲ R'+(i+1)+' direnci yukarı kırıldı'+(l.price!=null?' ('+l.price+')':''));
  for(const [i,l] of (prev.supports||[]).entries())if(py<l.y&&y>l.y)fire('s'+Math.round(l.y*200),'▼ S'+(i+1)+' desteği aşağı kırıldı'+(l.price!=null?' ('+l.price+')':''));
}

// Claude'un fiyatli seviyelerinden y -> fiyat dogrusal donusumu (yoksa null).
// Fiyat ekseni etiketleri (varsa) ve fiyatli seviyelerden y <-> fiyat dogrusal olcegi.
function calibParams(a){
  if(!a)return null;
  if(a.cal&&Number.isFinite(a.cal.k))return a.cal; // piyasa verisiyle eslestirilmis olcek
  const axis=(a.axis||[]).filter(t=>typeof t.price==='number'&&typeof t.y==='number');
  const pts=axis.length>=2?axis:[...(a.resistances||[]),...(a.supports||[])].filter(l=>typeof l.price==='number');
  if(pts.length<2)return null;
  const n=pts.length,mx=pts.reduce((s,p)=>s+p.y,0)/n,my=pts.reduce((s,p)=>s+p.price,0)/n;
  let sxy=0,sxx=0;for(const p of pts){sxy+=(p.y-mx)*(p.price-my);sxx+=(p.y-mx)**2}
  if(sxx<1e-6||sxy>=0)return null;
  return {mx,my,k:sxy/sxx};
}
function calibrate(a){const c=calibParams(a);return c?y=>c.my+c.k*(y-c.mx):null}
const fmtP=v=>v.toLocaleString('tr-TR',{maximumFractionDigits:Math.abs(v)<10?4:2});

// Son fiyat, en guncelden: kullanicinin ekranindaki son nokta (araci kurum grafigi, gecikmesiz; Yahoo'dan alinan olcekle
// fiyata cevrilir) > bottan son 2 dk icinde gelen fiyat > Yahoo kotasyonu (~15 dk gecikmeli).
const botPrice=sym=>lastDepth&&lastDepth.last!=null&&Date.now()-lastDepth.at<120000&&(!sym||String(sym).replace(/\W/g,'').includes(lastDepth.symbol))?lastDepth.last:null;
function lastPrice(a,local){
  const c=calibParams(a);if(c&&local&&local.last)return c.my+c.k*(local.last.y-c.mx);
  const b=botPrice(a&&a.symbol);if(b!=null)return b;
  return a&&a.engine==='piyasa'&&typeof a.last_price==='number'?a.last_price:null;
}
// Alarm cizgileri: son fiyat cizgiyi gectiginde bir kez bildirim gonderir.
// Fiyatli alarm (price) fiyat karsilastirmasiyla, fiyatsiz eski alarm ekran y'si ile tetiklenir.
// p0/p1: onceki/simdiki son nokta {y,p,sym}; ekran y'si asagi dogru artar.
function checkAlarms(d,p0,p1,a){
  const k=dkey(d),all=cfg().drawings||{},list=all[k]||[];let hit=false;
  const cal=calibrate(a),sym=(a&&a.symbol)||(lastAi&&lastAi.symbol)||'Grafik',sameSym=p0.sym===p1.sym;
  for(const l of list){
    if(l.t!=='alarm'||l.fired)continue;let up=null,lp=null;
    if(typeof l.price==='number'){
      if(!sameSym||p0.p==null||p1.p==null||(l.sym&&p1.sym&&l.sym!==p1.sym))continue; // fiyat bilinmiyorsa ekran konumuna guvenme
      lp=l.price;if(p0.p<lp&&p1.p>=lp)up=true;else if(p0.p>lp&&p1.p<=lp)up=false;
    }else{
      const ly=l.a[1];lp=cal?cal(ly):null;if(p0.y>ly&&p1.y<=ly)up=true;else if(p0.y<ly&&p1.y>=ly)up=false;
    }
    if(up===null)continue;
    l.fired=Date.now();l.firedBy=typeof l.price==='number'?'fiyat':'ekran';hit=true;
    if(cfg().sbOn)sync.enqueue('alarms',{symbol:sym,price:lp!=null?+lp.toFixed(4):null,direction:up?'yukari':'asagi'});
    if(Notification.isSupported())new Notification({title:sym+' · alarm',body:(up?'▲ Fiyat alarm çizgisini yukarı geçti':'▼ Fiyat alarm çizgisini aşağı geçti')+(lp!=null?' ('+fmtP(lp)+')':''),sound:'Glass'}).show();
  }
  if(hit){save({drawings:{...all,[k]:list}});if(k===ovKey)sendOv('drawings',list)}
}
const pendingAlarms=()=>Object.values(cfg().drawings||{}).some(l=>l.some(x=>x.t==='alarm'&&!x.fired));

// Claude sonucuna yerel indikatorleri ekle ve skoru Claude'un yonuyle birlestir.
function merge(a,local){
  if(!local.chart_found)return a;
  const f=[...(local.factors||[])],cv=a.bias==='yukselis'?1:a.bias==='dusus'?-1:0;
  if(cv)f.unshift({v:Math.round(cv*a.confidence/4),t:(a.engine==='grok'?'Grok':'Claude')+': '+(cv>0?'yükseliş':'düşüş')+' (%'+a.confidence+')'});
  let rr=local.rr;
  const R=(a.resistances||[])[0],S=(a.supports||[])[0];
  if(typeof a.last_price==='number'&&R&&S&&R.price!=null&&S.price!=null&&R.price>a.last_price&&S.price<a.last_price)
    rr=+((R.price-a.last_price)/(a.last_price-S.price)).toFixed(2);
  return{...a,colorMode:local.colorMode,candleStyle:local.candleStyle,last:local.last,candles:local.candles,ind:local.ind,lines:local.lines,fib:local.fib,rr,signals:local.signals,lastCandle:local.lastCandle,
    factors:f,score:Math.max(-100,Math.min(100,f.reduce((s,x)=>s+x.v,0)))};
}

// --- analiz --------------------------------------------------------------
async function analyze(opts={}){
  if(busy)return;
  const eng=opts.engine||(opts.silent?liveEngine():engineName());
  const key=eng==='claude'?getKey():null;
  if(eng==='grok'&&!grokKey()){send('err',{msg:'Grok analizi için Ayarlar sekmesinden xAI API anahtarını gir.',settings:true});return opts.silent||showPop()}
  if(eng==='claude'&&!key){send('err',{msg:'Claude analizi için Ayarlar sekmesinden API anahtarını gir. Anahtarsız da Hızlı (yerel) analiz kullanılabilir.',settings:true});return opts.silent||showPop()}
  if(!screenAllowed()){
    try{await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1,height:1}})}catch(e){} // izin istemini tetikler
    send('err',{msg:'Ekran Kaydı izni gerekli. Sistem Ayarları › Gizlilik ve Güvenlik › Ekran Kaydı bölümünden Cem App\'i aç, sonra uygulamayı yeniden başlat.',perm:true});
    return opts.silent||showPop();
  }
  busy=true;
  try{
    const d=targetDisplay(opts.silent),shot=await capture(d),sig=signature(shot);
    const change=d.id===ovDisplay?diff(sig,lastSig):1;
    if(opts.silent&&change===0){send('skip',Date.now());return}
    const {width:W,height:H}=shot.getSize();
    const local=engine.analyzeBitmap(shot.toBitmap(),W,H,{colors:candleColors()});
    let a=local;
    if(eng==='claude'||eng==='grok'){
      send('busy',{text:(eng==='grok'?'Grok':'Claude')+' okuyor…'});
      // Grafik alani bulunduysa yalnizca o bolumu (fiyat ekseniyle) gonder: daha az token, daha net okuma.
      let crop=null,img=shot;
      if(local.chart_found){const b=local.chart_box;
        const x=Math.max(0,b.x1-0.03),y=Math.max(0,b.y1-0.08),x2=Math.min(1,b.x2+0.14),y2=Math.min(1,b.y2+0.08);
        if((x2-x)*(y2-y)<0.85){crop={x,y,w:x2-x,h:y2-y};img=shot.crop({x:Math.round(x*W),y:Math.round(y*H),width:Math.round(crop.w*W),height:Math.round(crop.h*H)})}}
      const jpg=img.toJPEG(82).toString('base64');
      if(eng==='grok'){try{a=await grok.analyze({key:grokKey(),model:cfg().grokModel||null,img:jpg,crop})}catch(e){throw new Error(grok.errorText(e))}}
      else{a=await ai.analyze({key,model:model(),img:jpg,crop,effort:opts.silent?'low':'medium'});addCost(a.cost)}
      a=merge(a,local);
      lastAi=a;
    }else if(eng==='piyasa'){
      a=await withMarket(local,opts);
    }
    lastSig=sig;
    const prev=lastResult;
    if(local.chart_found){const cur={d:dkey(d),y:local.last.y,p:lastPrice(a,local),sym:a.symbol||mkt().symbol||null};if(lastLocal&&lastLocal.d===cur.d)checkAlarms(d,lastLocal,cur,a);lastLocal=cur}
    // Canli yerel takipte son 60 sn icindeki Claude sonucunu (fiyatli seviyeler) koru, yalnizca son fiyat noktasini guncelle.
    if(opts.silent&&eng==='yerel'&&prev&&(prev.engine==='claude'||prev.engine==='grok')&&Date.now()-prev.at<60000&&local.chart_found&&change<0.25){
      const keep={...prev,last:local.last,lines:local.lines,ind:local.ind,signals:local.signals,lastCandle:local.lastCandle};drawOverlay(keep,d,false);checkAlerts(prev,keep);return}
    a.at=Date.now();
    a.confidence=Math.max(0,Math.min(100,Math.round(a.confidence||0)));
    const entry={...a,model:eng==='claude'?model():eng==='grok'?(a.model||cfg().grokModel||null):null};
    if(a.chart_found){
      if(!opts.silent||eng==='claude'||eng==='grok')save({history:[slim(entry),...(cfg().history||[]).map(slim)].slice(0,HISTORY_MAX)});
      drawOverlay(a,d,!opts.silent);checkAlerts(prev,a);
    }else if(!opts.silent)clearAnalysis();
    send('result',{...entry,silent:!!opts.silent,usage:state().usage});
    if(!opts.silent&&(a.symbol||mkt().symbol))pushNews(a.symbol||mkt().symbol);
  }catch(e){send('err',{msg:ai.errorText(e)})}
  finally{busy=false}
}

// Gecmise yalnizca gosterim icin gerekenler: cizgi/mum dizileri cfg.json'u sisirmesin.
function slim(e){if(!e)return e;const {lines,rawCandles,allSignals,trendlines,fib,lastCandle,cal,realSignals,market:m,...rest}=e;
  return {...rest,signals:undefined,market:m?{quote:m.quote,backtest:m.backtest,tf:m.tf}:undefined}}

// Ekran analizini piyasa verisiyle birlestir: fiyat olcegi, gercek veriden indikatorler, tarihli sinyaller, basari orani, haberler.
async function withMarket(local,opts={}){
  const m=mkt();
  if(!m.symbol)throw new Error('Piyasa verisi için hisse kodunu yaz (Analiz sekmesinin üstünde).');
  if(!opts.silent)send('busy',{text:m.symbol+' verisi alınıyor…'});
  const r=await market.load(m.symbol,{tf:m.tf,market:m.market,avKey:avKey(),news:!opts.silent});
  const rows=r.chart&&r.chart.rows||[];
  const series=rows.length?engine.analyzeSeries(rows):null;
  const cal=local.chart_found&&rows.length?engine.calibrateFromSeries(local.rawCandles,rows):null;
  const P=y=>cal?+(cal.my+cal.k*(y-cal.mx)).toFixed(4):null;
  const base=local.chart_found?local:{chart_found:!!series,engine:'piyasa',resistances:[],supports:[],trendlines:[],patterns:[],signals:[]};
  const a={...base,engine:'piyasa',symbol:r.symbol,timeframe:m.tf,cal:cal?{mx:cal.mx,my:cal.my,k:cal.k}:null,
    // Ekrandaki seviyeler fiyatla etiketlenir; olcek yoksa gercek veriden seviyeler gelir.
    resistances:cal?base.resistances.map(l=>({...l,price:P(l.y)})):base.resistances,
    supports:cal?base.supports.map(l=>({...l,price:P(l.y)})):base.supports,
    last_price:(r.chart&&r.chart.quote.price)??(series&&series.last_price)??(r.quote&&r.quote.price)??null};
  if(series&&series.chart_found){ // indikator ve skor gercek fiyattan: ekrandaki piksel tahmininden daha guvenilir
    Object.assign(a,{ind:series.ind,score:series.score,factors:series.factors,rr:series.rr,bias:series.bias,trend:series.trend,confidence:series.confidence,comment:series.comment,
      patterns:[...new Set([...(series.patterns||[]),...(base.patterns||[])])]});
  }
  a.market={tf:m.tf,yahoo:r.yahoo,quote:r.chart?r.chart.quote:r.quote||null,stale:!!(r.chart&&r.chart.stale),
    levels:series?{R:series.resistances,S:series.supports}:null,signals:series?series.signals.slice(-6):[],backtest:series?series.backtest:null,
    news:[...((r.news&&r.news.items)||[]),...((r.avNews&&r.avNews.items)||[])].slice(0,8),sentiment:r.avNews?r.avNews.sentiment:null,
    calib:cal?{r2:+cal.r2.toFixed(4),n:cal.n,shift:cal.shift}:null,errors:r.errors,avLeft:r.avLeft};
  a.market.rows=rows.length;a.market.screenN=local.rawCandles?local.rawCandles.length:0;
  // Yahoo BIST verisi ~15 dk gecikmeli: gosterilen son fiyat ekrandaki grafikten (olcekle) ya da bottan alinir
  const live=cal&&local.last?+P(local.last.y):botPrice(r.symbol);
  if(live!=null){a.market.delayedPrice=a.last_price;a.last_price=live;a.market.priceSource=cal&&local.last?'ekran':'bot'}else a.market.priceSource='yahoo';
  if(cal&&series)a.realSignals=realMarks(series.signals||[],rows,local,cal);
  if(!a.chart_found&&!series)throw new Error(r.errors.join(' · ')||'Veri alınamadı.');
  return a;
}

// Gercek veriden (tarihli, kaymayan) AL/SAT sinyallerini ekrandaki mumlara esle.
// calibrateFromSeries ekran mumu [N-k] ile rows[R-k-shift] eslestirir => ekran indeksi s=N-R+i+shift.
function realMarks(sigs,rows,local,cal){
  const rc=local.rawCandles||[],N=rc.length,R=rows.length,b=local.chart_box;if(!N||!b)return [];
  // x yaklasimi: grafik alaninin solundan son mumun merkezine esit aralik (rawCandles x verirse onu kullan).
  const lx=local.lastCandle&&Number.isFinite(local.lastCandle.x)?local.lastCandle.x:null;
  const xOf=s=>rc[s]&&Number.isFinite(rc[s].x)?rc[s].x:lx!=null?b.x1+(lx-b.x1)*(s+0.5)/(N-0.5):b.x1+(s+0.5)*(b.x2-b.x1)/N;
  const yOf=p=>cal.mx+(p-cal.my)/cal.k;
  return sigs.map(g=>{const s=N-R+g.i+(cal.shift||0),r=rows[g.i];if(s<0||s>=N||!r)return null;
    const y=yOf(g.dir>0?r.l:r.h);if(!(y>=0&&y<=1))return null;
    return {x:+xOf(s).toFixed(4),y:+y.toFixed(4),dir:g.dir,t:g.t,price:g.price}}).filter(Boolean);
}

function setLive(on){
  save({live:on});clearInterval(timer);timer=null;lastSig=null;
  if(on){timer=setInterval(()=>analyze({silent:true}),interval()*1000);analyze({silent:true})}
  else if(!cfg().pin){clearTimeout(fadeTimer);fadeTimer=setTimeout(clearAnalysis,30000)}
  trayTitle();
}

// --- derinlik (Telegram botu / ekran) --------------------------------------
const enc=v=>v?(safeStorage.isEncryptionAvailable()?'e:'+safeStorage.encryptString(v).toString('base64'):'p:'+v):undefined;
const dec=v=>!v?null:v.startsWith('e:')?(()=>{try{return safeStorage.decryptString(Buffer.from(v.slice(2),'base64'))}catch(e){return null}})():v.slice(2);
const tgCfg=()=>cfg().tg||{};
let tgUser=null,tgAskResolve=null,depthTimer=null,depthBusy=false,lastDepth=null;
const depthHist={},flowHist={};

// --- guvenli istek planlayici ------------------------------------------------
// Telegram hesabinin kisitlanmamasi icin: en az 20 sn + rastgele bekleme, seans saatleri,
// saatlik/gunluk sinir ve Telegram "bekle" derse otomatik duraklama.
const SAFE={minSec:20,hourCap:100,dayCap:700};
const sent=[];let floodUntil=0;
// Seans: hafta sonu, resmi tatil ve arife (yarim gun) calendar.js'te.
const marketOpen=()=>calendar.isOpen(new Date());
// Ek bot sorgulari: AKD (kurum dagilimi) ve gerceklesen islemler. Derinlik isteginden birkac sn sonra,
// hisse basina AKD en fazla 2 dk'da, islemler 1 dk'da bir sorulur; ayni guvenli sinirlar sayilir.
const EXTRA={
  akd:{key:'akdCmd',def:'/akd {KOD}',every:120,has:r=>(r.buyers||[]).length+(r.sellers||[]).length>0,img:(im,ref)=>require('./depthimg').readAkd(im,{ref}),pick:r=>({buyers:r.buyers,sellers:r.sellers})},
  trades:{key:'tradeCmd',def:'/islem {KOD}',every:60,has:r=>(r.trades||[]).length>0,img:(im,ref)=>require('./depthimg').readTrades(im,{ref}),pick:r=>({trades:r.trades})}};
const extraCache={akd:{},trades:{}},extraFail={akd:{},trades:{}};
// Arayuze giden bot fotografi: yarim kalmis (kesilmis) data URL yerine kucultulmus gecerli JPEG
function thumb(p){if(!p)return null;try{let im=nativeImage.createFromDataURL(p);if(im.isEmpty())return null;if(im.getSize().width>760)im=im.resize({width:760,quality:'good'});
  const u='data:image/jpeg;base64,'+im.toJPEG(82).toString('base64');return u.length<=1500000?u:null}catch(e){return null}}
async function photoData(messages,fn){const m=messages.find(x=>x.photo);if(!m)return null;
  try{const im=nativeImage.createFromDataURL(m.photo),sz=im.getSize();return await fn({width:sz.width,height:sz.height,data:im.toBitmap(),bgra:true})}catch(e){console.error('ocr',e);return null}}
async function fetchExtra(kind,symbol,ref,auto,now=false){
  const X=EXTRA[kind],cmd=tgCfg()[X.key]??X.def,c=extraCache[kind][symbol];
  if(!cmd||!cmd.includes('{KOD}'))return null;
  // now: canli takip turu bu sorguyu secti (canSend zaten kontrol edildi), bekleme ve onbellek yok
  // Bot bu komutu desteklemiyorsa her turda bosuna sormayalim: art arda hatada bekleme 2x buyur (en fazla 8x)
  const fl=extraFail[kind][symbol],failWait=fl?X.every*1000*Math.min(8,2**fl.n):0;
  if(!now){
    if(c&&Date.now()-c.at<X.every*1000)return c;
    if(fl&&Date.now()-fl.at<failWait)return c||null;
    const t=Date.now();
    if(t<floodUntil||sent.length>=SAFE.dayCap||(auto&&sent.filter(x=>t-x<3600000).length>=SAFE.hourCap))return c||null;
    await new Promise(r=>setTimeout(r,2500+Math.random()*2500));
  }
  sent.push(Date.now());
  let msgs;try{msgs=await tg.query(tgCfg().bot,cmd.replace(/\{KOD\}/g,symbol))}
  catch(err){const w=tg.floodSeconds(err);if(w)floodUntil=Date.now()+(w+15)*1000;return c||null}
  let r=depthLib.parseText(msgs.map(m=>m.text).join('\n'),{symbol});
  if(!X.has(r))r=await photoData(msgs,im=>X.img(im,ref))||r;
  if(!X.has(r)){extraFail[kind][symbol]={at:Date.now(),n:((fl&&fl.n)||0)+1};return c||null}
  delete extraFail[kind][symbol];
  if(kind==='akd')saveAkd(symbol,r);
  return extraCache[kind][symbol]={at:Date.now(),...X.pick(r)};
}
// Canli takip: her turda tek istek. En "bayat" veri secilir (derinlik ~60 sn, islemler ~45 sn, AKD ~3 dk hedefi).
const lastRaw={},tapes={};
function pickKind(symbol){
  const now=Date.now(),age=t=>t?(now-t)/1000:1e9,on=k=>{const v=tgCfg()[EXTRA[k].key]??EXTRA[k].def;return !!v&&v.includes('{KOD}')};
  const c=[['depth',age(lastRaw[symbol]&&lastRaw[symbol].at)/60]];
  // Basarisiz ek komut: son deneme zamani ve bekleme carpani hesaba katilir; derinlik 2 dk'dan eskiyse once o
  const seen=k=>Math.max((extraCache[k][symbol]||{}).at||0,(extraFail[k][symbol]||{}).at||0),mult=k=>extraFail[k][symbol]?Math.min(8,2**extraFail[k][symbol].n):1;
  if(age(lastRaw[symbol]&&lastRaw[symbol].at)>120)return 'depth';
  if(on('trades'))c.push(['trades',age(seen('trades'))/(45*mult('trades'))]);
  if(on('akd'))c.push(['akd',age(seen('akd'))/(180*mult('akd'))]);
  return c.sort((a,b)=>b[1]-a[1])[0][0];
}
function canSend(auto){
  const now=Date.now();while(sent.length&&now-sent[0]>86400000)sent.shift();
  if(now<floodUntil)return 'Telegram bekletiyor, '+Math.ceil((floodUntil-now)/1000)+' sn sonra devam edilecek';
  if(auto&&!marketOpen())return 'Seans kapalı: '+(calendar.status(new Date()).reason||'seans dışı')+'; otomatik yenileme duraklatıldı';
  const lastHour=sent.filter(t=>now-t<3600000).length;
  if(auto&&lastHour>=SAFE.hourCap)return 'Saatlik güvenli sınıra ulaşıldı ('+SAFE.hourCap+')';
  if(sent.length>=SAFE.dayCap)return 'Günlük güvenli sınıra ulaşıldı ('+SAFE.dayCap+')';
  if(sent.length&&now-sent[sent.length-1]<(auto?SAFE.minSec:5)*1000)return 'Çok sık istek: biraz bekle';
  return null;
}
const safeInfo=()=>{const now=Date.now();return {hour:sent.filter(t=>now-t<3600000).length,day:sent.length,hourCap:SAFE.hourCap,dayCap:SAFE.dayCap,market:marketOpen(),marketWhy:calendar.status(new Date()).reason,flood:Math.max(0,Math.ceil((floodUntil-now)/1000))}};

function tgAsk(step,hint){
  send('tgAsk',{step,hint:hint||null});showPop();
  return new Promise((res,rej)=>{tgAskResolve={res,rej}});
}
async function tgConnect(p){
  const c=tgCfg();
  const apiId=String(p.apiId||c.apiId||'').trim(),apiHash=String(p.apiHash||dec(c.apiHash)||'').trim();
  if(!/^\d+$/.test(apiId)||!/^[0-9a-f]{32}$/i.test(apiHash))throw new Error('api_id sayı, api_hash 32 karakterlik bir kod olmalı (my.telegram.org).');
  const bot=String(p.bot||c.bot||'').trim().replace(/^@?/,'@');
  save({tg:{...c,apiId,apiHash:enc(apiHash),bot:bot.length>1?bot:c.bot,cmd:p.cmd||c.cmd||'{KOD}',akdCmd:p.akdCmd!=null?String(p.akdCmd).slice(0,60):c.akdCmd,tradeCmd:p.tradeCmd!=null?String(p.tradeCmd).slice(0,60):c.tradeCmd}});
  tgUser=null;                                        // eski istemci kapanir; yeni baglanti basarisizsa 'bagli' gorunmesin
  tgUser=await tg.connect({apiId,apiHash,session:dec(tgCfg().session),
    ask:(step,hint)=>step==='phone'&&p.phone?Promise.resolve(String(p.phone)):tgAsk(step,hint),
    onSession:ss=>save({tg:{...tgCfg(),session:enc(ss)}})});
  return tgState();
}
const tgState=()=>({connected:!!tgUser,user:tgUser,bot:tgCfg().bot||null,cmd:tgCfg().cmd||'{KOD}',akdCmd:tgCfg().akdCmd??'/akd {KOD}',tradeCmd:tgCfg().tradeCmd??'/islem {KOD}',apiId:tgCfg().apiId||'',hasHash:!!tgCfg().apiHash});

// Grafikteki sembol: son Claude analizinden, yoksa son derinlikten.
// Haber botunun Supabase'e yazdigi hisse haberleri. Uygulamada bakilan hisse "watchlist"e yazilir (saatte en fazla bir kez);
// bot bu listedeki hisselerin haberlerini cekip puanlar. Okuma 10 dk onbellekli, son 3 gun, onem sirasina gore.
const newsCache={},watchAt={};
const bistCode=s=>String(s||'').toLocaleUpperCase('tr-TR').replace(/\.IS$/,'').replace(/[ŞÇĞÖÜİ]/g,c=>({Ş:'S',Ç:'C',Ğ:'G',Ö:'O',Ü:'U',İ:'I'})[c]).replace(/[^A-Z0-9]/g,'');
async function botNews(symbol){
  const sym=bistCode(symbol);if(!sym||!/^[A-Z0-9]{2,8}$/.test(sym)||!sync.state().configured)return null;
  if(cfg().sbOn&&(!watchAt[sym]||Date.now()-watchAt[sym]>3600000)){watchAt[sym]=Date.now();sync.upsert('watchlist',[{symbol:sym,last_seen:new Date().toISOString()}],'user_id,symbol').catch(()=>{})}
  const c=newsCache[sym];if(c&&Date.now()-c.at<600000)return c.data;
  try{const since=new Date(Date.now()-3*86400000).toISOString(),q=encodeURIComponent;
    const sel='/rest/v1/news?select=ts,kind,symbols,title,summary,reason,effect,topic,source,url,score,importance,react_1h,react_1d&order=importance.desc.nullslast,ts.desc';
    const own=await sync.get(sel+'&symbols=cs.%7B'+sym+'%7D&ts=gte.'+q(since)+'&limit=6')||[];
    // Genel BIST gundemi: son 24 saatin onemi 4-5 olanlari (hisseye ozel haber yoksa da piyasa resmi gorunsun)
    const day=new Date(Date.now()-86400000).toISOString();
    const gen=sym==='XU100'?[]:(await sync.get(sel+'&symbols=cs.%7BXU100%7D&importance=gte.4&kind=neq.rapor&ts=gte.'+q(day)+'&limit=4')||[]);
    const list=[...own,...gen.filter(g=>!own.some(o=>o.title===g.title)).map(g=>({...g,general:true}))];
    // Yaklasan sirket olaylari (temettu, bedelsiz, genel kurul, bilanco...) ve cok gunluk kurum birikimi
    const calendar=await sync.get('/rest/v1/calendar_events?select=day,kind,title,url&symbol=eq.'+sym+'&day=gte.'+trDay()+'&order=day.asc&limit=5').catch(()=>[])||[];
    const akdRows=await sync.get('/rest/v1/akd_daily?select=day,side,broker,net,cost,updated_at&symbol=eq.'+sym+'&day=gte.'+trDay(-12)+'&order=day.desc&limit=600').catch(()=>[])||[];
    const data={list,calendar,akd:akdSummary(akdRows)};
    newsCache[sym]={at:Date.now(),data};return data}
  catch(e){return c?c.data:null}
}
function pushNews(symbol){botNews(symbol).then(data=>{if(!data)return;const sym=bistCode(symbol);send('botNews',{symbol:sym,...data});sendOv('botNews',{symbol:sym,...data})}).catch(()=>{})}

// --- AKD gunluk arsivi -------------------------------------------------------------
// Her AKD okumasi gunun son durumunu yazar: hisse + gun + taraf + kurum basina tek satir (upsert).
const trDay=(off=0)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul'}).format(new Date(Date.now()+off*86400000));
const isOther=n=>/^d[iİı]ğ?g?er$/i.test(String(n||'').replace(/ğ/g,'g').replace(/[İı]/g,'i'));
// AKD o gunun seansina aittir: seans acilmadan, hafta sonu ya da tatilde gelen AKD son islem gunune yazilir.
function akdDay(){
  const now=new Date(),min=+new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now).replace(':','')
  let off=min<955?-1:0;
  for(let k=0;k<10;k++,off--){const d=trDay(off);if(calendar.status(new Date(d+'T09:00:00Z')).open)return d}
  return trDay();
}
function saveAkd(symbol,r){
  const sym=bistCode(symbol);if(!sym||!cfg().sbOn||!sync.state().configured)return;
  const day=akdDay(),seen=new Set(),rows=[];
  for(const [side,list] of [['buy',r.buyers||[]],['sell',r.sellers||[]]])for(const x of list){
    const broker=String(x.name||'').trim().slice(0,60),k=side+'|'+broker;if(!broker||x.net==null||seen.has(k))continue;seen.add(k);
    rows.push({day,symbol:sym,side,broker,net:Math.round(x.net),cost:x.cost??null,pct:x.pct??null,updated_at:new Date().toISOString()})}
  if(rows.length)sync.upsert('akd_daily',rows,'user_id,day,symbol,side,broker').then(()=>{if(newsCache[sym])newsCache[sym].at=0}).catch(()=>{});
}
// Son 5 islem gununde kurum basina net lot (alici +, satici -); ayni gun hem alici hem satici satiri varsa son guncellenen gecerli.
function akdSummary(rows){
  const latest=new Map();
  for(const r of rows){if(isOther(r.broker))continue;const k=r.day+'|'+r.broker,p=latest.get(k);if(!p||r.updated_at>p.updated_at)latest.set(k,r)}
  const days=[...new Set([...latest.values()].map(r=>r.day))].sort().reverse().slice(0,5);if(!days.length)return null;
  const by=new Map();
  for(const r of latest.values()){if(!days.includes(r.day))continue;const b=by.get(r.broker)||{name:r.broker,net:0,buyDays:0,sellDays:0,cost:null};
    b.net+=(r.side==='buy'?1:-1)*(r.net||0);r.side==='buy'?b.buyDays++:b.sellDays++;if(r.side==='buy'&&r.cost!=null&&b.cost==null)b.cost=r.cost;by.set(r.broker,b)}
  const all=[...by.values()].sort((a,b)=>b.net-a.net);
  return {days:days.length,from:days[days.length-1],to:days[0],top:all.filter(b=>b.net>0).slice(0,3),bottom:all.filter(b=>b.net<0).slice(-2).reverse()};
}
// Sinyal karnesi: bot (haber deposu) her sinyalin 1 saat / 1 gun / 5 gun sonrasini olcer.
async function scorecard(days=30){
  if(!sync.state().configured)return {ok:false,msg:'Supabase bağlı değil.'};
  try{
    // Supabase tek seferde en fazla 1000 satir verir: yeniden eskiye 1000'lik sayfalar, en fazla 5000
    const q='/rest/v1/signals?select=dir,source,why,ret_1h,ret_1d,ret_5d&ret_1d=not.is.null&ts=gte.'+encodeURIComponent(new Date(Date.now()-days*86400000).toISOString())+'&order=ts.desc,id.desc&limit=1000&offset=';
    const rows=[];for(let off=0;off<5000;off+=1000){const p=await sync.get(q+off)||[];rows.push(...p);if(p.length<1000)break}
    const stat=xs=>{const h=k=>{const v=xs.filter(r=>r[k]!=null);return v.length?{n:v.length,hit:Math.round(v.filter(r=>r[k]*r.dir>0).length/v.length*100),avg:+(v.reduce((s,r)=>s+r[k]*r.dir,0)/v.length).toFixed(2)}:null};
      return {n:xs.length,h1:h('ret_1h'),d1:h('ret_1d'),d5:h('ret_5d')}};
    const rule=w=>String(w||'').replace(/%\s*\d+(?:[.,]\d+)?|[+-]?\d+(?:[.,]\d+)?\s*%|[+-]\d+(?:[.,]\d+)?/g,'').replace(/\s+/g,' ').trim().slice(0,40);
    const rules=new Map();for(const r of rows)for(const w of new Set((r.why||[]).map(rule).filter(Boolean))){(rules.get(w)||rules.set(w,[]).get(w)).push(r)}
    return {ok:true,days,total:rows.length,buy:stat(rows.filter(r=>r.dir>0)),sell:stat(rows.filter(r=>r.dir<0)),
      rules:[...rules.entries()].filter(([,v])=>v.length>=3).map(([k,v])=>({rule:k,...stat(v)})).sort((a,b)=>b.n-a.n).slice(0,8)};
  }catch(e){return {ok:false,msg:e.message}}
}
const currentSymbol=()=>cfg().symbol||(lastAi&&lastAi.symbol)||(lastDepth&&lastDepth.symbol)||cfg().depthSymbol||'';

let depthNext=null;   // suren istek varken gelen elle/Neo istegi: bitince calisir (sessizce dusmesin)
async function fetchDepth(opts={}){
  if(depthBusy){if(!opts.auto)depthNext=opts;return}depthBusy=true;
  const symbol=bistCode(opts.symbol||(opts.auto&&cfg().depthSymbol)||currentSymbol());
  const source=opts.source||cfg().depthSource||'telegram';
  try{
    if(!symbol)throw new Error('Hisse kodu yaz (ör. PRZMA) ya da önce grafiği Claude ile analiz et.');
    save({depthSymbol:symbol,depthSource:source});
    send('depthBusy',{symbol,source});
    let d=null,messages=[],kind='depth';
    if(source==='telegram'){
      if(!tgUser)throw new Error('Telegram bağlı değil. Ayarlar › Telegram derinlik botu bölümünden bağlan.');
      if(!tgCfg().bot)throw new Error('Botun kullanıcı adını Ayarlar\'a yaz (ör. @b0pt_bot).');
      const why=canSend(!!opts.auto);
      if(why){send('depthWait',{msg:why,safe:safeInfo()});return}
      const raw=lastRaw[symbol];kind=opts.auto&&raw&&Date.now()-raw.at<600000?pickKind(symbol):'depth';
      if(kind!=='depth'){
        await fetchExtra(kind,symbol,raw.last||(raw.bids[0]&&raw.bids[0].price)||null,true,true);
        d={...raw,buyers:raw.buyers,sellers:raw.sellers,trades:raw.trades};
      }else{
      sent.push(Date.now());
      try{messages=await tg.query(tgCfg().bot,(tgCfg().cmd||'{KOD}').replace(/\{KOD\}/g,symbol))}
      catch(err){const w=tg.floodSeconds(err);if(w){floodUntil=Date.now()+(w+15)*1000;send('depthWait',{msg:'Telegram '+w+' sn beklememizi istedi; otomatik duraklatıldı.',safe:safeInfo()});return}throw err}
      d=depthLib.parseText(messages.map(m=>m.text).join('\n'),{symbol});
      // Bot tabloyu resim olarak gonderdiyse (BOPT): once yerel OCR (ucretsiz), olmazsa Grok/Claude.
      const photo=messages.find(m=>m.photo);
      if(!depthLib.hasData(d)&&photo){
        const r=await photoData(messages,img=>require('./depthimg').read(img,{hint:{symbol,last:d.last,change:d.change}}));
        if(r&&depthLib.hasData(r))d=r;
        if(!depthLib.hasData(d)&&visionAI()){const r=await readDepthImage(photo.photo.split(',')[1]);if(r.found)d={bids:[],asks:[],buyers:[],sellers:[],trades:[],...r,symbol:r.symbol||symbol}}
        if(!depthLib.hasData(d))throw new Error('Botun gönderdiği tablo resmi okunamadı.'+(visionAI()?'':' Yedek olarak Grok anahtarı ekleyebilirsin.'))}
      lastRaw[symbol]={...d,at:Date.now()};
      }
      // Kurum dagilimi ve islemler derinlik mesajinda yoksa ayri komutlarla sor (onbellekli)
      const ref=d.last||(d.bids[0]&&d.bids[0].price)||null;
      // Elle istekte eksikler hemen sorulur; canli takipte yalnizca onbellek (sira gelince ayrica sorulur)
      const ex=k=>opts.auto?extraCache[k][symbol]||null:fetchExtra(k,symbol,ref,false);
      if(!d.buyers.length&&!d.sellers.length){const a=await ex('akd');if(a){d.buyers=a.buyers;d.sellers=a.sellers;d.akdAt=a.at}}
      if(!d.trades.length){const a=await ex('trades');if(a){d.trades=a.trades;d.tradesAt=a.at}}
      // Islem akisi: gun icinde biriken islemler
      const day=new Date().toDateString();if(!tapes[symbol]||tapes[symbol].day!==day)tapes[symbol]={day,list:[]};
      if(d.trades.length)tapes[symbol].list=depthLib.mergeTape(tapes[symbol].list,d.trades);
      d.tape=depthLib.tapeFlow(tapes[symbol].list);
    }else{
      if(!visionAI())throw new Error('Ekrandan derinlik okumak için Grok ya da Claude API anahtarı gerekli.');
      const disp=activeDisplay(),shot=await capture(disp);
      const r=await readDepthImage(shot.toJPEG(85).toString('base64'));
      if(!r.found)throw new Error('Ekranda derinlik tablosu bulunamadı. Derinlik terminalini açık tut.');
      d={bids:[],asks:[],buyers:[],sellers:[],trades:[],...r,symbol:r.symbol||symbol};
    }
    const pr=depthLib.pressure(d);
    const fresh=kind==='depth',dataAt=fresh?Date.now():((lastRaw[symbol]||{}).at||Date.now());
    if(pr&&fresh){const h=depthHist[symbol]=(depthHist[symbol]||[]);h.push({t:Date.now(),p:pr.score});if(h.length>120)h.shift()}
    // Kurum akisi: alicilarin net toplami - saticilarin; artiyorsa kurumlar topluyor.
    const flow=(d.buyers||[]).reduce((s,x)=>s+Math.abs(x.net||0),0)-(d.sellers||[]).reduce((s,x)=>s+Math.abs(x.net||0),0);
    if((d.buyers.length||d.sellers.length)&&(fresh||kind==='akd')){const f=flowHist[symbol]=(flowHist[symbol]||[]);f.push({t:Date.now(),v:flow});if(f.length>120)f.shift()}
    const fh=flowHist[symbol]||[],fd=fh.length>1?fh[fh.length-1].v-fh[0].v:0;
    if(!modOn('borsa'))return;   // istek surerken Borsa kapatildi: sonuc gosterilmez/kaydedilmez
    lastDepth={...d,symbol,at:dataAt,source,walls:depthLib.walls(d),pressure:pr,trend:depthLib.trend(depthHist[symbol]||[]),history:(depthHist[symbol]||[]).slice(-40),
      flow:{net:flow,change:fd,top:(d.buyers[0]||null)},safe:safeInfo()};
    lastDepth.signal=liveSignal();lastDepth.live=liveView();
    recordDepth(lastDepth);recordSignal(lastDepth.signal,lastResult||{});
    send('depth',{...lastDepth,messages:messages.map(m=>({...m,photo:thumb(m.photo)})),usage:state().usage});
    pushDepthOverlay();if(!opts.auto||!newsCache[bistCode(symbol)]||Date.now()-newsCache[bistCode(symbol)].at>600000)pushNews(symbol);
  }catch(e){send('depthErr',{msg:ai.errorText(e)})}
  finally{depthBusy=false;if(depthNext){const n=depthNext;depthNext=null;if(modOn('borsa'))fetchDepth(n)}}
}
// Derinligi grafigin uzerine: fiyat olcegi varsa seviyelere, yoksa kose kartina.
function pushDepthOverlay(){
  if(!modOn('borsa'))return;                           // Borsa kapatildiktan sonra biten istek katmani geri acmasin
  if(!lastDepth||!cfg().depthOverlay&&cfg().depthOverlay!==undefined)return sendOv('depth',null);
  const cal=lastResult&&lastResult.engine!=='yerel'&&(!lastResult.symbol||!lastDepth.symbol||lastResult.symbol.replace(/\W/g,'').includes(lastDepth.symbol))?calibParams(lastResult):null;
  sendOv('depth',{...lastDepth,cal,box:lastResult&&lastResult.chart_box||null});
  if(!ov.isVisible())ov.showInactive();
}
// Canli AL/SAT: islem akisi (aktif alis/satis, VWAP, agresif kurum) + derinlik baskisi ve trendi + kurum akisi
// + varsa grafik teknik skoru. Grafik analizi olmadan da calisir.
// Grafik ve derinlik ayni hisseye ait mi (grafikte kod yoksa eslesmez sayilir)
const sameStock=(a,d)=>!!(a&&d&&a.symbol&&d.symbol&&bistCode(a.symbol)===bistCode(d.symbol));
const DEPTH_FRESH=5*60*1000;   // bundan eski derinlik canli sinyale katilmaz
function liveView(){
  const d=lastDepth;if(!d||(d.at&&Date.now()-d.at>DEPTH_FRESH))return null;
  const a=lastResult&&lastResult.chart_found&&sameStock(lastResult,d)?lastResult:null;
  const why=[];let v=0;
  const tf=d.tape;if(tf&&tf.enough){v+=tf.score/40;why.push(...tf.why.slice(0,2))}
  if(a&&typeof a.score==='number'){v+=a.score/50;if(Math.abs(a.score)>=20)why.push('Teknik skor '+(a.score>0?'+':'')+a.score)}
  if(d.pressure){v+=d.pressure.score/40;if(Math.abs(d.pressure.score)>=15)why.push((d.pressure.score>0?'Alış':'Satış')+' baskısı '+(d.pressure.score>0?'+':'')+d.pressure.score)}
  if(d.trend&&d.trend.dir){v+=d.trend.dir*0.5;why.push(d.trend.text)}
  const ak=(newsCache[bistCode(d.symbol)]||{}).data;const acc=ak&&ak.akd&&ak.akd.top[0];
  if(acc&&ak.akd.days>=3&&acc.buyDays>=Math.ceil(ak.akd.days*0.6)){v+=0.3;why.push(acc.name.split(' ')[0]+' '+acc.buyDays+'/'+ak.akd.days+' gün alıcı')}
  if(d.flow&&d.flow.top&&d.flow.net){v+=Math.sign(d.flow.net)*0.5;why.push((d.flow.net>0?d.flow.top.name.split(' ')[0]+' topluyor':'Kurumlar satıyor'))}
  const dir=v>=1.6?1:v<=-1.6?-1:0;
  return {dir,strength:Math.min(3,Math.abs(v)),score:Math.round(Math.max(-1,Math.min(1,v/3))*100),why:why.slice(0,3),at:Date.now()};
}
function liveSignal(){const l=liveView();return l&&l.dir?{dir:l.dir,strength:l.strength,why:l.why}:null}
let depthGen=0;
function setDepthAuto(sec){
  save({depthAuto:sec});clearTimeout(depthTimer);depthTimer=null;const gen=++depthGen;
  if(sec<=0)return;
  // Sabit aralik yerine rastgele sapmali zamanlayici (her istek %0-35 gecikmeli).
  // Ekrandan okuma her turda Claude kredisi harcar: otomatikte en az 60 sn.
  // Saatlik ve gunluk sinir seans boyunca yetsin: en az ~45 sn (3600/100 ve 8,4 saat / 700 istek)
  const pace=Math.ceil(Math.max(3600/SAFE.hourCap,8.4*3600/SAFE.dayCap));
  const loop=()=>{const floor=(cfg().depthSource==='ekran')?60:Math.max(SAFE.minSec,pace);depthTimer=setTimeout(async()=>{if(gen!==depthGen)return;await fetchDepth({auto:true});if(gen===depthGen&&cfg().depthAuto>0)loop()},Math.max(floor,sec)*1000*(1+Math.random()*0.35))};
  loop();
}

// --- kisayollar (ayarlardan degistirilebilir) ---
const SC_DEFAULT={analyze:'CommandOrControl+Shift+A',draw:'CommandOrControl+Shift+D',live:'CommandOrControl+Shift+L'};
const SC_NAME={analyze:'Ekranı analiz et',draw:'Çizim modu',live:'Canlı mod'};
const SC_FN={analyze:()=>analyze(),draw:()=>setDrawing(!drawing),live:()=>{setLive(!cfg().live);send('state',state())}};
const sc=()=>({...SC_DEFAULT,...(cfg().shortcuts||{})});
let scState={},scPaused=false;
const tryReg=(acc,f)=>{try{return globalShortcut.register(acc,f)}catch(e){return false}}; // gecersiz kisayol hata atar
function registerShortcuts(){
  globalShortcut.unregisterAll();scPaused=false;const s=sc();
  for(const k in SC_DEFAULT){const ok=tryReg(s[k],SC_FN[k]);scState[k]={acc:s[k],ok};if(!ok)console.warn(s[k]+' kısayolu kaydedilemedi.')}
  rearmOthers();
  return scState;
}
// Yeni kisayol kaydedilemezse eskisi kalir ve hata doner.
function setShortcut(name,acc){
  acc=String(acc||'').trim();
  const fail=msg=>{registerShortcuts();return {ok:false,msg,shortcuts:scState}};
  if(!SC_DEFAULT[name])return fail('Bilinmeyen kısayol.');
  if(!acc||acc.length>60||!/^[\w+\-=\[\];',./\\`]+$/.test(acc))return fail('Geçersiz kısayol.');
  const s=sc(),other=Object.keys(s).find(k=>k!==name&&s[k].toLowerCase()===acc.toLowerCase());
  if(other)return fail('Bu kısayol zaten "'+SC_NAME[other]+'" için kullanılıyor.');
  // Diger ozelliklerin kisayollari (Pano ⌘⇧V, Neo ⌥Bosluk) alinamaz
  const nk=a=>String(a).toLowerCase().replace(/commandorcontrol|cmdorctrl|command|cmd|super|meta/g,'cmd').replace(/control/g,'ctrl').replace(/option/g,'alt').split('+').sort().join('+');
  const taken={[nk('CommandOrControl+Shift+V')]:'Pano Geçmişi',[nk((cfg().neo&&cfg().neo.hotkey)||'Alt+Space')]:'Neo'}[nk(acc)];
  if(taken)return fail('Bu kısayol "'+taken+'" için kullanılıyor.');
  globalShortcut.unregisterAll();
  if(!tryReg(acc,SC_FN[name]))return fail('Kısayol kaydedilemedi: geçersiz ya da başka bir uygulama kullanıyor. Eski kısayol korundu.');
  save({shortcuts:{...(cfg().shortcuts||{}),[name]:acc}});registerShortcuts();
  return {ok:true,shortcuts:scState};
}

// --- sistem kontrolu: her madde {name,st:'ok'|'warn'|'fail',msg}. Rapor gizli bilgi icermez (anahtar, belirtec, telefon, oturum yok).
const withTimeout=(p,ms,msg)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error(msg)),ms))]);
async function diagnostics(){
  const out=[],add=(name,st,msg)=>out.push({name,st,msg}),mac=process.platform==='darwin';
  const osv=mac?'macOS '+process.getSystemVersion():process.platform+' '+require('os').release();
  add('Sistem',mac&&parseInt(process.getSystemVersion())<12?'warn':'ok',osv+' · '+process.arch+' · Electron '+process.versions.electron+' · uygulama '+require('./package.json').version+(mac&&parseInt(process.getSystemVersion())<12?' · Electron 43 için macOS 12 ve üstü gerekir':''));
  if(mac){const st=systemPreferences.getMediaAccessStatus('screen');
    add('Ekran kaydı izni',st==='granted'?'ok':st==='not-determined'?'warn':'fail',st==='granted'?'İzin verildi.':st==='not-determined'?'Henüz sorulmadı; ilk analizde macOS izin isteyecek.':'İzin yok ('+st+'). Sistem Ayarları › Gizlilik ve Güvenlik › Ekran Kaydı.')}
  else add('Ekran kaydı izni','ok','Bu platformda ayrı izin gerekmez.');
  try{const srcs=await withTimeout(desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:320,height:200}}),8000,'zaman aşımı');
    const t=srcs[0]&&srcs[0].thumbnail;
    if(!t||t.isEmpty())add('Test ekran görüntüsü','fail','Görüntü boş geldi: izin eksik olabilir.');
    else{const b=t.toBitmap();let mn=255,mx=0;for(let i=0;i<b.length;i+=4*37){const v=(b[i]+b[i+1]+b[i+2])/3;if(v<mn)mn=v;if(v>mx)mx=v}
      add('Test ekran görüntüsü',mx-mn<4?'warn':'ok',srcs.length+' ekran · '+t.getSize().width+'×'+t.getSize().height+(mx-mn<4?' · görüntü tek renk; izin yoksa macOS yalnızca masaüstü arka planını verir.':' · görüntü alındı.'))}
  }catch(e){add('Test ekran görüntüsü','fail','Alınamadı: '+e.message)}
  const enc=safeStorage.isEncryptionAvailable();
  add('Şifreli saklama',enc?'ok':'warn',enc?'Anahtar Zinciri kullanılabilir; anahtarlar şifreli saklanır.':'Kullanılamıyor; anahtarlar düz metin saklanır.');
  add('Bildirimler',Notification.isSupported()?'ok':'warn',Notification.isSupported()?'Destekleniyor. Test bildirimi gönderip görünüp görünmediğine bak.':'Desteklenmiyor.');
  const bad=Object.entries(scState).filter(([,v])=>!v.ok);
  const accL=a=>String(a).replace(/CommandOrControl|CmdOrCtrl/g,mac?'Cmd':'Ctrl');
  add('Kısayollar',bad.length?'warn':'ok',Object.entries(scState).map(([k,v])=>SC_NAME[k]+' '+accL(v.acc)+(v.ok?'':' (kayıtsız)')).join(' · ')+(bad.length?' · başka bir uygulama kullanıyor olabilir; Kısayollar kartından değiştir.':''));
  try{const r=await withTimeout(market.candles('THYAO','1g','BIST'),8000,'Yahoo 8 sn içinde yanıt vermedi');
    add('Yahoo Finance',r.stale?'warn':'ok',(r.rows||[]).length+' günlük mum (THYAO)'+(r.stale?' · bağlantı yok, eski önbellek: '+(r.staleReason||''):r.cached?' · önbellekten':' · canlı bağlantı')+' · Alpha Vantage kotası harcanmaz.')}
  catch(e){add('Yahoo Finance','fail','Ulaşılamadı: '+e.message)}
  const left=market.avLeft();
  add('Alpha Vantage',avKey()?(left>0?'ok':'warn'):'ok',avKey()?'Anahtar kayıtlı · bugün '+left+'/25 istek kaldı (kontrol istek atmaz).':'Anahtar yok (isteğe bağlı; BIST için gerekmez).');
  add('Grok (xAI)','ok',grokKey()?'Anahtar kayıtlı'+(cfg().grokModel?' · model '+cfg().grokModel:' · model otomatik')+' (kontrol istek atmaz).':'Anahtar yok (isteğe bağlı).');
  add('Claude API','ok',getKey()?'Anahtar kayıtlı (kontrol istek atmaz).':'Anahtar yok (isteğe bağlı; Hızlı analiz ücretsiz).');
  const t=tgCfg();
  add('Telegram',tgUser?'ok':t.session?'warn':'ok',tgUser?'Bağlı'+(t.bot?' · bot ayarlı':' · bot adı yazılmadı'):t.session?'Kayıtlı oturum var ama bağlantı kurulamadı.':'Kurulmamış (isteğe bağlı).');
  const b=sync.state();
  add('Supabase',b.configured?(b.error?'warn':'ok'):'ok',b.configured?'Bağlı · '+b.sent+' gönderildi · '+b.pending+' bekliyor'+(b.dropped?' · '+b.dropped+' reddedildi':'')+(b.error?' · hata: '+b.error:''):'Kurulmamış (isteğe bağlı).');
  const cs=calendar.status(new Date()),yi=calendar.yearInfo();
  add('Seans takvimi',yi.verified?'ok':'warn',(cs.open?'Seans açık':'Seans kapalı: '+cs.reason)+' · '+(yi.known?(yi.verified?'bu yılın tatilleri doğrulanmış':'bu yılın dini bayram tarihleri doğrulanmamış'):'bu yıl için takvim verisi yok'));
  let size=0;try{size=fs.statSync(F()).size}catch(e){}
  add('Ayar dosyası',size>1e6?'warn':'ok',(size/1024).toFixed(1).replace('.',',')+' KB'+(size>1e6?' · büyük; Geçmiş ya da çizimleri temizle.':''));
  const icon={ok:'[TAMAM]',warn:'[UYARI]',fail:'[HATA]'};
  const report=['Cem App sistem kontrolü · '+new Date().toISOString(),...out.map(x=>icon[x.st]+' '+x.name+': '+x.msg)].join('\n');
  return {items:out,report};
}
// Bot mesaji ayristirici testi: Telegram'a istek atmadan yapistirilan metni ayristir.
function parseTest(text){
  const d=depthLib.parseText(String(text||'').slice(0,20000));
  return {symbol:d.symbol,last:d.last,change:d.change,ceiling:d.ceiling,floor:d.floor,buyRatio:d.buyRatio,hasData:depthLib.hasData(d),
    counts:{bids:d.bids.length,asks:d.asks.length,trades:d.trades.length,buyers:d.buyers.length,sellers:d.sellers.length},
    bids:d.bids.slice(0,3),asks:d.asks.slice(0,3),buyers:d.buyers.slice(0,3),sellers:d.sellers.slice(0,3),trades:d.trades.slice(0,3),
    walls:depthLib.walls(d),pressure:depthLib.pressure(d)};
}

function state(){
  const u=cfg().usage||{};
  return{mods:{ses:modOn('ses'),paylas:modOn('paylas')},hasGrok:!!grokKey(),grokModel:cfg().grokModel||'',grokModels:cfg().grokModels||[],hasKey:!!getKey(),live:!!cfg().live,model:model(),models:ai.MODELS,interval:interval(),intervals:INTERVALS,engine:engineName(),mkt:mkt(),hasAv:!!avKey(),avLeft:market.avLeft(),tfs:Object.keys(market.TF),liveAi:!!cfg().liveAi,
    history:cfg().history||[],perm:screenAllowed(),secure:safeStorage.isEncryptionAvailable(),alerts:!!cfg().alerts,pin:!!cfg().pin,ind:ind(),
    login:process.platform==='darwin'&&app.getLoginItemSettings().openAtLogin,alarms:Object.values(cfg().drawings||{}).flat().filter(x=>x.t==='alarm'&&!x.fired).length,
    usage:u.month===month()?u:{cost:0,count:0,total:u.total||0},sb:{...sync.state(),on:!!cfg().sbOn},
    signals:cfg().signals!==false,safe:safeInfo(),tg:tgState(),depthSource:cfg().depthSource||'telegram',depthAuto:cfg().depthAuto||0,depthOverlay:cfg().depthOverlay!==false,symbol:currentSymbol(),
    shortcuts:scState,candleColors:candleColors(),cal:{...calendar.yearInfo(),year:new Date().getFullYear()},notify:Notification.isSupported()};
}

app.whenReady().then(()=>{
  // Paketlenmis uygulamada Gelistirici Araclari menusu yok (pencerelerde kod calistirilip kilit/anahtar korumalari asilamasin); kopyala-yapistir icin Duzen menusu kalir
  if(app.isPackaged)Menu.setApplicationMenu(Menu.buildFromTemplate([{role:'appMenu'},{role:'editMenu'},{role:'windowMenu'}]));
  migrateDrawings();mk();
  // Dosya kilidi: ev ve veri klasorlerini okudugu icin uygulama hazir olunca kaydedilir
  lockUi=require('./lock-main').registerLock({ipcMain,dialog,shell,app,BrowserWindow,path,systemPreferences,safeStorage});
  // Cozunurluk/olcek degisince imza degisir: katmanin durdugu ekranin cizimlerini yeni imzaya tasi.
  // Her ekranin son imzasi tutulur: katmanin o an durmadigi ekranin cizimleri de tasinir.
  const dispKeys=new Map(screen.getAllDisplays().map(x=>[x.id,dkey(x)]));
  screen.on('display-added',(e,d)=>dispKeys.set(d.id,dkey(d)));
  screen.on('display-metrics-changed',(e,d)=>{const nk=dkey(d),old=d.id===ovDisplay&&ovKey?ovKey:dispKeys.get(d.id);dispKeys.set(d.id,nk);
    if(old&&old!==nk){const all=cfg().drawings||{};if(all[old]&&!(all[nk]||[]).length){const o={...all,[nk]:all[old]};delete o[old];save({drawings:o})}}
    if(d.id===ovDisplay&&ovKey)placeOverlay(d)});
  tray=new Tray(trayIcon());tray.setToolTip(APP_NAME);
  tray.on('click',()=>modOn('borsa')?toggle():hubUi.open());
  tray.on('right-click',()=>tray.popUpContextMenu(Menu.buildFromTemplate([
    {label:'Merkezi Aç',click:()=>hubUi.open()},{type:'separator'},
    ...(modOn('borsa')?[
      {label:'Hızlı Analiz (yerel)',click:()=>analyze({engine:'yerel'})},
      {label:'Claude ile Analiz',enabled:!!getKey(),click:()=>analyze({engine:'claude'})},
      {label:'Ekranı Analiz Et',accelerator:sc().analyze,click:()=>analyze()},
      {label:'Çizim Modu',accelerator:sc().draw,click:()=>setDrawing(true)},
      {label:'Analiz Çizgilerini Gizle',click:clearAnalysis},
      {label:'Canlı Mod',type:'checkbox',accelerator:sc().live,checked:!!cfg().live,click:m=>{setLive(m.checked);send('state',state())}},{type:'separator'}]:[]),
    ...(modOn('ses')?[{label:'Ses…',click:()=>audioUi.open()}]:[]),
    ...(modOn('paylas')?[{label:'Telefonla Dosya Paylaş (QR)…',click:openShare}]:[]),
    ...(modOn('temizlik')?[{label:'Temizlik…',click:()=>cleanerUi.open()}]:[]),
    ...(modOn('kilit')?[{label:'Dosya Kilidi…',click:()=>lockUi.open()}]:[]),
    ...(modOn('sistem')?[{label:'Sistem Durumu…',click:()=>sysUi.show()}]:[]),
    ...(modOn('pano')?[{label:'Pano Geçmişi (⌘⇧V)…',click:()=>panoUi.open()}]:[]),
    ...(modOn('hiz')?[{label:'İnternet Hız Testi…',click:()=>hizUi.open()}]:[]),
    ...(modOn('neo')?[{label:'Neo ile konuş (⌥ Boşluk)',click:()=>neoUi.talk()},{label:'Neo…',click:()=>neoUi.open()}]:[]),
    {type:'separator'},{label:'Çıkış',role:'quit'}])));
  if(modOn('borsa'))registerShortcuts();
  // Dock simgesi: tiklaninca Merkez acilir. Oturum acilisinda baslatildiysa pencere gosterilmez.
  app.on('activate',()=>hubUi.open());
  if(!app.getLoginItemSettings().wasOpenedAtLogin)hubUi.open();
  pop.on('hide',()=>{if(scPaused&&modOn('borsa'))registerShortcuts()}); // yakalama yarida kaldiysa kisayollari geri yukle
  ipcMain.handle('scCapture',(e,on)=>{if(on){scPaused=true;globalShortcut.unregisterAll();rearmOthers()}else if(modOn('borsa'))registerShortcuts();else scPaused=false;return scState});
  ipcMain.handle('diag',()=>diagnostics());
  ipcMain.handle('karne',()=>scorecard());
  ipcMain.handle('shareOpen',()=>{if(modOn('paylas'))openShare();pop.hide()});
  ipcMain.handle('sesOpen',()=>{if(modOn('ses'))audioUi.open();pop.hide()});
  ipcMain.handle('hubOpen',()=>{hubUi.open();pop.hide()});
  // Paylasim komutlari yalniz paylasim penceresinden kabul edilir (baska pencere dosya ekleyip ag'a acamasin)
  const fromShare=e=>!!shareWin&&!shareWin.isDestroyed()&&e.sender===shareWin.webContents&&modOn('paylas');
  ipcMain.handle('shareStart',async e=>{if(!fromShare(e))return {ok:false,msg:'İzin yok'};try{
    if(!shareSess||!shareSess.info().running){shareSess=shareLib.createShare({downloadsDir:app.getPath('downloads'),ask:shareAsk,onEvent:shareEvt,host:process.env.GRAFIK_SHARE_HOST||undefined});await shareSess.start()}
    return shareState()}catch(err){shareSess=null;return {ok:false,msg:err.message}}});
  ipcMain.handle('shareStop',e=>{if(!fromShare(e))return shareState();if(shareSess)shareSess.stop('user');return shareState()});
  ipcMain.handle('sharePick',async e=>{if(!shareSess||!fromShare(e))return null;const r=await dialog.showOpenDialog(shareWin||undefined,{properties:['openFile','multiSelections'],title:'Telefona gönderilecek dosyalar'});
    if(!r.canceled)shareSess.add(r.filePaths);return shareState()});
  ipcMain.handle('shareAdd',(e,paths)=>{if(shareSess&&fromShare(e)&&Array.isArray(paths))shareSess.add(paths.filter(p=>typeof p==='string'&&path.isAbsolute(p)).slice(0,500));return shareState()});
  ipcMain.handle('shareRemove',(e,id)=>{if(shareSess&&fromShare(e))shareSess.remove(String(id));return shareState()});
  // Yalnizca bu oturumda telefondan gelen dosyalar Finder'da gosterilir
  ipcMain.handle('shareReveal',(e,p)=>{if(shareSess&&fromShare(e)&&shareSess.info().received.some(r=>r.path===p))shell.showItemInFolder(p)});
  ipcMain.handle('testNotify',()=>{if(!Notification.isSupported())return false;new Notification({title:APP_NAME,body:'Test bildirimi: bildirimler çalışıyor.'}).show();return true});
  ipcMain.handle('parseTest',(e,t)=>parseTest(t));
  ipcMain.handle('scSet',(e,o)=>modOn('borsa')?setShortcut(o&&o.name,o&&o.acc):{ok:false,msg:'Borsa özelliği kapalı.',shortcuts:scState});
  ipcMain.handle('analyze',(e,eng)=>analyze({engine:['claude','yerel','piyasa','grok'].includes(eng)?eng:undefined}));
  // Grok: anahtari dogrula ve gorsel destekli modelleri listele (tek istek, kredi harcamaz).
  ipcMain.handle('grokTest',async()=>{if(!grokKey())return {ok:false,msg:'Önce anahtarı kaydet.'};
    try{const r=await grok.test(grokKey());save({grokModels:r.visionModels});return {ok:true,models:r.visionModels,state:state()}}catch(e){return {ok:false,msg:grok.errorText(e)}}});
  ipcMain.handle('key',(e,k)=>{setKey(typeof k==='string'?k.trim():'');trayTitle();return state()});
  ipcMain.handle('cfg',state);
  ipcMain.handle('live',(e,on)=>setLive(!!on&&modOn('borsa')));
  ipcMain.handle('set',(e,o)=>{o=o||{};
    if(ai.MODELS.some(x=>x.id===o.model))save({model:o.model});
    if(INTERVALS.includes(o.interval)){save({interval:o.interval});if(cfg().live)setLive(true)}
    if(typeof o.grokKey==='string'){const k=o.grokKey.trim();if(k&&!grok.validKey(k))return {...state(),err:'Grok anahtarı "xai-" ya da "grok_" ile başlamalı.'};save({grokKey:k?enc(k):undefined});if(!k&&cfg().engine==='grok')save({engine:'yerel'})}
    if(typeof o.grokModel==='string')save({grokModel:o.grokModel.trim().slice(0,60)||undefined});
    if(['yerel','claude','piyasa','grok'].includes(o.engine)){save({engine:o.engine});lastSig=null;trayTitle()}
    if(typeof o.symbol==='string'){const sy=o.symbol.trim().slice(0,20);save({symbol:sy});if(sy)save({depthSymbol:sy.toLocaleUpperCase('tr-TR')})}
    if(market.TF[o.tf])save({tf:o.tf});
    if(o.market==='BIST'||o.market==='US')save({market:o.market});
    if(typeof o.avKey==='string'){const k=o.avKey.trim();if(k&&!/^[A-Z0-9]{8,24}$/i.test(k))return {...state(),err:'Alpha Vantage anahtarı geçersiz görünüyor.'};save({avKey:k?enc(k):undefined})}
    if(typeof o.alerts==='boolean')save({alerts:o.alerts});
    if(typeof o.liveAi==='boolean'){save({liveAi:o.liveAi});lastSig=null;trayTitle()}
    if(typeof o.pin==='boolean'){save({pin:o.pin});if(o.pin)clearTimeout(fadeTimer)}
    if(o.ind&&typeof o.ind==='object'){const n=ind();for(const k in IND_DEFAULT)if(typeof o.ind[k]==='boolean')n[k]=o.ind[k];save({ind:n});if(lastResult)sendOv('draw',{...lastResult,anim:false,show:n})}
    if(o.candleColors==='auto'||o.candleColors==='green-red')save({candleColors:o.candleColors});
    else if(o.candleColors&&typeof o.candleColors==='object'){const c=o.candleColors;if(!HEX.test(c.up)||!HEX.test(c.down))return {...state(),err:'Renkler #rrggbb biçiminde olmalı.'};
      save({candleColors:{up:c.up.toLowerCase(),down:c.down.toLowerCase(),tol:Math.max(20,Math.min(120,+c.tol||60))}})}
    if(o.candleColors!==undefined)lastSig=null;
    if(typeof o.login==='boolean')app.setLoginItemSettings({openAtLogin:o.login});
    return state();
  });
  ipcMain.handle('clearHistory',()=>save({history:[]}));
  ipcMain.handle('hideOverlay',clearAnalysis);
  ipcMain.handle('draw',(e,on)=>setDrawing(on!==false));
  ipcMain.handle('saveDrawings',(e,list)=>{if(!Array.isArray(list)||!ovKey)return;
    // Bozuk oge (null, a dizisi olmayan) kaydedilirse cfg her okunuşta patlar: yalniz gecerli cizimler
    list=list.filter(okDraw);
    save({drawings:{...(cfg().drawings||{}),[ovKey]:list.slice(0,200)}});syncOverlay();
    // Alarmlar canli takip ister: bekleyen alarm varsa canli modu ac.
    if(pendingAlarms()&&!cfg().live){setLive(true);send('state',state())}});
  ipcMain.handle('copy',(e,t)=>{if(typeof t==='string')clipboard.writeText(t.slice(0,5000))});
  ipcMain.handle('resize',(e,h)=>{if(Number.isFinite(h))pop.setSize(380,Math.max(320,Math.min(680,Math.round(h))))});
  ipcMain.handle('openPerm',()=>shell.openExternal(SETTINGS_URL));
  ipcMain.handle('openBilling',()=>shell.openExternal('https://console.anthropic.com/settings/billing'));
  ipcMain.handle('quit',()=>app.quit());
  market.init(app.getPath('userData'));
  ipcMain.handle('sbConnect',async(e,p)=>{try{
    const r=await sync.signIn({url:p.url,anon:p.anon,email:String(p.email||'').trim(),password:String(p.password||'')});
    save({sb:{url:r.url,anon:enc(String(p.anon).trim()),email:r.user,refresh:enc(sync.tokens().refresh)},sbOn:true});
    return {ok:true,state:state()}}catch(err){return {ok:false,msg:err.message}}});
  ipcMain.handle('sbLogout',()=>{sync.signOut();save({sb:undefined,sbOn:false});return state()});
  ipcMain.handle('sbToggle',(e,on)=>{save({sbOn:!!on});return state()});
  ipcMain.handle('sbFlush',async()=>{await sync.flush();return state()});
  // Kayitli Supabase oturumunu yukle ve bekleyen kuyrugu gonder.
  const sb=cfg().sb;
  sync.init({dir:app.getPath('userData'),onToken:t=>{if(!t)return;const c=cfg().sb;if(c)save({sb:{...c,refresh:enc(t.refresh),email:t.user||c.email}})}});
  if(sb&&sb.url&&sb.anon&&sb.refresh)sync.restore({url:sb.url,anon:dec(sb.anon),refresh:dec(sb.refresh),user:sb.email});
  ipcMain.handle('tgConnect',async(e,p)=>{try{return {ok:true,tg:await tgConnect(p||{})}}catch(err){return {ok:false,msg:ai.errorText(err)}}});
  ipcMain.handle('tgAnswer',(e,v)=>{if(tgAskResolve){const r=tgAskResolve;tgAskResolve=null;v==null?r.rej(new Error('Giriş iptal edildi.')):r.res(String(v))}});
  ipcMain.handle('tgLogout',async()=>{try{await tg.logout()}catch(e){}tgUser=null;save({tg:{...tgCfg(),session:undefined}});
    if((cfg().depthSource||'telegram')==='telegram')setDepthAuto(0);return tgState()});
  ipcMain.handle('tgSet',(e,o)=>{o=o||{};const c=tgCfg(),nb=o.bot!=null?String(o.bot).trim().replace(/^@?/,'@'):c.bot;save({tg:{...c,bot:nb&&nb.length>1?nb:c.bot,cmd:o.cmd!=null?String(o.cmd).slice(0,60):c.cmd,akdCmd:o.akdCmd!=null?String(o.akdCmd).slice(0,60):c.akdCmd,tradeCmd:o.tradeCmd!=null?String(o.tradeCmd).slice(0,60):c.tradeCmd}});return tgState()});
  ipcMain.handle('depth',(e,o)=>{o=o||{};if(!modOn('borsa'))return;
    return fetchDepth({symbol:typeof o.symbol==='string'?o.symbol.slice(0,12):undefined,source:o.source==='ekran'||o.source==='telegram'?o.source:undefined})});
  ipcMain.handle('depthSet',(e,o)=>{o=o||{};
    if(o.source==='telegram'||o.source==='ekran')save({depthSource:o.source});
    if([0,20,30,45,60,120].includes(o.auto))setDepthAuto(modOn('borsa')?o.auto:0);
    if(typeof o.signals==='boolean'){save({signals:o.signals});if(lastResult)sendOv('draw',{...lastResult,anim:false,show:ind()})}
    if(typeof o.overlay==='boolean'){save({depthOverlay:o.overlay});pushDepthOverlay();syncOverlay()}
    return state()});
  ipcMain.handle('tgClick',async(e,o)=>{const {msgId,i,j}=o||{};const why=canSend(false);if(why)return {ok:false,msg:why};sent.push(Date.now());
    try{const r=await tg.click(tgCfg().bot,msgId,i,j);if(r.webapp)openTerminal(r.webapp);return {ok:true,...r}}catch(err){return {ok:false,msg:ai.errorText(err)}}});
  ipcMain.handle('tgMenu',async()=>{if(!tgUser||!tgCfg().bot)return {ok:false,msg:'Önce Telegram\'a bağlan ve bot adını yaz.'};
    const why=canSend(false);if(why)return {ok:false,msg:why};sent.push(Date.now());
    try{const r=await tg.menuApp(tgCfg().bot);openTerminal(r.url);return {ok:true,text:r.text}}catch(err){return {ok:false,msg:ai.errorText(err)}}});
  ipcMain.handle('openUrl',(e,u)=>{if(/^https:\/\//.test(u))openTerminal(u)});
  ipcMain.handle('openExternal',(e,u)=>{if(/^https:\/\/[^\s]+$/.test(String(u)))shell.openExternal(u)});
  // Kayitli Telegram oturumunu sessizce geri yukle.
  const c=tgCfg();
  if(c.session&&c.apiId&&c.apiHash)tg.restore({apiId:c.apiId,apiHash:dec(c.apiHash),session:dec(c.session)}).then(u=>{tgUser=u;send('state',state())}).catch(()=>{});
  if(modOn('borsa')&&cfg().depthAuto)setDepthAuto(cfg().depthAuto);
  if(modOn('borsa')&&cfg().live)setLive(true);
  trayTitle();
});
app.on('will-quit',()=>{globalShortcut.unregisterAll();if(shareSess)shareSess.stop('quit');try{require('./depthimg').close()}catch(e){}});
app.on('window-all-closed',e=>e.preventDefault());
