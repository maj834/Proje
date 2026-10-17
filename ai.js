// Claude ile grafik okuma (istege bagli, API anahtari gerekir).
const Anthropic=require('@anthropic-ai/sdk');

const MODELS=[
  {id:'claude-haiku-5-5',name:'Haiku 5.5',note:'En ucuz ve hızlı (önerilen)',inM:0.10,outM:0.50},
  {id:'claude-sonnet-5-5',name:'Sonnet 5.5',note:'Daha isabetli, ~20 kat pahalı',inM:2,outM:10},
  {id:'claude-opus-5-5',name:'Opus 5.5',note:'En isabetli, en pahalı',inM:4,outM:20}
];

const SYS='Sen deneyimli bir teknik analiz uzmanisin. Goruntudeki fiyat grafigini (TradingView, broker, Matriks, tarayici vb.) oku. '+
  'Tum x ve y degerleri goruntunun sol ust kosesine gore 0-1 araligindadir (x: 0 sol, 1 sag; y: 0 ust, 1 alt). '+
  'chart_box mumlarin cizildigi alanin sinirlaridir (eksenler haric). Fiyat eksenini oku; okuyamayip tahmin ettiysen price null birak. '+
  'En fazla 3 destek, 3 direnc ve 2 trend cizgisi ver; trend cizgisi en az iki tepe/dibe degen gecerli bir cizgi olmali. '+
  'confidence 0-100 arasi tam sayidir. comment Turkce, kisa, net ve gerekceli olsun. Ekranda grafik yoksa chart_found false dondur.';
const LEVEL={type:'object',properties:{price:{type:['number','null']},y:{type:'number'}},required:['price','y'],additionalProperties:false};
const BOX={type:'object',properties:{x1:{type:'number'},y1:{type:'number'},x2:{type:'number'},y2:{type:'number'}},required:['x1','y1','x2','y2'],additionalProperties:false};
const TLINE={type:'object',properties:{type:{type:'string',enum:['destek','direnc']},x1:{type:'number'},y1:{type:'number'},x2:{type:'number'},y2:{type:'number'}},
  required:['type','x1','y1','x2','y2'],additionalProperties:false};
const SCHEMA={type:'object',additionalProperties:false,
  required:['chart_found','symbol','timeframe','bias','confidence','trend','chart_box','resistances','supports','trendlines','breakout','patterns','comment'],
  properties:{
    chart_found:{type:'boolean'},symbol:{type:['string','null']},timeframe:{type:['string','null']},
    bias:{type:'string',enum:['yukselis','dusus','notr']},confidence:{type:'integer'},trend:{type:'string'},chart_box:BOX,
    resistances:{type:'array',items:LEVEL},supports:{type:'array',items:LEVEL},trendlines:{type:'array',items:TLINE},
    breakout:{type:['string','null']},patterns:{type:'array',items:{type:'string'}},comment:{type:'string'}
  }};

const modelInfo=id=>MODELS.find(m=>m.id===id)||MODELS[0];
const cost=(id,u)=>{const m=modelInfo(id);return((u.input_tokens||0)*m.inM+(u.output_tokens||0)*m.outM)/1e6};

// img: JPEG base64. crop: goruntunun tam ekrandaki yeri {x,y,w,h} (0-1); yanit tam ekrana cevrilir.
async function analyze({key,model,img,crop,effort}){
  const req={model,max_tokens:16000,system:SYS,output_config:{effort,format:{type:'json_schema',schema:SCHEMA}},
    messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:img}},{type:'text',text:'Grafigi analiz et.'}]}]};
  const client=new Anthropic({apiKey:key,maxRetries:2});
  // Sonnet/Opus: guvenlik filtresi reddederse sunucu tarafinda yedek modele gec.
  const r=model.startsWith('claude-haiku')?await client.messages.create(req)
    :await client.beta.messages.create({...req,betas:['server-side-fallback-2026-07-01'],fallbacks:'default'});
  if(r.stop_reason==='refusal')throw new Error('Model bu isteği yanıtlamadı. Tekrar dene.');
  if(r.stop_reason==='max_tokens')throw new Error('Yanıt yarıda kesildi. Tekrar dene.');
  const a=JSON.parse(r.content.filter(c=>c.type==='text').map(c=>c.text).join(''));
  const c=crop||{x:0,y:0,w:1,h:1},X=v=>c.x+v*c.w,Y=v=>c.y+v*c.h;
  for(const l of [...(a.resistances||[]),...(a.supports||[])])l.y=Y(l.y);
  for(const t of a.trendlines||[]){t.x1=X(t.x1);t.x2=X(t.x2);t.y1=Y(t.y1);t.y2=Y(t.y2)}
  if(a.chart_box){const b=a.chart_box;a.chart_box={x1:X(b.x1),y1:Y(b.y1),x2:X(b.x2),y2:Y(b.y2)}}
  a.engine='claude';a.cost=cost(model,r.usage||{});
  return a;
}

function errorText(e){
  if(e instanceof Anthropic.AuthenticationError)return 'API anahtarı geçersiz. Ayarlar sekmesinden kontrol et.';
  if(e instanceof Anthropic.PermissionDeniedError)return 'Bu anahtarın seçili modele erişimi yok.';
  if(e instanceof Anthropic.RateLimitError)return 'İstek sınırı aşıldı, biraz bekleyip tekrar dene.';
  if(e instanceof Anthropic.APIConnectionError)return 'Bağlantı kurulamadı. İnternet bağlantını kontrol et.';
  if(e instanceof Anthropic.APIError){
    if(/credit balance/i.test(e.message))return 'API kredin bitti. console.anthropic.com › Billing bölümünden kredi yükle.';
    return 'API hatası ('+(e.status||'?')+'): '+e.message}
  if(e instanceof SyntaxError)return 'Model yanıtı okunamadı. Tekrar dene.';
  return String(e.message||e);
}

module.exports={MODELS,analyze,errorText,modelInfo};
