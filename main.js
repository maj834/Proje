const {app,BrowserWindow,Tray,screen,desktopCapturer,ipcMain,globalShortcut,nativeImage,safeStorage,systemPreferences,shell,Menu}=require('electron');
const Anthropic=require('@anthropic-ai/sdk');
const fs=require('fs'),path=require('path');

const MODELS=[
  {id:'claude-sonnet-5-5',name:'Sonnet 5.5',note:'Dengeli (önerilen)'},
  {id:'claude-opus-5-5',name:'Opus 5.5',note:'En isabetli, daha yavaş'},
  {id:'claude-haiku-5-5',name:'Haiku 5.5',note:'En hızlı ve ucuz'}
];
const INTERVALS=[15,30,60,120];
const HISTORY_MAX=20;
const SETTINGS_URL='x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

let tray,pop,ov,timer=null,busy=false,ovTimer,lastSig=null;

// --- ayarlar -------------------------------------------------------------
const F=()=>path.join(app.getPath('userData'),'cfg.json');
const cfg=()=>{try{return JSON.parse(fs.readFileSync(F()))}catch(e){return{}}};
const save=o=>{const c={...cfg(),...o};for(const k in c)if(c[k]===undefined)delete c[k];fs.writeFileSync(F(),JSON.stringify(c),{mode:0o600})};

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
const model=()=>MODELS.some(m=>m.id===cfg().model)?cfg().model:MODELS[0].id;
const interval=()=>INTERVALS.includes(cfg().interval)?cfg().interval:30;

// --- model istegi --------------------------------------------------------
const SYS='Sen deneyimli bir teknik analiz uzmanisin. Ekran goruntusunde herhangi bir programdaki (TradingView, broker, Matriks, tarayici vb.) fiyat grafigini bul ve oku. '+
  'y degeri cizginin ekran goruntusunun ustunden itibaren dikey konumudur (0 ust, 1 alt). Fiyat eksenini oku; fiyati okuyamayip tahmin ettiysen price null birak. '+
  'En fazla 3 destek ve 3 direnc ver. confidence 0-100 arasi bir tam sayidir. comment Turkce, kisa, net ve gerekceli olsun. Ekranda grafik yoksa chart_found false dondur.';
const LEVEL={type:'object',properties:{price:{type:['number','null']},y:{type:'number'}},required:['price','y'],additionalProperties:false};
const SCHEMA={type:'object',additionalProperties:false,
  required:['chart_found','symbol','timeframe','bias','confidence','trend','resistances','supports','breakout','patterns','comment'],
  properties:{
    chart_found:{type:'boolean'},symbol:{type:['string','null']},timeframe:{type:['string','null']},
    bias:{type:'string',enum:['yukselis','dusus','notr']},confidence:{type:'integer'},trend:{type:'string'},
    resistances:{type:'array',items:LEVEL},supports:{type:'array',items:LEVEL},
    breakout:{type:['string','null']},patterns:{type:'array',items:{type:'string'}},comment:{type:'string'}
  }};

async function ask(key,img){
  const m=model();
  const req={model:m,max_tokens:16000,system:SYS,output_config:{effort:'medium',format:{type:'json_schema',schema:SCHEMA}},
    messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:img}},{type:'text',text:'Ekrandaki grafiği analiz et.'}]}]};
  const client=new Anthropic({apiKey:key,maxRetries:2});
  // Sonnet/Opus: guvenlik filtresi reddederse sunucu tarafinda yedek modele gec.
  const r=m.startsWith('claude-haiku')?await client.messages.create(req)
    :await client.beta.messages.create({...req,betas:['server-side-fallback-2026-07-01'],fallbacks:'default'});
  if(r.stop_reason==='refusal')throw new Error('Model bu isteği yanıtlamadı. Tekrar dene.');
  if(r.stop_reason==='max_tokens')throw new Error('Yanıt yarıda kesildi. Tekrar dene.');
  const t=r.content.filter(c=>c.type==='text').map(c=>c.text).join('');
  return JSON.parse(t);
}

function apiError(e){
  if(e instanceof Anthropic.AuthenticationError)return 'API anahtarı geçersiz. Ayarlar sekmesinden kontrol et.';
  if(e instanceof Anthropic.PermissionDeniedError)return 'Bu anahtarın seçili modele erişimi yok.';
  if(e instanceof Anthropic.RateLimitError)return 'İstek sınırı aşıldı, biraz bekleyip tekrar dene.';
  if(e instanceof Anthropic.APIConnectionError)return 'Bağlantı kurulamadı. İnternet bağlantını kontrol et.';
  if(e instanceof Anthropic.APIError)return 'API hatası ('+(e.status||'?')+'): '+e.message;
  if(e instanceof SyntaxError)return 'Model yanıtı okunamadı. Tekrar dene.';
  return String(e.message||e);
}

// --- ekran ---------------------------------------------------------------
const activeDisplay=()=>screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
const screenAllowed=()=>process.platform!=='darwin'||systemPreferences.getMediaAccessStatus('screen')==='granted';

async function capture(d){
  const w=1600,h=Math.round(w*d.size.height/d.size.width);
  const srcs=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:w,height:h}});
  const src=srcs.find(s=>s.display_id===String(d.id))||srcs[0];
  if(!src||src.thumbnail.isEmpty())throw new Error('Ekran görüntüsü alınamadı.');
  return src.thumbnail;
}
// Kucuk gri tonlu imza: canli modda ekran degismediyse istegi atla.
function signature(img){
  const b=img.resize({width:48,height:27}).toBitmap(),s=new Uint8Array(b.length/4);
  for(let i=0;i<s.length;i++)s[i]=(b[i*4]+b[i*4+1]+b[i*4+2])/3;
  return s;
}
function changed(a,b){
  if(!a||!b||a.length!==b.length)return true;
  let n=0;for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>12)n++;
  return n/a.length>0.01;
}

// --- pencereler ----------------------------------------------------------
const send=(ch,d)=>pop&&!pop.isDestroyed()&&pop.webContents.send(ch,d);
function mk(){
  const pre=path.join(__dirname,'preload.js');
  pop=new BrowserWindow({width:380,height:600,show:false,frame:false,resizable:false,skipTaskbar:true,alwaysOnTop:true,transparent:true,
    vibrancy:'popover',visualEffectState:'active',roundedCorners:true,webPreferences:{preload:pre,sandbox:true}});
  pop.setContentProtection(true);pop.loadFile(path.join(__dirname,'popup.html'));
  pop.on('blur',()=>{if(!pop.webContents.isDevToolsOpened())pop.hide()});
  ov=new BrowserWindow({transparent:true,frame:false,focusable:false,hasShadow:false,skipTaskbar:true,show:false,enableLargerThanScreen:true,
    webPreferences:{preload:pre,sandbox:true}});
  ov.setAlwaysOnTop(true,'screen-saver');ov.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
  ov.setIgnoreMouseEvents(true);ov.setContentProtection(true);ov.loadFile(path.join(__dirname,'overlay.html'));
  for(const w of [pop,ov])w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
}
function showPop(){
  const t=tray.getBounds(),d=screen.getDisplayNearestPoint({x:t.x,y:t.y}).workArea,[w]=pop.getSize();
  const x=Math.min(Math.max(Math.round(t.x+t.width/2-w/2),d.x+8),d.x+d.width-w-8);
  pop.setPosition(x,Math.round(t.y+t.height+4));pop.show();
}
const toggle=()=>pop.isVisible()?pop.hide():showPop();

function hideOverlay(){clearTimeout(ovTimer);if(ov.isVisible())ov.hide()}
function drawOverlay(a,d){
  ov.setBounds(d.bounds);ov.webContents.send('draw',a);ov.showInactive();
  clearTimeout(ovTimer);ovTimer=setTimeout(()=>ov.hide(),Math.max(25,interval()+10)*1000);
}

function trayIcon(){
  // "Template" adli ikon: macOS acik/koyu menu cubugunda rengi kendisi ayarlar (@2x Retina icin otomatik yuklenir).
  const img=nativeImage.createFromPath(path.join(__dirname,'assets','trayTemplate.png'));
  img.setTemplateImage(true);return img;
}

// --- analiz --------------------------------------------------------------
async function analyze(opts={}){
  if(busy)return;
  const key=getKey();
  if(!key){send('err',{msg:'Önce Ayarlar sekmesinden API anahtarını gir.',settings:true});return opts.silent||showPop()}
  if(!screenAllowed()){
    try{await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1,height:1}})}catch(e){} // izin istemini tetikler
    send('err',{msg:'Ekran Kaydı izni gerekli. Sistem Ayarları › Gizlilik ve Güvenlik › Ekran Kaydı bölümünden Grafik Okuyucu\'yu aç, sonra uygulamayı yeniden başlat.',perm:true});
    return opts.silent||showPop();
  }
  busy=true;
  try{
    const d=activeDisplay(),shot=await capture(d),sig=signature(shot);
    if(opts.silent&&!changed(sig,lastSig)){send('skip',Date.now());return}
    send('busy',1);
    const a=await ask(key,shot.toJPEG(80).toString('base64'));
    lastSig=sig;
    a.confidence=Math.max(0,Math.min(100,Math.round(a.confidence||0)));
    const entry={...a,at:Date.now(),model:model()};
    if(a.chart_found){save({history:[entry,...(cfg().history||[])].slice(0,HISTORY_MAX)});drawOverlay(a,d)}else hideOverlay();
    send('result',entry);
  }catch(e){send('err',{msg:apiError(e)})}
  finally{busy=false}
}

function setLive(on){
  save({live:on});clearInterval(timer);timer=null;lastSig=null;
  if(on)timer=setInterval(()=>analyze({silent:true}),interval()*1000);
  tray&&tray.setTitle(on?' Canlı':'');
}

app.whenReady().then(()=>{
  app.dock&&app.dock.hide();mk();
  tray=new Tray(trayIcon());tray.setToolTip('Grafik Okuyucu (⌘⇧A)');
  tray.on('click',toggle);
  tray.on('right-click',()=>tray.popUpContextMenu(Menu.buildFromTemplate([
    {label:'Ekranı Analiz Et',accelerator:'CommandOrControl+Shift+A',click:()=>analyze()},
    {label:'Çizgileri Gizle',click:hideOverlay},{type:'separator'},
    {label:'Çıkış',role:'quit'}])));
  if(!globalShortcut.register('CommandOrControl+Shift+A',()=>analyze()))console.warn('Kısayol başka bir uygulama tarafından kullanılıyor.');
  ipcMain.handle('analyze',()=>analyze());
  ipcMain.handle('key',(e,k)=>{setKey(typeof k==='string'?k.trim():'');return !!getKey()});
  ipcMain.handle('cfg',()=>({hasKey:!!getKey(),live:!!cfg().live,model:model(),models:MODELS,interval:interval(),intervals:INTERVALS,
    history:cfg().history||[],perm:screenAllowed(),secure:safeStorage.isEncryptionAvailable()}));
  ipcMain.handle('live',(e,on)=>setLive(!!on));
  ipcMain.handle('model',(e,m)=>{if(MODELS.some(x=>x.id===m))save({model:m})});
  ipcMain.handle('interval',(e,s)=>{if(INTERVALS.includes(s)){save({interval:s});if(cfg().live)setLive(true)}});
  ipcMain.handle('clearHistory',()=>save({history:[]}));
  ipcMain.handle('hideOverlay',hideOverlay);
  ipcMain.handle('openPerm',()=>shell.openExternal(SETTINGS_URL));
  ipcMain.handle('quit',()=>app.quit());
  if(cfg().live)setLive(true);
});
app.on('will-quit',()=>globalShortcut.unregisterAll());
app.on('window-all-closed',e=>e.preventDefault());
