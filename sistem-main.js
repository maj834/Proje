// Sistem Durumu: menu cubugunda tek tus. Basinca islemci sicakligi, FPS, CPU/GPU/RAM, fan, pil, ag ve disk paneli acilir.
// Olcumleri native/sistem.swift (sistem-yardimcisi) yapar; root gerekmez. Menu cubugunda secilen degerler yazi olarak durur.
const {spawn}=require('child_process'),fs=require('fs');

// Menu cubugunda gosterilebilecek degerler (sira = gosterim sirasi)
const BAR={
  temp:{name:'İşlemci sıcaklığı',f:s=>s.cpu&&num(s.cpu.temp)!=null?Math.round(s.cpu.temp)+'°':null},
  cpu:{name:'İşlemci kullanımı',f:s=>s.cpu&&num(s.cpu.usage)!=null?'CPU '+Math.round(s.cpu.usage)+'%':null},
  gpu:{name:'Ekran kartı',f:s=>s.gpu&&num(s.gpu.usage)!=null?'GPU '+Math.round(s.gpu.usage)+'%':null},
  ram:{name:'Bellek',f:s=>s.mem&&s.mem.total?'RAM '+Math.round(s.mem.used/s.mem.total*100)+'%':null},
  fps:{name:'FPS',f:s=>s.fps&&num(s.fps.screen)!=null?Math.round(s.fps.screen)+' fps':null},
  net:{name:'İnternet hızı',f:s=>s.net?'↓'+rate(s.net.down):null},
  fan:{name:'Fan',f:s=>Array.isArray(s.fans)&&s.fans.length?Math.round(Math.max(...s.fans))+' rpm':null},
};
const num=v=>typeof v==='number'&&isFinite(v)?v:null;
// Bayt/sn -> kisa yazi (1,2 MB/s); menu cubugu dar oldugu icin en fazla 4 karakter sayi
function rate(b){b=num(b)||0;const u=['B','KB','MB','GB'];let i=0;while(b>=1000&&i<u.length-1){b/=1000;i++}
  return (i&&b<10?b.toLocaleString('tr-TR',{maximumFractionDigits:1}):Math.round(b))+' '+u[i]+'/s'}
const barTitle=(s,items)=>s?(items||[]).filter(k=>BAR[k]).map(k=>BAR[k].f(s)).filter(Boolean).join('  '):'';
const DEF={bar:['temp','cpu'],hot:95};
const clean=c=>({bar:Array.isArray(c.bar)?c.bar.filter(k=>BAR[k]).slice(0,4):DEF.bar,
  hot:Math.max(60,Math.min(110,Math.round(+c.hot||DEF.hot)))});
// Yardimcidan gelen satiri dogrula: yalniz bilinen alanlar, sayilar sinirli (bozuk veri arayuze gitmesin)
function sanitize(m){
  if(!m||m.type!=='stats')return null;const n=(v,lo,hi)=>{v=num(v);return v==null||v<lo||v>hi?null:v};
  const o={t:n(m.t,0,9e15)||Date.now(),thermal:['nominal','fair','serious','critical'].includes(m.thermal)?m.thermal:null};
  const c=m.cpu||{};o.cpu={usage:n(c.usage,0,100),temp:n(c.temp,1,130),tempMax:n(c.tempMax,1,130),
    cores:Array.isArray(c.cores)?c.cores.slice(0,256).map(v=>n(v,0,100)):[]};
  const g=m.gpu||{};o.gpu={usage:n(g.usage,0,100),temp:n(g.temp,1,130)};
  const r=m.mem||{};o.mem={used:n(r.used,0,1e15),total:n(r.total,1,1e15),swap:n(r.swap,0,1e15),
    pressure:['normal','warn','critical'].includes(r.pressure)?r.pressure:null};
  const f=m.fps||{};o.fps={display:n(f.display,1,1000),screen:n(f.screen,0,1000)};
  o.fans=Array.isArray(m.fans)?m.fans.slice(0,8).map(v=>n(v,0,20000)).filter(v=>v!=null):[];
  const b=m.battery;o.battery=b&&typeof b==='object'?{pct:n(b.pct,0,100),charging:!!b.charging,temp:n(b.temp,-20,90),
    cycles:n(b.cycles,0,1e5),watts:n(b.watts,-500,500)}:null;
  const w=m.net||{};o.net={down:n(w.down,0,1e12)||0,up:n(w.up,0,1e12)||0};
  const d=m.disk||{};o.disk={read:n(d.read,0,1e12)||0,write:n(d.write,0,1e12)||0,free:n(d.free,0,1e16)};
  o.power=n(m.power,0,2000);
  return o;
}

function registerSystem({ipcMain,app,BrowserWindow,Tray,nativeImage,screen,path,Notification,cfg,save,isOn=()=>true}){
  let child=null,buf='',restarts=0,tray=null,win=null,hello=null,last=null,error=null,hotAt=0,hidAt=0;
  const hist=[];                                         // son 120 olcum (grafikler)
  const conf=()=>clean({...DEF,...(cfg().system||{})});
  const bin=()=>process.env.CEM_SISTEM_BIN||(app.isPackaged?path.join(process.resourcesPath,'bin','sistem-yardimcisi'):path.join(__dirname,'build','bin','sistem-yardimcisi'));
  const send=o=>{if(child&&child.stdin.writable)child.stdin.write(JSON.stringify(o)+'\n')};
  const open=()=>!!win&&!win.isDestroyed()&&win.isVisible();
  const view=()=>({supported:process.platform==='darwin'||!!process.env.CEM_SISTEM_BIN,hello,last,hist,error,conf:conf(),
    bars:Object.entries(BAR).map(([id,b])=>({id,name:b.name}))});
  const push=()=>{if(open())win.webContents.send('sys:data',{last,hello,hist:hist.slice(-1),error})};
  function title(){if(!tray)return;const t=barTitle(last,conf().bar);tray.setTitle(t||(error?'Sistem ⚠':'Sistem'),{fontType:'monospacedDigit'})}
  // Panel acikken her saniye ve ekran FPS olcumu; kapaliyken 2 sn ve FPS kapali (az islemci)
  function pace(){send({cmd:'interval',ms:open()?1000:2000});send({cmd:'fps',on:open()||conf().bar.includes('fps')})}

  function onLine(line){
    let m;try{m=JSON.parse(line)}catch(e){return}
    if(m.type==='hello'){hello={chip:String(m.chip||'').slice(0,80),model:String(m.model||'').slice(0,40),arch:String(m.arch||'').slice(0,10),
      cores:num(m.cores),memTotal:num(m.memTotal)};restarts=0;error=null}
    else if(m.type==='error'){error=String(m.msg||'').slice(0,200)}
    else{const s=sanitize(m);if(!s)return;last=s;hist.push(s);if(hist.length>120)hist.shift();alarm(s)}
    title();push();
  }
  // Isinma uyarisi: sicaklik esigi ya da macOS "ciddi" isil durum; 10 dk'da en fazla bir bildirim
  function alarm(s){const t=s.cpu.tempMax??s.cpu.temp,hot=t!=null&&t>=conf().hot,crit=s.thermal==='serious'||s.thermal==='critical';
    if((hot||crit)&&Date.now()-hotAt>600000&&Notification&&Notification.isSupported()){hotAt=Date.now();
      new Notification({title:'Mac ısınıyor',body:(t!=null?'İşlemci '+Math.round(t)+'°C. ':'')+(crit?'macOS performansı düşürüyor.':'Ağır işleri azaltmayı düşün.')}).show()}}
  function start(){
    if(child)return true;if(!isOn())return false;
    if(process.platform!=='darwin'&&!process.env.CEM_SISTEM_BIN||!fs.existsSync(bin())){error='Sistem yardımcısı bulunamadı. Uygulamanın Mac sürümünü GitHub\'dan indirdiğinden emin ol.';title();push();return false}
    const c=child=spawn(bin(),[],{stdio:['pipe','pipe','pipe']});buf='';
    c.stdout.setEncoding('utf8');c.stdin.on('error',()=>{});
    c.stdout.on('data',d=>{if(child!==c)return;buf+=d;let i;while((i=buf.indexOf('\n'))>=0){onLine(buf.slice(0,i));buf=buf.slice(i+1)}
      if(buf.length>1e6)buf=''});
    c.stderr.on('data',d=>console.error('sistem-yardimcisi:',String(d).trim()));
    c.on('exit',(code,sig)=>{if(child!==c)return;child=null;
      if((code||sig)&&isOn()&&restarts<3){restarts++;error='Sistem yardımcısı yeniden başlatılıyor…';title();push();setTimeout(start,1500*restarts)}
      else if(code||sig){error='Sistem yardımcısı durdu ('+(sig||code)+').';title();push()}});
    c.on('error',e=>{if(child===c)child=null;error='Sistem yardımcısı başlatılamadı: '+e.message;title();push()});
    pace();send({cmd:'once'});
    return true;
  }
  function stop(){if(!child)return;const c=child;child=null;try{c.stdin.end(JSON.stringify({cmd:'quit'})+'\n')}catch(e){}
    setTimeout(()=>{if(c.exitCode===null&&c.signalCode===null)try{c.kill('SIGKILL')}catch(e){}},1500)}

  function makeWin(){
    win=new BrowserWindow({width:340,height:600,show:false,frame:false,resizable:false,movable:false,fullscreenable:false,skipTaskbar:true,
      alwaysOnTop:true,
      webPreferences:{preload:path.join(__dirname,'sistem-preload.js'),sandbox:true,backgroundThrottling:false}});
    win.loadFile(path.join(__dirname,'sistem.html'));
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
    win.on('blur',()=>{if(!win.webContents.isDevToolsOpened()){hidAt=Date.now();win.hide()}});
    win.on('hide',pace);win.on('show',pace);win.on('closed',()=>{win=null});
  }
  // Paneli menu cubugundaki tusun altina hizala
  function show(){
    if(!isOn())return;start();if(!win)makeWin();
    const t=tray?tray.getBounds():{x:0,y:0,width:0,height:0},d=screen.getDisplayNearestPoint({x:t.x,y:t.y}).workArea,[w]=win.getSize();
    const x=Math.min(Math.max(Math.round(t.x+t.width/2-w/2),d.x+8),d.x+d.width-w-8);
    win.setPosition(x,Math.round(tray?t.y+t.height+4:d.y+8));win.show();win.focus();
  }
  // Panel acikken tusa basmak once blur ile gizler; hemen ardindan gelen tiklama paneli yeniden acmasin
const toggle=()=>open()?win.hide():Date.now()-hidAt<300?null:show();
  function enable(){
    if(tray||!isOn())return;
    tray=new Tray(nativeImage.createEmpty());tray.setToolTip('Sistem durumu');title();
    tray.on('click',toggle);tray.on('right-click',toggle);
    start();
  }
  function disable(){stop();if(win&&!win.isDestroyed())win.close();win=null;if(tray){tray.destroy();tray=null}last=null;hist.length=0}

  const fromWin=e=>!!win&&!win.isDestroyed()&&e.sender===win.webContents;
  ipcMain.handle('sys:state',e=>fromWin(e)?view():null);
  ipcMain.handle('sys:set',(e,o)=>{if(!fromWin(e)||!o||typeof o!=='object')return null;
    save({system:clean({...conf(),...o})});title();pace();return view()});
  ipcMain.handle('sys:hide',e=>{if(fromWin(e))win.hide()});
  app.whenReady().then(()=>{if(isOn())enable()});
  app.on('will-quit',stop);
  return {enable,disable,show,toggle,start,stop,view,status:()=>last?barTitle(last,['temp','cpu'])||null:null};
}
module.exports={registerSystem,sanitize,barTitle,rate,clean,BAR};
