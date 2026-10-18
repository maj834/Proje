// xAI Grok ile grafik ve derinlik okuma (istege bagli, kullanicinin xAI anahtari).
// xAI API'si OpenAI uyumludur: POST https://api.x.ai/v1/chat/completions, gorsel image_url (data URL) ile gider.
// Prompt ve JSON semasi Claude ile ayni (ai.js), boylece iki motorun ciktisi ayni bicimdedir.
const ai=require('./ai');

const BASE='https://api.x.ai/v1';
// Model adlari zamanla degisir: once hesabin gorsel destekleyen modelleri listelenir, yoksa bu yedek kullanilir.
const FALLBACK_MODEL='grok-4';
// Onbellek anahtara baglidir: anahtar degisince (ya da baska anahtar denenince) liste yeniden alinir.
let modelCache={key:null,at:0,list:null};

const validKey=k=>/^xai-[A-Za-z0-9_-]{20,}$/.test(String(k||'').trim())||/^grok_[A-Za-z0-9_]{20,}$/.test(String(k||'').trim());

async function call(key,path,body,ms=60000){
  let r;
  try{r=await fetch(BASE+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(ms)})}
  catch(e){throw new Error(e.name==='TimeoutError'?'Grok yanıt vermedi.':'Grok\'a bağlanılamadı.')}
  const text=await r.text();let j=null;try{j=text?JSON.parse(text):null}catch(e){}
  if(!r.ok){const m=(j&&(j.error&&(j.error.message||j.error)||j.message))||text.slice(0,160);const e=new Error(String(m));e.status=r.status;throw e}
  return j;
}

// Gorsel girdi kabul eden modeller (hesaba gore). /language-models alanlari: id, input_modalities.
async function models(key,{fresh=false}={}){
  if(!fresh&&modelCache.list&&modelCache.key===key&&Date.now()-modelCache.at<3600000)return modelCache.list;
  const j=await call(key,'/language-models',null,15000);
  const list=((j&&(j.models||j.data))||[]).filter(m=>(m.input_modalities||[]).includes('image')).map(m=>m.id).filter(Boolean);
  modelCache={key,at:Date.now(),list};
  return list;
}
async function pickModel(key,preferred){
  if(preferred)return preferred;
  try{const l=await models(key);if(l.length)return l.find(id=>/grok-4/.test(id)&&!/heavy/.test(id))||l[0]}catch(e){}
  return FALLBACK_MODEL;
}

function parse(j){
  const ch=j&&j.choices&&j.choices[0];
  if(!ch)throw new Error('Grok boş yanıt döndürdü.');
  if(ch.finish_reason==='length')throw new Error('Grok yanıtı yarıda kesildi. Tekrar dene.');
  const m=ch.message||{};
  if(m.refusal)throw new Error('Grok bu isteği yanıtlamadı.');
  const t=typeof m.content==='string'?m.content:(m.content||[]).map(p=>p.text||'').join('');
  // Yapilandirilmis cikti desteklenmiyorsa metnin icindeki JSON'u al.
  try{return JSON.parse(t)}catch(e){const s=t.indexOf('{'),f=t.lastIndexOf('}');if(s>=0&&f>s)return JSON.parse(t.slice(s,f+1));throw new SyntaxError('json')}
}

async function ask(key,model,system,schema,name,img,text,max=8000){
  const body={model,max_tokens:max,temperature:0,
    response_format:{type:'json_schema',json_schema:{name,strict:true,schema}},
    messages:[{role:'system',content:system},{role:'user',content:[{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+img,detail:'high'}},{type:'text',text}]}]};
  let j;
  try{j=await call(key,'/chat/completions',body)}
  catch(e){
    // Model json_schema desteklemiyorsa duz JSON isteyerek bir kez daha dene.
    if(e.status===400&&/response_format|json_schema|schema/i.test(e.message)){
      delete body.response_format;body.messages[0].content=system+' Yanitin yalnizca gecerli JSON olsun.';j=await call(key,'/chat/completions',body);
    }else throw e;
  }
  return {data:parse(j),usage:j.usage||{},model:j.model||model};
}

async function analyze({key,model,img,crop}){
  const m=await pickModel(key,model);
  const r=await ask(key,m,ai.SYS,ai.SCHEMA,'grafik_analizi',img,'Grafigi analiz et.');
  const a=ai.mapCrop(r.data,crop);
  a.engine='grok';a.model=r.model;a.tokens={in:r.usage.prompt_tokens||0,out:r.usage.completion_tokens||0};
  return a;
}
async function analyzeDepth({key,model,img}){
  const m=await pickModel(key,model);
  const r=await ask(key,m,ai.DSYS,ai.DSCHEMA,'derinlik',img,'Derinlik verilerini oku.');
  return {...r.data,model:r.model,cost:0};
}
// Anahtar denemesi her zaman sunucuya gider (onbellekteki liste gecersiz anahtari gizlemesin).
async function test(key){
  const l=await models(key,{fresh:true});
  return {ok:true,visionModels:l};
}

function errorText(e){
  if(e.status===401||e.status===403&&/key|auth/i.test(e.message))return 'Grok API anahtarı geçersiz. Ayarlar sekmesinden kontrol et.';
  if(e.status===403||e.status===402||/credit|billing|spending/i.test(e.message||''))return 'Grok hesabında kredi yok ya da bu modele erişim kapalı (console.x.ai).';
  if(e.status===404)return 'Grok modeli bulunamadı; Ayarlar\'dan başka bir model seç.';
  if(e.status===429)return 'Grok istek sınırı aşıldı, biraz bekleyip tekrar dene.';
  if(e instanceof SyntaxError)return 'Grok yanıtı okunamadı. Tekrar dene.';
  const m=String(e.message||e).slice(0,160);return /^Grok/.test(m)?m:'Grok: '+m;
}

module.exports={analyze,analyzeDepth,models,test,errorText,validKey,FALLBACK_MODEL};
