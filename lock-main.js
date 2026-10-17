// Dosya Kilidi penceresi (ana surec): Touch ID (systemPreferences), Anahtar Zinciri (safeStorage), chflags, Cop Sepeti.
// Pencere hicbir zaman keyfi yol veremez: ac/kaldir/sil yalnizca kayittaki id ile; kilitlenecek yollar yalnizca
// yerel dosya penceresinden ya da surukle-birak ile gelir ve burada/cekirdekte dogrulanir (mutlak, normal dosya,
// sembolik bag degil, ev klasorunde).
const {execFile}=require('child_process');
const lockLib=require('./lock');

function registerLock({ipcMain,dialog,shell,app,BrowserWindow,path,systemPreferences,safeStorage}){
  const mac=process.platform==='darwin',home=app.getPath('home');
  // Kilitli bayragi: Finder silmeden once sorar, rm basarisiz olur. Sahibi Bilgi Al'dan kaldirabilir.
  const chflags=(p,on)=>mac?new Promise((ok,no)=>execFile('/usr/bin/chflags',[on?'uchg':'nouchg',p],e=>e?no(e):ok())):Promise.resolve();
  const canBio=()=>{try{return mac&&!!systemPreferences.canPromptTouchID()}catch(e){return false}};
  const keyOk=()=>{try{return safeStorage.isEncryptionAvailable()}catch(e){return false}};
  const protect=b=>{if(!keyOk())throw new Error('safeStorage yok');return safeStorage.encryptString(b.toString('base64')).toString('base64')};
  const unprotect=s=>Buffer.from(safeStorage.decryptString(Buffer.from(s,'base64')),'base64');
  const biometric=reason=>{if(!canBio())return Promise.reject(new Error('Touch ID yok'));return systemPreferences.promptTouchID(reason)};
  let win=null,q=Promise.resolve();
  const send=e=>{if(win&&!win.isDestroyed())win.webContents.send('kl:evt',e)};
  const vault=lockLib.createVault({dir:path.join(app.getPath('userData'),'kilit'),protect,unprotect,biometric,chflags,home,
    trash:p=>shell.trashItem(p),onEvent:send});
  // Dosya islemleri sirayla
  const run=f=>{const p=q.then(f);q=p.catch(()=>{});return p};

  function open(){
    if(win){win.show();win.focus();return}
    win=new BrowserWindow({width:420,height:640,minWidth:380,minHeight:520,title:'Dosya Kilidi',show:false,
      webPreferences:{preload:path.join(__dirname,'lock-preload.js'),sandbox:true}});
    win.loadFile(path.join(__dirname,'lock.html'));win.once('ready-to-show',()=>{win.show();win.focus()});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',e=>e.preventDefault());
    win.on('closed',()=>{win=null;vault.lock('window')});
  }

  const tilde=p=>p===home?'~':p.startsWith(home+path.sep)?'~'+p.slice(home.length):p;
  const view=e=>({id:e.id,name:e.name,folder:tilde(path.dirname(e.path)),file:path.basename(e.path),size:e.size,lockedAt:e.lockedAt,missing:e.missing,opened:e.opened});
  function state(extra){
    const unlocked=vault.isUnlocked();
    return {ok:true,setup:vault.hasPassword(),unlocked,touchId:canBio()&&keyOk()&&vault.hasBiometric(),canTouchId:canBio(),
      remainingMs:vault.remainingMs(),idleMs:vault.idleMs,files:unlocked?vault.files().map(view):[],mac,...extra};
  }
  // Yalnizca kendi penceremizden gelen istekler; hatalar Turkce mesaj olarak doner
  const h=(ch,f)=>ipcMain.handle(ch,async(e,...a)=>{
    if(!win||e.sender!==win.webContents)return {ok:false,msg:'İzin yok.'};
    try{const r=await f(...a);return r&&r.ok!=null?r:state(r)}catch(err){return {...state(),ok:false,msg:err.message,code:err.code}}
  });
  const str=v=>typeof v==='string'?v:'';
  const need=()=>{if(!vault.isUnlocked())throw Object.assign(new Error('Kasa kilitli.'),{code:'LOCKED'})};
  function ent(id){need();const e=vault.files().find(x=>x.id===str(id));if(!e)throw new Error('Dosya listede yok.');return e}
  const ask=async(o)=>(await dialog.showMessageBox(win||undefined,{type:'warning',defaultId:0,cancelId:1,...o})).response===0;
  const progress=(name,kind)=>(done,total)=>send({type:'progress',name,kind,done,total});

  h('kl:state',()=>state());
  h('kl:setup',async(pw,pw2)=>{
    if(str(pw)!==str(pw2))throw new Error('Şifreler aynı değil.');
    await vault.setup(str(pw));
  });
  h('kl:unlockPw',pw=>vault.unlockWithPassword(str(pw)).then(()=>{}));
  h('kl:unlockBio',async()=>{if(!canBio())throw new Error('Touch ID bu Mac\'te kullanılamıyor; şifreyle aç.');await vault.unlockBiometric()});
  h('kl:lock',()=>{vault.lock('user')});
  h('kl:touch',()=>{vault.touch()});
  h('kl:changePw',async(old,nw,nw2)=>{
    if(str(nw)!==str(nw2))throw new Error('Yeni şifreler aynı değil.');
    if(str(old))await vault.changePassword(str(old),str(nw));
    else if(vault.isUnlocked()&&canBio()){
      try{await biometric('kasa şifresini değiştirmek')}catch(e){throw new Error('Touch ID doğrulanamadı.')}
      await vault.resetPassword(str(nw));
    }else throw new Error('Mevcut şifreyi gir.');
    return {done:'Şifre değiştirildi. Kilitli dosyalar yeniden şifrelenmedi; yeni şifreyle açılır.'};
  });

  // Kilitle: her dosya icin sonuc (ok/msg). .kilitli dosyalar bu kasaya aitse listeye eklenir.
  async function lockPaths(paths){
    need();const results=[];
    for(const p of paths){
      const name=path.basename(p);
      try{
        if(p.toLowerCase().endsWith(lockLib.EXT)){await run(()=>vault.adopt(p));results.push({name,ok:true,msg:'Zaten kilitliydi; listeye eklendi.'});continue}
        const r=await run(()=>vault.lockFile(p,{onProgress:progress(name,'lock'),onVerify:progress(name,'verify')}));
        results.push({name,ok:true,flagged:r.flagged,msg:r.flagged||!mac?'':'Kilitlendi ama macOS "Kilitli" bayrağı konamadı.'});
      }catch(e){results.push({name,ok:false,msg:e.message})}
      send({type:'progress',name,done:1,total:1,end:true});
    }
    return {results};
  }
  h('kl:pick',async()=>{
    need();
    const r=await dialog.showOpenDialog(win,{properties:['openFile','multiSelections'],title:'Kilitlenecek dosyaları seç',buttonLabel:'Kilitle'});
    if(r.canceled||!r.filePaths.length)return {};
    return lockPaths(r.filePaths);
  });
  h('kl:drop',async paths=>{
    need();
    const list=(Array.isArray(paths)?paths:[]).filter(p=>typeof p==='string'&&path.isAbsolute(p)&&p===path.normalize(p)).slice(0,200);
    return lockPaths(list);
  });
  h('kl:open',async id=>{
    const e=ent(id);
    const p=await run(()=>vault.openTemp(e.path,{onProgress:progress(e.name,'open')}));
    const err=await shell.openPath(p);
    if(err)throw new Error('Açılamadı: '+err);
    return {done:`"${e.name}" geçici bir kopyada açıldı. Kopyadaki değişiklikler, "Değişiklikleri kaydet ve yeniden kilitle" demezsen kaydedilmez.`};
  });
  h('kl:save',async id=>{
    const e=ent(id);
    const r=await run(()=>vault.saveTemp(e.path,{onProgress:progress(e.name,'lock')}));
    return {done:`"${e.name}" kaydedildi ve yeniden kilitlendi.`+(r.flagged||!mac?'':' ("Kilitli" bayrağı konamadı.)')};
  });
  h('kl:unlock',async id=>{
    const e=ent(id);
    if(!await ask({message:`"${e.name}" kilidi kaldırılsın mı?`,detail:'Dosya şifresiz hale gelir ve aynı klasöre özgün adıyla geri konur.',buttons:['Kilidi kaldır','Vazgeç']}))return {};
    const r=await run(()=>vault.unlockFile(e.path,{onProgress:progress(e.name,'unlock')}));
    shell.showItemInFolder(r.path);
    return {done:`"${r.name}" kilidi kaldırıldı.`};
  });
  h('kl:trash',async id=>{
    const e=ent(id);
    if(!await ask({message:`"${e.name}" Çöp Sepeti'ne taşınsın mı?`,detail:'Kilitli (şifreli) dosya Çöp Sepeti\'ne gider; oradan geri alınabilir. Çöp boşaltılınca kalıcı olarak silinir.',buttons:['Çöp Sepeti\'ne taşı','Vazgeç']}))return {};
    await run(()=>vault.removeLocked(e.path));
    return {done:`"${e.name}" Çöp Sepeti'ne taşındı.`};
  });
  h('kl:forget',id=>{need();vault.forget(str(id))});
  h('kl:reveal',id=>{const e=ent(id);if(!e.missing)shell.showItemInFolder(e.path)});

  app.on('will-quit',()=>vault.lock('quit'));
  return {open,lock:()=>vault.lock('user'),vault};
}

module.exports={registerLock};
