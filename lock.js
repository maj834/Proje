// Dosya Kilidi cekirdegi: secilen dosyalar yerinde guclu sifrelenir (photo.jpg -> photo.jpg.kilitli).
// Anahtar: rastgele 32 baytlik veri anahtari (DK). Kasada iki kez saklanir: (a) kullanici sifresinden scrypt ile
// turetilen anahtarla AES-256-GCM sarili, (b) disaridan verilen protect() ile (Electron safeStorage -> Anahtar Zinciri),
// Touch ID yolu icin. DK yalnizca acik oturum boyunca bellekte durur; kilitlenince sifirlanir.
// Dosya bicimi (akisli, sabit bellek): "GOKILIT1" | surum(1) | tuz(16) | baslik uzunlugu(4) | iv(12)+baslik+etiket(16)
// | parcalar: uzunluk(4) + sifreli veri + etiket(16). Nonce = nonceBase XOR sayac, AAD = sayac(8) + son-parca bayragi(1).
// Bu modul Electron'a baglanmaz: Touch ID, Anahtar Zinciri, chflags, Cop Sepeti disaridan verilir (testte sahte).
const fs=require('fs'),fsp=fs.promises,path=require('path'),os=require('os'),crypto=require('crypto');

const MAGIC=Buffer.from('GOKILIT1'),VER=1,EXT='.kilitli';
const CHUNK=1024*1024,TAG=16,SALT=16,IVL=12,MAXHDR=64*1024,MAXCHUNK=64*1024*1024;
const PRE=MAGIC.length+1+SALT;               // magic + surum + tuz (baslik AAD'si)
const IDLE=5*60*1000;                        // 5 dk islem yoksa kilitlenir
const RESERVE=64*1024*1024;                  // kilitlerken diskte dosya boyutu + 64 MB bos alan olsun
const MAXFAIL=5,WAIT=30*1000,MINPW=6;
const SCRYPT={N:2**15,r:8,p:1,maxmem:64*1024*1024};

const E=(msg,code)=>Object.assign(new Error(msg),{code});
const bad=()=>E('Kilitli dosya bozuk ya da değiştirilmiş; açılamadı.','TAMPER');
const noop=async()=>{};
const rand=n=>crypto.randomBytes(n).toString('hex');
const exists=p=>{try{fs.lstatSync(p);return true}catch(e){return false}};
const inside=(p,d)=>p===d||p.startsWith(d.endsWith(path.sep)?d:d+path.sep);
const realOr=p=>{try{return fs.realpathSync(p)}catch(e){return path.resolve(p)}};
const freeBytesOf=dir=>{try{const s=fs.statfsSync(dir);return s.bavail*s.bsize}catch(e){return Infinity}};
const human=n=>n>=1024**3?(n/1024**3).toFixed(1)+' GB':n>=1024**2?(n/1024**2).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
const scryptAsync=(pw,salt,o)=>new Promise((ok,no)=>crypto.scrypt(Buffer.from(String(pw).normalize('NFC'),'utf8'),salt,32,o,(e,k)=>e?no(e):ok(k)));

// Dosya basina anahtar: HKDF-SHA256(DK, tuz, "gokilit-file")
const fileKey=(dk,salt)=>Buffer.from(crypto.hkdfSync('sha256',dk,salt,'gokilit-file',32));
function nonce(base,i){const n=Buffer.from(base),c=Buffer.alloc(8);c.writeBigUInt64BE(BigInt(i));for(let k=0;k<8;k++)n[4+k]^=c[k];return n}
function aad(i,fin){const a=Buffer.alloc(9);a.writeBigUInt64BE(BigInt(i));a[8]=fin?1:0;return a}

async function readFull(h,buf,pos=null){
  let off=0;
  while(off<buf.length){const {bytesRead}=await h.read(buf,off,buf.length-off,pos==null?null:pos+off);if(!bytesRead)break;off+=bytesRead}
  return off;
}
async function writeAll(h,buf,pos=null){
  let off=0;
  while(off<buf.length){const {bytesWritten}=await h.write(buf,off,buf.length-off,pos==null?null:pos+off);off+=bytesWritten}
}
function fsyncDir(d){try{const fd=fs.openSync(d,'r');try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}catch(e){}}
function writeJson(f,o){
  const t=f+'.'+rand(4)+'.tmp',fd=fs.openSync(t,'wx',0o600);
  try{fs.writeSync(fd,JSON.stringify(o));fs.fsyncSync(fd)}catch(e){fs.closeSync(fd);fs.rmSync(t,{force:true});throw e}
  fs.closeSync(fd);fs.renameSync(t,f);fsyncDir(path.dirname(f));
}
// Gecici dosyayi hedefe koy; hedef varsa ezme (link EEXIST verir). Link desteklemeyen disklerde rename.
async function place(tmp,out){
  try{await fsp.link(tmp,out)}catch(e){
    if(e.code==='EEXIST'||exists(out))throw E(`"${path.basename(out)}" zaten var.`,'EXISTS');
    await fsp.rename(tmp,out);fsyncDir(path.dirname(out));return;
  }
  await fsp.unlink(tmp);fsyncDir(path.dirname(out));
}

// Basliktaki dosya adi: yol ve kontrol karakteri yok
function safeName(n){
  n=path.basename(String(n||'').replace(/\\/g,'/')).replace(/[\u0000-\u001f\u007f/:]/g,'_').trim();
  if(!n||n==='.'||n==='..')n='dosya';
  if(n.length>200){const ext=path.extname(n).slice(0,20);n=n.slice(0,200-ext.length)+ext}
  return n;
}
// "foto.jpg" varsa "foto (kilit açıldı).jpg", o da varsa "foto (kilit açıldı 2).jpg"
function freeName(dir,name){
  let p=path.join(dir,name);if(!exists(p))return p;
  const ext=path.extname(name),base=name.slice(0,name.length-ext.length);
  for(let i=1;;i++){p=path.join(dir,`${base} (kilit açıldı${i>1?' '+i:''})${ext}`);if(!exists(p))return p}
}

// Kilitlenebilir mi: mutlak yol, normal dosya, sembolik bag degil, tek bagli, .kilitli degil, ev klasorunde, uygulama paketi degil
function checkLockable(src,{home,deny=[]}={}){
  if(typeof src!=='string'||!path.isAbsolute(src))throw E('Geçersiz dosya yolu.','PATH');
  let st;try{st=fs.lstatSync(src)}catch(e){throw E(`"${path.basename(src)}" bulunamadı.`,'NOENT')}
  const nm=path.basename(src);
  if(st.isSymbolicLink())throw E(`"${nm}" bir sembolik bağ (kısayol); yalnızca gerçek dosyalar kilitlenebilir.`,'SYMLINK');
  if(st.isDirectory())throw E(`"${nm}" bir klasör. Bu sürümde klasör kilitlenemiyor; içindeki dosyaları seç.`,'DIR');
  if(!st.isFile())throw E(`"${nm}" normal bir dosya değil.`,'TYPE');
  if(nm.toLowerCase().endsWith(EXT))throw E(`"${nm}" zaten kilitli.`,'ALREADY');
  if(st.nlink>1)throw E(`"${nm}" dosyasının başka sabit bağları var; şifresiz kopya kalacağı için kilitlenmedi.`,'NLINK');
  const real=fs.realpathSync(src),h=home&&realOr(home);
  if(!h||!inside(real,h)||real===h)throw E(`"${nm}" ev klasörünün dışında; sistem ve uygulama dosyaları kilitlenemez.`,'OUTSIDE');
  if(real.split(path.sep).some(s=>/\.app$/i.test(s)))throw E(`"${nm}" bir uygulama paketinin içinde; kilitlenemez.`,'BUNDLE');
  for(const d of deny)if(d&&inside(real,realOr(d)))throw E(`"${nm}" uygulamanın kendi dosyası; kilitlenemez.`,'DENY');
  return {real,st};
}
function checkLocked(p){
  if(typeof p!=='string'||!path.isAbsolute(p)||!p.toLowerCase().endsWith(EXT))throw E('Geçersiz kilitli dosya.','PATH');
  let st;try{st=fs.lstatSync(p)}catch(e){throw E(`"${path.basename(p)}" bulunamadı.`,'NOENT')}
  if(!st.isFile())throw E(`"${path.basename(p)}" normal bir dosya değil.`,'TYPE');
  return st;
}

// src'yi sifreleyip out'a yazar (out yeni olmali). Basliktaki sha256 sabit uzunlukta oldugundan once yer tutucu
// yazilir, sonda gercek ozet ayni uzunlukta yeniden sifrelenip yerine konur: tek gecis, sabit bellek.
async function encryptStream(dk,src,out,o={}){
  const chunk=o.chunk||CHUNK;
  if(!(chunk>0&&chunk<=MAXCHUNK))throw E('Geçersiz parça boyu.','ARG');
  const salt=crypto.randomBytes(SALT),key=fileKey(dk,salt),nb=crypto.randomBytes(IVL);
  const pre=Buffer.concat([MAGIC,Buffer.from([VER]),salt]);
  const seal=m=>{const iv=crypto.randomBytes(IVL),c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(pre);
    const ct=Buffer.concat([c.update(JSON.stringify(m),'utf8'),c.final()]);return Buffer.concat([iv,ct,c.getAuthTag()])};
  let inH=null,outH=null,cur=null,nxt=null;
  try{
    inH=await fsp.open(src,'r');
    const st=await inH.stat();
    const meta={name:safeName(o.name||path.basename(src)),size:st.size,mtimeMs:st.mtimeMs,mode:st.mode&0o777,chunk,
      nonceBase:nb.toString('base64'),sha256:'0'.repeat(64)};
    const h0=seal(meta),len=Buffer.alloc(4);len.writeUInt32BE(h0.length);
    if(h0.length>MAXHDR)throw E('Dosya adı çok uzun.','ARG');
    outH=await fsp.open(out,'wx',0o600);
    await writeAll(outH,Buffer.concat([pre,len,h0]));
    const hash=crypto.createHash('sha256');
    cur=Buffer.alloc(chunk);nxt=Buffer.alloc(chunk);
    let curN=await readFull(inH,cur),i=0,total=0;
    for(;;){
      const nxtN=curN===chunk?await readFull(inH,nxt):0,fin=nxtN===0,pt=cur.subarray(0,curN);
      hash.update(pt);
      const c=crypto.createCipheriv('aes-256-gcm',key,nonce(nb,i));c.setAAD(aad(i,fin));
      const ct=Buffer.concat([c.update(pt),c.final()]),l=Buffer.alloc(4);l.writeUInt32BE(ct.length);
      await writeAll(outH,Buffer.concat([l,ct,c.getAuthTag()]));
      total+=curN;i++;if(o.onProgress)o.onProgress(total,st.size);
      if(fin)break;
      [cur,nxt]=[nxt,cur];curN=nxtN;
    }
    if(total!==st.size)throw E(`"${meta.name}" kilitlenirken değişti; tekrar dene.`,'CHANGED');
    meta.sha256=hash.digest('hex');
    const h1=seal(meta);if(h1.length!==h0.length)throw E('Başlık yazılamadı.','INTERNAL');
    await writeAll(outH,h1,PRE+4);
    await outH.sync();
    return meta;
  }catch(e){
    if(outH){await outH.close().catch(()=>{});outH=null;await fsp.rm(out,{force:true}).catch(()=>{})}
    throw e;
  }finally{
    key.fill(0);if(cur)cur.fill(0);if(nxt)nxt.fill(0);
    if(outH)await outH.close();if(inH)await inH.close().catch(()=>{});
  }
}

// Kilitli dosyayi cozup her parcayi (etiketi dogrulandiktan sonra) sink'e verir. sink yoksa yalnizca dogrular.
// Herhangi bir degisiklik, kesme, siralama bozuklugu ya da ozet uyusmazligi hata firlatir.
async function decryptStream(dk,file,sink,o={}){
  const h=await fsp.open(file,'r');let key=null,buf=null;
  try{
    const size=(await h.stat()).size,pre=Buffer.alloc(PRE+4);
    if(await readFull(h,pre,0)!==pre.length||!pre.subarray(0,MAGIC.length).equals(MAGIC))throw E('Bu bir kilitli dosya değil ya da bozuk.','FORMAT');
    if(pre[MAGIC.length]!==VER)throw E('Bu kilitli dosya daha yeni bir sürümle oluşturulmuş.','FORMAT');
    const salt=pre.subarray(MAGIC.length+1,PRE),hl=pre.readUInt32BE(PRE);
    if(hl<IVL+TAG+2||hl>MAXHDR||PRE+4+hl>size)throw bad();
    const hb=Buffer.alloc(hl);if(await readFull(h,hb,PRE+4)!==hl)throw bad();
    key=fileKey(dk,salt);
    let meta;
    try{const d=crypto.createDecipheriv('aes-256-gcm',key,hb.subarray(0,IVL));d.setAAD(pre.subarray(0,PRE));d.setAuthTag(hb.subarray(hl-TAG));
      meta=JSON.parse(Buffer.concat([d.update(hb.subarray(IVL,hl-TAG)),d.final()]).toString('utf8'))}
    catch(e){throw E('Dosya açılamadı: anahtar bu kasaya ait değil ya da dosya değiştirilmiş.','AUTH')}
    const nb=Buffer.from(String(meta&&meta.nonceBase||''),'base64');
    if(!meta||typeof meta.name!=='string'||!Number.isSafeInteger(meta.size)||meta.size<0||!Number.isSafeInteger(meta.chunk)||
      meta.chunk<1||meta.chunk>MAXCHUNK||nb.length!==IVL||!/^[0-9a-f]{64}$/.test(meta.sha256))throw bad();
    if(o.headerOnly)return meta;
    const hash=crypto.createHash('sha256'),lb=Buffer.alloc(4);buf=Buffer.alloc(meta.chunk+TAG);
    let pos=PRE+4+hl,i=0,total=0;
    for(;;){
      if(pos+4+TAG>size)throw bad();
      await readFull(h,lb,pos);const n=lb.readUInt32BE(0),end=pos+4+n+TAG;
      if(n>meta.chunk||end>size)throw bad();
      const fin=end===size;
      if(!fin&&n!==meta.chunk)throw bad();
      if(await readFull(h,buf.subarray(0,n+TAG),pos+4)!==n+TAG)throw bad();
      let pt;
      try{const d=crypto.createDecipheriv('aes-256-gcm',key,nonce(nb,i));d.setAAD(aad(i,fin));d.setAuthTag(buf.subarray(n,n+TAG));
        pt=Buffer.concat([d.update(buf.subarray(0,n)),d.final()])}catch(e){throw bad()}
      hash.update(pt);total+=n;
      if(total>meta.size){pt.fill(0);throw bad()}
      if(sink)await sink(pt);
      pt.fill(0);pos=end;i++;
      if(o.onProgress)o.onProgress(total,meta.size);
      if(fin)break;
    }
    if(total!==meta.size||hash.digest('hex')!==meta.sha256)throw bad();
    return meta;
  }finally{if(key)key.fill(0);if(buf)buf.fill(0);await h.close().catch(()=>{})}
}

// Cozup dest'e yazar: once ayni klasorde gizli gecici dosyaya, tam dogrulanirsa dest'e. Hata olursa hicbir sey kalmaz.
async function decryptToFile(dk,locked,dest,o={}){
  const tmp=path.join(path.dirname(dest),'.'+path.basename(dest)+'.'+rand(4)+'.aciliyor');
  let h=null;
  try{
    h=await fsp.open(tmp,'wx',0o600);
    const meta=await decryptStream(dk,locked,pt=>writeAll(h,pt),o);
    await h.sync();await h.close();h=null;
    await fsp.chmod(tmp,(meta.mode&0o777)||0o600).catch(()=>{});
    if(Number.isFinite(meta.mtimeMs))await fsp.utimes(tmp,new Date(),new Date(meta.mtimeMs)).catch(()=>{});
    await place(tmp,dest);
    return meta;
  }catch(e){
    if(h)await h.close().catch(()=>{});
    await fsp.rm(tmp,{force:true}).catch(()=>{});
    throw e;
  }
}

// o: {dir, protect(buf)->string, unprotect(string)->buf, biometric(reason)->Promise, chflags(path,on)->Promise,
//     trash(path)->Promise, home, chunk, idleMs, freeBytes(dir), tmpRoot, now, onEvent(e)}
function createVault(o={}){
  if(!o.dir)throw E('Kasa klasörü gerekli.','ARG');
  const dir=o.dir,vf=path.join(dir,'vault.json'),rf=path.join(dir,'registry.json');
  const now=o.now||Date.now,idleMs=o.idleMs||IDLE,home=o.home||os.homedir(),chunk=o.chunk||CHUNK;
  const freeBytes=o.freeBytes||freeBytesOf;
  let dk=null,timer=null,deadline=0,fails=0,until=0,busy=0;
  const temps=new Map();                     // gecici acik kopya yolu -> {dir, locked}
  const ev=e=>{try{o.onEvent&&o.onEvent(e)}catch(_){}};
  fs.mkdirSync(dir,{recursive:true,mode:0o700});try{fs.chmodSync(dir,0o700)}catch(e){}

  const read=()=>{try{const v=JSON.parse(fs.readFileSync(vf,'utf8'));return v&&v.pw?v:null}catch(e){return null}};
  const kcv=k=>crypto.createHmac('sha256',k).update('gokilit-kcv').digest().subarray(0,16).toString('base64');
  const VAAD=Buffer.from('gokilit-vault-v1');
  function wrap(key,k){const iv=crypto.randomBytes(IVL),c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(VAAD);
    const ct=Buffer.concat([c.update(k),c.final()]);return {iv:iv.toString('base64'),ct:ct.toString('base64'),tag:c.getAuthTag().toString('base64')}}
  async function newPw(pw){
    const salt=crypto.randomBytes(16),key=await scryptAsync(pw,salt,SCRYPT);
    return {key,kdf:{name:'scrypt',N:SCRYPT.N,r:SCRYPT.r,p:SCRYPT.p,salt:salt.toString('base64')}};
  }
  async function unwrapPw(v,pw){
    const k=v.kdf,key=await scryptAsync(pw,Buffer.from(k.salt,'base64'),{N:k.N,r:k.r,p:k.p,maxmem:SCRYPT.maxmem});
    try{const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(v.pw.iv,'base64'));d.setAAD(VAAD);d.setAuthTag(Buffer.from(v.pw.tag,'base64'));
      return Buffer.concat([d.update(Buffer.from(v.pw.ct,'base64')),d.final()])}catch(e){return null}finally{key.fill(0)}
  }
  const tryProtect=k=>{if(!o.protect)return null;try{const s=o.protect(k);return typeof s==='string'&&s?s:null}catch(e){return null}};
  function checkPw(pw){
    if(typeof pw!=='string'||[...pw].length<MINPW)throw E(`Şifre en az ${MINPW} karakter olmalı.`,'WEAK');
    if([...pw].length>1024)throw E('Şifre çok uzun.','WEAK');
  }
  function gate(){const t=now();if(until>t)throw E(`Çok fazla yanlış deneme. ${Math.ceil((until-t)/1000)} saniye bekle.`,'WAIT')}
  function wrong(){
    if(++fails>=MAXFAIL){fails=0;until=now()+WAIT;return E(`Şifre yanlış. Çok fazla deneme: ${WAIT/1000} saniye bekle.`,'WAIT')}
    return E(`Şifre yanlış. ${MAXFAIL-fails} deneme hakkın kaldı.`,'WRONG');
  }

  function touch(){
    if(!dk)return;
    deadline=now()+idleMs;clearTimeout(timer);
    timer=setTimeout(()=>{if(busy)return touch();lock('idle')},idleMs);if(timer.unref)timer.unref();
  }
  function start(k){if(dk&&dk!==k)dk.fill(0);dk=k;touch();ev({type:'unlocked'})}
  function need(){if(!dk)throw E('Kasa kilitli. Önce Touch ID ya da şifreyle aç.','LOCKED');touch()}
  function closeTemps(){for(const t of temps.values())try{fs.rmSync(t.dir,{recursive:true,force:true})}catch(e){}temps.clear()}
  // Oturumu kapat: DK sifirlanir, gecici acik kopyalar silinir
  function lock(reason='user'){
    clearTimeout(timer);timer=null;
    const was=!!dk;if(dk){dk.fill(0);dk=null}
    closeTemps();
    if(was)ev({type:'locked',reason});
  }

  async function setup(pw){
    if(read())throw E('Şifre zaten belirlenmiş.','EXISTS');
    checkPw(pw);
    const k=crypto.randomBytes(32),{key,kdf}=await newPw(pw);
    try{writeJson(vf,{v:1,kdf,pw:wrap(key,k),kcv:kcv(k),bio:tryProtect(k),created:now()})}finally{key.fill(0)}
    start(k);return true;
  }
  async function unlockWithPassword(pw){
    gate();const v=read();if(!v)throw E('Önce bir şifre belirle.','NOSETUP');
    if(typeof pw!=='string'||!pw)throw E('Şifreyi gir.','WRONG');
    const k=await unwrapPw(v,pw);
    if(!k)throw wrong();
    fails=0;
    if(!v.bio){const b=tryProtect(k);if(b){v.bio=b;try{writeJson(vf,v)}catch(e){}}}   // Touch ID kaydini onar
    start(k);return true;
  }
  function unlockWithKey(buf){
    const v=read();if(!v)throw E('Önce bir şifre belirle.','NOSETUP');
    if(!Buffer.isBuffer(buf)||buf.length!==32)throw E('Anahtar geçersiz.','KEY');
    const a=Buffer.from(kcv(buf),'base64'),b=Buffer.from(v.kcv,'base64');
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw E('Anahtar bu kasaya ait değil; şifreyle aç.','KEY');
    start(Buffer.from(buf));return true;
  }
  async function unlockBiometric(unprotect=o.unprotect){
    const v=read();if(!v)throw E('Önce bir şifre belirle.','NOSETUP');
    if(!v.bio||!unprotect)throw E('Touch ID kaydı yok; şifreyle aç.','NOBIO');
    if(o.biometric){try{await o.biometric('kilitli dosyaları açmak')}catch(e){throw E('Touch ID doğrulanamadı.','BIO')}}
    let k;try{k=unprotect(v.bio)}catch(e){throw E('Anahtar Zinciri\'ne erişilemedi; şifreyle aç.','KEYCHAIN')}
    try{return unlockWithKey(k)}finally{if(Buffer.isBuffer(k))k.fill(0)}
  }
  async function rewrap(v,k,nw){
    const {key,kdf}=await newPw(nw);
    try{v.kdf=kdf;v.pw=wrap(key,k);v.changed=now();writeJson(vf,v)}finally{key.fill(0)}
  }
  // Sifre degisince yalnizca DK yeniden sarilir; dosyalar yeniden sifrelenmez
  async function changePassword(old,nw){
    gate();const v=read();if(!v)throw E('Önce bir şifre belirle.','NOSETUP');
    checkPw(nw);
    const k=typeof old==='string'&&old?await unwrapPw(v,old):null;
    if(!k)throw wrong();
    fails=0;try{await rewrap(v,k,nw)}finally{k.fill(0)}
    touch();return true;
  }
  // Acik oturumda (ornegin taze Touch ID dogrulamasindan sonra) yeni sifre koy
  async function resetPassword(nw){need();checkPw(nw);await rewrap(read(),dk,nw);return true}

  // Kayit: kilitli dosyalarin listesi (yol, ad, boyut, tarih). Icerik yok.
  const regRead=()=>{try{const a=JSON.parse(fs.readFileSync(rf,'utf8'));return Array.isArray(a)?a:[]}catch(e){return []}};
  const regWrite=a=>writeJson(rf,a);
  function regAdd(e){const a=regRead().filter(x=>x.path!==e.path);a.push(e);regWrite(a);return e}
  function regDrop(p){const a=regRead(),b=a.filter(x=>x.path!==p);if(b.length!==a.length)regWrite(b)}
  function files(){
    const open=new Set([...temps.values()].map(t=>t.locked));
    return regRead().map(e=>({...e,missing:!exists(e.path),opened:open.has(e.path)}));
  }
  const entry=id=>regRead().find(e=>e.id===id)||null;
  const forget=id=>{const a=regRead(),b=a.filter(e=>e.id!==id);regWrite(b);return b.length!==a.length};

  const header=async p=>{need();checkLocked(p);return decryptStream(dk,p,null,{headerOnly:true})};
  const verify=async p=>{need();checkLocked(p);return decryptStream(dk,p,null)};
  async function decryptTo(p,dest,x={}){need();checkLocked(p);busy++;try{return await decryptToFile(dk,p,dest,x)}finally{busy--;touch()}}
  function space(dirp,size){if(size+RESERVE>freeBytes(dirp))throw E(`Yeterli boş alan yok (${human(size+RESERVE)} gerekli).`,'SPACE')}
  const prog=f=>(d,t)=>{touch();if(f)f(d,t)};

  // Kilitle: sifrele -> fsync -> tamamen cozup ozetle dogrula -> ancak sonra orijinali sil -> uchg bayragi koy
  async function lockFile(src,x={}){
    need();const chflags=x.chflags||o.chflags||noop;
    const {real,st}=checkLockable(src,{home,deny:[dir]});
    const out=real+EXT,d=path.dirname(real);
    if(exists(out))throw E(`"${path.basename(out)}" zaten var.`,'EXISTS');
    space(d,st.size);
    let tmp=path.join(d,'.'+path.basename(real)+'.'+rand(4)+'.kilitleniyor'),placed=false;
    busy++;
    try{
      const meta=await encryptStream(dk,real,tmp,{chunk:x.chunk||chunk,onProgress:prog(x.onProgress)});
      if(x.beforeVerify)await x.beforeVerify(tmp);
      let v;try{v=await decryptStream(dk,tmp,null,{onProgress:prog(x.onVerify)})}
      catch(e){throw E(`"${path.basename(real)}" doğrulanamadı; orijinal dosyaya dokunulmadı.`,'VERIFY')}
      if(v.sha256!==meta.sha256||v.size!==meta.size)throw E(`"${path.basename(real)}" doğrulanamadı; orijinal dosyaya dokunulmadı.`,'VERIFY');
      const now2=fs.lstatSync(real);
      if(now2.size!==meta.size||now2.mtimeMs!==meta.mtimeMs)throw E(`"${path.basename(real)}" kilitlenirken değişti; tekrar dene.`,'CHANGED');
      await place(tmp,out);tmp=null;placed=true;
      try{await fsp.unlink(real)}catch(e){throw E(`"${path.basename(real)}" silinemedi (${e.code||e.message}); kilitleme geri alındı.`,'UNLINK')}
      fsyncDir(d);
      let flagged=true;try{await chflags(out,true)}catch(e){flagged=false}
      const ent=regAdd({id:rand(8),path:out,name:meta.name,size:meta.size,lockedAt:now()});
      return {...ent,flagged};
    }catch(e){
      if(tmp)await fsp.rm(tmp,{force:true}).catch(()=>{});
      if(placed&&exists(real))await fsp.rm(out,{force:true}).catch(()=>{});
      throw e;
    }finally{busy--;touch()}
  }

  // Kilidi kalici kaldir: yanina orijinal adla coz (dogrulanir), uchg kaldir, .kilitli dosyayi sil
  async function unlockFile(p,x={}){
    need();const chflags=x.chflags||o.chflags||noop;checkLocked(p);
    const meta=await header(p),dest=freeName(path.dirname(p),safeName(meta.name));
    await decryptTo(p,dest,{onProgress:prog(x.onProgress)});
    try{await chflags(p,false)}catch(e){}
    try{await fsp.unlink(p)}catch(e){
      try{await chflags(p,true)}catch(_){}
      throw E(`"${path.basename(dest)}" açıldı ama kilitli kopya silinemedi (${e.code||e.message}).`,'UNLINK');
    }
    fsyncDir(path.dirname(p));regDrop(p);
    for(const [k,t] of temps)if(t.locked===p){try{fs.rmSync(t.dir,{recursive:true,force:true})}catch(e){}temps.delete(k)}
    return {path:dest,name:path.basename(dest),size:meta.size};
  }

  // Duzenlenmis kopyayi kilitli dosyanin yerine atomik olarak yeniden sifrele (ad ayni kalir)
  async function relock(p,from,x={}){
    need();const chflags=x.chflags||o.chflags||noop;checkLocked(p);
    const meta=await header(p),st=fs.lstatSync(from);
    if(!st.isFile())throw E('Kaydedilecek kopya bulunamadı.','NOENT');
    const d=path.dirname(p);space(d,st.size);
    let tmp=path.join(d,'.'+path.basename(p)+'.'+rand(4)+'.yenileniyor'),cleared=false;
    busy++;
    try{
      const m=await encryptStream(dk,from,tmp,{name:meta.name,chunk:x.chunk||chunk,onProgress:prog(x.onProgress)});
      if(x.beforeVerify)await x.beforeVerify(tmp);
      let v;try{v=await decryptStream(dk,tmp,null)}catch(e){throw E('Yeni kopya doğrulanamadı; kilitli dosya değişmedi.','VERIFY')}
      if(v.sha256!==m.sha256)throw E('Yeni kopya doğrulanamadı; kilitli dosya değişmedi.','VERIFY');
      try{await chflags(p,false);cleared=true}catch(e){}
      await fsp.rename(tmp,p);tmp=null;fsyncDir(d);
      let flagged=true;try{await chflags(p,true)}catch(e){flagged=false}
      const a=regRead(),e=a.find(r=>r.path===p);if(e){e.size=m.size;e.updatedAt=now();regWrite(a)}
      return {size:m.size,flagged};
    }catch(e){
      if(tmp){await fsp.rm(tmp,{force:true}).catch(()=>{});if(cleared)await chflags(p,true).catch(()=>{})}
      throw e;
    }finally{busy--;touch()}
  }

  // Sil: uchg kaldir, Cop Sepeti'ne tasi (kalici silme yok). Basarisizsa bayrak geri konur.
  async function removeLocked(p,x={}){
    need();const chflags=x.chflags||o.chflags||noop,trash=x.trash||o.trash;
    if(!trash)throw E('Çöp Sepeti kullanılamıyor.','TRASH');
    checkLocked(p);
    try{await chflags(p,false)}catch(e){}
    try{await trash(p)}catch(e){await chflags(p,true).catch(()=>{});throw E(`Çöp Sepeti'ne taşınamadı: ${e.message}`,'TRASH')}
    regDrop(p);
    for(const [k,t] of temps)if(t.locked===p){try{fs.rmSync(t.dir,{recursive:true,force:true})}catch(e){}temps.delete(k)}
    return true;
  }

  // Ac: ozel gecici klasore (0700) cozer; oturum kilitlenince silinir
  async function openTemp(p,x={}){
    need();checkLocked(p);
    for(const [k,t] of temps)if(t.locked===p&&exists(k))return k;
    const meta=await header(p);
    const td=fs.mkdtempSync(path.join(o.tmpRoot||os.tmpdir(),'gokilit-'));fs.chmodSync(td,0o700);
    const tp=path.join(td,safeName(meta.name));
    try{await decryptTo(p,tp,{onProgress:x.onProgress})}catch(e){fs.rmSync(td,{recursive:true,force:true});throw e}
    temps.set(tp,{dir:td,locked:p});return tp;
  }
  async function saveTemp(p,x={}){
    need();
    for(const [k,t] of temps)if(t.locked===p&&exists(k))return relock(p,k,x);
    throw E('Bu dosyanın açık bir kopyası yok.','NOTEMP');
  }
  // Baska yerden gelen .kilitli dosyayi listeye ekle (bu kasanin anahtariyla acilabiliyorsa)
  async function adopt(p){
    need();const real=realOr(p);checkLocked(real);
    const meta=await header(real);
    const old=regRead().find(e=>e.path===real);if(old)return old;
    return regAdd({id:rand(8),path:real,name:meta.name,size:meta.size,lockedAt:now()});
  }

  return {setup,hasPassword:()=>!!read(),hasBiometric:()=>!!(read()||{}).bio&&!!o.unprotect,
    unlockWithPassword,unlockWithKey,unlockBiometric,lock,isUnlocked:()=>!!dk,changePassword,resetPassword,
    touch,remainingMs:()=>dk?Math.max(0,deadline-now()):0,idleMs,
    lockFile,decryptTo,verify,header,unlockFile,relock,removeLocked,openTemp,saveTemp,adopt,
    files,entry,forget,temps:()=>[...temps.keys()],_peek:()=>dk};
}

module.exports={createVault,encryptStream,decryptStream,decryptToFile,checkLockable,checkLocked,safeName,freeName,human,
  EXT,MAGIC,CHUNK,RESERVE,IDLE};
