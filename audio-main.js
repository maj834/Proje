// Ses bolumu: native/ses.swift yardimcisini (ses-yardimcisi) calistirir, ayarlari saklar, "Ses" penceresini yonetir.
// Uygulama basina ses %0-200, bas/tiz, genel ses efekti, cikis aygiti ve ana ses. macOS 14.4+ gerekir.
const {spawn}=require('child_process'),fs=require('fs');

// Hazir ses efektleri (genel): kazanc carpani, bas ve tiz (dB)
const PRESETS={
  kapali:{gain:1,bass:0,treble:0},bas:{gain:1,bass:7,treble:0},ekstra_bas:{gain:1.1,bass:11,treble:-1},
  konusma:{gain:1.1,bass:-4,treble:4},tiz:{gain:1,bass:0,treble:6},yukselt:{gain:1.6,bass:2,treble:1},gece:{gain:0.8,bass:-3,treble:0}};
const clampS=s=>({gain:Math.max(0,Math.min(2,+s.gain||0)),bass:Math.max(-12,Math.min(12,+s.bass||0)),treble:Math.max(-12,Math.min(12,+s.treble||0)),mute:!!s.mute});
const neutral=s=>!s.mute&&Math.abs(s.gain-1)<0.005&&Math.abs(s.bass)<0.1&&Math.abs(s.treble)<0.1;

function registerAudio({ipcMain,app,BrowserWindow,path,cfg,save}){
  let child=null,win=null,buf='',state={supported:null,apps:[],devices:[],error:null},icons={};
  const conf=()=>({apps:{},global:{gain:1,bass:0,treble:0,mute:false},preset:'kapali',...(cfg().sound||{})});
  const bin=()=>process.env.GRAFIK_SES_BIN||(app.isPackaged?path.join(process.resourcesPath,'bin','ses-yardimcisi'):path.join(__dirname,'build','bin','ses-yardimcisi'));
  const send=o=>{if(child&&child.stdin.writable)child.stdin.write(JSON.stringify(o)+'\n')};
  const toWin=()=>{if(win&&!win.isDestroyed())win.webContents.send('ses:state',view())};
  const view=()=>{const c=conf();return {...state,global:c.global,preset:c.preset,presets:Object.keys(PRESETS),
    apps:state.apps.map(a=>({...a,icon:icons[a.bundle]||null,...clampS({gain:1,...(c.apps[a.bundle]||{})})}))}};
  const needed=()=>{const c=conf();return !neutral(clampS({gain:1,...c.global}))||Object.values(c.apps).some(s=>!neutral(clampS({gain:1,...s})))};

  async function icon(a){if(icons[a.bundle]||!a.path)return;try{icons[a.bundle]=(await app.getFileIcon(a.path,{size:'normal'})).toDataURL();toWin()}catch(e){}}
  function onLine(line){
    let m;try{m=JSON.parse(line)}catch(e){return}
    if(m.type==='hello'){state.supported=!!m.supported;state.os=m.os;if(!m.supported)state.error='Uygulama başına ses ayarı macOS 14.4 (Sonoma) ve üstünü gerektirir. Bu Mac: '+m.os}
    else if(m.type==='apps'){state.apps=m.apps||[];state.apps.forEach(icon)}
    else if(m.type==='devices')state.devices=m.devices||[];
    else if(m.type==='error')state.error=m.msg;
    else if(m.type==='unsupported')state.error='Bu macOS sürümü uygulama başına ses ayarını desteklemiyor (14.4+ gerekir).';
    toWin();
  }
  function start(){
    if(child)return true;
    if(process.platform!=='darwin'&&!process.env.GRAFIK_SES_BIN||!fs.existsSync(bin())){state.error='Ses yardımcısı bulunamadı. Uygulamanın Mac sürümünü GitHub\'dan indirdiğinden emin ol.';toWin();return false}
    child=spawn(bin(),[],{stdio:['pipe','pipe','pipe']});buf='';state.error=null;
    child.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){onLine(buf.slice(0,i));buf=buf.slice(i+1)}});
    child.stderr.on('data',d=>console.error('ses-yardimcisi:',String(d).trim()));
    child.on('exit',code=>{child=null;if(code&&code!==0){state.error='Ses yardımcısı durdu (kod '+code+').';toWin()}});
    child.on('error',e=>{child=null;state.error='Ses yardımcısı başlatılamadı: '+e.message;toWin()});
    // Kayitli ayarlari uygula
    const c=conf();send({cmd:'global',...clampS({gain:1,...c.global})});
    for(const [bundle,s] of Object.entries(c.apps))send({cmd:'set',bundle,...clampS({gain:1,...s})});
    send({cmd:'list'});
    return true;
  }
  function stop(){if(child){send({cmd:'quit'});const c=child;setTimeout(()=>{try{c.kill()}catch(e){}},1500);child=null}}
  // Pencere kapaninca: ayar yoksa yardimciyi kapat (ses tamamen normale doner); ayar varsa arka planda calismaya devam
  function open(){
    if(win){win.show();win.focus();return}
    win=new BrowserWindow({width:420,height:720,minWidth:380,minHeight:520,title:'Ses',show:false,
      webPreferences:{preload:path.join(__dirname,'ses-preload.js'),sandbox:true}});
    win.loadFile(path.join(__dirname,'ses.html'));win.once('ready-to-show',()=>{win.show();win.focus()});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
    win.on('closed',()=>{win=null;if(!needed())stop()});
    start();
  }
  const setApp=(bundle,s)=>{if(typeof bundle!=='string'||!/^[\w.\-]{1,200}$/.test(bundle))return view();
    const c=conf(),v=clampS({gain:1,...(c.apps[bundle]||{}),...s});const apps={...c.apps};if(neutral(v))delete apps[bundle];else apps[bundle]=v;
    save({sound:{...c,apps}});if(start())send({cmd:'set',bundle,...v});return view()};
  const setGlobal=(s,preset)=>{const c=conf(),v=clampS({...c.global,...s});save({sound:{...c,global:v,preset:preset||'ozel'}});if(start())send({cmd:'global',...v});return view()};

  ipcMain.handle('ses:state',()=>{start();return view()});
  ipcMain.handle('ses:app',(e,bundle,s)=>setApp(bundle,s||{}));
  ipcMain.handle('ses:global',(e,s)=>setGlobal(s||{}));
  ipcMain.handle('ses:preset',(e,name)=>PRESETS[name]?setGlobal({...PRESETS[name],mute:false},name):view());
  ipcMain.handle('ses:reset',()=>{const c=conf();save({sound:{...c,apps:{},global:{gain:1,bass:0,treble:0,mute:false},preset:'kapali'}});send({cmd:'reset'});return view()});
  ipcMain.handle('ses:volume',(e,v)=>{send({cmd:'masterVolume',value:Math.max(0,Math.min(1,+v||0))})});
  ipcMain.handle('ses:mute',(e,on)=>{send({cmd:'masterMute',value:!!on})});
  ipcMain.handle('ses:device',(e,uid)=>{if(typeof uid==='string')send({cmd:'device',uid})});
  // Uygulama acilisinda kayitli bir ayar varsa (or. Spotify %150) hemen uygula
  app.whenReady().then(()=>{if(needed())start()});
  app.on('will-quit',stop);
  return {open,start,stop,view};
}
module.exports={registerAudio,PRESETS,clampS,neutral};
