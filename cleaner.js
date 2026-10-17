// Temizlik: kopya dosyalari bulma ve guvenli sistem temizligi. Electron'suz; testler gecici klasorlerde calisir.
// Temel kural: kullanicinin acikca secmedigi hicbir sey silinmez, kullanici dosyalari asla kalici silinmez
// (yalnizca Cop Sepeti'ne). Kalici silme yalnizca yeniden olusturulan onbellek/gunluk klasorlerinde yapilir ve
// removeItems icindeki koruma, cagirandan bagimsiz olarak her yolu yeniden denetler.
const fs=require('fs'),fsp=fs.promises,path=require('path'),os=require('os'),crypto=require('crypto');

const CHUNK=64*1024,DAY=864e5,MAXD=24;
const BUNDLE=/\.(app|photoslibrary|musiclibrary|tvlibrary|fcpbundle|logicx|imovielibrary|bundle|framework|xcodeproj|xcworkspace)$/i;
const SKIP_DIR=new Set(['node_modules','.git']);
const DLTRASH=/(^|[\/\\])(Downloads|\.Trash|\.Trashes|Trash)([\/\\]|$)/i;
// Her zaman korunan onbellekler (iCloud, anahtar zinciri, Safari, Bul, Fotograflar, Mail vb.)
const CACHE_KEEP=[/^com\.apple\.Safari/i,/^com\.apple\.bird$/i,/^CloudKit$/i,/^com\.apple\.akd$/i,/^com\.apple\.nsurlsessiond$/i,
  /^com\.apple\.HomeKit$/i,/^com\.apple\.homed$/i,/^FamilyCircle$/i,/^com\.apple\.ap\.adprivacyd$/i,/^com\.apple\.findmy/i,/^GeoServices$/i,
  /^com\.apple\.passd$/i,/^com\.apple\.Photos/i,/^com\.apple\.mail/i,/keychain/i,/^com\.apple\.cloud/i,/^com\.apple\.icloud/i,
  /^com\.apple\.security/i,/^com\.apple\.trustd/i,/^com\.apple\.containermanagerd/i];
// Bu ust klasorler baska kategoride (tarayici/gelistirici) ya da hic taranmaz; onbellek kategorisinde sayilmaz
const CACHE_OTHER=new Set(['google','com.google.chrome','firefox','com.microsoft.edgemac','bravesoftware','yarn','pip','homebrew']);
const BROWSERS=[['com.google.Chrome','Chrome'],['org.mozilla.firefox','Firefox'],['com.microsoft.edgemac','Edge'],['com.brave.Browser','Brave']];

const tick=()=>new Promise(r=>setImmediate(r));
const abortErr=()=>Object.assign(new Error('İptal edildi'),{name:'AbortError'});
const perm=e=>e&&(e.code==='EACCES'||e.code==='EPERM');
const hidden=n=>n.startsWith('.');
// child, parent'in kesinlikle icinde mi (parent'in kendisi degil)
const inside=(c,p)=>{const b=p.endsWith(path.sep)?p:p+path.sep;return c.length>b.length&&c.startsWith(b)};
const insideCI=(c,p)=>inside(c.toLowerCase(),p.toLowerCase())||c.toLowerCase()===p.toLowerCase();
const fmt=v=>v.toFixed(1).replace('.',',');
const human=n=>{n=Math.max(0,+n||0);return n>=1024**4?fmt(n/1024**4)+' TB':n>=1024**3?fmt(n/1024**3)+' GB':n>=1024**2?fmt(n/1024**2)+' MB':n>=1024?Math.round(n/1024)+' KB':n+' B'};
async function lstatOk(p){try{return await fsp.lstat(p)}catch(e){return null}}
const isDir=st=>st&&st.isDirectory()&&!st.isSymbolicLink();

// Temizlik kaydi: her kaldirma bir JSON satiri
function appendLog(logFile,rec){
  if(!logFile)return;
  try{fs.mkdirSync(path.dirname(logFile),{recursive:true});fs.appendFileSync(logFile,JSON.stringify({t:new Date().toISOString(),...rec})+'\n')}catch(e){}
}

// ---------- Kopya dosyalar ----------

// Klasorleri gez: sembolik baglar izlenmez, gizli/paket klasorleri ve ~/Library atlanir, ayni inode bir kez sayilir
async function walkFiles(roots,{minSize,signal,exclude,home,onFile}){
  const lib=path.join(home,'Library'),ex=exclude.map(p=>path.resolve(p)),seen=new Set();
  const excluded=p=>ex.some(e=>p===e||inside(p,e));
  const stack=[];let n=0;
  for(const r of roots){const p=path.resolve(r);if(isDir(await lstatOk(p))&&!excluded(p))stack.push(p)}
  while(stack.length){
    if(signal&&signal.aborted)throw abortErr();
    const dir=stack.pop();let ents;
    try{ents=await fsp.readdir(dir,{withFileTypes:true})}catch(e){continue}
    for(const d of ents){
      const p=path.join(dir,d.name);
      if(d.isSymbolicLink()||hidden(d.name)||excluded(p))continue;
      if(d.isDirectory()){if(!SKIP_DIR.has(d.name)&&!BUNDLE.test(d.name)&&p!==lib)stack.push(p);continue}
      if(!d.isFile()||/\.icloud$/i.test(d.name))continue;
      let st;try{st=await fsp.lstat(p)}catch(e){continue}
      if(!st.isFile()||st.size<minSize)continue;
      if(st.blocks===0&&st.size>4096)continue;           // indirilmemis bulut dosyasi: okumak indirmeyi tetikler
      const id=st.dev+':'+st.ino;if(seen.has(id))continue;seen.add(id);   // sabit bag = ayni dosya
      onFile({path:p,size:st.size,mtimeMs:st.mtimeMs,birthtimeMs:st.birthtimeMs});
      if(++n%500===0)await tick();
    }
  }
}

async function readAt(fh,pos,len){const b=Buffer.alloc(len);const {bytesRead}=await fh.read(b,0,len,pos);return b.subarray(0,bytesRead)}
// Hizli ozet: kucuk dosyada tum icerik (tam SHA-256 ile ayni), buyukte ilk+son 64 KB + boyut
async function quickHash(p,size){
  const fh=await fsp.open(p,'r');
  try{
    const h=crypto.createHash('sha256');
    if(size<=2*CHUNK){h.update(await readAt(fh,0,size));return {full:true,hash:h.digest('hex')}}
    h.update(String(size));h.update(await readAt(fh,0,CHUNK));h.update(await readAt(fh,size-CHUNK,CHUNK));
    return {full:false,hash:h.digest('hex')};
  }finally{await fh.close()}
}
async function fullHash(p,signal){
  const h=crypto.createHash('sha256'),s=fs.createReadStream(p,{highWaterMark:1024*1024});
  try{for await(const c of s){if(signal&&signal.aborted)throw abortErr();h.update(c)}}finally{s.destroy()}
  return h.digest('hex');
}

// Kalacak kopya: Indirilenler/Cop disindaki, sonra en eski olusturulan, sonra en kisa yol
function pickKeep(files){
  const born=f=>f.birthtimeMs>0?f.birthtimeMs:f.mtimeMs;
  return [...files].sort((a,b)=>(DLTRASH.test(a.path)-DLTRASH.test(b.path))||(born(a)-born(b))||(a.path.length-b.path.length)||(a.path<b.path?-1:1))[0].path;
}

async function findDuplicates(roots,o={}){
  const {minSize=1024,onProgress,signal,exclude=[],home=os.homedir()}=o;
  const bySize=new Map();let files=0,bytes=0,last=0,total=0;
  const prog=(phase,force)=>{const t=Date.now();if(!onProgress||(!force&&t-last<150))return;last=t;
    try{onProgress({phase,files,bytes,total})}catch(e){}};
  await walkFiles(roots||[],{minSize:Math.max(1,minSize),signal,exclude,home,onFile:f=>{
    files++;bytes+=f.size;let a=bySize.get(f.size);if(!a)bySize.set(f.size,a=[]);a.push(f);prog('tara')}});
  prog('tara',true);
  const cands=[...bySize.values()].filter(a=>a.length>1);
  files=0;bytes=0;total=cands.reduce((s,a)=>s+a.length,0);prog('karsilastir',true);
  const groups=[];
  for(const list of cands){
    const byQ=new Map();
    for(const f of list){
      if(signal&&signal.aborted)throw abortErr();
      try{const q=await quickHash(f.path,f.size);f.q=q;let a=byQ.get(q.hash);if(!a)byQ.set(q.hash,a=[]);a.push(f)}catch(e){}
      files++;bytes+=Math.min(f.size,2*CHUNK);prog('karsilastir');
    }
    for(const sub of byQ.values()){
      if(sub.length<2)continue;
      const byH=new Map();
      for(const f of sub){
        let h=f.q.full?f.q.hash:null;
        if(!h){try{h=await fullHash(f.path,signal)}catch(e){if(e.name==='AbortError')throw e;continue}bytes+=f.size;prog('karsilastir')}
        let a=byH.get(h);if(!a)byH.set(h,a=[]);a.push(f);
      }
      for(const [hash,fl] of byH){
        if(fl.length<2)continue;
        const out=fl.map(({path:p,mtimeMs,birthtimeMs})=>({path:p,mtimeMs,birthtimeMs}));
        groups.push({size:fl[0].size,hash,files:out,keep:pickKeep(out)});
      }
    }
    await tick();
  }
  prog('karsilastir',true);
  return groups.sort((a,b)=>b.size*(b.files.length-1)-a.size*(a.files.length-1));
}

// ---------- Sistem temizligi ----------

// Boyut: sembolik bag izlenmez, izin hatalari atlanip sayilir; en yeni degisiklik zamani da doner
async function sizeOf(p){
  let size=0,newest=0,skipped=0,n=0;const stack=[p];
  while(stack.length){
    const q=stack.pop();let st;
    try{st=await fsp.lstat(q)}catch(e){if(perm(e))skipped++;continue}
    newest=Math.max(newest,st.mtimeMs);
    if(isDir(st)){let ents;try{ents=await fsp.readdir(q)}catch(e){if(perm(e))skipped++;continue}for(const e of ents)stack.push(path.join(q,e))}
    else size+=st.size;
    if(++n%1000===0)await tick();
  }
  return {size,newest,skipped};
}
async function children(dir,stats){
  try{return (await fsp.readdir(dir)).filter(n=>!hidden(n)).map(n=>path.join(dir,n))}
  catch(e){if(perm(e))stats.skipped++;return []}
}
const runningMatch=(name,ids)=>{name=name.toLowerCase();return ids.some(id=>name===id||name.startsWith(id+'.'))};
// Tarayici onbellegi hangi tarayiciya ait (calisiyorsa dokunulmaz)
function browserOf(p,home){
  const C=path.join(home,'Library','Caches'),rel=inside(p,C)?p.slice(C.length+1).toLowerCase():'';
  if(rel.startsWith('google'+path.sep+'chrome')||rel.startsWith('com.google.chrome'))return 'com.google.Chrome';
  if(rel.startsWith('firefox'))return 'org.mozilla.firefox';
  if(rel.startsWith('com.microsoft.edgemac'))return 'com.microsoft.edgemac';
  if(rel.startsWith('bravesoftware'))return 'com.brave.Browser';
  return null;
}

// Bos klasorler (yalnizca bos alt klasor ve .DS_Store iceren); kok klasorun kendisi raporlanmaz
async function emptyDirs(base,stats){
  const out=[];let n=0;
  async function rec(dir,depth,isRoot){
    let ents;try{ents=await fsp.readdir(dir,{withFileTypes:true})}catch(e){if(perm(e))stats.skipped++;return false}
    let empty=true;const kids=[];
    for(const d of ents){
      if(d.name==='.DS_Store'&&d.isFile())continue;
      if(d.isDirectory()&&!d.isSymbolicLink()&&!hidden(d.name)&&!BUNDLE.test(d.name)&&!SKIP_DIR.has(d.name)&&depth<MAXD){
        const p=path.join(dir,d.name);if(await rec(p,depth+1,false))kids.push(p);else empty=false;
      }else empty=false;
    }
    if(!empty||isRoot)out.push(...kids);
    if(++n%200===0)await tick();
    return empty;
  }
  if(isDir(await lstatOk(base)))await rec(base,0,true);
  return out;
}

const CATS={
  cache:{title:'Uygulama önbellekleri',desc:'Uygulamaların hız için tuttuğu geçici dosyalar; silinince gerektiğinde yeniden oluşturulur. Açık uygulamalar ve iCloud, Safari, Anahtar Zinciri gibi sistem önbellekleri atlanır.',mode:'delete',default:true},
  logs:{title:'Eski günlük dosyaları',desc:'Uygulamaların 7 günden eski kayıt (log) dosyaları; yalnızca sorun giderme içindir, silmek güvenlidir.',mode:'delete',default:true},
  dev:{title:'Geliştirici önbellekleri',desc:'Xcode, simülatör, npm, Yarn, pip, Gradle ve Homebrew ara dosyaları; bir sonraki derleme ya da kurulumda yeniden indirilir veya oluşturulur.',mode:'delete',default:false},
  browser:{title:'Tarayıcı önbellekleri',desc:'Chrome, Firefox, Edge ve Brave’in sayfa önbelleği; geçmiş, çerez, parola ve yer imlerine dokunulmaz. Açık tarayıcılar atlanır.',mode:'delete',default:false},
  installers:{title:'Eski yükleyiciler',desc:'İndirilenler klasöründe 30 günden eski .dmg, .pkg, .xip ve .iso dosyaları; Çöp Sepeti’ne taşınır, gerekirse geri alınabilir.',mode:'trash',default:false},
  trash:{title:'Çöp Sepeti',desc:'Çöp Sepeti’ndeki öğeler; boşaltılınca geri alınamaz, bu yüzden kendiliğinden seçilmez.',mode:'trash-empty',default:false},
  emptydirs:{title:'Boş klasörler',desc:'İndirilenler, Masaüstü ve Belgeler içindeki hiçbir dosya içermeyen klasörler; yalnızca hâlâ boşlarsa kaldırılır.',mode:'delete',default:false},
};

async function scanJunk(home=os.homedir(),o={}){
  const {runningBundleIds=[],now=Date.now(),onProgress}=o;
  const ids=runningBundleIds.map(s=>String(s).toLowerCase()),stats={skipped:0};
  const L=path.join(home,'Library'),C=path.join(L,'Caches');
  const prog=id=>{try{onProgress&&onProgress({phase:'sistem',id,title:CATS[id].title})}catch(e){}};
  const measure=async(paths,filter)=>{const out=[];for(const p of paths){const st=await lstatOk(p);if(!st||st.isSymbolicLink())continue;
    const s=await sizeOf(p);stats.skipped+=s.skipped;if(!filter||filter(s,st))out.push({path:p,size:s.size});}return out};
  const cats=[];
  const add=(id,items,extra)=>{items.sort((a,b)=>b.size-a.size);cats.push({id,...CATS[id],items,size:items.reduce((s,i)=>s+i.size,0),...extra})};

  // a) Uygulama onbellekleri
  prog('cache');
  const cacheList=(await children(C,stats)).filter(p=>{const n=path.basename(p);
    return !CACHE_OTHER.has(n.toLowerCase())&&!CACHE_KEEP.some(r=>r.test(n))&&!runningMatch(n,ids)});
  add('cache',await measure(cacheList,s=>s.size>0));

  // b) Eski gunlukler: icindeki en yeni degisiklik bile 7 gunden eski olmali
  prog('logs');
  add('logs',await measure(await children(path.join(L,'Logs'),stats),(s)=>s.newest<now-7*DAY));

  // c) Gelistirici onbellekleri: kok klasorler korunur, icerikleri temizlenir
  prog('dev');
  const devRoots=[path.join(L,'Developer/Xcode/DerivedData'),path.join(L,'Developer/Xcode/iOS DeviceSupport'),path.join(L,'Developer/CoreSimulator/Caches'),
    path.join(home,'.npm/_cacache'),path.join(home,'.gradle/caches')];
  let dev=[];for(const r of devRoots)if(isDir(await lstatOk(r)))dev.push(...await children(r,stats));
  dev.push(...['Yarn','pip','Homebrew'].map(n=>path.join(C,n)));
  add('dev',await measure(dev,s=>s.size>0));

  // d) Tarayici onbellekleri (profil, gecmis, cerez, parola asla)
  prog('browser');
  const br=[];
  for(const prof of await children(path.join(C,'Google/Chrome'),stats))for(const s of ['Cache','Code Cache'])br.push(path.join(prof,s));
  br.push(path.join(C,'com.google.Chrome'));
  for(const prof of await children(path.join(C,'Firefox/Profiles'),stats))br.push(path.join(prof,'cache2'));
  br.push(path.join(C,'com.microsoft.edgemac'),path.join(C,'BraveSoftware'));
  const open=BROWSERS.filter(([id])=>ids.includes(id.toLowerCase()));
  const brItems=await measure(br.filter(p=>!open.some(([id])=>browserOf(p,home)===id)),(s,st)=>st.isDirectory()&&s.size>0);
  add('browser',brItems,open.length?{note:open.map(b=>b[1]).join(', ')+' açık olduğu için atlandı.'}:{});

  // e) Eski yukleyiciler (Indirilenler kokunde)
  prog('installers');
  const dl=path.join(home,'Downloads');
  const inst=(await children(dl,stats)).filter(p=>/\.(dmg|pkg|xip|iso)$/i.test(p));
  add('installers',await measure(inst,(s,st)=>st.mtimeMs<now-30*DAY));

  // f) Cop Sepeti: yalnizca boyut; bosaltmayi Electron tarafi yapar
  prog('trash');
  const tr=path.join(home,'.Trash');let trItems=[];
  try{trItems=(await fsp.readdir(tr)).filter(n=>n!=='.DS_Store').map(n=>path.join(tr,n))}catch(e){if(perm(e))stats.skipped++}
  add('trash',await measure(trItems));

  // g) Bos klasorler
  prog('emptydirs');
  const ed=[];for(const d of ['Downloads','Desktop','Documents'])ed.push(...await emptyDirs(path.join(home,d),stats));
  add('emptydirs',await measure(ed));

  return {categories:cats,total:cats.reduce((s,c)=>s+c.size,0),skipped:stats.skipped};
}

// ---------- Kaldirma (koruma burada, cagirandan bagimsiz) ----------

function allowed(home){
  const L=path.join(home,'Library');
  return {lib:L,caches:path.join(L,'Caches'),
    del:[path.join(L,'Caches'),path.join(L,'Logs'),path.join(L,'Developer/Xcode/DerivedData'),path.join(L,'Developer/Xcode/iOS DeviceSupport'),
      path.join(L,'Developer/CoreSimulator/Caches'),path.join(home,'.npm/_cacache'),path.join(home,'.gradle/caches')],
    empty:['Downloads','Desktop','Documents'].map(d=>path.join(home,d))};
}
const deny=m=>{throw new Error(m)};

// Bir yolun verilen kipte kaldirilabilir olup olmadigini denetler; degilse Turkce hata atar
async function guard(p,mode,home){
  if(typeof home!=='string'||!path.isAbsolute(home)||path.resolve(home)===path.parse(path.resolve(home)).root)deny('Ev klasörü geçersiz.');
  home=path.resolve(home);
  if(typeof p!=='string'||!p)deny('Geçersiz yol.');
  if(!path.isAbsolute(p))deny('Yol tam (mutlak) değil.');
  if(p.split(/[\/\\]/).includes('..')||path.resolve(p)!==p)deny('Yol normal biçimde değil.');
  if(p===path.parse(p).root||p===home)deny('Kök ya da ev klasörü kaldırılamaz.');
  const st=await lstatOk(p);if(!st)deny('Bulunamadı.');
  if(st.isSymbolicLink())deny('Sembolik bağlar (kısayollar) kaldırılmaz.');
  const A=allowed(home);let root,kind;
  if(mode==='delete'){
    root=A.del.find(r=>inside(p,r));
    if(root){
      if(root===A.caches&&CACHE_KEEP.some(r=>r.test(p.slice(root.length+1).split(path.sep)[0])))deny('Bu sistem önbelleği korunuyor.');
      kind='rm';
    }else if((root=A.empty.find(r=>inside(p,r)))&&isDir(st))kind='emptydir';
    else deny('İzin verilen temizlik klasörlerinin dışında; kaldırılmadı.');
  }else if(mode==='trash'){
    if(!inside(p,home))deny('Ev klasörünün dışında; taşınmadı.');
    if(insideCI(p,A.lib))deny('Kitaplık (Library) klasörü Çöp Sepeti’ne taşınmaz.');
    root=home;kind='trash';
  }else deny('Bilinmeyen temizlik kipi.');
  // Ust klasorlerdeki sembolik baglarla izinli kokun disina cikilmasin
  let real,realRoot;
  try{realRoot=await fsp.realpath(root);real=path.join(await fsp.realpath(path.dirname(p)),path.basename(p))}catch(e){deny('Yol çözümlenemedi.')}
  if(!inside(real,realRoot))deny('Yol izin verilen klasörün dışına çıkıyor.');
  if(kind==='trash'){let rl=null;try{rl=await fsp.realpath(A.lib)}catch(e){}if(rl&&insideCI(real,rl))deny('Kitaplık (Library) klasörü Çöp Sepeti’ne taşınmaz.')}
  return {kind,st};
}

// Bos klasoru kaldir: o anda hala yalnizca bos klasor ve .DS_Store iceriyorsa; asagidan yukari rmdir
async function removeEmptyDir(dir){
  const dirs=[],ds=[];let size=0;
  const stack=[dir];
  while(stack.length){
    const d=stack.pop();dirs.push(d);
    for(const e of await fsp.readdir(d,{withFileTypes:true})){
      const p=path.join(d,e.name);
      if(e.name==='.DS_Store'&&e.isFile()){ds.push(p);size+=(await fsp.lstat(p)).size;continue}
      if(e.isDirectory()&&!e.isSymbolicLink()&&!hidden(e.name)){stack.push(p);continue}
      deny('Klasör artık boş değil; kaldırılmadı.');
    }
  }
  for(const f of ds)await fsp.unlink(f);
  for(const d of dirs.reverse())await fsp.rmdir(d);   // dolu ise rmdir zaten hata verir
  return size;
}

async function removeItems(items,o={}){
  const {mode,trash,home=os.homedir(),logFile}=o;
  const removed=[],failed=[];let freed=0;
  for(const it of Array.isArray(items)?items:[]){
    const p=typeof it==='string'?it:it&&it.path;
    try{
      const {kind}=await guard(p,mode,home);let size=0;
      if(kind==='trash'){
        if(typeof trash!=='function')deny('Çöp Sepeti işlevi yok.');
        size=(await sizeOf(p)).size;await trash(p);
      }else if(kind==='emptydir')size=await removeEmptyDir(p);
      else{size=(await sizeOf(p)).size;await fsp.rm(p,{recursive:true})}
      removed.push(p);freed+=size;appendLog(logFile,{path:p,size,mode:kind==='emptydir'?'rmdir':mode});
    }catch(e){failed.push({path:String(p),error:e&&e.message||String(e)})}
  }
  return {removed,failed,freed};
}

// Dosya hala grubun icerigine sahip mi (var, normal dosya, ayni boyut, ayni tam ozet)
async function sameContent(p,g){
  const st=await lstatOk(p);
  if(!st||!st.isFile()||st.isSymbolicLink()||st.size!==g.size)return false;
  try{return await fullHash(p)===g.hash}catch(e){return false}
}

// Secilen kopyalari yalnizca Cop Sepeti'ne tasir; her gruptan en az bir dogrulanmis kopya kalir
async function removeDuplicates(groups,selectedPaths,o={}){
  const {trash,home=os.homedir(),logFile}=o;
  const sel=new Set((Array.isArray(selectedPaths)?selectedPaths:[]).filter(p=>typeof p==='string'));
  const removed=[],failed=[],known=new Set();let freed=0;
  const fail=(p,m)=>failed.push({path:p,error:m});
  for(const g of Array.isArray(groups)?groups:[]){
    const mine=g.files.filter(f=>sel.has(f.path)&&!known.has(f.path));mine.forEach(f=>known.add(f.path));
    if(!mine.length)continue;
    const rest=g.files.filter(f=>!sel.has(f.path));
    if(!rest.length){mine.forEach(f=>fail(f.path,'Bu grubun tüm kopyaları seçili; en az biri kalmalı.'));continue}
    // Kalan kopyalardan en az biri hala ayni icerikte olmali (once onerilen kalacak)
    rest.sort((a,b)=>(b.path===g.keep)-(a.path===g.keep));
    let ok=null;for(const f of rest)if(await sameContent(f.path,g)){ok=f;break}
    if(!ok){mine.forEach(f=>fail(f.path,'Kalan kopya değişmiş ya da yok; bu gruptan hiçbir şey taşınmadı.'));continue}
    for(const f of mine){
      try{
        const p=f.path;
        if(typeof trash!=='function')deny('Çöp Sepeti işlevi yok.');
        if(!path.isAbsolute(p)||path.resolve(p)!==p||p.split(/[\/\\]/).includes('..'))deny('Yol normal biçimde değil.');
        if(insideCI(p,path.join(home,'Library')))deny('Kitaplık (Library) içindeki dosyalara dokunulmaz.');
        const st=await lstatOk(p);
        if(!st)deny('Dosya artık yok.');
        if(st.isSymbolicLink()||!st.isFile())deny('Normal bir dosya değil.');
        if(!await sameContent(p,g))deny('Dosya taramadan sonra değişmiş; taşınmadı.');
        await trash(p);
        removed.push(p);freed+=g.size;appendLog(logFile,{path:p,size:g.size,mode:'trash',kind:'kopya',kept:ok.path});
      }catch(e){fail(f.path,e&&e.message||String(e))}
    }
  }
  for(const p of sel)if(!known.has(p))fail(p,'Son taramada bulunmayan dosya; taşınmadı.');
  return {removed,failed,freed};
}

module.exports={findDuplicates,scanJunk,removeItems,removeDuplicates,human,pickKeep,guard,sizeOf,appendLog,browserOf,runningMatch,CATS};
