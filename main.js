const {app,BrowserWindow,Tray,screen,desktopCapturer,ipcMain,globalShortcut,nativeImage,safeStorage,systemPreferences,shell,Menu,Notification,clipboard}=require('electron');
const fs=require('fs'),path=require('path');
const engine=require('./engine');
const ai=require('./ai');

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
const ind=()=>({...IND_DEFAULT,...(cfg().ind||{})});
function addCost(c){
  const u=cfg().usage||{};const m=u.month===month()?u:{month:month(),cost:0,count:0};
  save({usage:{month:m.month,cost:m.cost+c,count:m.count+1,total:(u.total||0)+c}});
}

// --- ekran ---------------------------------------------------------------
const activeDisplay=()=>screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
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
  pop.on('blur',()=>{if(!pop.webContents.isDevToolsOpened())pop.hide()});
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
  if(drawing||hasDraw||lastResult)ov.showInactive();else ov.hide();
}
function drawOverlay(a,d,anim){
  placeOverlay(d);lastResult=a;
  sendOv('draw',{...a,anim,show:ind()});syncOverlay();
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
function calibrate(a){
  const pts=[...((a&&a.resistances)||[]),...((a&&a.supports)||[])].filter(l=>typeof l.price==='number');
  if(pts.length<2)return null;
  const n=pts.length,mx=pts.reduce((s,p)=>s+p.y,0)/n,my=pts.reduce((s,p)=>s+p.price,0)/n;
  let sxy=0,sxx=0;for(const p of pts){sxy+=(p.y-mx)*(p.price-my);sxx+=(p.y-mx)**2}
  if(sxx<1e-6||sxy>=0)return null;
  const k=sxy/sxx;return y=>my+k*(y-mx);
}
const fmtP=v=>v.toLocaleString('tr-TR',{maximumFractionDigits:Math.abs(v)<10?4:2});

// Alarm cizgileri: son fiyat cizgiyi gectiginde bir kez bildirim gonderir.
function checkAlarms(d,py,y){
  const all=cfg().drawings||{},list=all[d.id]||[];let hit=false;
  const cal=calibrate(lastResult&&lastResult.engine==='claude'?lastResult:null),sym=(lastAi&&lastAi.symbol)||'Grafik';
  for(const l of list){
    if(l.t!=='alarm'||l.fired)continue;const ly=l.a[1];
    if((py>ly&&y<=ly)||(py<ly&&y>=ly)){
      l.fired=Date.now();hit=true;
      if(Notification.isSupported())new Notification({title:'🔔 '+sym+' alarmı',body:(y<py?'▲ Fiyat alarm çizgisini yukarı geçti':'▼ Fiyat alarm çizgisini aşağı geçti')+(cal?' ('+fmtP(cal(ly))+')':''),sound:'Glass'}).show();
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
  return{...a,last:local.last,candles:local.candles,ind:local.ind,lines:local.lines,fib:local.fib,rr,
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
    const d=activeDisplay(),shot=await capture(d),sig=signature(shot);
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
      const keep={...prev,last:local.last,lines:local.lines,ind:local.ind};drawOverlay(keep,d,false);checkAlerts(prev,keep);return}
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

function state(){
  const u=cfg().usage||{};
  return{hasKey:!!getKey(),live:!!cfg().live,model:model(),models:ai.MODELS,interval:interval(),intervals:INTERVALS,engine:engineName(),liveAi:!!cfg().liveAi,
    history:cfg().history||[],perm:screenAllowed(),secure:safeStorage.isEncryptionAvailable(),alerts:!!cfg().alerts,pin:!!cfg().pin,ind:ind(),
    login:process.platform==='darwin'&&app.getLoginItemSettings().openAtLogin,alarms:Object.values(cfg().drawings||{}).flat().filter(x=>x.t==='alarm'&&!x.fired).length,
    usage:u.month===month()?u:{cost:0,count:0,total:u.total||0}};
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
  if(cfg().live)setLive(true);
  trayTitle();
});
app.on('will-quit',()=>globalShortcut.unregisterAll());
app.on('window-all-closed',e=>e.preventDefault());
