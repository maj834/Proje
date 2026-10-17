const {app,BrowserWindow,Tray,screen,desktopCapturer,ipcMain,globalShortcut,nativeImage,safeStorage,systemPreferences,shell,Menu,Notification,clipboard}=require('electron');
const fs=require('fs'),path=require('path');
const engine=require('./engine');
const ai=require('./ai');
const depthLib=require('./depth');
const tg=require('./tg');

const INTERVALS=[2,5,10,30,60];
const HISTORY_MAX=30;
const SETTINGS_URL='x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
const SHOT_W=1568; // Claude'un yeniden boyutlandirmadan kabul ettigi genislik

let tray,pop,ov,timer=null,busy=false,fadeTimer,lastSig=null,ovDisplay=null,drawing=false,lastResult=null,lastAi=null,lastLocal=null;
const alerted=new Map();

// --- ayarlar -------------------------------------------------------------
const F=()=>path.join(app.getPath('userData'),'cfg.json');
let C=null;
const cfg=()=>{if(!C){try{C=JSON.parse(fs.readFileSync(F()))}catch(e){C={}}}return C};
const save=o=>{const c={...cfg(),...o};for(const k in c)if(c[k]===undefined)delete c[k];C=c;fs.writeFileSync(F(),JSON.stringify(c),{mode:0o600})};

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
const engineName=()=>cfg().engine==='claude'&&getKey()?'claude':'yerel';
// Canli mod, kullanici ayarlardan acikca izin vermedikce ucretsiz yerel motoru kullanir.
const liveEngine=()=>cfg().liveAi&&getKey()?'claude':'yerel';
const month=()=>new Date().toISOString().slice(0,7);
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
  if(ovDisplay===d.id)return;
  ovDisplay=d.id;ov.setBounds(d.bounds);
  sendOv('drawings',(cfg().drawings||{})[d.id]||[]);
  syncOverlay();
}
function syncOverlay(){
  const hasDraw=((cfg().drawings||{})[ovDisplay]||[]).length>0;
  if(drawing||hasDraw||lastResult||(lastDepth&&cfg().depthOverlay!==false))ov.showInactive();else ov.hide();
}
function drawOverlay(a,d,anim){
  placeOverlay(d);lastResult=a;
  sendOv('draw',{...a,anim,show:ind(),live:liveSignal()});syncOverlay();
  if(lastDepth&&a.engine==='claude')pushDepthOverlay();
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
    termWin.webContents.setWindowOpenHandler(({url})=>{shell.openExternal(url);return {action:'deny'}});
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

// Alarm cizgileri: son fiyat cizgiyi gectiginde bir kez bildirim gonderir.
function checkAlarms(d,py,y){
  const all=cfg().drawings||{},list=all[d.id]||[];let hit=false;
  const cal=calibrate(lastResult&&lastResult.engine==='claude'?lastResult:null),sym=(lastAi&&lastAi.symbol)||'Grafik';
  for(const l of list){
    if(l.t!=='alarm'||l.fired)continue;const ly=l.a[1];
    if((py>ly&&y<=ly)||(py<ly&&y>=ly)){
      l.fired=Date.now();hit=true;
      if(Notification.isSupported())new Notification({title:sym+' · alarm',body:(y<py?'▲ Fiyat alarm çizgisini yukarı geçti':'▼ Fiyat alarm çizgisini aşağı geçti')+(cal?' ('+fmtP(cal(ly))+')':''),sound:'Glass'}).show();
    }
  }
  if(hit){save({drawings:{...all,[d.id]:list}});if(d.id===ovDisplay)sendOv('drawings',list)}
}
const pendingAlarms=()=>Object.values(cfg().drawings||{}).some(l=>l.some(x=>x.t==='alarm'&&!x.fired));

// Claude sonucuna yerel indikatorleri ekle ve skoru Claude'un yonuyle birlestir.
function merge(a,local){
  if(!local.chart_found)return a;
  const f=[...(local.factors||[])],cv=a.bias==='yukselis'?1:a.bias==='dusus'?-1:0;
  if(cv)f.unshift({v:Math.round(cv*a.confidence/4),t:'Claude: '+(cv>0?'yükseliş':'düşüş')+' (%'+a.confidence+')'});
  let rr=local.rr;
  const R=(a.resistances||[])[0],S=(a.supports||[])[0];
  if(typeof a.last_price==='number'&&R&&S&&R.price!=null&&S.price!=null&&R.price>a.last_price&&S.price<a.last_price)
    rr=+((R.price-a.last_price)/(a.last_price-S.price)).toFixed(2);
  return{...a,last:local.last,candles:local.candles,ind:local.ind,lines:local.lines,fib:local.fib,rr,signals:local.signals,lastCandle:local.lastCandle,
    factors:f,score:Math.max(-100,Math.min(100,f.reduce((s,x)=>s+x.v,0)))};
}

// --- analiz --------------------------------------------------------------
async function analyze(opts={}){
  if(busy)return;
  const eng=opts.engine||(opts.silent?liveEngine():engineName());
  const key=eng==='claude'?getKey():null;
  if(eng==='claude'&&!key){send('err',{msg:'Claude analizi için Ayarlar sekmesinden API anahtarını gir. Anahtarsız da Hızlı (yerel) analiz kullanılabilir.',settings:true});return opts.silent||showPop()}
  if(!screenAllowed()){
    try{await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1,height:1}})}catch(e){} // izin istemini tetikler
    send('err',{msg:'Ekran Kaydı izni gerekli. Sistem Ayarları › Gizlilik ve Güvenlik › Ekran Kaydı bölümünden Grafik Okuyucu\'yu aç, sonra uygulamayı yeniden başlat.',perm:true});
    return opts.silent||showPop();
  }
  busy=true;
  try{
    const d=targetDisplay(opts.silent),shot=await capture(d),sig=signature(shot);
    const change=d.id===ovDisplay?diff(sig,lastSig):1;
    if(opts.silent&&change===0){send('skip',Date.now());return}
    const {width:W,height:H}=shot.getSize();
    const local=engine.analyzeBitmap(shot.toBitmap(),W,H);
    let a=local;
    if(eng==='claude'){
      send('busy',1);
      // Grafik alani bulunduysa yalnizca o bolumu (fiyat ekseniyle) gonder: daha az token, daha net okuma.
      let crop=null,img=shot;
      if(local.chart_found){const b=local.chart_box;
        const x=Math.max(0,b.x1-0.03),y=Math.max(0,b.y1-0.08),x2=Math.min(1,b.x2+0.14),y2=Math.min(1,b.y2+0.08);
        if((x2-x)*(y2-y)<0.85){crop={x,y,w:x2-x,h:y2-y};img=shot.crop({x:Math.round(x*W),y:Math.round(y*H),width:Math.round(crop.w*W),height:Math.round(crop.h*H)})}}
      a=await ai.analyze({key,model:model(),img:img.toJPEG(82).toString('base64'),crop,effort:opts.silent?'low':'medium'});
      addCost(a.cost);
      a=merge(a,local);
      lastAi=a;
    }
    lastSig=sig;
    const prev=lastResult;
    if(local.chart_found){if(lastLocal&&lastLocal.d===d.id)checkAlarms(d,lastLocal.y,local.last.y);lastLocal={d:d.id,y:local.last.y}}
    // Canli yerel takipte son 60 sn icindeki Claude sonucunu (fiyatli seviyeler) koru, yalnizca son fiyat noktasini guncelle.
    if(opts.silent&&eng==='yerel'&&prev&&prev.engine==='claude'&&Date.now()-prev.at<60000&&local.chart_found&&change<0.25){
      const keep={...prev,last:local.last,lines:local.lines,ind:local.ind,signals:local.signals,lastCandle:local.lastCandle};drawOverlay(keep,d,false);checkAlerts(prev,keep);return}
    a.at=Date.now();
    a.confidence=Math.max(0,Math.min(100,Math.round(a.confidence||0)));
    const entry={...a,model:eng==='claude'?model():null};
    if(a.chart_found){
      if(!opts.silent||eng==='claude')save({history:[entry,...(cfg().history||[])].slice(0,HISTORY_MAX)});
      drawOverlay(a,d,!opts.silent);checkAlerts(prev,a);
    }else if(!opts.silent)clearAnalysis();
    send('result',{...entry,silent:!!opts.silent,usage:state().usage});
  }catch(e){send('err',{msg:ai.errorText(e)})}
  finally{busy=false}
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
function istanbulNow(){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Istanbul',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  return {day:p.weekday,min:(+p.hour)*60+(+p.minute)}}
function marketOpen(){const t=istanbulNow();return !['Sat','Sun'].includes(t.day)&&t.min>=9*60+55&&t.min<=18*60+15}
function canSend(auto){
  const now=Date.now();while(sent.length&&now-sent[0]>86400000)sent.shift();
  if(now<floodUntil)return 'Telegram bekletiyor, '+Math.ceil((floodUntil-now)/1000)+' sn sonra devam edilecek';
  if(auto&&!marketOpen())return 'Seans dışı: otomatik yenileme duraklatıldı';
  const lastHour=sent.filter(t=>now-t<3600000).length;
  if(auto&&lastHour>=SAFE.hourCap)return 'Saatlik güvenli sınıra ulaşıldı ('+SAFE.hourCap+')';
  if(sent.length>=SAFE.dayCap)return 'Günlük güvenli sınıra ulaşıldı ('+SAFE.dayCap+')';
  if(sent.length&&now-sent[sent.length-1]<(auto?SAFE.minSec:5)*1000)return 'Çok sık istek: biraz bekle';
  return null;
}
const safeInfo=()=>{const now=Date.now();return {hour:sent.filter(t=>now-t<3600000).length,day:sent.length,hourCap:SAFE.hourCap,dayCap:SAFE.dayCap,market:marketOpen(),flood:Math.max(0,Math.ceil((floodUntil-now)/1000))}};

function tgAsk(step,hint){
  send('tgAsk',{step,hint:hint||null});showPop();
  return new Promise((res,rej)=>{tgAskResolve={res,rej}});
}
async function tgConnect(p){
  const c=tgCfg();
  const apiId=String(p.apiId||c.apiId||'').trim(),apiHash=String(p.apiHash||dec(c.apiHash)||'').trim();
  if(!/^\d+$/.test(apiId)||!/^[0-9a-f]{32}$/i.test(apiHash))throw new Error('api_id sayı, api_hash 32 karakterlik bir kod olmalı (my.telegram.org).');
  const bot=String(p.bot||c.bot||'').trim().replace(/^@?/,'@');
  save({tg:{...c,apiId,apiHash:enc(apiHash),bot:bot.length>1?bot:c.bot,cmd:p.cmd||c.cmd||'{KOD}'}});
  tgUser=await tg.connect({apiId,apiHash,session:dec(tgCfg().session),
    ask:(step,hint)=>step==='phone'&&p.phone?Promise.resolve(String(p.phone)):tgAsk(step,hint),
    onSession:ss=>save({tg:{...tgCfg(),session:enc(ss)}})});
  return tgState();
}
const tgState=()=>({connected:!!tgUser,user:tgUser,bot:tgCfg().bot||null,cmd:tgCfg().cmd||'{KOD}',apiId:tgCfg().apiId||'',hasHash:!!tgCfg().apiHash});

// Grafikteki sembol: son Claude analizinden, yoksa son derinlikten.
const currentSymbol=()=>(lastAi&&lastAi.symbol)||(lastDepth&&lastDepth.symbol)||cfg().depthSymbol||'';

async function fetchDepth(opts={}){
  if(depthBusy)return;depthBusy=true;
  const symbol=String(opts.symbol||currentSymbol()||'').toUpperCase().replace(/[^A-ZÇĞİÖŞÜ0-9]/g,'');
  const source=opts.source||cfg().depthSource||'telegram';
  try{
    if(!symbol)throw new Error('Hisse kodu yaz (ör. PRZMA) ya da önce grafiği Claude ile analiz et.');
    save({depthSymbol:symbol,depthSource:source});
    send('depthBusy',{symbol,source});
    let d=null,messages=[];
    if(source==='telegram'){
      if(!tgUser)throw new Error('Telegram bağlı değil. Ayarlar › Telegram derinlik botu bölümünden bağlan.');
      if(!tgCfg().bot)throw new Error('Botun kullanıcı adını Ayarlar\'a yaz (ör. @derinlikbot).');
      const why=canSend(!!opts.auto);
      if(why){send('depthWait',{msg:why,safe:safeInfo()});return}
      sent.push(Date.now());
      try{messages=await tg.query(tgCfg().bot,(tgCfg().cmd||'{KOD}').replace(/\{KOD\}/g,symbol))}
      catch(err){const w=tg.floodSeconds(err);if(w){floodUntil=Date.now()+(w+15)*1000;send('depthWait',{msg:'Telegram '+w+' sn beklememizi istedi; otomatik duraklatıldı.',safe:safeInfo()});return}throw err}
      d=depthLib.parseText(messages.map(m=>m.text).join('\n'),{symbol});
      // Bot veriyi resim olarak gonderdiyse ve anahtar varsa Claude ile oku.
      const photo=messages.find(m=>m.photo);
      if(!depthLib.hasData(d)&&photo&&getKey()){
        const r=await ai.analyzeDepth({key:getKey(),model:model(),img:photo.photo.split(',')[1]});addCost(r.cost);if(r.found)d={...r,symbol:r.symbol||symbol}}
    }else{
      if(!getKey())throw new Error('Ekrandan derinlik okumak için Claude API anahtarı gerekli.');
      const disp=activeDisplay(),shot=await capture(disp);
      const r=await ai.analyzeDepth({key:getKey(),model:model(),img:shot.toJPEG(85).toString('base64')});addCost(r.cost);
      if(!r.found)throw new Error('Ekranda derinlik tablosu bulunamadı. Derinlik terminalini açık tut.');
      d={...r,symbol:r.symbol||symbol};
    }
    const pr=depthLib.pressure(d);
    if(pr){const h=depthHist[symbol]=(depthHist[symbol]||[]);h.push({t:Date.now(),p:pr.score});if(h.length>120)h.shift()}
    // Kurum akisi: alicilarin net toplami - saticilarin; artiyorsa kurumlar topluyor.
    const flow=(d.buyers||[]).reduce((s,x)=>s+(x.net||0),0)-(d.sellers||[]).reduce((s,x)=>s+(x.net||0),0);
    if(d.buyers.length||d.sellers.length){const f=flowHist[symbol]=(flowHist[symbol]||[]);f.push({t:Date.now(),v:flow});if(f.length>120)f.shift()}
    const fh=flowHist[symbol]||[],fd=fh.length>1?fh[fh.length-1].v-fh[0].v:0;
    lastDepth={...d,symbol,at:Date.now(),source,walls:depthLib.walls(d),pressure:pr,trend:depthLib.trend(depthHist[symbol]||[]),history:(depthHist[symbol]||[]).slice(-40),
      flow:{net:flow,change:fd,top:(d.buyers[0]||null)},safe:safeInfo()};
    lastDepth.signal=liveSignal();
    send('depth',{...lastDepth,messages:messages.map(m=>({...m,photo:m.photo?m.photo.slice(0,200000):null})),usage:state().usage});
    pushDepthOverlay();
  }catch(e){send('depthErr',{msg:ai.errorText(e)})}
  finally{depthBusy=false}
}
// Derinligi grafigin uzerine: fiyat olcegi varsa seviyelere, yoksa kose kartina.
function pushDepthOverlay(){
  if(!lastDepth||!cfg().depthOverlay&&cfg().depthOverlay!==undefined)return sendOv('depth',null);
  const cal=lastResult&&lastResult.engine==='claude'&&(!lastResult.symbol||!lastDepth.symbol||lastResult.symbol.replace(/\W/g,'').includes(lastDepth.symbol))?calibParams(lastResult):null;
  sendOv('depth',{...lastDepth,cal,box:lastResult&&lastResult.chart_box||null});
  if(!ov.isVisible())ov.showInactive();
}
// Son mum icin canli AL/SAT: grafik skoru + derinlik baskisi + kurum akisi.
function liveSignal(){
  const a=lastResult,d=lastDepth;if(!a||!a.chart_found)return null;
  const why=[];let v=0;
  if(typeof a.score==='number'){v+=a.score/50;if(Math.abs(a.score)>=20)why.push('Teknik skor '+(a.score>0?'+':'')+a.score)}
  if(d&&d.pressure){v+=d.pressure.score/40;if(Math.abs(d.pressure.score)>=15)why.push((d.pressure.score>0?'Alış':'Satış')+' baskısı '+(d.pressure.score>0?'+':'')+d.pressure.score)}
  if(d&&d.trend&&d.trend.dir){v+=d.trend.dir*0.5;why.push(d.trend.text)}
  if(d&&d.flow&&d.flow.top&&d.flow.net){v+=Math.sign(d.flow.net)*0.5;why.push((d.flow.net>0?d.flow.top.name.split(' ')[0]+' topluyor':'Kurumlar satıyor'))}
  const dir=v>=1.6?1:v<=-1.6?-1:0;
  return dir?{dir,strength:Math.min(3,Math.abs(v)),why:why.slice(0,3)}:null;
}
function setDepthAuto(sec){
  save({depthAuto:sec});clearTimeout(depthTimer);depthTimer=null;
  if(sec<=0)return;
  // Sabit aralik yerine rastgele sapmali zamanlayici (her istek %0-35 gecikmeli).
  // Ekrandan okuma her turda Claude kredisi harcar: otomatikte en az 60 sn.
  const loop=()=>{const floor=(cfg().depthSource==='ekran')?60:SAFE.minSec;depthTimer=setTimeout(async()=>{await fetchDepth({auto:true});if(cfg().depthAuto>0)loop()},Math.max(floor,sec)*1000*(1+Math.random()*0.35))};
  loop();
}

function state(){
  const u=cfg().usage||{};
  return{hasKey:!!getKey(),live:!!cfg().live,model:model(),models:ai.MODELS,interval:interval(),intervals:INTERVALS,engine:engineName(),liveAi:!!cfg().liveAi,
    history:cfg().history||[],perm:screenAllowed(),secure:safeStorage.isEncryptionAvailable(),alerts:!!cfg().alerts,pin:!!cfg().pin,ind:ind(),
    login:process.platform==='darwin'&&app.getLoginItemSettings().openAtLogin,alarms:Object.values(cfg().drawings||{}).flat().filter(x=>x.t==='alarm'&&!x.fired).length,
    usage:u.month===month()?u:{cost:0,count:0,total:u.total||0},
    signals:cfg().signals!==false,safe:safeInfo(),tg:tgState(),depthSource:cfg().depthSource||'telegram',depthAuto:cfg().depthAuto||0,depthOverlay:cfg().depthOverlay!==false,symbol:currentSymbol()};
}

app.whenReady().then(()=>{
  app.dock&&app.dock.hide();mk();
  tray=new Tray(trayIcon());tray.setToolTip('Grafik Okuyucu');
  tray.on('click',toggle);
  tray.on('right-click',()=>tray.popUpContextMenu(Menu.buildFromTemplate([
    {label:'Hızlı Analiz (yerel)',click:()=>analyze({engine:'yerel'})},
    {label:'Claude ile Analiz',enabled:!!getKey(),click:()=>analyze({engine:'claude'})},
    {label:'Çizim Modu',accelerator:'CommandOrControl+Shift+D',click:()=>setDrawing(true)},
    {label:'Analiz Çizgilerini Gizle',click:clearAnalysis},{type:'separator'},
    {label:'Canlı Mod',type:'checkbox',accelerator:'CommandOrControl+Shift+L',checked:!!cfg().live,click:m=>{setLive(m.checked);send('state',state())}},{type:'separator'},
    {label:'Çıkış',role:'quit'}])));
  const sc=[['CommandOrControl+Shift+A',()=>analyze()],['CommandOrControl+Shift+D',()=>setDrawing(!drawing)],
    ['CommandOrControl+Shift+L',()=>{setLive(!cfg().live);send('state',state())}]];
  for(const [k,f] of sc)if(!globalShortcut.register(k,f))console.warn(k+' kısayolu başka bir uygulama tarafından kullanılıyor.');
  ipcMain.handle('analyze',(e,eng)=>analyze({engine:eng==='claude'||eng==='yerel'?eng:undefined}));
  ipcMain.handle('key',(e,k)=>{setKey(typeof k==='string'?k.trim():'');trayTitle();return state()});
  ipcMain.handle('cfg',state);
  ipcMain.handle('live',(e,on)=>setLive(!!on));
  ipcMain.handle('set',(e,o)=>{
    if(ai.MODELS.some(x=>x.id===o.model))save({model:o.model});
    if(INTERVALS.includes(o.interval)){save({interval:o.interval});if(cfg().live)setLive(true)}
    if(o.engine==='yerel'||o.engine==='claude'){save({engine:o.engine});lastSig=null;trayTitle()}
    if(typeof o.alerts==='boolean')save({alerts:o.alerts});
    if(typeof o.liveAi==='boolean'){save({liveAi:o.liveAi});lastSig=null;trayTitle()}
    if(typeof o.pin==='boolean'){save({pin:o.pin});if(o.pin)clearTimeout(fadeTimer)}
    if(o.ind&&typeof o.ind==='object'){const n=ind();for(const k in IND_DEFAULT)if(typeof o.ind[k]==='boolean')n[k]=o.ind[k];save({ind:n});if(lastResult)sendOv('draw',{...lastResult,anim:false,show:n})}
    if(typeof o.login==='boolean')app.setLoginItemSettings({openAtLogin:o.login});
    return state();
  });
  ipcMain.handle('clearHistory',()=>save({history:[]}));
  ipcMain.handle('hideOverlay',clearAnalysis);
  ipcMain.handle('draw',(e,on)=>setDrawing(on!==false));
  ipcMain.handle('saveDrawings',(e,list)=>{if(!Array.isArray(list))return;save({drawings:{...(cfg().drawings||{}),[ovDisplay]:list.slice(0,200)}});syncOverlay();
    // Alarmlar canli takip ister: bekleyen alarm varsa canli modu ac.
    if(pendingAlarms()&&!cfg().live){setLive(true);send('state',state())}});
  ipcMain.handle('copy',(e,t)=>{if(typeof t==='string')clipboard.writeText(t.slice(0,5000))});
  ipcMain.handle('resize',(e,h)=>{if(Number.isFinite(h))pop.setSize(380,Math.max(320,Math.min(680,Math.round(h))))});
  ipcMain.handle('openPerm',()=>shell.openExternal(SETTINGS_URL));
  ipcMain.handle('openBilling',()=>shell.openExternal('https://console.anthropic.com/settings/billing'));
  ipcMain.handle('quit',()=>app.quit());
  ipcMain.handle('tgConnect',async(e,p)=>{try{return {ok:true,tg:await tgConnect(p||{})}}catch(err){return {ok:false,msg:ai.errorText(err)}}});
  ipcMain.handle('tgAnswer',(e,v)=>{if(tgAskResolve){const r=tgAskResolve;tgAskResolve=null;v==null?r.rej(new Error('Giriş iptal edildi.')):r.res(String(v))}});
  ipcMain.handle('tgLogout',async()=>{await tg.logout();tgUser=null;save({tg:{...tgCfg(),session:undefined}});return tgState()});
  ipcMain.handle('tgSet',(e,o)=>{const c=tgCfg();save({tg:{...c,bot:o.bot!=null?String(o.bot).trim().replace(/^@?/,'@'):c.bot,cmd:o.cmd!=null?String(o.cmd).slice(0,60):c.cmd}});return tgState()});
  ipcMain.handle('depth',(e,o)=>fetchDepth(o||{}));
  ipcMain.handle('depthSet',(e,o)=>{
    if(o.source==='telegram'||o.source==='ekran')save({depthSource:o.source});
    if([0,20,30,60,120].includes(o.auto))setDepthAuto(o.auto);
    if(typeof o.signals==='boolean'){save({signals:o.signals});if(lastResult)sendOv('draw',{...lastResult,anim:false,show:ind()})}
    if(typeof o.overlay==='boolean'){save({depthOverlay:o.overlay});pushDepthOverlay()}
    return state()});
  ipcMain.handle('tgClick',async(e,{msgId,i,j})=>{
    try{const r=await tg.click(tgCfg().bot,msgId,i,j);if(r.webapp)openTerminal(r.webapp);return {ok:true,...r}}catch(err){return {ok:false,msg:ai.errorText(err)}}});
  ipcMain.handle('openUrl',(e,u)=>{if(/^https:\/\//.test(u))openTerminal(u)});
  // Kayitli Telegram oturumunu sessizce geri yukle.
  const c=tgCfg();
  if(c.session&&c.apiId&&c.apiHash)tg.restore({apiId:c.apiId,apiHash:dec(c.apiHash),session:dec(c.session)}).then(u=>{tgUser=u;send('state',state())}).catch(()=>{});
  if(cfg().depthAuto)setDepthAuto(cfg().depthAuto);
  if(cfg().live)setLive(true);
  trayTitle();
});
app.on('will-quit',()=>globalShortcut.unregisterAll());
app.on('window-all-closed',e=>e.preventDefault());
