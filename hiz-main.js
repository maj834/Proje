// Internet Hiz Testi + Wi-Fi QR penceresi. Olcum ana surecte yapilir (hiz.js); pencere yalniz sonucu gosterir.
// Wi-Fi sifresi yalnizca istenince Anahtar Zinciri'nden okunur (macOS kendi onayini sorar); hicbir yere yazilmaz, loglanmaz.
const {execFile}=require('child_process');
const H=require('./hiz');

// Kabuksuz komut: arguman dizisi, zaman asimi, sinirli cikti
const execDefault=(file,args,o={})=>new Promise((ok,no)=>{
  execFile(file,args,{timeout:o.timeout||10000,maxBuffer:1024*1024,encoding:'utf8',env:{...process.env,LANG:'en_US.UTF-8'}},(e,out,err)=>{
    if(e){e.stderr=String(err||'').slice(0,500);return no(e)}ok(out)})});

// fetch/exec/base yalniz testler icin disaridan verilebilir
function registerHiz({ipcMain,app,BrowserWindow,path,cfg,save,isOn=()=>true,fetch,exec,base,testOpts}){
  let win=null,ctl=null,running=null;
  const run=exec||execDefault;
  const conf=()=>({history:[],...(cfg().hiz||{})});
  const history=()=>(Array.isArray(conf().history)?conf().history:[]).slice(-H.HISTORY_MAX);
  const mac=()=>process.platform==='darwin'||!!exec;
  const view=()=>({history:history(),running:!!running,wifi:mac()});
  const fromWin=e=>!!win&&!win.isDestroyed()&&e.sender===win.webContents;
  const toWin=(ch,d)=>{if(win&&!win.isDestroyed())win.webContents.send(ch,d)};
  const cancel=()=>{if(ctl){ctl.abort();ctl=null}};

  function open(){
    if(!isOn())return;
    if(win){if(win.isMinimized())win.restore();win.show();win.focus();return}
    win=new BrowserWindow({width:440,height:760,minWidth:380,minHeight:560,title:'İnternet Hız Testi',show:false,
      webPreferences:{preload:path.join(__dirname,'hiz-preload.js'),sandbox:true}});
    win.loadFile(path.join(__dirname,'hiz.html'));win.once('ready-to-show',()=>{win.show();win.focus()});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
    // Pencere kapaninca test durur; Wi-Fi sifresi yalniz pencerede (renderer) duruyordu, onunla birlikte gider
    win.on('closed',()=>{win=null;cancel()});
  }

  async function start(){
    if(running)return {ok:false,error:'Test zaten sürüyor.'};
    const c=ctl=new AbortController();
    running=H.runTest({fetch,base,...(testOpts||{}),signal:c.signal,onProgress:p=>toWin('hiz:evt',p)});
    try{
      const r=await running;
      const item=H.historyItem(r);save({hiz:{...conf(),history:H.pushHistory(history(),item)}});
      return {ok:true,result:r,history:history()};
    }catch(e){
      return e.code==='CANCELLED'?{ok:false,cancelled:true,error:e.message}:{ok:false,error:e.code==='NET'?e.message:'Test tamamlanamadı: '+e.message};
    }finally{running=null;if(ctl===c)ctl=null}
  }

  async function ssid(){
    if(!mac())return {ok:false,error:'Bu özellik yalnızca Mac\'te çalışır.'};
    const r=await H.currentSsid(run);
    if(r.ssid)return {ok:true,ssid:r.ssid};
    return {ok:false,redacted:r.redacted,error:r.redacted
      ?'macOS ağ adını gizliyor (konum izni gerekir). Ağ adını elle yazabilirsin.'
      :'Wi-Fi ağına bağlı görünmüyorsun. Ağ adını elle yazabilirsin.'};
  }
  async function password(name){
    if(!mac())return {ok:false,error:'Bu özellik yalnızca Mac\'te çalışır.'};
    try{return {ok:true,pass:await H.wifiPassword(run,name)}}catch(e){return {ok:false,code:e.code,error:e.message}}
  }
  async function qr(o){
    if(!o||typeof o!=='object')return {ok:false,error:'Geçersiz istek.'};
    const name=typeof o.ssid==='string'?o.ssid:'',pass=typeof o.pass==='string'?o.pass:'';
    if(!H.validSsid(name))return {ok:false,error:'Ağ adı 1–32 bayt olmalı.'};
    if(!o.open&&(pass.length<8||pass.length>64))return {ok:false,error:'WPA şifresi 8–64 karakter olmalı. Şifresiz ağ ise "Şifresiz ağ"ı seç.'};
    const text=H.wifiString({ssid:name,pass,open:!!o.open,hidden:!!o.hidden});
    const url=await require('qrcode').toDataURL(text,{errorCorrectionLevel:'M',margin:2,width:560,color:{dark:'#000000',light:'#ffffff'}});
    return {ok:true,url};
  }

  ipcMain.handle('hiz:state',e=>fromWin(e)?view():null);
  ipcMain.handle('hiz:start',e=>fromWin(e)?start():null);
  ipcMain.handle('hiz:cancel',e=>{if(fromWin(e))cancel();return null});
  ipcMain.handle('hiz:clear',e=>{if(!fromWin(e))return null;save({hiz:{...conf(),history:[]}});return view()});
  ipcMain.handle('hiz:ssid',e=>fromWin(e)?ssid():null);
  ipcMain.handle('hiz:pass',(e,name)=>fromWin(e)?password(name):null);
  ipcMain.handle('hiz:qr',(e,o)=>fromWin(e)?qr(o).catch(()=>({ok:false,error:'QR oluşturulamadı.'})):null);
  app.on('will-quit',cancel);

  const enable=()=>{};
  function disable(){cancel();if(win&&!win.isDestroyed())win.close();win=null}
  function status(){
    if(running)return 'Test sürüyor…';
    const l=history().at(-1);return l&&l.down!=null?'Son test: ↓ '+H.fmtMbps(l.down)+' Mb/sn':null;
  }
  // Neo (sesli asistan): testi calistir, ozet sonuc dondur (pencere aciksa canli ilerleme orada da gorunur)
  async function runForNeo(){const r=await start();if(!r.ok)return {error:r.error||'Test yapılamadı.'};const x=r.result||{};
    return {download_mbit:x.down??x.download??null,upload_mbit:x.up??x.upload??null,ping_ms:x.ping??x.latency??null,jitter_ms:x.jitter??null,verdict:x.verdict||null,isp:x.isp||(x.meta&&x.meta.isp)||null}}
  return {enable,disable,open,status,run:runForNeo};
}
module.exports={registerHiz};
