// Neo: "Hey Neo" sesli asistani. Kulak ve agiz native/neo.swift (neo-yardimcisi): uyandirma kelimesi Mac'te, internetsiz.
// Beyin neo.js (Claude + uygulama araclari). Ekranin ustunde kucuk bir kure: dinliyor / dusunuyor / konusuyor.
const {spawn}=require('child_process'),fs=require('fs');
const {createBrain,createGroqBrain}=require('./neo.js');

const DEF={wake:true,voice:'',rate:0.5,hotkey:'Alt+Space',brain:'groq'};
const BRAINS=['groq','claude'];
const WAKE=['hey neo','hey nio','hey niyo','hey neyo','hey neo','hey nevo','hey new'];
const clean=c=>({wake:c.wake!==false,voice:typeof c.voice==='string'?c.voice.slice(0,200):'',
  rate:Math.max(0.3,Math.min(0.7,+c.rate||DEF.rate)),brain:BRAINS.includes(c.brain)?c.brain:DEF.brain,hotkey:typeof c.hotkey==='string'&&/^[\w+]{1,40}$/.test(c.hotkey)?c.hotkey:DEF.hotkey});

// keys: {get(beyin) -> anahtar|null, set(beyin, anahtar)}; beyin 'groq' (ucretsiz, varsayilan) ya da 'claude' (API anahtari)
function registerNeo({ipcMain,app,BrowserWindow,path,screen,globalShortcut,Notification,shell,cfg,save,keys,actions,isOn=()=>true,brain=null}){
  let child=null,buf='',restarts=0,orb=null,win=null,hello=null,state='off',error=null,warning=null,partial='',answer='',hideT=null,busy=false,sayN=0,gen=0;
  const saying=new Set(),later=[];                    // konusulmakta olan say id'leri; dinlerken gelen hatirlatmalar
  const log=[];                                          // son 30 konusma (pencerede gecmis)
  const conf=()=>clean({...DEF,...(cfg().neo||{})});
  const bin=()=>process.env.CEM_NEO_BIN||(app.isPackaged?path.join(process.resourcesPath,'bin','neo-yardimcisi'):path.join(__dirname,'build','bin','neo-yardimcisi'));
  const send=o=>{if(child&&child.stdin.writable)child.stdin.write(JSON.stringify(o)+'\n')};
  const brains={};
  const B=()=>brain||(brains[conf().brain]=brains[conf().brain]||(conf().brain==='claude'
    ?createBrain({getKey:()=>keys.get('claude'),actions,onTool:n=>show({tool:n})})
    :createGroqBrain({getKey:()=>keys.get('groq'),actions,onTool:n=>show({tool:n})})));
  const view=()=>({supported:process.platform==='darwin'||!!process.env.CEM_NEO_BIN,hello,state,error,warning,conf:conf(),log,hasKey:!!keys.get(conf().brain),keys:{groq:!!keys.get('groq'),claude:!!keys.get('claude')}});
  const toWin=()=>{if(win&&!win.isDestroyed())win.webContents.send('neo:state',view())};
  // Kureye canli bilgi: durum, duyulan metin, cevap, ses duzeyi
  function show(o={}){
    if(!orb||orb.isDestroyed())makeOrb();
    orb.webContents.send('neo:orb',{state,partial,answer,error,...o});
    if(!orb.isVisible()){place();orb.showInactive()}
    clearTimeout(hideT);
    if(state==='idle'||state==='off')hideT=setTimeout(()=>{if(orb&&!orb.isDestroyed())orb.hide()},answer?7000:2500);
  }
  function setState(s){state=s;show();toWin();if((s==='idle'||s==='off')&&later.length&&child)speak(later.shift())}
  const rest=()=>child&&conf().wake?'idle':'off';
  function speak(t){const id='s'+(++sayN);saying.add(id);send({cmd:'say',id,text:t});answer=t;setState('speaking')}

  async function onCommand(text){
    // Onceki soru suruyorsa yeni girdi sessizce kaybolmasin
    if(busy){log.unshift({at:Date.now(),q:text,a:'Önceki soruyu yanıtlıyorum; bitince tekrar sor.',tools:[]});if(log.length>30)log.pop();toWin();return}
    const g=gen;busy=true;partial=text;answer='';send({cmd:'thinking'});setState('thinking');
    let r;try{r=await B().ask(text)}catch(e){r={text:'Bir şeyler ters gitti.'}}
    if(g===gen)busy=false;                               // Neo kapatilip acildiysa yeni turun mesgul bayragina dokunma (disable zaten sifirladi)
    if(g!==gen||!isOn())return;                          // bu arada Neo kapatildi: cevap gosterilmez
    answer=r.text;log.unshift({at:Date.now(),q:text,a:r.text,tools:r.tools||[]});if(log.length>30)log.pop();toWin();
    if(child)speak(r.text);else setState('off');
  }
  function onLine(line){
    let m;try{m=JSON.parse(line)}catch(e){return}
    if(child&&child.t0&&Date.now()-child.t0>30000)restarts=0;   // 30 sn ayakta kalan yardimci saglikli: yeniden baslatma hakki sifirlanir
    switch(m.type){
      case 'hello':warning=null;hello={wakeOnDevice:!!m.wakeOnDevice,cmdOnDevice:!!m.cmdOnDevice,voices:Array.isArray(m.voices)?m.voices.slice(0,40).map(v=>({id:String(v.id||''),name:String(v.name||''),quality:String(v.quality||'')})):[]};
        error=null;configure();if(conf().wake)send({cmd:'start'});toWin();break;
      case 'state':if(!busy&&['off','idle','listening','speaking'].includes(m.state)){if(m.state==='listening'){partial='';answer=''}
        if(m.state==='idle'||m.state==='listening')error=null;    // mikrofon calisiyor: eski hata gecersiz
        if(m.state==='speaking'||!saying.size)setState(m.state)}break;
      case 'wake':partial='';answer='';show({wake:true});break;
      case 'partial':partial=String(m.text||'').slice(0,300);show();break;
      case 'level':if(orb&&!orb.isDestroyed()&&orb.isVisible())orb.webContents.send('neo:level',+m.db||-90);break;
      case 'command':{const t=String(m.text||'').trim();if(t)onCommand(t.slice(0,1000));else if(busy){partial='';show()}else{send({cmd:'idle'});setState(rest())}break}
      // Onceki soru surerken bos dinleme 'dusunuyorum' durumunu bozmasin
      case 'nocommand':if(busy){partial='';show();break}partial='';answer='Seni duyamadım.';send({cmd:'idle'});setState(rest());break;
      // Kuyrukta baska konusma varsa bekleme durumuna gecilmez
      case 'spoken':saying.delete(String(m.id||''));if(m.stopped&&!m.id)saying.clear();if(!saying.size&&!busy){send({cmd:'idle'});setState(rest())}break;
      case 'error':{const msg=String(m.msg||m.code||'').slice(0,200);
        // Ölümcul olmayan uyarilar (internetle tanima, varsayilan ses) hata sayilmaz
        if(m.code==='no_recognizer'||m.code==='tts'){warning=msg;toWin();break}
        error=msg;if(m.code==='mic_denied'||m.code==='speech_denied'){state='off'}show({error});toWin();break}
    }
  }
  const configure=()=>{const c=conf();send({cmd:'config',wake:WAKE,locale:'tr-TR',silenceMs:1200,maxMs:15000,voice:c.voice,rate:c.rate})};
  function start(){
    if(child)return true;if(!isOn())return false;
    if(process.platform!=='darwin'&&!process.env.CEM_NEO_BIN||!fs.existsSync(bin())){error='Neo ses yardımcısı bulunamadı. Uygulamanın Mac sürümünü GitHub\'dan indirdiğinden emin ol.';toWin();return false}
    const c=child=spawn(bin(),[],{stdio:['pipe','pipe','pipe']});c.t0=Date.now();buf='';
    c.stdout.setEncoding('utf8');c.stdin.on('error',()=>{});
    c.stdout.on('data',d=>{if(child!==c)return;buf+=d;let i;while((i=buf.indexOf('\n'))>=0){onLine(buf.slice(0,i));buf=buf.slice(i+1)}if(buf.length>1e6)buf=''});
    c.stderr.on('data',d=>console.error('neo-yardimcisi:',String(d).trim()));
    c.on('exit',(code,sig)=>{if(child!==c)return;child=null;saying.clear();
      if(orb&&!orb.isDestroyed()&&orb.isVisible())setState('off');else state='off';   // kure 'konusuyorum'da takili kalmasin
      if((code||sig)&&isOn()&&restarts<3){restarts++;setTimeout(start,2000*restarts)}
      else if(code||sig){error='Neo ses yardımcısı durdu ('+(sig||code)+').'}toWin()});
    c.on('error',e=>{if(child===c)child=null;error='Neo başlatılamadı: '+e.message;toWin()});
    return true;
  }
  function stop(now=false){if(!child)return;const c=child;child=null;state='off';try{c.stdin.end(JSON.stringify({cmd:'quit'})+'\n')}catch(e){}
    if(now)try{c.kill('SIGTERM')}catch(e){}           // uygulama kapanirken: zamanlayici calismayabilir, hemen SIGTERM (yardimci duzgun kapanir)
    setTimeout(()=>{if(c.exitCode===null&&c.signalCode===null)try{c.kill('SIGKILL')}catch(e){}},1500)}
  // Kisayol ya da kureye tiklama: uyandirma kelimesi beklemeden dinle; konusurken basilirsa sustur
  function talk(){
    if(!isOn())return;if(!child&&!start())return show({error});
    if(state==='speaking'){send({cmd:'stopSay'});return}
    if(state==='listening'){send({cmd:'cancel'});return}
    partial='';answer='';send({cmd:'listen'});
  }
  // Yazili soru (pencereden): ses olmadan da calisir
  async function typed(text){text=String(text||'').trim().slice(0,1000);if(!text)return view();await onCommand(text);return view()}

  function makeOrb(){
    orb=new BrowserWindow({width:420,height:150,show:false,frame:false,transparent:true,resizable:false,movable:false,focusable:false,
      skipTaskbar:true,hasShadow:false,alwaysOnTop:true,fullscreenable:false,
      webPreferences:{preload:path.join(__dirname,'neo-preload.js'),sandbox:true,backgroundThrottling:false}});
    orb.setAlwaysOnTop(true,'screen-saver');orb.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
    orb.loadFile(path.join(__dirname,'neo.html'),{query:{orb:'1'}});
    orb.webContents.setWindowOpenHandler(()=>({action:'deny'}));orb.webContents.on('will-navigate',e=>e.preventDefault());
    orb.on('closed',()=>{orb=null});
  }
  // Kure: imlecin oldugu ekranin ust ortasi, menu cubugunun hemen alti
  function place(){const d=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,[w]=orb.getSize();
    orb.setPosition(Math.round(d.x+d.width/2-w/2),d.y+8)}
  function open(){
    if(win&&!win.isDestroyed()){win.show();win.focus();return}
    win=new BrowserWindow({width:440,height:620,minWidth:380,minHeight:480,title:'Neo',show:false,
      webPreferences:{preload:path.join(__dirname,'neo-preload.js'),sandbox:true}});
    win.loadFile(path.join(__dirname,'neo.html'));win.once('ready-to-show',()=>{win.show();win.focus()});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
    win.on('closed',()=>{win=null});start();
  }
  let hk=null;
  function rearm(){if(!isOn())return;if(hk){try{globalShortcut.unregister(hk)}catch(e){}hk=null}const k=conf().hotkey;try{if(globalShortcut.register(k,talk))hk=k}catch(e){}}
  function enable(){if(!isOn())return;start();rearm()}
  function disable(){gen++;busy=false;later.length=0;saying.clear();stop();if(hk){try{globalShortcut.unregister(hk)}catch(e){}hk=null}if(orb&&!orb.isDestroyed())orb.close();if(win&&!win.isDestroyed())win.close();for(const k in brains)brains[k].reset()}

  const from=e=>!!((win&&!win.isDestroyed()&&e.sender===win.webContents)||(orb&&!orb.isDestroyed()&&e.sender===orb.webContents));
  ipcMain.handle('neo:state',e=>from(e)?view():null);
  ipcMain.handle('neo:talk',e=>{if(from(e))talk()});
  ipcMain.handle('neo:ask',(e,t)=>from(e)?typed(t):null);
  ipcMain.handle('neo:set',(e,o)=>{if(!from(e)||!o||typeof o!=='object')return null;const before=conf();
    save({neo:clean({...before,...o})});const c=conf();configure();
    if(c.wake!==before.wake)send({cmd:c.wake?'start':'stop'});
    if(c.hotkey!==before.hotkey&&isOn()){if(hk){try{globalShortcut.unregister(hk)}catch(e){}hk=null}try{if(globalShortcut.register(c.hotkey,talk))hk=c.hotkey}catch(e){}}
    toWin();return view()});
  ipcMain.handle('neo:forget',e=>{if(!from(e))return null;for(const k in brains)brains[k].reset();log.length=0;return view()});
  // Anahtar sifreli saklanir. Bos metin yok sayilir (yanlislikla "Kaydet" silmesin); yalniz acik null ("Sil" dugmesi) siler
  ipcMain.handle('neo:key',(e,p,k)=>{if(!from(e)||!BRAINS.includes(p))return null;
    if(k===null){keys.set(p,null);delete brains[p];return view()}
    k=typeof k==='string'?k.trim():'';if(!k)return view();
    if((p==='groq'?!/^gsk_[A-Za-z0-9]{20,100}$/.test(k):!/^sk-ant-[\w-]{20,200}$/.test(k)))return {...view(),keyError:p==='groq'?'Groq anahtarı "gsk_" ile başlar.':'Claude anahtarı "sk-ant-" ile başlar.'};
    keys.set(p,k);delete brains[p];return view()});
  ipcMain.handle('neo:link',e=>{if(from(e))shell.openExternal('https://console.groq.com/keys')});
  app.whenReady().then(()=>{if(isOn())enable()});
  app.on('will-quit',()=>stop(true));
  // Disaridan (zamanlayici) sesli bildirim
  // Disaridan (zamanlayici) sesli bildirim; kullanici o an konusuyorsa komutu bolunmesin diye sonraya birakilir
  const say=t=>{if(!isOn())return;t=String(t).slice(0,500);if(!child&&!start())return;if(state==='listening'||busy||state==='thinking'){later.push(t);return}speak(t)};
  return {enable,disable,open,talk,stop,view,rearm,say,status:()=>error?'Sorun var':state==='idle'?'"Hey Neo" dinliyor':state==='off'?null:'Çalışıyor'};
}
module.exports={registerNeo,clean,WAKE};
