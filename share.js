// QR ile dosya paylasimi: Mac'te kisa omurlu bir web sunucusu acilir, telefon (iPhone/Android/iPad) QR'i okutup
// kendi tarayicisinda dosyalari indirir ya da Mac'e dosya gonderir. Uygulama, hesap ve internet gerekmez (ayni Wi-Fi).
// Guvenlik: her oturumda tahmin edilemeyen anahtar (adreste), yalnizca yerel ag adresleri, sure dolunca kapanir,
// telefondan gelen dosyalar icin Mac'te onay istenir. Dosyalar diskten akitilir: boyut siniri yoktur, yalnizca bos alan.
// Onay bir "bilet"tir: yalnizca beyan edilen ad/boyuttaki dosyalar, her biri bir kez yuklenebilir.
const http=require('http'),fs=require('fs'),fsp=fs.promises,path=require('path'),os=require('os'),crypto=require('crypto');

const TTL=10*60*1000;               // islem yoksa 10 dk sonra kapanir
const MAXLIFE=2*60*60*1000;         // ne olursa olsun en fazla 2 saat acik kalir
const IDLE=2*60*1000;               // 2 dk veri akmayan baglanti kapatilir (takilan aktarim oturumu acik tutmasin)
const RESERVE=1024**3;              // diskte en az 1 GB bos kalsin
const PART='.cemapp-part';          // yarim yuklemelerin eki; acilista yalnizca bu ekli eski dosyalar silinir
const PART_OLD=60*60*1000;          // 1 saatten eski yarim yuklemeler artik
const NAMEMAX=200;                  // dosya adi en fazla 200 bayt (UTF-8; APFS siniri 255)

// Yerel ag IPv4 adresi: once Wi-Fi/Ethernet (en0, en1...), sonra ozel ag araliklari.
function lanAddress(){
  const nets=os.networkInterfaces(),cands=[];
  for(const [name,list] of Object.entries(nets))for(const a of list||[]){
    if(a.family!=='IPv4'&&a.family!==4||a.internal)continue;
    if(!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address))continue;
    cands.push({name,address:a.address,score:(/^en\d/.test(name)?0:1)+(/^192\.168\./.test(a.address)?0:0.5)});
  }
  cands.sort((a,b)=>a.score-b.score);
  return cands[0]?cands[0].address:null;
}

// Metni UTF-8 bayt sinirina gore kes (karakter ortasindan bolmeden)
function cutBytes(s,max){let o='',b=0;for(const ch of s){const n=Buffer.byteLength(ch);if(b+n>max)break;o+=ch;b+=n}return o}
// Dosya adini guvenli hale getir: yol, kontrol ve bicim (U+202E gibi yon) karakterleri yok, en fazla 200 bayt, gizli dosya olmasin
function safeName(n){
  n=path.basename(String(n||'').slice(0,4096).replace(/\\/g,'/')).replace(/\p{Cf}/gu,'').replace(/[\p{Cc}\p{Cs}<>:"|?*]/gu,'_').replace(/^\.+/,'').trim();
  if(!n)n='dosya';
  if(Buffer.byteLength(n)>NAMEMAX){let ext=path.extname(n);if(Buffer.byteLength(ext)>20)ext='';n=cutBytes(n.slice(0,n.length-ext.length),NAMEMAX-Buffer.byteLength(ext)).trim()+ext}
  return n;
}
const variant=(name,i)=>{if(i<2)return name;const ext=path.extname(name);return `${name.slice(0,name.length-ext.length)} (${i})${ext}`};
// Yarim dosyayi benzersiz adla ve 'wx' ile ayni anda olustur: es zamanli ayni adli yuklemeler birbirinin dosyasina dokunmaz
function openPart(dir,name){
  for(let i=1;i<10000;i++){const dest=path.join(dir,variant(name,i));if(fs.existsSync(dest))continue;
    try{return {fd:fs.openSync(dest+PART,'wx'),tmp:dest+PART}}catch(e){if(e.code!=='EEXIST')throw e}}
  throw new Error('uygun ad yok');
}
// Biten dosyayi asla uzerine yazmadan yerlestir: link EEXIST verirse bir sonraki ad denenir
async function place(tmp,dir,name){
  for(let i=1;i<10000;i++){const dest=path.join(dir,variant(name,i));
    try{await fsp.link(tmp,dest)}catch(e){if(e.code==='EEXIST')continue;
      if(!['EPERM','ENOTSUP','EOPNOTSUPP','ENOSYS','EXDEV'].includes(e.code))throw e;
      // sert bagi desteklemeyen disk: kopyala (COPYFILE_EXCL yine uzerine yazmaz)
      try{await fsp.copyFile(tmp,dest,fs.constants.COPYFILE_EXCL)}catch(e2){if(e2.code==='EEXIST')continue;await fsp.rm(dest,{force:true}).catch(()=>{});throw e2}}
    await fsp.rm(tmp,{force:true});return dest;
  }
  throw new Error('uygun ad yok');
}
// Bu uygulamanin onceki oturumlardan kalan eski yarim dosyalarini sil (yabanci .part dosyalarina dokunmaz)
function sweepParts(dir,now=Date.now()){
  let names=[];try{names=fs.readdirSync(dir)}catch(e){return 0}
  let n=0;for(const f of names){if(!f.endsWith(PART))continue;const p=path.join(dir,f);
    try{const st=fs.lstatSync(p);if(st.isFile()&&now-st.mtimeMs>PART_OLD){fs.rmSync(p,{force:true});n++}}catch(e){}}
  return n;
}
const freeBytes=dir=>{try{const s=fs.statfsSync(dir);return s.bavail*s.bsize}catch(e){return Infinity}};
const human=n=>n>=1024**3?(n/1024**3).toFixed(1)+' GB':n>=1024**2?(n/1024**2).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const contentDisposition=name=>`attachment; filename="${name.replace(/[^\x20-\x7e]/g,'_').replace(/"/g,"'")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

// opts: {downloadsDir, ask({ip,count,bytes,names}) -> Promise<bool>, onEvent(evt), host (test icin), ttl, maxLife, idle}
function createShare(opts={}){
  const token=crypto.randomBytes(18).toString('base64url');
  const files=new Map();                 // id -> {id,path,name,size}
  const tickets=new Map(),pending=new Set(); // onay biletleri (bilet -> {ip,files:[{name,size}]}), onay bekleyen IP'ler
  const inflight=new Set();              // suren yuklemelerin yarim dosyalari
  const received=[];
  let server=null,timer=null,life=null,url=null,active=0,closed=false;
  const ev=e=>{try{opts.onEvent&&opts.onEvent(e)}catch(_){}};
  const touch=()=>{clearTimeout(timer);if(closed)return;timer=setTimeout(()=>{if(active)return touch();stop('time')},opts.ttl||TTL)};

  function add(paths){
    for(const p of paths){try{const st=fs.statSync(p);if(!st.isFile())continue;
      const id=crypto.randomBytes(6).toString('hex');files.set(id,{id,path:p,name:path.basename(p),size:st.size})}catch(e){}}
    touch();ev({type:'files',files:list()});return list();
  }
  const remove=id=>{files.delete(id);ev({type:'files',files:list()});return list()};
  const list=()=>[...files.values()].map(({id,name,size})=>({id,name,size}));

  function page(){
    const items=list().map(f=>`<a class="f" href="f/${f.id}" download><span class="n">${esc(f.name)}</span><span class="s">${human(f.size)}</span><span class="d">İndir</span></a>`).join('')
      ||'<p class="e">Mac’ten gönderilen dosya yok.</p>';
    return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dosya paylaşımı</title><style>
:root{--bg:#f5f5f7;--fg:#1d1d1f;--m:#6e6e73;--c:#fff;--l:#d2d2d7;--a:#b25e09}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#f5f5f7;--m:#a1a1a6;--c:#232326;--l:#3a3a3e;--a:#f0a33a}}
*{box-sizing:border-box}body{margin:0;font:16px/1.4 -apple-system,system-ui,sans-serif;background:var(--bg);color:var(--fg);padding:20px 16px 40px;max-width:560px;margin:auto}
h1{font-size:20px;margin:4px 0 2px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--m);margin:26px 0 8px}
.m{color:var(--m);font-size:14px}.box{background:var(--c);border:1px solid var(--l);border-radius:12px;overflow:hidden}
.f{display:flex;align-items:center;gap:10px;padding:14px;color:inherit;text-decoration:none;border-top:1px solid var(--l)}.f:first-child{border-top:0}
.n{flex:1;word-break:break-all}.s{color:var(--m);font-size:13px;white-space:nowrap}.d{color:var(--a);font-weight:600}
.e{padding:14px;margin:0;color:var(--m)}label.b{display:block;text-align:center;padding:16px;border-radius:12px;background:var(--a);color:#fff;font-weight:600}
input{display:none}.p{margin-top:10px;font-size:14px}.bar{height:6px;border-radius:3px;background:var(--l);margin-top:6px;overflow:hidden}.bar i{display:block;height:100%;width:0;background:var(--a)}
</style></head><body><h1>Dosya paylaşımı</h1><p class="m">Mac ile aynı Wi-Fi ağındasın. Uygulama gerekmez.</p>
<h2>Mac'ten gelenler</h2><div class="box" id="fl">${items}</div>
<h2>Mac'e gönder</h2><label class="b">Dosya seç<input id="u" type="file" multiple></label><div id="st" class="p m"></div>
<script>
const st=document.getElementById('st');
function show(t,p){st.innerHTML='<div>'+t+'</div>'+(p!=null?'<div class="bar"><i style="width:'+p+'%"></i></div>':'')}
function up(f,t){return new Promise((ok,no)=>{const x=new XMLHttpRequest();x.open('POST','up?t='+encodeURIComponent(t)+'&size='+f.size+'&name='+encodeURIComponent(f.name));
  x.upload.onprogress=e=>{if(e.lengthComputable)show(f.name+' gönderiliyor… %'+Math.round(e.loaded/e.total*100),e.loaded/e.total*100)};
  x.onload=()=>x.status===200?ok():no(new Error(x.responseText||('HTTP '+x.status)));x.onerror=()=>no(new Error('Bağlantı koptu'));x.send(f)})}
// Mac'te eklenen dosyalar sayfa yenilenmeden gorunsun
const H=n=>n>=1073741824?(n/1073741824).toFixed(1)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
const E=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
let last='';setInterval(async()=>{try{const l=await fetch('list',{cache:'no-store'}).then(r=>r.json());const k=JSON.stringify(l);if(k===last)return;last=k;
  document.getElementById('fl').innerHTML=l.length?l.map(f=>'<a class="f" href="f/'+f.id+'" download><span class="n">'+E(f.name)+'</span><span class="s">'+H(f.size)+'</span><span class="d">İndir</span></a>').join(''):'<p class="e">Mac’ten gönderilen dosya yok.</p>'}catch(e){}},4000);
document.getElementById('u').onchange=async e=>{const fs=[...e.target.files];if(!fs.length)return;
  show('Mac’te onay bekleniyor…');
  const r=await fetch('ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({files:fs.map(f=>({name:f.name,size:f.size}))})}).then(r=>r.json()).catch(()=>({ok:false,msg:'Bağlantı yok'}));
  if(!r.ok){show(r.msg||'Mac gönderimi reddetti.');return}
  try{for(const f of fs)await up(f,r.ticket);show(fs.length+' dosya gönderildi.')}catch(err){show('Gönderilemedi: '+err.message)}
  e.target.value=''};
</script></body></html>`;
  }

  function sendFile(req,res,f){
    let st;try{st=fs.statSync(f.path)}catch(e){res.writeHead(404);return res.end('Dosya artık yok')}
    const size=st.size,range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range||'');
    let start=0,end=size-1,code=200;
    if(range&&size){start=range[1]?+range[1]:Math.max(0,size-(+range[2]||0));end=range[1]&&range[2]?Math.min(+range[2],size-1):size-1;
      if(start>end||start>=size){res.writeHead(416,{'content-range':`bytes */${size}`});return res.end()}code=206}
    res.writeHead(code,{'content-type':'application/octet-stream','content-length':end-start+1,'accept-ranges':'bytes',
      'content-disposition':contentDisposition(f.name),...(code===206?{'content-range':`bytes ${start}-${end}/${size}`}:{}),'cache-control':'no-store'});
    if(req.method==='HEAD')return res.end();
    active++;touch();ev({type:'download',name:f.name,ip:req.socket.remoteAddress});
    const s=fs.createReadStream(f.path,{start,end});s.pipe(res);
    const done=()=>{active=Math.max(0,active-1);touch()};res.on('close',done);s.on('error',()=>res.destroy());
  }

  function readJson(req,max=256*1024){return new Promise((ok,no)=>{const b=[];let n=0;
    req.on('data',c=>{n+=c.length;if(n>max){no(new Error('büyük'));req.destroy()}else b.push(c)});req.on('error',no);
    req.on('end',()=>{try{ok(JSON.parse(Buffer.concat(b).toString('utf8')||'{}'))}catch(e){no(e)}})})}
  const json=(res,code,o)=>{if(res.headersSent||res.destroyed)return;res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(o))};
  // Telefona yalnizca genel Turkce mesaj gider (yerel yol, sistem hatasi yok)
  const text=(res,code,msg)=>{if(res.headersSent||res.destroyed)return;res.writeHead(code,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});res.end(msg)};

  async function onAsk(req,res){
    const ip=req.socket.remoteAddress;let body;
    try{body=await readJson(req)}catch(e){return json(res,400,{ok:false,msg:'Geçersiz istek'})}
    const raw=Array.isArray(body&&body.files)?body.files:[];
    if(!raw.length)return json(res,400,{ok:false,msg:'Dosya seçilmedi'});
    if(raw.length>500)return json(res,400,{ok:false,msg:'Tek seferde en fazla 500 dosya gönderilebilir.'});
    const fl=raw.map(f=>({name:safeName(f&&f.name),size:f&&f.size}));
    if(fl.some(f=>!Number.isSafeInteger(f.size)||f.size<0))return json(res,400,{ok:false,msg:'Geçersiz dosya boyutu'});
    const bytes=fl.reduce((s,f)=>s+f.size,0);
    if(bytes>freeBytes(opts.downloadsDir)-RESERVE)return json(res,507,{ok:false,msg:'Mac\'te yeterli boş alan yok ('+human(bytes)+' gerekli).'});
    if(pending.has(ip))return json(res,429,{ok:false,msg:'Mac\'te bekleyen bir onay var.'});
    pending.add(ip);active++;touch();req.socket.setTimeout(0);   // kullanici dusunurken baglanti bosta kapanmasin
    let yes=false;try{yes=!!(opts.ask&&await opts.ask({ip,count:fl.length,bytes,names:fl.slice(0,5).map(f=>f.name)}))}catch(e){}
    pending.delete(ip);active=Math.max(0,active-1);touch();
    if(closed)return text(res,503,'Paylaşım kapandı.');
    if(!yes)return json(res,403,{ok:false,msg:'Mac gönderimi reddetti.'});
    // Bilet yalnizca bu listedeki ad+boyut ciftleri icin, her biri bir kez gecerli
    const id=crypto.randomBytes(18).toString('base64url');tickets.set(id,{ip,files:fl});
    json(res,200,{ok:true,ticket:id});
  }

  function onUpload(req,res,u){
    const ip=req.socket.remoteAddress,tid=u.searchParams.get('t')||'',tk=tickets.get(tid);
    if(!tk||tk.ip!==ip)return text(res,403,'Önce Mac\'te onay gerekli.');
    const name=safeName(u.searchParams.get('name')),sz=u.searchParams.get('size')||'',size=/^\d{1,16}$/.test(sz)?+sz:-1;
    const i=tk.files.findIndex(f=>f.name===name&&f.size===size);
    if(i<0)return text(res,403,'Bu dosya Mac\'te onaylanmadı.');
    const cl=req.headers['content-length'],len=/^\d{1,16}$/.test(cl||'')?+cl:-1;
    if(req.headers['transfer-encoding']||len!==size)return text(res,400,'Dosya boyutu onaylananla uyuşmuyor.');
    if(len>freeBytes(opts.downloadsDir)-RESERVE)return text(res,507,'Mac\'te yeterli boş alan yok.');
    tk.files.splice(i,1);if(!tk.files.length)tickets.delete(tid);   // her onay bir kez kullanilir
    let part;try{part=openPart(opts.downloadsDir,name)}catch(e){ev({type:'upload-fail',name,msg:e.message});return text(res,500,'Dosya kaydedilemedi.')}
    const {tmp}=part,out=fs.createWriteStream(tmp,{fd:part.fd});let n=0,failed=false,done=false;
    inflight.add(tmp);active++;touch();ev({type:'upload-start',name,ip});
    const fail=(msg,detail)=>{if(failed||done)return;failed=true;req.unpipe(out);out.destroy();inflight.delete(tmp);fs.rm(tmp,{force:true},()=>{});
      active=Math.max(0,active-1);touch();ev({type:'upload-fail',name,msg:detail||msg});
      if(!res.headersSent&&!res.destroyed){res.writeHead(500,{'content-type':'text/plain; charset=utf-8',connection:'close'});res.end(msg)}};
    req.on('data',c=>{n+=c.length;if(n>len)return fail('Fazla veri geldi.');if(n%(8*1024*1024)<c.length){touch();ev({type:'upload-progress',name,bytes:n,total:len})}});
    req.on('aborted',()=>fail('Bağlantı koptu.'));req.on('error',()=>fail('Bağlantı koptu.'));
    res.on('close',()=>{if(!done)fail('Bağlantı koptu.')});
    out.on('error',e=>fail('Dosya kaydedilemedi.',e.message));
    req.pipe(out);
    out.on('finish',()=>{if(failed)return;
      if(n!==len)return fail('Dosya eksik geldi.');
      place(tmp,opts.downloadsDir,name).then(dest=>{if(failed)return;done=true;inflight.delete(tmp);active=Math.max(0,active-1);touch();
        const item={name:path.basename(dest),path:dest,size:n,at:Date.now()};received.push(item);ev({type:'received',...item});
        text(res,200,'ok')},e=>fail('Dosya kaydedilemedi.',e.message))});
  }

  // Istek isleyicisi asla hata firlatmaz: bozuk istek ana sureci cokertmesin
  function handler(req,res){
    try{route(req,res)}catch(e){try{if(!res.headersSent){res.writeHead(400);res.end('Geçersiz istek')}else res.destroy()}catch(_){}}
  }
  function route(req,res){
    let u;try{u=new URL(req.url,'http://x')}catch(e){res.writeHead(400);return res.end('Geçersiz istek')}
    const parts=u.pathname.split('/').filter(Boolean);
    // Yalnizca /s/<anahtar>/... ; anahtar sabit zamanli karsilastirilir
    const ok=parts[0]==='s'&&parts[1]&&parts[1].length===token.length&&crypto.timingSafeEqual(Buffer.from(parts[1]),Buffer.from(token));
    res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
    if(!ok){res.writeHead(404);return res.end('Bulunamadı')}
    if(!u.pathname.endsWith('/')&&parts.length===2){res.writeHead(302,{location:u.pathname+'/'});return res.end()}
    const rest=parts.slice(2);touch();
    if(!rest.length&&(req.method==='GET'||req.method==='HEAD')){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
      'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'"});
      ev({type:'visit',ip:req.socket.remoteAddress});return res.end(req.method==='HEAD'?undefined:page())}
    if(rest[0]==='f'&&rest[1]&&(req.method==='GET'||req.method==='HEAD')){const f=files.get(rest[1]);if(!f){res.writeHead(404);return res.end('Dosya yok')}return sendFile(req,res,f)}
    if(rest[0]==='list'&&req.method==='GET')return json(res,200,list());
    if(rest[0]==='ask'&&req.method==='POST')return onAsk(req,res).catch(()=>json(res,500,{ok:false,msg:'Beklenmeyen hata'}));
    if(rest[0]==='up'&&req.method==='POST')return onUpload(req,res,u);
    res.writeHead(404);res.end('Bulunamadı');
  }

  function start(){
    if(server)return Promise.resolve(info());
    const host=opts.host||lanAddress();
    if(!host)return Promise.reject(new Error('Mac bir Wi-Fi ya da yerel ağa bağlı değil. Telefonla aynı Wi-Fi\'a bağlan.'));
    if(closed)return Promise.reject(new Error('Paylaşım kapandı.'));
    sweepParts(opts.downloadsDir);
    return new Promise((ok,no)=>{
      // requestTimeout yok (buyuk dosyalar uzun surer) ama veri akmayan soket IDLE sonra kapanir
      server=http.createServer(handler);server.requestTimeout=0;server.headersTimeout=30000;server.timeout=opts.idle||IDLE;
      server.on('error',e=>{server=null;no(e)});
      server.listen(0,host,()=>{url=`http://${host}:${server.address().port}/s/${token}/`;touch();
        life=setTimeout(()=>stop('time'),opts.maxLife||MAXLIFE);ev({type:'start',url});ok(info())});
    });
  }
  function stop(reason='user'){
    if(closed)return;closed=true;clearTimeout(timer);clearTimeout(life);tickets.clear();
    // suren yuklemelerin yarim dosyalari hemen (senkron) silinir: uygulama hemen kapansa da artik kalmasin
    for(const t of inflight){try{fs.rmSync(t,{force:true})}catch(e){}}inflight.clear();
    if(server){server.closeAllConnections&&server.closeAllConnections();server.close();server=null}
    ev({type:'stop',reason});
  }
  const info=()=>({url,files:list(),received:received.map(({name,size,path:p})=>({name,size,path:p})),running:!!server});
  return {start,stop,add,remove,info,token};
}

module.exports={createShare,lanAddress,safeName,human,sweepParts,PART};
