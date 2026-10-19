// Neo: "Hey Neo" sesli asistani. Kulak ve agiz native/neo.swift (neo-yardimcisi): uyandirma kelimesi Mac'te, internetsiz.
// Beyin neo.js (Claude + uygulama araclari). Ekranin ustunde kucuk bir kure: dinliyor / dusunuyor / konusuyor.
const {spawn}=require('child_process'),fs=require('fs'),power=require('./power');
const {createBrain,createGroqBrain}=require('./neo.js');

const DEF={wake:true,voice:'',rate:0.5,hotkey:'Alt+Space',brain:'groq',wakeLang:'auto',followUp:true};
const FOLLOW_MS=6000,SILENCE_MS=1700;   // cevaptan sonra uyandirma kelimesiz dinleme; komut sonu sessizligi (cumle ortasinda kesmesin)
const WAKE_LANGS=['auto','en','tr'];
const BRAINS=['groq','claude'];
const WAKE=['hey neo','hey nio','hey niyo','hey neyo','hey neo','hey nevo','hey new','hey nea','hey neu','hay neo'];
const clean=c=>({wake:c.wake!==false,voice:typeof c.voice==='string'?c.voice.slice(0,200):'',
  rate:Math.max(0.3,Math.min(0.7,+c.rate||DEF.rate)),brain:BRAINS.includes(c.brain)?c.brain:DEF.brain,hotkey:typeof c.hotkey==='string'&&/^[\w+]{1,40}$/.test(c.hotkey)?c.hotkey:DEF.hotkey,
  wakeLang:WAKE_LANGS.includes(c.wakeLang)?c.wakeLang:DEF.wakeLang,followUp:c.followUp!==false,batteryWake:c.batteryWake!==false});

// keys: {get(beyin) -> anahtar|null, set(beyin, anahtar)}; beyin 'groq' (ucretsiz, varsayilan) ya da 'claude' (API anahtari)
function registerNeo({ipcMain,app,BrowserWindow,path,screen,globalShortcut,Notification,shell,cfg,save,keys,actions,isOn=()=>true,brain=null}){
  let child=null,buf='',restarts=0,orb=null,win=null,hello=null,state='off',error=null,warning=null,heard='',partial='',answer='',hideT=null,busy=false,sayN=0,gen=0;
  const saying=new Set(),later=[];                    // konusulmakta olan say id'leri; dinlerken gelen hatirlatmalar
  const follows=new Set();                               // bitince yardimcinin takip dinlemesi yapacagi say id'leri
  let followListen=false;                                // su anki dinleme cevaptan sonraki takip mi
  const log=[];                                          // son 30 konusma (pencerede gecmis)
  const conf=()=>clean({...DEF,...(cfg().neo||{})});
  const bin=()=>process.env.CEM_NEO_BIN||(app.isPackaged?path.join(process.resourcesPath,'bin','neo-yardimcisi'):path.join(__dirname,'build','bin','neo-yardimcisi'));
  const send=o=>{if(child&&child.stdin.writable)child.stdin.write(JSON.stringify(o)+'\n')};
  const brains={};
  const B=()=>brain||(brains[conf().brain]=brains[conf().brain]||(conf().brain==='claude'
    ?createBrain({getKey:()=>keys.get('claude'),actions,onTool:n=>show({tool:n})})
    :createGroqBrain({getKey:()=>keys.get('groq'),actions,onTool:n=>show({tool:n})})));
  const view=()=>({heard,supported:process.platform==='darwin'||!!process.env.CEM_NEO_BIN,hello,state,error,warning,conf:conf(),log,hasKey:!!keys.get(conf().brain),keys:{groq:!!keys.get('groq'),claude:!!keys.get('claude')}});
  const toWin=()=>{if(win&&!win.isDestroyed())win.webContents.send('neo:state',view())};
  // Kureye canli bilgi: durum, duyulan metin, cevap, ses duzeyi
  function show(o={}){
    if(!orb||orb.isDestroyed())makeOrb();
    orb.webContents.send('neo:orb',{state,partial,answer,error,followUp:state==='listening'&&followListen,...o});
    if(!orb.isVisible()){place();orb.showInactive()}
    clearTimeout(hideT);
    if(state==='idle'||state==='off')hideT=setTimeout(()=>{if(orb&&!orb.isDestroyed())orb.hide()},answer?7000:2500);
  }
  function setState(s){state=s;show();toWin();if((s==='idle'||s==='off')&&later.length&&child)speak(later.shift())}
  // "Hey Neo" dinlemesi (surekli mikrofon) ne zaman acik: ayar acik, ekran kilitli / Mac uykuda degil ve
  // pildeyken kapatilmamis. Kimse bakmazken mikrofon kapanir (pil + gizlilik); kisayol her zaman calisir.
  const wantWake=()=>{const c=conf(),p=power.state();return c.wake&&!power.away()&&!(p.battery&&!c.batteryWake)};
  let wakeSent=null;
  const syncWake=()=>{if(!child)return;const w=wantWake();if(w===wakeSent)return;wakeSent=w;send({cmd:w?'start':'stop'})};
  const rest=()=>child&&wantWake()?'idle':'off';
  // follow: sesli sorunun cevabi; bitince yardimci birkac saniye "Hey Neo" beklemeden dinler (ayar acikken)
  function speak(t,follow=false){const id='s'+(++sayN);saying.add(id);const fu=follow&&conf().followUp;if(fu)follows.add(id);
    send({cmd:'say',id,text:t,...(fu?{followUp:true}:{})});answer=t;setState('speaking')}

  async function onCommand(text,voice=false){
    // Onceki soru suruyorsa yeni girdi sessizce kaybolmasin
    if(busy){log.unshift({at:Date.now(),q:text,a:'Önceki soruyu yanıtlıyorum; bitince tekrar sor.',tools:[]});if(log.length>30)log.pop();toWin();return}
    const g=gen;busy=true;partial=text;answer='';send({cmd:'thinking'});setState('thinking');
    let r;try{r=await B().ask(text)}catch(e){r={text:'Bir şeyler ters gitti.'}}
    if(g===gen)busy=false;                               // Neo kapatilip acildiysa yeni turun mesgul bayragina dokunma (disable zaten sifirladi)
    if(g!==gen||!isOn())return;                          // bu arada Neo kapatildi: cevap gosterilmez
    answer=r.text;log.unshift({at:Date.now(),q:text,a:r.text,tools:r.tools||[]});if(log.length>30)log.pop();toWin();
    if(child)speak(r.text,voice);else setState('off');
  }
  function onLine(line){
    let m;try{m=JSON.parse(line)}catch(e){return}
    if(child&&child.t0&&Date.now()-child.t0>30000)restarts=0;   // 30 sn ayakta kalan yardimci saglikli: yeniden baslatma hakki sifirlanir
    switch(m.type){
      case 'hello':warning=null;hello={wakeOnDevice:!!m.wakeOnDevice,cmdOnDevice:!!m.cmdOnDevice,wakeLocale:String(m.wakeLocale||'').slice(0,12),voices:Array.isArray(m.voices)?m.voices.slice(0,40).map(v=>({id:String(v.id||''),name:String(v.name||''),quality:String(v.quality||'')})):[]};
        error=null;configure();wakeSent=null;syncWake();toWin();break;
      // Takip dinlemesinde (followUp) onceki cevap kurede kalir: kullanici okuyup cevap verebilsin
      case 'state':if(!busy&&['off','idle','listening','speaking'].includes(m.state)){followListen=m.state==='listening'&&!!m.followUp;if(m.state==='listening'){partial='';if(!followListen)answer=''}
        if(m.state==='idle'||m.state==='listening')error=null;    // mikrofon calisiyor: eski hata gecersiz
        if(m.state==='speaking'||!saying.size)setState(m.state)}break;
      case 'wake':partial='';answer='';heard='';show({wake:true});break;
      // Tani: uyandirma asamasinda tanicinin duydugu metin (eslesmese de); ayar penceresinde gosterilir
      case 'heard':heard=String(m.text||'').slice(0,120);toWin();break;
      case 'partial':partial=String(m.text||'').slice(0,300);show();break;
      case 'level':if(orb&&!orb.isDestroyed()&&orb.isVisible())orb.webContents.send('neo:level',+m.db||-90);break;
      case 'command':{const t=String(m.text||'').trim();if(t)onCommand(t.slice(0,1000),true);else if(busy){partial='';show()}else{send({cmd:'idle'});setState(rest())}break}
      // Onceki soru surerken bos dinleme 'dusunuyorum' durumunu bozmasin
      // Takip penceresinde kimse konusmadi: sessizce beklemeye donulur ("Seni duyamadım" denmez)
      case 'nocommand':if(busy){partial='';show();break}partial='';if(!m.followUp)answer='Seni duyamadım.';send({cmd:'idle'});setState(rest());break;
      // Kuyrukta baska konusma varsa bekleme durumuna gecilmez. Takipli cevap dogal bittiyse yardimci kendisi
      // dinlemeye (ya da beklemeye) gecer ve durumunu bildirir: 'idle' gonderilirse takip dinlemesi kesilirdi
      case 'spoken':{const id=String(m.id||''),fu=follows.has(id)&&!m.stopped;follows.delete(id);saying.delete(id);if(m.stopped&&!m.id){saying.clear();follows.clear()}
        if(!saying.size&&!busy&&!fu){send({cmd:'idle'});setState(rest())}break}
      case 'error':{const msg=String(m.msg||m.code||'').slice(0,200);
        // Ölümcul olmayan uyarilar (internetle tanima, varsayilan ses) hata sayilmaz
        if(m.code==='no_recognizer'||m.code==='tts'){warning=msg;toWin();break}
        error=msg;if(m.code==='mic_denied'||m.code==='speech_denied'){state='off'}show({error});toWin();break}
    }
  }
  const configure=()=>{const c=conf();send({cmd:'config',wake:WAKE,wakeLang:c.wakeLang,locale:'tr-TR',silenceMs:SILENCE_MS,maxMs:15000,followUpMs:c.followUp?FOLLOW_MS:0,voice:c.voice,rate:c.rate})};
  function start(){
    if(child)return true;if(!isOn())return false;
    if(process.platform!=='darwin'&&!process.env.CEM_NEO_BIN||!fs.existsSync(bin())){error='Neo ses yardımcısı bulunamadı. Uygulamanın Mac sürümünü GitHub\'dan indirdiğinden emin ol.';toWin();return false}
    const c=child=spawn(bin(),[],{stdio:['pipe','pipe','pipe']});c.t0=Date.now();buf='';
    c.stdout.setEncoding('utf8');c.stdin.on('error',()=>{});
    c.stdout.on('data',d=>{if(child!==c)return;buf+=d;let i;while((i=buf.indexOf('\n'))>=0){onLine(buf.slice(0,i));buf=buf.slice(i+1)}if(buf.length>1e6)buf=''});
    c.stderr.on('data',d=>console.error('neo-yardimcisi:',String(d).trim()));
    c.on('exit',(code,sig)=>{if(child!==c)return;child=null;saying.clear();follows.clear();
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
  function disable(){gen++;busy=false;later.length=0;saying.clear();follows.clear();stop();if(hk){try{globalShortcut.unregister(hk)}catch(e){}hk=null}if(orb&&!orb.isDestroyed())orb.close();if(win&&!win.isDestroyed())win.close();for(const k in brains)brains[k].reset()}

  const from=e=>!!((win&&!win.isDestroyed()&&e.sender===win.webContents)||(orb&&!orb.isDestroyed()&&e.sender===orb.webContents));
  ipcMain.handle('neo:state',e=>from(e)?view():null);
  ipcMain.handle('neo:talk',e=>{if(from(e))talk()});
  ipcMain.handle('neo:ask',(e,t)=>from(e)?typed(t):null);
  ipcMain.handle('neo:set',(e,o)=>{if(!from(e)||!o||typeof o!=='object')return null;const before=conf();
    // Pano Gecmisi kisayolu (⌘⇧V) alinamaz
    if(typeof o.hotkey==='string'&&/^(commandorcontrol|cmdorctrl|command|cmd)\+shift\+v$|^shift\+(commandorcontrol|cmdorctrl|command|cmd)\+v$/i.test(o.hotkey))o={...o,hotkey:before.hotkey};
    save({neo:clean({...before,...o})});const c=conf();configure();
    syncWake();
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
  app.whenReady().then(()=>{power.init();power.on(()=>{syncWake();toWin()});if(isOn())enable()});
  app.on('will-quit',()=>stop(true));
  // Disaridan (zamanlayici) sesli bildirim
  // Disaridan (zamanlayici) sesli bildirim; kullanici o an konusuyorsa komutu bolunmesin diye sonraya birakilir
  const say=t=>{if(!isOn())return;t=String(t).slice(0,500);if(!child&&!start())return;if(state==='listening'||busy||state==='thinking'){later.push(t);return}speak(t)};
  return {enable,disable,open,talk,stop,view,rearm,say,status:()=>error?'Sorun var':state==='idle'?'"Hey Neo" dinliyor':state==='off'?null:'Çalışıyor'};
}
module.exports={registerNeo,clean,WAKE};
