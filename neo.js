// Neo'nun beyni: sesli komutu Claude'a gonderir, uygulamanin araclarini (ses, borsa, sistem, zamanlayici...) calistirir,
// kisa ve konusmaya uygun Turkce cevap dondurur. Ses (duyma/konusma) native/neo.swift'te; bu dosya Electron'dan bagimsiz test edilir.
const Anthropic=require('@anthropic-ai/sdk');

const MODEL='claude-opus-5-5';
const MEMORY_MS=5*60*1000,MAX_TURNS=12,MAX_STEPS=6;

const SYSTEM=`Sen Neo'sun: Cem App'in içindeki Türkçe sesli asistan. Kullanıcı Mac'te "Hey Neo" deyip konuşuyor; cevabın sesli okunacak.
- Cevapların kısa olsun: çoğunlukla 1-2 cümle, en fazla 4. Madde işareti, başlık, emoji, tablo ve markdown kullanma.
- Sayıları konuşma diline uygun yaz ("yüzde 23", "41 lira 20 kuruş"). Kısaltmaları açılmış söyle.
- Bir işi yapabilecek araç varsa önce aracı kullan, sonra sonucu tek cümleyle söyle. Yapamadığın şeyi yapmış gibi söyleme.
- Güncel bilgi (döviz, haber, hava, maç) gerekiyorsa web aramasını kullan; kaynağı kısaca an.
- Borsa sorularında yatırım tavsiyesi verme; veriyi ve göstergeleri aktar, kararı kullanıcıya bırak.
- Komut belirsizse en olası anlamı seç; gerçekten anlaşılmıyorsa tek kısa soru sor.
- Ses tanıma hataları olabilir ("tırk hava yolları" = THYAO gibi); bağlamdan düzelt.`;

const FEATURES=['borsa','ses','paylas','temizlik','kilit','sistem','pano','hiz','merkez'];
const obj=(props,req)=>({type:'object',properties:props,required:req,additionalProperties:false});
// Uygulama araclari (istemci tarafi). strict: girdiler semaya birebir uyar. Sayi sinirlari strict'te desteklenmez; runTool'da kirpilir.
const TOOLS=[
  {name:'open_feature',description:'Cem App içindeki bir özelliğin penceresini açar. borsa: grafik/derinlik paneli, ses: uygulama başına ses, paylas: QR dosya paylaşımı, temizlik, kilit: dosya kilidi, sistem: sıcaklık/FPS paneli, pano: pano geçmişi, hiz: internet hız testi, merkez: tüm özellikler.',
    strict:true,input_schema:obj({feature:{type:'string',enum:FEATURES}},['feature'])},
  {name:'system_status',description:'Mac\'in anlık durumu: işlemci sıcaklığı ve kullanımı, ekran kartı, bellek, FPS, fan, pil, internet ve disk hızı.',
    strict:true,input_schema:obj({},[])},
  {name:'set_app_volume',description:'Tek bir uygulamanın sesini ayarlar (yüzde 0-200; 100 normal, 100 üstü yükseltme). Uygulama adı kullanıcının dediği gibi (Spotify, Chrome, Zoom...).',
    strict:true,input_schema:obj({app:{type:'string'},percent:{type:'integer',description:'0-200'}},['app','percent'])},
  {name:'set_mac_volume',description:'Mac\'in ana ses düzeyini (yüzde 0-100) ayarlar ya da sessize alır.',
    strict:true,input_schema:obj({percent:{type:'integer',description:'0-100'},mute:{type:'boolean'}},['percent','mute'])},
  {name:'stock_info',description:'BIST hissesinin son fiyatı, günlük değişimi, son derinlik/baskı özeti ve haber botunun önemli haberleri. Sembol BIST kodu (THYAO, ASELS...).',
    strict:true,input_schema:obj({symbol:{type:'string'}},['symbol'])},
  {name:'show_stock',description:'Borsa panelini verilen hisseyle açar ve derinlik/AKD/işlem verisini getirir (ekranda gösterir).',
    strict:true,input_schema:obj({symbol:{type:'string'}},['symbol'])},
  {name:'set_timer',description:'Belirtilen dakika sonra bildirim ve sesli hatırlatma kurar.',
    strict:true,input_schema:obj({minutes:{type:'number',description:'0.1-1440 dakika'},label:{type:'string'}},['minutes','label'])},
  {name:'open_app',description:'Mac\'te bir uygulamayı açar (ör. Safari, Spotify, Notlar).',
    strict:true,input_schema:obj({name:{type:'string'}},['name'])},
  {name:'open_url',description:'Bir web adresini varsayılan tarayıcıda açar. Yalnızca https adresleri.',
    strict:true,input_schema:obj({url:{type:'string'}},['url'])},
  {name:'speed_test',description:'İnternet hız testi yapar (indirme, yükleme, gecikme). Yaklaşık 20-30 saniye sürer.',
    strict:true,input_schema:obj({},[])},
  {name:'clipboard_search',description:'Pano geçmişinde (son kopyalananlar) arar ve bulunanı panoya geri kopyalar.',
    strict:true,input_schema:obj({query:{type:'string'}},['query'])},
];
const WEB={type:'web_search_20260209',name:'web_search',max_uses:3,user_location:{type:'approximate',country:'TR',timezone:'Europe/Istanbul'}};

const clip=(s,n)=>{s=String(s==null?'':s);return s.length>n?s.slice(0,n)+'…':s};
// Arac sonucunu modele gidecek kisa metne cevir
const asText=v=>clip(typeof v==='string'?v:JSON.stringify(v),6000);

// Girdi dogrulama (strict olsa da savunma amacli): bilinmeyen arac/eksik alan hata olarak doner
function check(name,inp){
  const t=TOOLS.find(x=>x.name===name);if(!t)return 'Bilinmeyen araç: '+name;
  if(!inp||typeof inp!=='object')return 'Geçersiz girdi';
  for(const k of t.input_schema.required)if(!(k in inp))return 'Eksik alan: '+k;
  return null;
}

// actions: {feature(id), status(), appVolume(app,pct), macVolume(pct,mute), stock(sym), showStock(sym), timer(min,label), openApp(name), openUrl(url), speed(), clipboard(q)}
async function runTool(actions,name,inp){
  const bad=check(name,inp);if(bad)return {error:bad};
  const call={open_feature:()=>actions.feature(inp.feature),system_status:()=>actions.status(),
    set_app_volume:()=>actions.appVolume(String(inp.app).slice(0,80),Math.max(0,Math.min(200,Math.round(+inp.percent)))),
    set_mac_volume:()=>actions.macVolume(Math.max(0,Math.min(100,Math.round(+inp.percent))),!!inp.mute),
    stock_info:()=>actions.stock(String(inp.symbol).slice(0,12)),show_stock:()=>actions.showStock(String(inp.symbol).slice(0,12)),
    set_timer:()=>actions.timer(Math.max(0.1,Math.min(1440,+inp.minutes)),String(inp.label||'').slice(0,120)),
    open_app:()=>actions.openApp(String(inp.name).slice(0,80)),
    open_url:()=>{const u=String(inp.url);if(!/^https:\/\/[^\s]+$/i.test(u))return {error:'Yalnızca https adresleri açılabilir.'};return actions.openUrl(u)},
    speed_test:()=>actions.speed(),clipboard_search:()=>actions.clipboard(String(inp.query).slice(0,200))}[name];
  if(!call)return {error:'Bu araç bu sürümde yok.'};
  try{const r=await call();return r==null?{ok:true}:r}catch(e){return {error:String(e&&e.message||e).slice(0,300)}}
}

// Konusma: son 5 dakikanin turlari tutulur (append-only; dusunme bloklari degistirilmeden geri gonderilir)
function createBrain({getKey,actions,client=null,now=()=>Date.now(),model=MODEL,onTool=()=>{}}){
  let messages=[],last=0;
  const mk=()=>client||new Anthropic({apiKey:getKey(),maxRetries:2});
  function reset(){messages=[];last=0}
  async function ask(text){
    if(!getKey()&&!client)return {text:'Claude anahtarı yok. Borsa ayarlarından Claude anahtarını ekle.',error:'nokey'};
    if(now()-last>MEMORY_MS||messages.length>MAX_TURNS*4)messages=[];
    const when=new Date(now()).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
    messages.push({role:'user',content:`[${when}] ${clip(text,2000)}`});
    const c=mk(),tools=[...TOOLS,WEB],used=[];let final=null;
    try{
      for(let step=0;step<MAX_STEPS;step++){
        const r=await c.beta.messages.create({model,max_tokens:4000,system:SYSTEM,tools,messages,
          output_config:{effort:'low'},betas:['server-side-fallback-2026-07-01'],fallbacks:'default'});
        messages.push({role:'assistant',content:r.content});
        if(r.stop_reason==='pause_turn')continue;
        if(r.stop_reason==='refusal'){final='Bu isteğe yardımcı olamıyorum.';break}
        const calls=r.content.filter(b=>b.type==='tool_use');
        if(r.stop_reason!=='tool_use'||!calls.length){final=r.content.filter(b=>b.type==='text').map(b=>b.text).join(' ').trim();break}
        const results=[];
        for(const b of calls){onTool(b.name,b.input);used.push(b.name);
          const out=await runTool(actions,b.name,b.input);
          results.push({type:'tool_result',tool_use_id:b.id,content:asText(out),...(out&&out.error?{is_error:true}:{})})}
        messages.push({role:'user',content:results});
      }
      if(final==null)final='Bu biraz uzun sürdü, işlemi yarıda bıraktım.';
      last=now();
      return {text:final||'Tamam.',tools:used};
    }catch(e){
      // Basarisiz turu gecmisten cikarmak yerine konusmayi sifirla (yarim arac turu kalmasin)
      messages=[];
      return {text:errText(e),error:e&&e.constructor&&e.constructor.name||'error',tools:used};
    }
  }
  return {ask,reset,history:()=>messages};
}
// ---- Groq (ucretsiz, OpenAI uyumlu) ----
// Ayni araclar OpenAI "function" bicimine cevrilir. gpt-oss modelleri Groq'un yerlesik web aramasini (browser_search) destekler;
// desteklenmezse (400) o arac bir daha gonderilmez. Gunluk sinir (429) ya da kaldirilmis model: siradaki modele gecilir.
const GROQ_URL='https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS=['openai/gpt-oss-120b','openai/gpt-oss-20b','llama-3.3-70b-versatile'];
const FN=TOOLS.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.input_schema}}));
function createGroqBrain({getKey,actions,fetch:F=(...a)=>fetch(...a),now=()=>Date.now(),onTool=()=>{},models=GROQ_MODELS}){
  let messages=[],last=0,mi=0,miAt=0,web=true;
  const reset=()=>{messages=[];last=0};
  async function call(){
    if(mi&&now()-miAt>3600000)mi=0;                       // bir saat sonra buyuk modeli yeniden dene
    for(let tries=0;tries<models.length+1;tries++){
      const model=models[Math.min(mi,models.length-1)],gpt=/gpt-oss/.test(model);
      const body={model,messages:[{role:'system',content:SYSTEM},...messages],tools:[...FN,...(web&&gpt?[{type:'browser_search'}]:[])],tool_choice:'auto',
        temperature:0.3,max_completion_tokens:1500,...(gpt?{reasoning_effort:'low'}:{})};
      let r;try{r=await F(GROQ_URL,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+getKey()},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)})}
      catch(e){const x=new Error('İnternete bağlanamadım.');x.code='net';throw x}
      const txt=await r.text();let j=null;try{j=JSON.parse(txt)}catch(e){}
      if(r.ok&&j&&j.choices&&j.choices[0])return j.choices[0];
      const msg=(j&&j.error&&j.error.message)||txt.slice(0,200);
      if(r.status===401){const x=new Error('Groq anahtarı geçersiz.');x.code='auth';throw x}
      if(r.status===400&&web&&/browser_search|tool/i.test(msg)){web=false;continue}
      if((r.status===429||r.status===404||r.status===400&&/model/i.test(msg)||r.status>=500)&&mi<models.length-1){mi++;miAt=now();continue}
      const x=new Error(r.status===429?'Groq günlük ücretsiz sınırı doldu, yarın sıfırlanır.':'Groq hata verdi ('+r.status+').');x.code=r.status===429?'limit':'api';throw x;
    }
    const x=new Error('Groq cevap vermedi.');x.code='api';throw x;
  }
  async function ask(text){
    if(!getKey())return {text:'Groq anahtarı yok. Neo penceresinden ücretsiz Groq anahtarını ekle.',error:'nokey'};
    if(now()-last>MEMORY_MS||messages.length>MAX_TURNS*4)messages=[];
    const when=new Date(now()).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
    messages.push({role:'user',content:`[${when}] ${clip(text,2000)}`});
    const used=[];
    try{
      for(let step=0;step<MAX_STEPS;step++){
        const ch=await call(),m=ch.message||{};
        const calls=(m.tool_calls||[]).filter(c=>c&&c.type==='function'&&c.function);
        // Gecmise yalniz gerekli alanlar (reasoning gibi ek alanlar tekrar gonderilmez)
        messages.push({role:'assistant',content:m.content||'',...(calls.length?{tool_calls:calls.map(c=>({id:c.id,type:'function',function:{name:c.function.name,arguments:c.function.arguments||'{}'}}))}:{})});
        if((m.executed_tools||[]).length)used.push('web_search');
        if(!calls.length){last=now();return {text:String(m.content||'').trim()||'Tamam.',tools:used}}
        for(const c of calls){let inp;try{inp=JSON.parse(c.function.arguments||'{}')}catch(e){inp=null}
          onTool(c.function.name,inp);used.push(c.function.name);
          const out=inp?await runTool(actions,c.function.name,inp):{error:'Geçersiz JSON girdi'};
          messages.push({role:'tool',tool_call_id:c.id,content:asText(out)})}
      }
      last=now();return {text:'Bu biraz uzun sürdü, işlemi yarıda bıraktım.',tools:used};
    }catch(e){messages=[];return {text:e.code?e.message:'Bir şeyler ters gitti.',error:e.code||'error',tools:used}}
  }
  return {ask,reset,history:()=>messages,model:()=>models[mi]};
}

function errText(e){
  if(e instanceof Anthropic.AuthenticationError)return 'Claude anahtarı geçersiz görünüyor.';
  if(e instanceof Anthropic.PermissionDeniedError)return 'Claude anahtarının bu modele erişimi yok.';
  if(e instanceof Anthropic.RateLimitError)return 'Claude şu an çok yoğun, biraz sonra tekrar dene.';
  if(e instanceof Anthropic.APIConnectionError)return 'İnternete bağlanamadım.';
  if(e instanceof Anthropic.APIError)return 'Claude hata verdi ('+e.status+').';
  return 'Bir şeyler ters gitti.';
}
module.exports={createBrain,createGroqBrain,runTool,TOOLS,FN,SYSTEM,MODEL,GROQ_MODELS,FEATURES,check};
