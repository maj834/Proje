// ElevenLabs: Neo icin dogal Turkce ses (istege bagli). Basarisiz olursa Neo yerel sese (native/neo.swift 'say') doner.
// - speak(metin,{voiceId,model}) -> {ok,file,chars} | {ok:false,code,msg}: POST /v1/text-to-speech/{ses}, mp3 onbellek klasorune yazilir.
//   Onbellek anahtari metin+ses+model sha256'si; en fazla 30 dosya (en eski silinir). Onbellekten calan cumle kota harcamaz.
// - Aylik karakter kotasi userData/eleven.json'da sayilir (ucretsiz plan ~10.000 karakter/ay). Kalan karakter (bu istekten sonra)
//   200'un altina inecekse istek atilmaz. test()/sync() GET /v1/user/subscription ile sayaci sunucuyla esitler.
// - voices(): GET /v1/voices, Turkce dogrulanmis / cok dilli sesler once; 24 saat onbellek (diskte de).
// - play(dosya): /usr/bin/afplay execFile ile; stop() calan sesi oldurur (durdurma / soz kesme).
// Kurallar: yalniz https, 6 sn zaman asimi (govde okuma dahil), yonlendirme reddedilir (baslikta giden anahtar baska adrese gitmesin).
// Anahtar cagri aninda key() ile okunur; koda, loga, diske ya da donen metinlere yazilmaz (dosyada yalniz kisa sha256 parmak izi durur:
// anahtar degisince sayac sifirlanir). Hata metinleri sabit Turkce cumlelerdir; yine de donen her metin anahtara karsi maskelenir.
// Fonksiyonlar reddetmez, her zaman {ok,...} doner. fetch, now, execFile enjekte edilir (testlerde sahte).
const fs=require('fs'),path=require('path'),crypto=require('crypto');

const API='https://api.elevenlabs.io';
const MODELS=['eleven_multilingual_v2','eleven_flash_v2_5'];    // dogal (varsayilan) / hizli
const TIMEOUT_MS=6000,RESERVE=200,FREE_LIMIT=10000,CACHE_MAX=30,MAX_TEXT=1500,VOICES_TTL=24*3600000,VOICES_MAX=100;
const DEFAULT_VOICE='EXAVITQu4vr4xnSDxMaL';                     // hazir ("premade") cok dilli ses; secim yoksa ve liste bos ise
const FILE='eleven.json',CDIR='eleven-cache';
const VOICE_RE=/^[A-Za-z0-9]{8,64}$/;
const KEY_RE=/^(sk_)?[A-Za-z0-9]{24,100}$/;
const SETTINGS={stability:0.5,similarity_boost:0.75};
const MSG={
  nokey:'ElevenLabs anahtarı yok.',
  empty:'Seslendirilecek metin yok.',
  long:'Metin çok uzun; sistem sesi kullanılıyor.',
  auth:'ElevenLabs anahtarı geçersiz (401). Anahtarı kontrol et ya da yenisini oluştur.',
  quota:'ElevenLabs karakter kotası doldu; ay yenilenince yeniden kullanılır. Bu arada sistem sesi konuşuyor.',
  paid:'Bu ses ya da model ücretli plan istiyor (402). Başka bir ses seç.',
  busy:'ElevenLabs şu an yoğun ya da istek sınırı aşıldı (429); biraz sonra tekrar dene.',
  voice:'Seçili ElevenLabs sesi bulunamadı (404); başka bir ses seç.',
  perm:'Anahtarda gerekli izin kapalı. ElevenLabs › API Keys bölümünde anahtarın izinlerini aç.',
  timeout:'ElevenLabs 6 saniyede yanıt vermedi.',
  offline:'İnternet yok ya da ElevenLabs\'e ulaşılamıyor.',
  bad:'ElevenLabs geçersiz bir yanıt döndürdü.',
  play:'Ses çalınamadı.',
  unusual:'ElevenLabs bu hesapta ücretsiz kullanımı durdurdu (olağandışı etkinlik); sistem sesi kullanılıyor.',
};
const kid=k=>crypto.createHash('sha256').update(String(k)).digest('hex').slice(0,10);
const th=n=>String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,'.');
const monthKey=t=>new Date(t).toISOString().slice(0,7);
const fin=v=>typeof v==='number'&&Number.isFinite(v);

function createEleven({fetch=(...a)=>globalThis.fetch(...a),now=()=>Date.now(),key=()=>null,dir,execFile,timeoutMs=TIMEOUT_MS,player='/usr/bin/afplay'}={}){
  const F=path.join(dir,FILE),C=path.join(dir,CDIR);
  let S=null;
  const load=()=>{if(S)return S;try{S=JSON.parse(fs.readFileSync(F,'utf8'))}catch(e){S={}}if(!S||typeof S!=='object')S={};return S};
  const persist=()=>{try{fs.mkdirSync(dir,{recursive:true});const t=F+'.tmp';fs.writeFileSync(t,JSON.stringify(S),{mode:0o600});fs.renameSync(t,F)}catch(e){}};
  const K=()=>{const k=key();return typeof k==='string'&&k.trim()?k.trim():null};
  // Donen her metin: anahtar (ve bes karakterden uzun parcasi) gorunmez
  const mask=s=>{s=String(s==null?'':s);const k=K();if(k&&k.length>=8)s=s.split(k).join('***').split(k.slice(0,Math.min(k.length,12))).join('***');return s};
  const fail=(code,extra)=>({ok:false,code,msg:mask(MSG[code]||MSG.bad),...(extra||{})});
  // Hesap durumu: anahtar degisirse sayac ve ses listesi sifirlanir; ay (ya da sunucudaki yenilenme ani) gecince sayac sifirlanir
  function acct(){const s=load(),k=K(),id=k?kid(k):null,t=now();
    if(s.kid!==id){S={kid:id,used:0,limit:FREE_LIMIT,month:monthKey(t),resetAt:null,syncedAt:null,tier:null,bad:null,voices:null};persist();return S}
    if(!fin(s.used))s.used=0;if(!fin(s.limit)||s.limit<=0)s.limit=FREE_LIMIT;
    if(fin(s.resetAt)&&t>=s.resetAt){s.used=0;s.resetAt=null;s.month=monthKey(t);persist()}
    else if(!fin(s.resetAt)&&s.month!==monthKey(t)){s.used=0;s.month=monthKey(t);persist()}
    return s}
  function quota(){const s=acct();return {used:s.used,limit:s.limit,left:Math.max(0,s.limit-s.used),resetAt:s.resetAt||null,syncedAt:s.syncedAt||null,tier:s.tier||null,reserve:RESERVE}}

  // Tek istek: 6 sn sinir govde okumasini da kapsar; fetch sinyali yok saysa bile yaris zamanlayicisi keser
  async function call(p,{method='GET',body,accept='application/json'}={}){
    const k=K();const ac=new AbortController();let to;
    const timer=new Promise((_,rej)=>{to=setTimeout(()=>{try{ac.abort()}catch(e){}rej(Object.assign(new Error('timeout'),{code:'timeout'}))},timeoutMs)});
    const work=(async()=>{
      const res=await fetch(API+p,{method,redirect:'error',signal:ac.signal,
        headers:{'xi-api-key':k,accept,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      const buf=Buffer.from(await res.arrayBuffer());
      return {status:res.status,ok:res.ok,headers:res.headers,buf}})();
    work.catch(()=>{});
    try{return await Promise.race([work,timer])}finally{clearTimeout(to)}
  }
  const json=b=>{try{return JSON.parse(b.toString('utf8'))}catch(e){return null}};
  // HTTP durumu / ag hatasi -> sabit hata kodu
  function classify(r,e){
    if(e){const c=e.code||(e.cause&&e.cause.code)||'';if(c==='timeout'||e.name==='AbortError'||e.name==='TimeoutError')return 'timeout';return 'offline'}
    const d=(json(r.buf)||{}).detail,st=String(d&&typeof d==='object'?d.status||'':'');
    if(st==='quota_exceeded')return 'quota';
    if(st==='missing_permissions')return 'perm';
    if(st==='detected_unusual_activity')return 'unusual';
    if(r.status===401||r.status===403)return 'auth';
    if(r.status===402)return 'paid';
    if(r.status===429)return 'busy';
    if(r.status===404)return 'voice';
    return 'bad'}
  async function req(p,o){try{const r=await call(p,o);return r.ok?{r}:{r,code:classify(r)}}catch(e){return {code:classify(null,e)}}}

  // ---- onbellek -----------------------------------------------------------------------------------------------------
  const cacheFile=(text,voice,model)=>path.join(C,crypto.createHash('sha256').update(model+'\n'+voice+'\n'+text).digest('hex').slice(0,32)+'.mp3');
  function prune(){try{const fsx=fs.readdirSync(C).filter(f=>f.endsWith('.mp3')).map(f=>{const p=path.join(C,f);return {p,m:fs.statSync(p).mtimeMs}}).sort((a,b)=>b.m-a.m);
    for(const x of fsx.slice(CACHE_MAX))try{fs.unlinkSync(x.p)}catch(e){}}catch(e){}}
  function touch(p){const t=now()/1000;try{fs.utimesSync(p,t,t)}catch(e){}}

  const firstVoice=()=>{const v=acct().voices;return v&&Array.isArray(v.list)&&v.list[0]?v.list[0].id:null};
  async function speak(text,{voiceId,model}={}){
    text=String(text==null?'':text).replace(/\s+/g,' ').trim();
    if(!text)return fail('empty');
    if(text.length>MAX_TEXT)return fail('long');
    if(!K())return fail('nokey');
    model=MODELS.includes(model)?model:MODELS[0];
    const voice=VOICE_RE.test(String(voiceId||''))?voiceId:(firstVoice()||DEFAULT_VOICE);
    const file=cacheFile(text,voice,model);
    try{if(fs.statSync(file).size>0){touch(file);return {ok:true,file,chars:0,cached:true}}}catch(e){}
    const s=acct();
    if(s.bad==='auth')return fail('auth');                       // gecersiz anahtar: her cumlede 6 sn beklenmesin (Dene ya da yeni anahtar sifirlar)
    if(s.limit-s.used-text.length<RESERVE)return fail('quota',{left:Math.max(0,s.limit-s.used)});
    const {r,code}=await req('/v1/text-to-speech/'+encodeURIComponent(voice)+'?output_format=mp3_44100_128',
      {method:'POST',accept:'audio/mpeg',body:{text,model_id:model,voice_settings:SETTINGS}});
    if(code){const a=acct();
      if(code==='auth'){a.bad='auth';persist()}
      if(code==='quota'){a.used=a.limit;persist()}                // sunucu kota dolu dedi: ay yenilenene (ya da esitlemeye) kadar istek atilmaz
      return fail(code,r?{status:r.status}:undefined)}
    const ct=String(r.headers&&r.headers.get?r.headers.get('content-type')||'':'');
    if(!r.buf.length||/json|text\//i.test(ct))return fail('bad');
    try{fs.mkdirSync(C,{recursive:true});const t=file+'.'+process.pid+'.tmp';fs.writeFileSync(t,r.buf);fs.renameSync(t,file)}catch(e){return fail('bad')}
    prune();
    const h=r.headers&&r.headers.get?+(r.headers.get('character-cost')||r.headers.get('x-character-count')||NaN):NaN;
    const chars=fin(h)&&h>=0?h:text.length;
    const a=acct();a.used+=chars;a.bad=null;persist();
    return {ok:true,file,chars}}

  // Sunucudaki kullanimla esitle (karakter harcamaz)
  async function sync(){
    if(!K())return fail('nokey');
    const {r,code}=await req('/v1/user/subscription');
    if(code)return fail(code);
    const j=json(r.buf);if(!j||typeof j!=='object')return fail('bad');
    const a=acct();
    if(fin(j.character_limit)&&j.character_limit>0)a.limit=j.character_limit;
    if(fin(j.character_count)&&j.character_count>=0)a.used=j.character_count;
    a.resetAt=fin(j.next_character_count_reset_unix)&&j.next_character_count_reset_unix>0?j.next_character_count_reset_unix*1000:null;
    a.tier=typeof j.tier==='string'?j.tier.slice(0,30):null;a.syncedAt=now();a.bad=null;a.month=monthKey(now());persist();
    return {ok:true,...quota()}}

  async function voices(force=false){
    if(!K())return {...fail('nokey'),voices:[]};
    const a=acct(),c=a.voices;
    if(!force&&c&&Array.isArray(c.list)&&now()-c.at<VOICES_TTL)return {ok:true,voices:c.list,cached:true};
    const {r,code}=await req('/v1/voices');
    if(code){if(code==='auth'){a.bad='auth';persist()}return {...fail(code),voices:c&&Array.isArray(c.list)?c.list:[],stale:!!c}}
    const j=json(r.buf);if(!j||!Array.isArray(j.voices))return {...fail('bad'),voices:c&&Array.isArray(c.list)?c.list:[]};
    const list=j.voices.filter(v=>v&&VOICE_RE.test(String(v.voice_id||''))).map(shapeVoice)
      .sort((x,y)=>(y.tr-x.tr)||(y.multi-x.multi)||(x.premade===y.premade?0:x.premade?-1:1)||x.name.localeCompare(y.name,'tr')).slice(0,VOICES_MAX);
    const b=acct();b.voices={at:now(),list};b.bad=null;persist();
    return {ok:true,voices:list}}
  const cachedVoices=()=>{const v=K()?acct().voices:null;return v&&Array.isArray(v.list)?v.list:[]};

  // Anahtar denemesi: kalan karakterle birlikte Turkce sonuc
  async function test(){
    if(!K())return {ok:false,code:'nokey',msg:MSG.nokey};
    const q=await sync();
    if(q.ok){const m='Anahtar çalışıyor. Bu ay kalan: '+th(q.left)+' / '+th(q.limit)+' karakter'+(q.resetAt?' (yenilenme: '+new Date(q.resetAt).toLocaleDateString('tr-TR',{day:'numeric',month:'long'})+')':'')+'.';
      return {ok:true,msg:mask(m),...quota()}}
    // Anahtarda "User: Read" izni kapaliysa kota okunamaz: anahtarin calistigi ses listesiyle dogrulanir
    if(q.code==='perm'){const v=await voices(true);
      if(v.ok){const z=quota();return {ok:true,msg:mask('Anahtar çalışıyor (kalan karakter sunucudan okunamadı; anahtarda "User" okuma izni kapalı). Uygulamanın sayacına göre bu ay kalan: '+th(z.left)+' karakter.'),...z}}
      return {ok:false,code:v.code,msg:v.msg}}
    return {ok:false,code:q.code,msg:q.msg}}

  // ---- calma (afplay) -----------------------------------------------------------------------------------------------
  let proc=null;const killed=new WeakSet();
  function play(file){
    stop();
    return new Promise(res=>{let p;
      try{p=execFile(player,[String(file)],{timeout:10*60000},err=>{if(proc===p)proc=null;
        if(killed.has(p))return res({ok:false,stopped:true});
        if(!err)return res({ok:true});
        res({ok:false,stopped:false,code:'play',msg:MSG.play})})}
      catch(e){return res({ok:false,stopped:false,code:'play',msg:MSG.play})}
      proc=p;
      if(p&&typeof p.on==='function')p.on('error',()=>{});
    })}
  function stop(){const p=proc;if(!p)return false;proc=null;killed.add(p);try{p.kill('SIGTERM')}catch(e){}return true}
  const playing=()=>!!proc;

  return {speak,sync,quota,voices,cachedVoices,test,play,stop,playing,validKey:k=>KEY_RE.test(String(k||'').trim())};
}
module.exports={createEleven,MODELS,KEY_RE,DEFAULT_VOICE,RESERVE,CACHE_MAX,TIMEOUT_MS};

// ses listesi ogesi: Turkce dogrulanmis mi, cok dilli mi, hazir ses mi
function shapeVoice(v){
  const vl=Array.isArray(v.verified_languages)?v.verified_languages:[],lab=v.labels&&typeof v.labels==='object'?v.labels:{};
  const tr=vl.some(l=>l&&/^tr\b|turk/i.test(String(l.language||l.locale||l.accent||'')))||/turk|^tr$/i.test(String(lab.language||''))||/turk/i.test(String(lab.accent||''))||
    /^tr\b/i.test(String((v.fine_tuning&&v.fine_tuning.language)||''));
  const hq=Array.isArray(v.high_quality_base_model_ids)?v.high_quality_base_model_ids:[];
  const premade=v.category==='premade';
  const multi=tr||premade||hq.some(m=>/multilingual|flash_v2_5|turbo_v2_5/.test(String(m)))||vl.length>1;
  const desc=[lab.gender==='female'?'kadın':lab.gender==='male'?'erkek':'',String(lab.accent||'').slice(0,20)].filter(Boolean).join(', ');
  return {id:String(v.voice_id),name:String(v.name||v.voice_id).replace(/[\u0000-\u001f]/g,' ').slice(0,60),tr:tr?1:0,multi:multi?1:0,premade,desc}
}
