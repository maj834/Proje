// QR ile dosya paylasimi: Mac'te kisa omurlu bir web sunucusu acilir, telefon (iPhone/Android/iPad) QR'i okutup
// kendi tarayicisinda dosyalari indirir ya da Mac'e dosya gonderir. Uygulama, hesap ve internet gerekmez (ayni Wi-Fi).
// Guvenlik: her oturumda tahmin edilemeyen anahtar (adreste), yalnizca yerel ag adresleri, sure dolunca kapanir,
// telefondan gelen dosyalar icin Mac'te onay istenir. Dosyalar diskten akitilir: boyut siniri yoktur, yalnizca bos alan.
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');

const TTL=10*60*1000;               // islem yoksa 10 dk sonra kapanir
const RESERVE=1024**3;              // diskte en az 1 GB bos kalsin

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

// Dosya adini guvenli hale getir: yol ve kontrol karakterleri yok, en fazla 180 karakter, gizli dosya olmasin
function safeName(n){
  n=path.basename(String(n||'').replace(/\\/g,'/')).replace(/[\u0000-\u001f\u007f<>:"|?*]/g,'_').replace(/^\.+/,'').trim();
  if(!n)n='dosya';
  if(n.length>180){const ext=path.extname(n).slice(0,20);n=n.slice(0,180-ext.length)+ext}
  return n;
}
function uniquePath(dir,name){
  let p=path.join(dir,name);const ext=path.extname(name),base=name.slice(0,name.length-ext.length);
  for(let i=2;fs.existsSync(p)||fs.existsSync(p+'.part');i++)p=path.join(dir,`${base} (${i})${ext}`);
  return p;
}
const freeBytes=dir=>{try{const s=fs.statfsSync(dir);return s.bavail*s.bsize}catch(e){return Infinity}};
const human=n=>n>=1024**3?(n/1024**3).toFixed(1)+' GB':n>=1024**2?(n/1024**2).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const contentDisposition=name=>`attachment; filename="${name.replace(/[^\x20-\x7e]/g,'_').replace(/"/g,"'")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

// opts: {downloadsDir, ask({ip,count,bytes,names}) -> Promise<bool>, onEvent(evt), host (test icin), ttl}
function createShare(opts={}){
  const token=crypto.randomBytes(18).toString('base64url');
  const files=new Map();                 // id -> {id,path,name,size}
  const approved=new Set(),pending=new Map(); // onaylanan istemci IP'leri, bekleyen onaylar
  const received=[];
  let server=null,timer=null,url=null,active=0,closed=false;
  const ev=e=>{try{opts.onEvent&&opts.onEvent(e)}catch(_){}};
  const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(active)return touch();stop('time')},opts.ttl||TTL)};

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
function up(f){return new Promise((ok,no)=>{const x=new XMLHttpRequest();x.open('POST','up?name='+encodeURIComponent(f.name));
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
  try{for(const f of fs)await up(f);show(fs.length+' dosya gönderildi.')}catch(err){show('Gönderilemedi: '+err.message)}
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

  function readJson(req,max=64*1024){return new Promise((ok,no)=>{let b='';req.on('data',c=>{b+=c;if(b.length>max){no(new Error('büyük'));req.destroy()}});req.on('end',()=>{try{ok(JSON.parse(b||'{}'))}catch(e){no(e)}})})}
  const json=(res,code,o)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(o))};

  async function onAsk(req,res){
    const ip=req.socket.remoteAddress;let body;
    try{body=await readJson(req)}catch(e){return json(res,400,{ok:false,msg:'Geçersiz istek'})}
    const fl=(Array.isArray(body.files)?body.files:[]).slice(0,500),bytes=fl.reduce((s,f)=>s+(+f.size||0),0);
    if(!fl.length)return json(res,400,{ok:false,msg:'Dosya seçilmedi'});
    if(bytes>freeBytes(opts.downloadsDir)-RESERVE)return json(res,507,{ok:false,msg:'Mac\'te yeterli boş alan yok ('+human(bytes)+' gerekli).'});
    if(approved.has(ip))return json(res,200,{ok:true});
    if(!pending.has(ip))pending.set(ip,Promise.resolve(opts.ask?opts.ask({ip,count:fl.length,bytes,names:fl.slice(0,5).map(f=>safeName(f.name))}):false).catch(()=>false));
    active++;touch();
    const yes=await pending.get(ip);pending.delete(ip);active=Math.max(0,active-1);touch();
    if(yes)approved.add(ip);
    json(res,yes?200:403,yes?{ok:true}:{ok:false,msg:'Mac gönderimi reddetti.'});
  }

  function onUpload(req,res,u){
    const ip=req.socket.remoteAddress;
    if(!approved.has(ip))return json(res,403,{ok:false,msg:'Önce Mac\'te onay gerekli.'});
    const len=+req.headers['content-length'];
    if(Number.isFinite(len)&&len>freeBytes(opts.downloadsDir)-RESERVE){res.writeHead(507);return res.end('Mac\'te yeterli boş alan yok')}
    const name=safeName(u.searchParams.get('name')),dest=uniquePath(opts.downloadsDir,name),tmp=dest+'.part';
    const out=fs.createWriteStream(tmp,{flags:'wx'});let n=0,failed=false;
    active++;touch();ev({type:'upload-start',name,ip});
    const fail=msg=>{if(failed)return;failed=true;out.destroy();fs.rm(tmp,{force:true},()=>{});active=Math.max(0,active-1);touch();
      ev({type:'upload-fail',name,msg});if(!res.headersSent){res.writeHead(500);res.end(msg)}};
    req.on('data',c=>{n+=c.length;if(n%(8*1024*1024)<c.length){touch();ev({type:'upload-progress',name,bytes:n,total:len||null})}});
    req.on('aborted',()=>fail('Bağlantı koptu'));out.on('error',e=>fail(e.message));
    req.pipe(out);
    out.on('finish',()=>{if(failed)return;
      if(Number.isFinite(len)&&n!==len)return fail('Eksik geldi');
      fs.rename(tmp,dest,e=>{if(e)return fail(e.message);active=Math.max(0,active-1);touch();
        const item={name:path.basename(dest),path:dest,size:n,at:Date.now()};received.push(item);ev({type:'received',...item});
        res.writeHead(200);res.end('ok')})});
  }

  function handler(req,res){
    const u=new URL(req.url,'http://x'),parts=u.pathname.split('/').filter(Boolean);
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
    if(rest[0]==='ask'&&req.method==='POST')return onAsk(req,res);
    if(rest[0]==='up'&&req.method==='POST')return onUpload(req,res,u);
    res.writeHead(404);res.end('Bulunamadı');
  }

  function start(){
    if(server)return Promise.resolve(info());
    const host=opts.host||lanAddress();
    if(!host)return Promise.reject(new Error('Mac bir Wi-Fi ya da yerel ağa bağlı değil. Telefonla aynı Wi-Fi\'a bağlan.'));
    return new Promise((ok,no)=>{
      server=http.createServer(handler);server.requestTimeout=0;server.headersTimeout=30000;
      server.on('error',e=>{server=null;no(e)});
      server.listen(0,host,()=>{url=`http://${host}:${server.address().port}/s/${token}/`;touch();ev({type:'start',url});ok(info())});
    });
  }
  function stop(reason='user'){
    if(closed)return;closed=true;clearTimeout(timer);
    if(server){server.closeAllConnections&&server.closeAllConnections();server.close();server=null}
    ev({type:'stop',reason});
  }
  const info=()=>({url,files:list(),received:received.map(({name,size,path:p})=>({name,size,path:p})),running:!!server});
  return {start,stop,add,remove,info,token};
}

module.exports={createShare,lanAddress,safeName,human};
