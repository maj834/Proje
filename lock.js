// Dosya Kilidi cekirdegi: secilen dosyalar yerinde guclu sifrelenir (photo.jpg -> photo.jpg.kilitli).
// Anahtar: rastgele 32 baytlik veri anahtari (DK). Kasada iki kez saklanir: (a) kullanici sifresinden scrypt ile
// turetilen anahtarla AES-256-GCM sarili, (b) disaridan verilen protect() ile (Electron safeStorage -> Anahtar Zinciri),
// Touch ID yolu icin. DK yalnizca acik oturum boyunca bellekte durur; kilitlenince sifirlanir.
// Dosya bicimi (akisli, sabit bellek): "GOKILIT1" | surum(1) | tuz(16) | baslik uzunlugu(4) | iv(12)+baslik+etiket(16)
// | parcalar: uzunluk(4) + sifreli veri + etiket(16). Nonce = nonceBase XOR sayac, AAD = sayac(8) + son-parca bayragi(1).
// Bu modul Electron'a baglanmaz: Touch ID, Anahtar Zinciri, chflags, Cop Sepeti disaridan verilir (testte sahte).
// Silinme kurtarma: her .kilitli dosyanin kasa klasorunde (yedek/<id>.kilitli) bir sert bagi (hard link) durur; ikisi ayni
// inode'dur, ek disk alani harcanmaz. Sahibi "Kilitli" bayragini kaldirip gorunen dosyayi silse bile icerik yedek adla
// yasar; repair() eksik dosyayi yedekten ayni yere geri baglar. Farkli diskte (EXDEV) bag kurulamaz: kopya alinmaz, backup:false.
const fs=require('fs'),fsp=fs.promises,path=require('path'),os=require('os'),crypto=require('crypto');

const MAGIC=Buffer.from('GOKILIT1'),VER=1,EXT='.kilitli';
const CHUNK=1024*1024,TAG=16,SALT=16,IVL=12,MAXHDR=64*1024,MAXCHUNK=64*1024*1024;
const PRE=MAGIC.length+1+SALT;               // magic + surum + tuz (baslik AAD'si)
const IDLE=5*60*1000;                        // 5 dk islem yoksa kilitlenir
const RESERVE=64*1024*1024;                  // kilitlerken diskte dosya boyutu + 64 MB bos alan olsun
const MAXFAIL=5,WAIT=30*1000,MAXWAIT=15*60*1000,MINPW=8;  // 5 yanlista 30 sn, her yeni turda iki kati (en fazla 15 dk)
const SCRYPT={N:2**17,r:8,p:1,maxmem:256*1024*1024};      // yeni kasalar; eskiler vault.json'daki N/r/p ile acilir
const TMPPRE='gokilit-';                     // gecici acik kopya klasorlerinin oneki (tmp kokunde yalnizca bunlar silinir)
const PARTIAL=/^\..+\.[0-9a-f]{8}\.(aciliyor|kilitleniyor|yenileniyor)$/;  // yarida kalmis islem dosyalari
const BAKDIR='yedek',BAKTMP=/^[0-9a-f]{16}\.kilitli\.[0-9a-f]{8}\.tmp$/;   // sert bag yedekleri ve yarim kalan yedek baglari
const BAKRE=/^([0-9a-f]{16})\.kilitli$/;     // tamamlanmis yedek bag adi (yedek/<id>.kilitli)
const IDRE=/^[0-9a-f]{16}$/;

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
//     trash(path)->Promise, home, chunk, idleMs, freeBytes(dir), tmpRoot (varsayilan dir/tmp), now, onEvent(e), scryptN (test icin),
//     link(from,to) (yedek bag icin; varsayilan fs.linkSync, testte EXDEV benzetimi)}
function createVault(o={}){
  if(!o.dir)throw E('Kasa klasörü gerekli.','ARG');
  const dir=o.dir,vf=path.join(dir,'vault.json'),rf=path.join(dir,'registry.json'),af=path.join(dir,'attempts.json');
  const now=o.now||Date.now,idleMs=o.idleMs||IDLE,home=o.home||os.homedir(),chunk=o.chunk||CHUNK;
  const freeBytes=o.freeBytes||freeBytesOf,tmpRoot=o.tmpRoot||path.join(dir,'tmp');
  const KDF={...SCRYPT,N:o.scryptN||SCRYPT.N};
  const bdir=path.join(dir,BAKDIR),link=o.link||fs.linkSync;
  let dk=null,timer=null,deadline=0,busy=0,gen=0;  // gen: her kilitlemede artar (suren acma islemi bunu gorur)
  const temps=new Map();                     // gecici acik kopya yolu -> {dir, locked}
  const ev=e=>{try{o.onEvent&&o.onEvent(e)}catch(_){}};
  fs.mkdirSync(dir,{recursive:true,mode:0o700});try{fs.chmodSync(dir,0o700)}catch(e){}
  fs.mkdirSync(tmpRoot,{recursive:true,mode:0o700});
  fs.mkdirSync(bdir,{recursive:true,mode:0o700});try{fs.chmodSync(bdir,0o700)}catch(e){}

  // Kasa dosyasi: yok (ilk kullanim), saglam ya da bozuk/okunamaz. Bozuksa vault.json.bak (son saglam kopya) denenir;
  // o da yoksa kasa "bozuk" sayilir ve yeni sifre BELIRLENMEZ (yoksa eski dosyalar acilamaz hale gelirdi).
  const vbak=vf+'.bak';
  const validV=v=>!!(v&&typeof v==='object'&&v.pw&&typeof v.pw.iv==='string'&&typeof v.pw.ct==='string'&&typeof v.pw.tag==='string'&&
    v.kdf&&typeof v.kdf==='object'&&typeof v.kdf.salt==='string'&&typeof v.kcv==='string');
  const parseV=f=>{let s;try{s=fs.readFileSync(f,'utf8')}catch(e){return e.code==='ENOENT'?{none:true}:{bad:true}}
    try{const v=JSON.parse(s);return validV(v)?{v}:{bad:true}}catch(e){return {bad:true}}};
  // Kasada veri var mi (kayit ya da yedek bag): varsa kasa dosyasi kaybolmus demektir, ilk kurulum yapilmaz
  function hasData(){
    try{const s=fs.readFileSync(rf,'utf8');let a;try{a=JSON.parse(s)}catch(e){return true}if(!Array.isArray(a)||a.length)return true}
    catch(e){if(e.code!=='ENOENT')return true}
    try{return fs.readdirSync(bdir).some(n=>BAKRE.test(n))}catch(e){return false}
  }
  function load(){
    const m=parseV(vf);if(m.v)return {state:'ok',v:m.v,from:'main'};
    const b=parseV(vbak);if(b.v)return {state:'ok',v:b.v,from:'bak'};
    if(m.none&&!b.bad&&!hasData())return {state:'none'};
    return {state:'corrupt'};
  }
  const read=()=>{const s=load();return s.state==='ok'?s.v:null};
  const corruptErr=()=>E('Kasa dosyası (vault.json) bozuk ya da okunamıyor. Kilitli dosyaların açılamaz hale gelmemesi için yeni şifre belirlenmedi; kasa klasörünü yedekten geri yükle.','CORRUPT');
  // Kasa kayitli olmali: yoksa NOSETUP, bozuksa CORRUPT
  function needV(){const s=load();if(s.state==='ok')return s;if(s.state==='corrupt')throw corruptErr();throw E('Önce bir şifre belirle.','NOSETUP')}
  // Yazmadan once mevcut saglam kopya .bak'a alinir; yazdiktan sonra .bak yeni surume esitlenir (sifre degisince eski
  // sifreyle sarili anahtar .bak'ta kalmasin).
  function saveV(v){
    const cur=parseV(vf);if(cur.v)try{writeJson(vbak,cur.v)}catch(e){}
    writeJson(vf,v);
    try{writeJson(vbak,v)}catch(e){}
  }
  const kcv=k=>crypto.createHmac('sha256',k).update('gokilit-kcv').digest().subarray(0,16).toString('base64');
  const VAAD=Buffer.from('gokilit-vault-v1');
  function wrap(key,k){const iv=crypto.randomBytes(IVL),c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(VAAD);
    const ct=Buffer.concat([c.update(k),c.final()]);return {iv:iv.toString('base64'),ct:ct.toString('base64'),tag:c.getAuthTag().toString('base64')}}
  async function newPw(pw){
    const salt=crypto.randomBytes(16),key=await scryptAsync(pw,salt,KDF);
    return {key,kdf:{name:'scrypt',N:KDF.N,r:KDF.r,p:KDF.p,salt:salt.toString('base64')}};
  }
  async function unwrapPw(v,pw){
    const k=v.kdf||{};
    if(!Number.isSafeInteger(k.N)||k.N<2**14||k.N>2**20||!(k.r>=1&&k.r<=32)||!(k.p>=1&&k.p<=4))throw E('Kasa dosyası bozuk.','FORMAT');
    const key=await scryptAsync(pw,Buffer.from(String(k.salt),'base64'),{N:k.N,r:k.r,p:k.p,maxmem:Math.max(SCRYPT.maxmem,256*k.N*k.r*k.p)});
    try{const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(v.pw.iv,'base64'));d.setAAD(VAAD);d.setAuthTag(Buffer.from(v.pw.tag,'base64'));
      return Buffer.concat([d.update(Buffer.from(v.pw.ct,'base64')),d.final()])}catch(e){return null}finally{key.fill(0)}
  }
  const tryProtect=k=>{if(!o.protect)return null;try{const s=o.protect(k);return typeof s==='string'&&s?s:null}catch(e){return null}};
  function checkPw(pw){
    if(typeof pw!=='string'||[...pw].length<MINPW)throw E(`Şifre en az ${MINPW} karakter olmalı.`,'WEAK');
    if([...pw].length>1024)throw E('Şifre çok uzun.','WEAK');
  }
  // Yanlis deneme sayaci kasa klasorunde saklanir: uygulamayi yeniden baslatmak sayaci sifirlamaz
  function att(){try{const a=JSON.parse(fs.readFileSync(af,'utf8'));return {fails:+a.fails||0,until:+a.until||0,rounds:+a.rounds||0,wait:+a.wait||0}}catch(e){return {fails:0,until:0,rounds:0,wait:0}}}
  function attSave(a){try{if(!a.fails&&!a.until&&!a.rounds)fs.rmSync(af,{force:true});else writeJson(af,a)}catch(e){}}
  const secs=ms=>{const s=Math.ceil(ms/1000);return s>=120?Math.ceil(s/60)+' dakika':s+' saniye'};
  function gate(){const t=now(),a=att();
    // Saat geri alinsa da bekleme, verilen sureyi (en fazla MAXWAIT) asmaz: kayitli bitis simdiye gore kirpilip saklanir
    const cap=Math.min(a.wait>0?a.wait:MAXWAIT,MAXWAIT);
    if(a.until-t>cap){a.until=t+cap;attSave(a)}
    if(a.until>t)throw E(`Çok fazla yanlış deneme. ${secs(a.until-t)} bekle.`,'WAIT')}
  function wrong(){
    const a=att();
    if(++a.fails>=MAXFAIL){const w=Math.min(WAIT*2**a.rounds,MAXWAIT);a.fails=0;a.rounds++;a.until=now()+w;a.wait=w;attSave(a);
      return E(`Şifre yanlış. Çok fazla deneme: ${secs(w)} bekle.`,'WAIT')}
    attSave(a);return E(`Şifre yanlış. ${MAXFAIL-a.fails} deneme hakkın kaldı.`,'WRONG');
  }
  const right=()=>attSave({fails:0,until:0,rounds:0});

  function touch(){
    if(!dk)return;
    deadline=now()+idleMs;clearTimeout(timer);
    timer=setTimeout(()=>{if(busy)return touch();lock('idle')},idleMs);if(timer.unref)timer.unref();
  }
  function start(k){if(dk&&dk!==k)dk.fill(0);dk=k;touch();ev({type:'unlocked'})}
  function need(){if(!dk)throw E('Kasa kilitli. Önce Touch ID ya da şifreyle aç.','LOCKED');touch()}
  // Tum gecici acik kopyalar tek bir kokte (tmpRoot/gokilit-*): kayitli olsun olmasin (suren acma, onceki cokus) hepsi silinir
  function wipeTemps(){
    for(const t of temps.values())try{fs.rmSync(t.dir,{recursive:true,force:true})}catch(e){}temps.clear();
    let names=[];try{names=fs.readdirSync(tmpRoot)}catch(e){}
    for(const n of names)if(n.startsWith(TMPPRE))try{fs.rmSync(path.join(tmpRoot,n),{recursive:true,force:true})}catch(e){}
  }
  // Oturumu kapat: DK sifirlanir, gecici acik kopyalar silinir
  function lock(reason='user'){
    clearTimeout(timer);timer=null;gen++;
    const was=!!dk;if(dk){dk.fill(0);dk=null}
    wipeTemps();
    if(was)ev({type:'locked',reason});
  }

  // Sifre denemeleri sirayla: ayni anda gelen denemeler gate()'i birlikte gecip 5 deneme sinirini asamaz
  let pwq=Promise.resolve();
  const serial=f=>{const p=pwq.then(f);pwq=p.catch(()=>{});return p};

  async function setup(pw){
    const s=load();
    if(s.state==='ok')throw E('Şifre zaten belirlenmiş.','EXISTS');
    if(s.state==='corrupt')throw corruptErr();
    checkPw(pw);
    const k=crypto.randomBytes(32),{key,kdf}=await newPw(pw);
    try{
      // scrypt surerken baska bir kurulum yapildiysa ezme
      if(load().state!=='none')throw E('Şifre zaten belirlenmiş.','EXISTS');
      saveV({v:1,kdf,pw:wrap(key,k),kcv:kcv(k),bio:tryProtect(k),created:now()});
    }catch(e){k.fill(0);throw e}finally{key.fill(0)}
    start(k);return true;
  }
  const unlockWithPassword=pw=>serial(async()=>{
    gate();const {v,from}=needV();
    if(typeof pw!=='string'||!pw)throw E('Şifreyi gir.','WRONG');
    const k=await unwrapPw(v,pw);
    if(!k)throw wrong();
    right();
    let dirty=from!=='main';                              // ana dosya bozuktu: .bak'tan onar
    if(!v.bio){const b=tryProtect(k);if(b){v.bio=b;dirty=true}}   // Touch ID kaydini onar
    if(dirty)try{saveV(v)}catch(e){}
    start(k);return true;
  });
  function unlockWithKey(buf){
    const {v}=needV();
    if(!Buffer.isBuffer(buf)||buf.length!==32)throw E('Anahtar geçersiz.','KEY');
    const a=Buffer.from(kcv(buf),'base64'),b=Buffer.from(v.kcv,'base64');
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw E('Anahtar bu kasaya ait değil; şifreyle aç.','KEY');
    start(Buffer.from(buf));return true;
  }
  async function unlockBiometric(unprotect=o.unprotect){
    const {v}=needV();
    if(!v.bio||!unprotect)throw E('Touch ID kaydı yok; şifreyle aç.','NOBIO');
    if(o.biometric){try{await o.biometric('kilitli dosyaları açmak')}catch(e){throw E('Touch ID doğrulanamadı.','BIO')}}
    let k;try{k=unprotect(v.bio)}catch(e){throw E('Anahtar Zinciri\'ne erişilemedi; şifreyle aç.','KEYCHAIN')}
    try{return unlockWithKey(k)}finally{if(Buffer.isBuffer(k))k.fill(0)}
  }
  async function rewrap(v,k,nw){
    const {key,kdf}=await newPw(nw);
    try{v.kdf=kdf;v.pw=wrap(key,k);v.changed=now();saveV(v)}finally{key.fill(0)}
  }
  // Sifre degisince yalnizca DK yeniden sarilir; dosyalar yeniden sifrelenmez
  const changePassword=(old,nw)=>serial(async()=>{
    gate();const {v}=needV();
    checkPw(nw);
    const k=typeof old==='string'&&old?await unwrapPw(v,old):null;
    if(!k)throw wrong();
    right();try{await rewrap(v,k,nw)}finally{k.fill(0)}
    touch();return true;
  });
  // Acik oturumda (ornegin taze Touch ID dogrulamasindan sonra) yeni sifre koy
  async function resetPassword(nw){need();checkPw(nw);await rewrap(needV().v,dk,nw);return true}

  // Kayit: kilitli dosyalarin listesi (yol, ad, boyut, tarih). Icerik yok.
  const regRead=()=>{try{const a=JSON.parse(fs.readFileSync(rf,'utf8'));return Array.isArray(a)?a:[]}catch(e){return []}};
  // Kesin okuma: kayit okunamiyorsa null (sahipsiz yedek temizligi bozuk kayitla calismasin)
  const regReadStrict=()=>{try{const a=JSON.parse(fs.readFileSync(rf,'utf8'));return Array.isArray(a)?a:null}catch(e){return e.code==='ENOENT'?[]:null}};
  const regWrite=a=>writeJson(rf,a);
  function regAdd(e){const a=regRead().filter(x=>x.path!==e.path);a.push(e);regWrite(a);return e}
  function regDrop(p){const a=regRead(),b=a.filter(x=>x.path!==p);if(b.length!==a.length)regWrite(b)}
  function regDropId(id){const a=regRead(),b=a.filter(x=>x.id!==id);if(b.length!==a.length)regWrite(b)}
  const live=()=>regRead().filter(e=>!e.pending);       // yarim kalmis kilitleme kayitlari listede gorunmez
  function files(){
    const open=new Set([...temps.values()].map(t=>t.locked));
    return live().map(e=>{const missing=!exists(e.path),b=bakPath(e.id);
      return {...e,missing,opened:open.has(e.path),recoverable:missing&&!!b&&exists(b)}});
  }
  const entry=id=>live().find(e=>e.id===id)||null;
  // Kayittan cikar; yedek bag da silinir (yoksa icerik kasa klasorunde sahipsiz kalirdi)
  async function forget(id,x={}){
    const a=regRead(),e=a.find(r=>r.id===id);if(!e)return false;
    await dropBackup(id,x.chflags||o.chflags||noop);
    regWrite(a.filter(r=>r.id!==id));return true;
  }

  // ---- Sert bag yedekleri (yedek/<id>.kilitli) ----
  const bakPath=id=>IDRE.test(String(id))?path.join(bdir,id+EXT):null;
  const isLockedFile=p=>{try{const st=fs.lstatSync(p);if(!st.isFile())return false;const fd=fs.openSync(p,'r');
    try{const b=Buffer.alloc(MAGIC.length);return fs.readSync(fd,b,0,b.length,0)===b.length&&b.equals(MAGIC)}finally{fs.closeSync(fd)}}catch(e){return false}};
  // from'un yedek bagini kur ya da atomik olarak yenile (gecici ad + rename). Bag kurulamazsa (EXDEV, EPERM...) kopya
  // ALINMAZ: false. Cagiran from uzerindeki uchg'yi once kaldirmis olmali (macOS: degistirilemez dosyaya link EPERM verir).
  function linkBackup(from,id){
    const b=bakPath(id);if(!b)return false;
    try{fs.mkdirSync(bdir,{recursive:true,mode:0o700})}catch(e){}
    const t=b+'.'+rand(4)+'.tmp';
    try{link(from,t)}catch(e){try{fs.rmSync(t,{force:true})}catch(_){}return false}
    try{fs.renameSync(t,b)}catch(e){try{fs.rmSync(t,{force:true})}catch(_){}return false}
    fsyncDir(bdir);return true;
  }
  async function dropBackup(id,chflags){
    const b=bakPath(id);if(!b||!exists(b))return;
    try{await chflags(b,false)}catch(e){}
    try{fs.rmSync(b,{force:true});fsyncDir(bdir)}catch(e){}
  }
  // Hicbir kaydin gostermedigi yedek baglari sil (or. eski surumde kayit yazilmadan kesilen kilitleme). Yalnizca
  // yedek adi kalibina uyan dosyalar; kayit okunamiyorsa hicbir sey silinmez.
  async function dropOrphans(chflags){
    const a=regReadStrict();if(!a)return 0;
    const ids=new Set(a.map(e=>String(e.id)));let names=[],n=0;
    try{names=fs.readdirSync(bdir)}catch(e){return 0}
    for(const nm of names){const m=BAKRE.exec(nm);if(!m||ids.has(m[1]))continue;
      const q=path.join(bdir,nm);try{if(!fs.lstatSync(q).isFile())continue}catch(e){continue}
      try{await chflags(q,false)}catch(e){}
      try{fs.rmSync(q,{force:true});n++}catch(e){}}
    if(n)fsyncDir(bdir);return n;
  }
  const sameFile=(a,b)=>{try{const x=fs.statSync(a),y=fs.statSync(b);return x.dev===y.dev&&x.ino===y.ino}catch(e){return false}};
  // Dosya kimligi (bigint: buyuk inode numaralarinda hassasiyet kaybi olmasin)
  const fid=p=>{try{const s=fs.statSync(p,{bigint:true});return {dev:String(s.dev),ino:String(s.ino)}}catch(e){return null}};
  // "x.jpg.kilitli" doluysa "x.jpg (geri getirildi).kilitli", o da doluysa "x.jpg (geri getirildi 2).kilitli"
  function restoreName(p){
    if(!exists(p))return p;
    const d=path.dirname(p),n=path.basename(p),base=n.slice(0,n.length-EXT.length);
    for(let i=1;;i++){const q=path.join(d,`${base} (geri getirildi${i>1?' '+i:''})${EXT}`);if(!exists(q))return q}
  }
  // Durum: her kayit icin gorunen dosya ve yedek var mi (degisiklik yapmaz; anahtar gerekmez)
  function check(){
    return live().map(e=>{const b=bakPath(e.id),vis=exists(e.path),bak=!!b&&exists(b),linked=vis&&bak&&sameFile(e.path,b);
      let alone=false;if(bak&&!linked)try{alone=fs.statSync(b).nlink===1}catch(_){}
      return {id:e.id,name:e.name,path:e.path,visible:vis,backup:bak,linked,recoverable:bak&&!linked&&(!vis||alone)}});
  }
  // Onar (acilista ve kasa acilinca): silinmis gorunen dosyayi yedekten geri bagla (ad doluysa "(geri getirildi)"),
  // uchg'yi yeniden koy; yedegi olmayan (eski surum) dosyalarin bagini kur. Anahtar gerekmez, icerik cozulmez.
  async function repair(x={}){
    const chflags=x.chflags||o.chflags||noop;
    const a=regRead(),restored=[],failed=[],moved=[];let linked=0,changed=false;
    for(const e of a){
      if(e.pending)continue;                            // yarim kilitleme: acilista sweep() cozer
      const b=bakPath(e.id);if(!b||typeof e.path!=='string'||!path.isAbsolute(e.path)||!e.path.toLowerCase().endsWith(EXT))continue;
      const vis=exists(e.path),bak=exists(b);
      // Yeniden kilitleme (relock) yeni dosyayi yerine koyduktan sonra, yedek bag yenilenip kayit yazilmadan kesildiyse:
      // gorunen dosya relock'un kaydettigi yeni dosyanin kendisidir (ayni inode). Eski surumu geri getirmek yerine
      // yedek bagi yeni dosyaya tasi. Isaret eslesmezse (relock yer degistirmeden kesildi) yalnizca isaret silinir.
      if(e.next&&typeof e.next==='object'){
        const id=vis?fid(e.path):null,n=e.next;
        if(id&&id.ino===String(n.ino)&&id.dev===String(n.dev)&&!(bak&&sameFile(e.path,b))&&isLockedFile(e.path)){
          if(bak)try{await chflags(b,false)}catch(_){}
          try{await chflags(e.path,false)}catch(_){}
          const ok=linkBackup(e.path,e.id);
          if(!ok&&bak)try{fs.rmSync(b,{force:true});fsyncDir(bdir)}catch(_){}
          try{await chflags(e.path,true)}catch(_){}
          if(ok){try{await chflags(b,true)}catch(_){}linked++}
          e.backup=ok;if(Number.isSafeInteger(n.size))e.size=n.size;e.updatedAt=now();
          delete e.next;changed=true;continue;
        }
        delete e.next;changed=true;
      }
      // Yerinde baska bir dosya var ve yedegi baska hicbir ad tutmuyorsa (nlink 1) bizimki silinmis demektir
      const replaced=vis&&bak&&!sameFile(e.path,b)&&(()=>{try{return fs.statSync(b).nlink===1}catch(_){return false}})();
      // Gorunen dosya yok ama ayni icerige baska bir ad daha bagli (nlink>1): dosya silinmemis, tasinmis/yeniden adlanmis.
      // Eski yerine kopya geri getirilmez; kullaniciya bildirilir.
      if(!vis&&bak&&(()=>{try{return fs.statSync(b).nlink>1}catch(_){return false}})()){moved.push({id:e.id,name:e.name});continue}
      if((!vis||replaced)&&bak){
        if(!isLockedFile(b)){failed.push({id:e.id,name:e.name,msg:'Yedek bozuk.'});continue}
        try{
          try{await chflags(b,false)}catch(_){}   // macOS: degistirilemez dosyaya bag kurulamaz
          let dest;
          for(let i=0;;i++){dest=restoreName(e.path);
            try{link(b,dest);break}catch(err){if(err.code!=='EEXIST'||i>=20)throw err}}
          fsyncDir(path.dirname(dest));
          let flagged=true;try{await chflags(dest,true)}catch(_){flagged=false}
          try{await chflags(b,true)}catch(_){}
          restored.push({id:e.id,name:e.name,path:dest,renamed:dest!==e.path,flagged});
          e.path=dest;e.backup=true;e.restoredAt=now();changed=true;
        }catch(err){try{await chflags(b,true)}catch(_){}failed.push({id:e.id,name:e.name,msg:err.code||err.message})}
      }else if(vis&&!bak&&isLockedFile(e.path)){
        // Yedegi olmayan dosya (eski surum ya da yedek silinmis): bagini kur
        let cleared=false;try{await chflags(e.path,false);cleared=true}catch(_){}
        const ok=linkBackup(e.path,e.id);
        if(cleared)try{await chflags(e.path,true)}catch(_){}
        if(ok){try{await chflags(b,true)}catch(_){}linked++}
        if(e.backup!==ok){e.backup=ok;changed=true}
      }
      // Kilitleme bayrak konmadan kesildiyse (sweep kaydi tamamladi): bayragi simdi koy
      if(e.unflagged){
        if(exists(e.path)){try{await chflags(e.path,true)}catch(_){}if(exists(b))try{await chflags(b,true)}catch(_){}}
        delete e.unflagged;changed=true;
      }
    }
    if(changed)regWrite(a);
    await dropOrphans(chflags);
    if(restored.length)ev({type:'restored',files:restored});
    return {restored,failed,linked,moved};
  }

  const header=async p=>{need();checkLocked(p);return decryptStream(dk,p,null,{headerOnly:true})};
  const verify=async p=>{need();checkLocked(p);return decryptStream(dk,p,null)};
  async function decryptTo(p,dest,x={}){need();checkLocked(p);const g=gen;busy++;
    try{return await decryptToFile(dk,p,dest,x)}catch(e){throw g!==gen?E('Kasa kilitlendi; işlem yarıda kaldı.','LOCKED'):e}finally{busy--;touch()}}
  function space(dirp,size){if(size+RESERVE>freeBytes(dirp))throw E(`Yeterli boş alan yok (${human(size+RESERVE)} gerekli).`,'SPACE')}
  const prog=f=>(d,t)=>{touch();if(f)f(d,t)};

  // Kilitle: sifrele -> fsync -> tamamen cozup ozetle dogrula -> ancak sonra orijinali sil -> uchg bayragi koy
  async function lockFile(src,x={}){
    need();const chflags=x.chflags||o.chflags||noop;
    const {real,st}=checkLockable(src,{home,deny:[dir]});
    const out=real+EXT,d=path.dirname(real);
    if(exists(out))throw E(`"${path.basename(out)}" zaten var.`,'EXISTS');
    space(d,st.size);
    let tmp=path.join(d,'.'+path.basename(real)+'.'+rand(4)+'.kilitleniyor'),placed=false,id=null,unlinked=false;
    busy++;
    try{
      const meta=await encryptStream(dk,real,tmp,{chunk:x.chunk||chunk,onProgress:prog(x.onProgress)});
      if(x.beforeVerify)await x.beforeVerify(tmp);
      let v;try{v=await decryptStream(dk,tmp,null,{onProgress:prog(x.onVerify)})}
      catch(e){throw E(`"${path.basename(real)}" doğrulanamadı; orijinal dosyaya dokunulmadı.`,'VERIFY')}
      if(v.sha256!==meta.sha256||v.size!==meta.size)throw E(`"${path.basename(real)}" doğrulanamadı; orijinal dosyaya dokunulmadı.`,'VERIFY');
      const now2=fs.lstatSync(real);
      if(now2.size!==meta.size||now2.mtimeMs!==meta.mtimeMs)throw E(`"${path.basename(real)}" kilitlenirken değişti; tekrar dene.`,'CHANGED');
      // Once "yarim" kayit: yerlestirme ile son kayit arasinda kesilirse acilista sweep() tamamlar ya da geri alir
      id=rand(8);
      const base={id,path:out,name:meta.name,size:meta.size,lockedAt:now()};
      {const a=regRead();a.push({...base,backup:false,pending:true,src:real});regWrite(a)}
      if(x.afterPending)await x.afterPending();
      await place(tmp,out);tmp=null;placed=true;
      if(x.afterPlace)await x.afterPlace();
      try{await fsp.unlink(real)}catch(e){throw E(`"${path.basename(real)}" silinemedi (${e.code||e.message}); kilitleme geri alındı.`,'UNLINK')}
      unlinked=true;fsyncDir(d);
      // Yedek sert bag uchg'den ONCE (macOS'ta degistirilemez dosyaya bag kurulamaz); ayni inode, ek alan yok
      const backup=linkBackup(out,id);
      if(x.afterBackup)await x.afterBackup();
      let flagged=true;try{await chflags(out,true)}catch(e){flagged=false}
      if(backup)try{await chflags(bakPath(id),true)}catch(e){}
      const ent=regAdd({...base,backup});
      return {...ent,flagged};   // regAdd ayni yoldaki yarim kaydin yerine gecer
    }catch(e){
      if(tmp)await fsp.rm(tmp,{force:true}).catch(()=>{});
      if(placed&&exists(real))await fsp.rm(out,{force:true}).catch(()=>{});
      // Orijinal hala yerindeyse (geri alindi) yarim kayit ve yedek silinir; orijinal silindiyse kayit kalir (sweep tamamlar)
      if(id&&!unlinked){try{regDropId(id)}catch(_){}await dropBackup(id,chflags)}
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
    fsyncDir(path.dirname(p));
    for(const e of regRead())if(e.path===p)await dropBackup(e.id,chflags);
    regDrop(p);
    for(const [k,t] of temps)if(t.locked===p){try{fs.rmSync(t.dir,{recursive:true,force:true})}catch(e){}temps.delete(k)}
    return {path:dest,name:path.basename(dest),size:meta.size};
  }

  // Duzenlenmis kopyayi kilitli dosyanin yerine atomik olarak yeniden sifrele (ad ayni kalir)
  async function relock(p,from,x={}){
    need();const chflags=x.chflags||o.chflags||noop;checkLocked(p);
    const meta=await header(p),st=fs.lstatSync(from);
    if(!st.isFile())throw E('Kaydedilecek kopya bulunamadı.','NOENT');
    const d=path.dirname(p);space(d,st.size);
    let tmp=path.join(d,'.'+path.basename(p)+'.'+rand(4)+'.yenileniyor'),cleared=false,marked=null,bk=null;
    busy++;
    try{
      const m=await encryptStream(dk,from,tmp,{name:meta.name,chunk:x.chunk||chunk,onProgress:prog(x.onProgress)});
      if(x.beforeVerify)await x.beforeVerify(tmp);
      let v;try{v=await decryptStream(dk,tmp,null)}catch(e){throw E('Yeni kopya doğrulanamadı; kilitli dosya değişmedi.','VERIFY')}
      if(v.sha256!==m.sha256)throw E('Yeni kopya doğrulanamadı; kilitli dosya değişmedi.','VERIFY');
      // Yer degistirmeden ONCE kayda yeni dosyanin kimligi yazilir: rename ile kayit arasinda kesilirse repair() gorunen
      // dosyanin bu yeni surum oldugunu bilir ve yedegi ona tasir (eski surumu "geri getirilmis" diye koymaz).
      const a=regRead(),e=a.find(r=>r.path===p),b=e&&bakPath(e.id);
      if(e){const id=fid(tmp);if(id){e.next={...id,size:m.size};regWrite(a);marked=e.id}}
      // Bayraklar once kaldirilir ki rename'den hemen sonra yedek bag yenilensin (aradaki pencere en kisa olsun)
      if(b&&exists(b))try{await chflags(b,false);bk=b}catch(_){}
      try{await chflags(p,false);cleared=true}catch(e){}
      await fsp.rename(tmp,p);tmp=null;fsyncDir(d);
      // Yedek bag hala eski inode'u gosteriyor: yeni dosyaya atomik olarak yenile; olmazsa eski surum yedegi silinir
      if(b){
        if(x.beforeBackup)await x.beforeBackup();
        e.backup=linkBackup(p,e.id);
        if(!e.backup)try{fs.rmSync(b,{force:true})}catch(_){}
      }
      let flagged=true;try{await chflags(p,true)}catch(e){flagged=false}
      if(b&&e.backup)try{await chflags(b,true)}catch(_){}
      if(e){e.size=m.size;e.updatedAt=now();delete e.next;regWrite(a)}
      return {size:m.size,flagged,backup:!!(e&&e.backup)};
    }catch(e){
      if(tmp){await fsp.rm(tmp,{force:true}).catch(()=>{});if(cleared)await chflags(p,true).catch(()=>{});
        // yer degistirilmedi: isaret silinir, yedek bayragi geri konur
        if(bk)await chflags(bk,true).catch(()=>{});
        if(marked)try{const a=regRead(),r=a.find(q=>q.id===marked);if(r&&r.next){delete r.next;regWrite(a)}}catch(_){}}
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
    for(const e of regRead())if(e.path===p)await dropBackup(e.id,chflags);
    regDrop(p);
    for(const [k,t] of temps)if(t.locked===p){try{fs.rmSync(t.dir,{recursive:true,force:true})}catch(e){}temps.delete(k)}
    return true;
  }

  // Ac: ozel gecici klasore (0700) cozer; oturum kilitlenince silinir. Cozme surerken kasa kilitlenirse kopya birakilmaz.
  async function openTemp(p,x={}){
    need();checkLocked(p);
    for(const [k,t] of temps)if(t.locked===p&&exists(k))return k;
    const g=gen,locked=()=>E('Kasa kilitlendi; dosya açılmadı.','LOCKED');
    let meta;try{meta=await header(p)}catch(e){throw g!==gen?locked():e}
    if(g!==gen||!dk)throw locked();
    fs.mkdirSync(tmpRoot,{recursive:true,mode:0o700});
    const td=fs.mkdtempSync(path.join(tmpRoot,TMPPRE));fs.chmodSync(td,0o700);
    const tp=path.join(td,safeName(meta.name));
    try{await decryptTo(p,tp,{onProgress:x.onProgress})}catch(e){fs.rmSync(td,{recursive:true,force:true});throw g!==gen?locked():e}
    if(g!==gen||!dk){fs.rmSync(td,{recursive:true,force:true});throw locked()}
    temps.set(tp,{dir:td,locked:p});return tp;
  }
  async function saveTemp(p,x={}){
    need();
    for(const [k,t] of temps)if(t.locked===p&&exists(k))return relock(p,k,x);
    throw E('Bu dosyanın açık bir kopyası yok.','NOTEMP');
  }
  // Baska yerden gelen .kilitli dosyayi listeye ekle (bu kasanin anahtariyla acilabiliyorsa)
  async function adopt(p,x={}){
    need();const chflags=x.chflags||o.chflags||noop;
    if(typeof p!=='string'||!path.isAbsolute(p))throw E('Geçersiz kilitli dosya.','PATH');
    const real=realOr(p);checkLocked(real);
    // Yalnizca ev klasorundeki dosyalar; kasanin kendi klasoru (yedek/, tmp/) asla
    const h=realOr(home),nm=path.basename(real);
    if(!inside(real,h)||real===h)throw E(`"${nm}" ev klasörünün dışında; listeye eklenemez.`,'OUTSIDE');
    if(inside(real,realOr(dir))||inside(real,realOr(tmpRoot)))throw E(`"${nm}" uygulamanın kendi dosyası; listeye eklenemez.`,'DENY');
    const meta=await header(real);
    const old=live().find(e=>e.path===real);if(old)return old;
    const id=rand(8),base={id,path:real,name:meta.name,size:meta.size,lockedAt:now()};
    regAdd({...base,backup:false});                    // once kayit: yedek bag hicbir zaman sahipsiz kalmaz
    let cleared=false;try{await chflags(real,false);cleared=true}catch(e){}
    const backup=linkBackup(real,id);
    if(cleared)try{await chflags(real,true)}catch(e){}
    if(backup)try{await chflags(bakPath(id),true)}catch(e){}
    return regAdd({...base,backup});
  }

  // Acilista: onceki oturumdan (cokus) kalan acik kopyalari ve kayitli dosyalarin yanindaki yarim islem dosyalarini sil
  function sweep(){
    wipeTemps();
    const dirs=new Set(regRead().map(e=>path.dirname(String(e.path||''))).filter(d=>path.isAbsolute(d)));
    for(const d of dirs){let names=[];try{names=fs.readdirSync(d)}catch(e){continue}
      for(const n of names)if(PARTIAL.test(n))try{const q=path.join(d,n);if(fs.lstatSync(q).isFile())fs.rmSync(q,{force:true})}catch(e){}}
    // yarim kalan yedek baglari (yenileme sirasinda cokus); tamamlanmis yedeklere dokunulmaz
    let bn=[];try{bn=fs.readdirSync(bdir)}catch(e){}
    for(const n of bn)if(BAKTMP.test(n))try{fs.rmSync(path.join(bdir,n),{force:true})}catch(e){}
    settlePending();
  }
  // Yarim kalmis kilitleme kayitlari (lockFile yerlestirme ile son kayit arasinda kesildi):
  //  - .kilitli yoksa: kayit (ve varsa yedek) silinir
  //  - .kilitli var ve orijinal hala yerinde: geri alinir (.kilitli silinir, orijinal kalir)
  //  - .kilitli var, orijinal silinmis: kayit tamamlanir; yedek bagi/bayrak repair()'de kurulur
  function settlePending(){
    const a=regRead();if(!a.some(e=>e&&e.pending))return;
    const out=[];
    for(const e of a){
      if(!e||!e.pending){out.push(e);continue}
      const b=bakPath(e.id),vis=typeof e.path==='string'&&path.isAbsolute(e.path)&&exists(e.path);
      const src=typeof e.src==='string'&&path.isAbsolute(e.src)&&e.src+EXT===e.path?e.src:null;
      if(vis&&isLockedFile(e.path)&&!(src&&exists(src))){
        const {pending,src:_s,...r}=e;
        r.backup=!!b&&exists(b)&&sameFile(e.path,b);r.unflagged=true;out.push(r);continue;
      }
      // geri al: yalnizca bizim yazdigimiz .kilitli (orijinal duruyor); baska bir dosyaya dokunulmaz
      if(vis&&src&&exists(src)&&isLockedFile(e.path)&&!(b&&exists(b)&&!sameFile(e.path,b)))try{fs.rmSync(e.path,{force:true});fsyncDir(path.dirname(e.path))}catch(_){}
      if(b)try{fs.rmSync(b,{force:true})}catch(_){}
    }
    try{regWrite(out)}catch(e){}
  }
  sweep();

  return {setup,hasPassword:()=>!!read(),status:()=>load().state,hasBiometric:()=>!!(read()||{}).bio&&!!o.unprotect,
    unlockWithPassword,unlockWithKey,unlockBiometric,lock,isUnlocked:()=>!!dk,changePassword,resetPassword,
    touch,remainingMs:()=>dk?Math.max(0,deadline-now()):0,idleMs,
    lockFile,decryptTo,verify,header,unlockFile,relock,removeLocked,openTemp,saveTemp,adopt,
    files,entry,forget,check,repair,backupDir:bdir,temps:()=>[...temps.keys()],_peek:()=>dk};
}

module.exports={createVault,encryptStream,decryptStream,decryptToFile,checkLockable,checkLocked,safeName,freeName,human,
  EXT,MAGIC,CHUNK,RESERVE,IDLE};
