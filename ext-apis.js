// Dis veri API'leri (kullanicinin ucretsiz anahtarlariyla): NewsAPI.org (haber), ExchangeRate-API v6 (doviz), CoinGecko Demo (kripto).
// Anahtarlar main.js'te safeStorage ile sifreli saklanir (enc/dec, groqKey/grokKey gibi) ve cagri aninda keys.*() ile okunur;
// koda, teste, loga ya da diske yazilmaz (sayac dosyasinda yalniz anahtarin kisa sha256 parmak izi durur: anahtar degisince sayac sifirlanir).
// Kurallar: yalniz https; 12 sn zaman asimi (govde okuma dahil); yonlendirme reddedilir (baslikta giden anahtar baska adrese gitmesin);
// hata metinleri sabit Turkce cumlelerdir, sunucudan gelen ayrinti eklenirse icindeki anahtar maskelenir. Fonksiyonlar reddetmez,
// her zaman {ok, ..., error} doner. Hata aninda eski onbellek varsa ok:true + stale:true + error ile o doner.
// Ucretsiz plan sinirlari (sayac userData/ext-apis.json'da):
//  NewsAPI Developer: gunde 100 istek -> uygulama butcesi 90 (UTC gunu). Plan gelistirme/test amaclidir; haberler ~24 saat gecikmeli,
//   en fazla 1 ay geriye aranir. /v2/everything 'language' listesinde Turkce yok: lang 'tr' iken parametre gonderilmez (Turkce sorgu yeter).
//  ExchangeRate-API Free: ayda 1.500 istek, kurlar gunde bir guncellenir -> onbellek time_next_update_unix'e kadar (en az 1 saat, en cok 26 saat)
//   ve diske yazilir (yeniden baslatmada kota harcanmaz). Kalan istek 20'nin altina inince yeni istek atilmaz (yedek). test('fx') /quota ucuyla
//   sunucudaki kalan sayiyi ve yenilenme gununu alir, sayaci esitler.
//  CoinGecko Demo: dakikada 30 istek (kayan 60 sn penceresi), ayda ~10.000 (100 yedek); 429'da Retry-After kadar beklenir.
//   Bir crypto() yenilemesi vs para birimi sayisi kadar istek atar (coins/markets tek vs_currency alir; sparkline yalniz ilkinde).
// fetch ve now enjekte edilir (testlerde sahte).
const fs=require('fs'),path=require('path'),crypto=require('crypto');

const TIMEOUT_MS=12000,MIN=60000,HOUR=3600000,DAY=86400000;
const NEWS_URL='https://newsapi.org/v2/everything',FX_URL='https://v6.exchangerate-api.com/v6/',CG_URL='https://api.coingecko.com/api/v3';
const LIMITS={news:{cap:90,plan:100,reserve:1,unit:'day'},fx:{cap:1500,reserve:20,unit:'month'},gecko:{cap:10000,reserve:100,unit:'month',perMin:30}};
const NAMES={news:'NewsAPI',fx:'ExchangeRate-API',gecko:'CoinGecko'};
const PROVIDERS=['news','fx','gecko'];
const ALIAS={news:'news',newsapi:'news',haber:'news',fx:'fx',doviz:'fx',kur:'fx',exchangerate:'fx','exchangerate-api':'fx',
  gecko:'gecko',coingecko:'gecko',crypto:'gecko',kripto:'gecko'};
const NEWS_TTL=30*MIN,CG_TTL=2*MIN,FX_MIN_TTL=HOUR,FX_MAX_TTL=26*HOUR,MEM_MAX=60,FXC_MAX=4;
// NewsAPI /v2/everything 'language' secenekleri (Turkce yok)
const NEWS_LANGS=new Set(['ar','de','en','es','fr','he','it','nl','no','pt','ru','sv','ud','zh']);
// Arayuz mesajlari 200 karakterde keser (borsa-pro-main.js): not ve hata metinleri bu sinirin altinda kalir.
const NEWS_NOTE='Ücretsiz Developer planı test amaçlıdır: haberler ~24 saat gecikmeli gelir, en fazla 1 ay geriye aranır.';
const MSG_MAX=200;
// TL caprazlari (X/TRY = 1 X kac TL)
const CROSS=['USD','EUR','GBP','CHF','JPY','CAD','AUD','SAR','AED','CNY','RUB','SEK','NOK','DKK','KWD','QAR','AZN'];
const COINS=['bitcoin','ethereum','solana','binancecoin','ripple'];
const FILE='ext-apis.json';
// Anahtar bicimi: yalniz URL/baslik icin guvenli karakterler (NewsAPI 32 hex, ExchangeRate 24 hex, CoinGecko "CG-..."); esnek tutuldu.
const KEY_RE={news:/^[A-Za-z0-9]{20,64}$/,fx:/^[A-Za-z0-9]{16,64}$/,gecko:/^[A-Za-z0-9_-]{10,80}$/};

// ---- yardimcilar ----------------------------------------------------------------------------------------------------
const fin=v=>typeof v==='number'&&Number.isFinite(v);
const num=v=>fin(v)?v:typeof v==='string'&&v.trim()!==''&&Number.isFinite(+v)?+v:null;
const sig=(v,d=6)=>fin(v)?+v.toPrecision(d):null;
const r2=v=>fin(v)?Math.round(v*100)/100:null;
const th=n=>String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,'.');
// null/undefined/'' varsayilana duser (Math.round(null)=0 alt sinira dusurmesin)
const int=(v,a,b,d)=>{v=num(v);return v==null?d:Math.max(a,Math.min(b,Math.round(v)))};
const dayKey=t=>new Date(t).toISOString().slice(0,10);
// Aylik donem: kota yenilenme gunu (rd) biliniyorsa donem o gunde baslar (ExchangeRate-API hesabin acildigi gunde yeniler).
function period(t,rd){const d=new Date(t);let y=d.getUTCFullYear(),m=d.getUTCMonth();rd=int(rd,1,28,1);
  if(d.getUTCDate()<rd){m--;if(m<0){m=11;y--}}
  return y+'-'+String(m+1).padStart(2,'0')+(rd>1?'@'+rd:'')}
const kid=k=>crypto.createHash('sha256').update(String(k)).digest('hex').slice(0,10);
const validKey=(p,k)=>{const re=KEY_RE[ALIAS[String(p||'').toLowerCase()]];return !!re&&re.test(String(k||'').trim())};
const TR={ç:'c',Ç:'C',ğ:'g',Ğ:'G',ı:'i',İ:'I',ö:'o',Ö:'O',ş:'s',Ş:'S',ü:'u',Ü:'U',â:'a',Â:'A',î:'i',Î:'I',û:'u',Û:'U'};
const fold=s=>String(s==null?'':s).replace(/[çÇğĞıİöÖşŞüÜâÂîÎûÛ]/g,c=>TR[c]);
const ENT={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',hellip:'…',ndash:'–',mdash:'—',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“'};
const ent=(m,e)=>{if(e[0]==='#'){const c=e[1]==='x'||e[1]==='X'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);
  return c>0&&c<0x110000&&!(c>=0xD800&&c<=0xDFFF)?String.fromCodePoint(c):' '}return ENT[e.toLowerCase()]||m};
// HTML etiketlerini sil, varliklari coz, bosluklari topla, kelime sinirinda kisalt
function clean(s,max=300){if(s==null)return '';
  let t=String(s).replace(/<[^>]*>/g,' ').replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi,ent).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  if(t.length>max){t=t.slice(0,max-1);const sp=t.lastIndexOf(' ');t=(sp>max*0.6?t.slice(0,sp):t).replace(/[\s,;:.-]+$/,'')+'…'}
  return t}
const httpsUrl=u=>{try{const x=new URL(String(u||''));return x.protocol==='https:'&&x.hostname&&!x.username&&!x.password&&x.hostname!=='removed.com'?x.href:null}catch(e){return null}};
const qs=o=>Object.entries(o).filter(([,v])=>v!=null&&v!=='').map(([k,v])=>k+'='+encodeURIComponent(String(v))).join('&');
// Seyrek seri: en fazla n nokta, ilk ve son korunur
function thin(a,n){if(!Array.isArray(a))return null;a=a.filter(fin);if(a.length<=n)return a.map(v=>sig(v));
  const st=(a.length-1)/(n-1),o=[];for(let i=0;i<n;i++)o.push(sig(a[Math.round(i*st)]));return o}
// TL caprazlari: rates herhangi bir bazda (1 baz = rates[X] X) -> X/TRY = rates.TRY / rates[X]
function crosses(rates,list=CROSS){const o={},t=rates&&rates.TRY;if(!fin(t)||t<=0)return o;
  for(const c of list){const r=rates[c];if(c!=='TRY'&&fin(r)&&r>0)o[c+'/TRY']=sig(t/r)}return o}

// Hisse haberi sorgusu (NewsAPI sozdizimi): tirnakli sirket adi (+ ASCII yazimi, basindaki kisa ad, parantez ici ikinci ad)
// VEYA borsa baglaminda kod. Kod tek basina sozluk kelimesine denk gelebilir (MAVI, FENER, KONYA, LOGO): (KOD AND baglam).
// Ad kodla ayniysa (ad bilinmiyor, nameOf kodu dondurur) yalniz baglamli kod aranir; tirnakli "MAVI" her maviyi getirirdi.
const NEWS_CTX='(hisse OR hissesi OR hisseleri OR borsa OR BIST)';
// Haberde gecmeyen unvan ekleri (sondan atilir): A.S., T.A.S., A.O., Anonim Sirketi, Sanayi ve Ticaret, Ltd. Sti.
const LEGAL=new Set(['as','tas','ao','anonim','sirketi','ortakligi','sanayi','san','ticaret','tic','ve','ltd','sti','inc','corp','plc']);
// Sondaki tanim kelimesi atilinca basindaki yaygin ad kalir: "Yapi Kredi Bankasi" -> "Yapi Kredi", "Tofas Oto" -> "Tofas"
const DESC=new Set(['bankasi','magazalar','magazalari','oto','polyester','giyim','marketler','marketleri']);
// Tek kelimelik genel anlamli ya da yabanci sirket/kulup haberine karisan adlar: borsa baglami istenir (4 harf ve alti zaten ister)
const AMBIG=new Set(['pegasus','brisa','goodyear','migros','fenerbahce','galatasaray','besiktas','trabzonspor','logo','mavi','deva','vakko']);
// Basinin kullandigi kisa adlar (unvanda gecmeyen)
const NEWS_ALIAS={EREGL:['Erdemir'],ISDMR:['İsdemir'],THYAO:['THY'],BIMAS:['BİM'],ENKAI:['Enka']};
function newsQuery(symbol,companyName){
  const code=String(symbol==null?'':symbol).toUpperCase().replace(/\.IS$/,'').replace(/[^A-Z0-9]/g,'').slice(0,12);
  const raw=String(companyName==null?'':companyName).slice(0,200);
  const alts=[...raw.matchAll(/\(([^)]*)\)/g)].map(m=>m[1]),main=raw.replace(/\([^)]*\)?/g,' ');
  const phr=s=>String(s).replace(/["()[\]{}:+^~*\\|!<>=&?,;]/g,' ').replace(/\b(AND|OR|NOT)\b/g,' ').replace(/\s+/g,' ').trim().replace(/^[-.'\s]+|[-'\s]+$/g,'');
  const wk=w=>fold(w).toLowerCase().replace(/[^a-z0-9]/g,'');
  const letters=s=>s.replace(/[^\p{L}\p{N}]/gu,'').length;
  const terms=[],seen=new Set(code?[code.toLowerCase()]:[]);
  const add=(n,ctx)=>{const k=fold(n).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();if(!k||seen.has(k)||seen.has(k.replace(/ /g,'')))return;seen.add(k);
    const vs=[...new Set([n,fold(n)])].map(v=>'"'+v+'"');
    terms.push(ctx?'('+(vs.length>1?'('+vs.join(' OR ')+')':vs[0])+' AND '+NEWS_CTX+')':vs.join(' OR '))};
  const named=s=>{let n=phr(s);if(letters(n)<3)return;let ws=n.split(' ');
    while(ws.length>1&&LEGAL.has(wk(ws[ws.length-1])))ws.pop();
    n=ws.join(' ');if(letters(n)<3)return;
    if(ws.length>1&&DESC.has(wk(ws[ws.length-1]))){const rest=ws.slice(0,-1),r=rest.join(' '),L=letters(r);
      if(rest.length>=2||L>=5){n=r;ws=rest}else{add(n,false);if(L>=4)add(r,true);return}}
    add(n,ws.length===1&&(letters(n)<5||AMBIG.has(wk(n))))};
  named(main);for(const a of NEWS_ALIAS[code]||[])named(a);for(const a of alts)named(a);
  const ct=code?'('+code+' AND '+NEWS_CTX+')':null;
  while(terms.length&&[...terms,ct].filter(Boolean).join(' OR ').length>500)terms.pop();
  return [...terms,ct].filter(Boolean).join(' OR ').slice(0,500)}

// ---- hata metinleri (saf) -------------------------------------------------------------------------------------------
// code: ic hata kodu; o: {status, detail, timeoutMs, left, wait, base, text}
function message(p,code,o={}){
  const N=NAMES[p]||'Servis',st=o.status,d=o.detail?String(o.detail).replace(/\s+/g,' ').trim().slice(0,160):'';
  const sec=Math.max(1,Math.round((o.timeoutMs||TIMEOUT_MS)/1000)),wait=o.wait>0?Math.ceil(o.wait):0;
  switch(code){
    case 'input':return o.text||N+' isteği geçersiz.';
    case 'nokey':return N+' anahtarı girilmemiş. Ayarlar\'dan ekle.';
    case 'badkey':return N+' anahtarı geçersiz görünüyor (beklenmeyen karakter ya da uzunluk). Ayarlar\'dan kontrol et.';
    case 'timeout':return N+' '+sec+' sn içinde yanıt vermedi. Tekrar dene.';
    case 'net':return N+' sunucusuna bağlanılamadı. İnternet bağlantını kontrol et.';
    case 'https':return N+' için yalnızca https adresine istek atılır.';
    case 'parse':return N+' yanıtı okunamadı. Tekrar dene.';
    case 'server':return N+' şu an yanıt vermiyor'+(st?' (HTTP '+st+')':'')+'. Biraz sonra tekrar dene.';
  }
  if(p==='news')switch(code){
    case 'key':return 'NewsAPI anahtarı geçersiz ya da devre dışı. Ayarlar\'dan kontrol et (ücretsiz Developer anahtarı newsapi.org hesabında).';
    case 'plan':return 'NewsAPI bu isteği ücretsiz planda kabul etmedi'+(st?' (HTTP '+st+')':'')+'. '+NEWS_NOTE;
    case 'limit':return 'NewsAPI istek sınırı doldu (ücretsiz Developer planı: günde 100 istek); yarın tekrar dene. '+NEWS_NOTE;
    case 'budget':return 'NewsAPI günlük istek bütçesi doldu (uygulama günde '+LIMITS.news.cap+' istek atar; ücretsiz plan '+LIMITS.news.plan+'). Yarın (UTC 00:00) sıfırlanır.';
    case 'bad':return 'NewsAPI isteği geçersiz buldu'+(d?': '+d:'.');
  }
  if(p==='fx')switch(code){
    case 'key':return 'ExchangeRate-API anahtarı geçersiz. Ayarlar\'dan kontrol et.';
    case 'inactive':return 'ExchangeRate-API hesabı etkin değil; kayıt e-postasındaki doğrulama bağlantısını onaylaman gerekebilir.';
    case 'quota':return 'ExchangeRate-API aylık istek sınırı ('+th(LIMITS.fx.cap)+') doldu; kota yenilenince tekrar dene.';
    case 'reserve':return 'ExchangeRate-API aylık kotasında '+th(o.left||0)+' istek kaldı; '+LIMITS.fx.reserve+' isteklik yedek korunuyor, yeni istek atılmadı.';
    case 'unsupported':return 'ExchangeRate-API bu para birimini desteklemiyor'+(o.base?': '+o.base:'')+'.';
    case 'bad':return 'ExchangeRate-API isteği hatalı buldu'+(d?': '+d:'.');
  }
  if(p==='gecko')switch(code){
    case 'key':return 'CoinGecko anahtarı geçersiz ya da Demo anahtarı değil (Pro anahtarı bu adreste çalışmaz). Ayarlar\'dan kontrol et.';
    case 'limit':return 'CoinGecko istek sınırı aşıldı (Demo plan: dakikada '+LIMITS.gecko.perMin+' istek). '+(wait?wait+' sn sonra':'Biraz bekleyip')+' tekrar dene.';
    case 'minute':return 'CoinGecko dakikalık istek sınırı ('+LIMITS.gecko.perMin+') dolmak üzere; '+(wait||60)+' sn sonra tekrar dene.';
    case 'month':return 'CoinGecko aylık istek kotası dolmak üzere (Demo plan: ayda '+th(LIMITS.gecko.cap)+', '+th(o.left||0)+' kaldı); yeni istek atılmadı.';
    case 'bad':return 'CoinGecko isteği geçersiz buldu'+(d?': '+d:'.');
  }
  return N+' isteği başarısız'+(st?' (HTTP '+st+')':'')+(d?': '+d:'.');
}
// Metinden anahtarlari ve anahtar tasiyabilecek URL parcalarini maskele
function scrub(s,keys=[]){let t=String(s==null?'':s);
  for(const k of keys)if(typeof k==='string'&&k.length>=6){t=t.split(k).join('***');const e=encodeURIComponent(k);if(e!==k)t=t.split(e).join('***')}
  return t.replace(/(\/v6\/)[^/\s?#"']+/g,'$1***').replace(/(api[_-]?key=|x-cg-demo-api-key[:=]\s*|x-api-key[:=]\s*)[^&\s"']+/gi,'$1***')}

// ---- fabrika ----------------------------------------------------------------------------------------------------------
function createExtApis({fetch:F=(...a)=>globalThis.fetch(...a),now=()=>Date.now(),keys={},dir=null,timeoutMs=TIMEOUT_MS}={}){
  const file=dir?path.join(dir,FILE):null;
  let st={};
  if(file)try{const j=JSON.parse(fs.readFileSync(file,'utf8'));if(j&&typeof j==='object'&&!Array.isArray(j))st=j}catch(e){}
  const save=()=>{if(!file)return;const tmp=file+'.tmp';
    try{fs.writeFileSync(tmp,JSON.stringify(st),{mode:0o600});fs.renameSync(tmp,file)}catch(e){try{fs.unlinkSync(tmp)}catch(_){}}};
  const mem=new Map(),inflight=new Map(),info={};for(const p of PROVIDERS)info[p]={lastOk:null,lastError:null,lastErrorAt:null};
  let win=[],coolUntil=0;   // CoinGecko: son 60 sn'deki istek zamanlari, 429 sonrasi bekleme

  const keyOf=p=>{try{const k=keys&&typeof keys[p]==='function'?keys[p]():null;return typeof k==='string'&&k.trim()?k.trim():null}catch(e){return null}};
  const allKeys=()=>PROVIDERS.map(keyOf).filter(Boolean);
  // Sayac: {per, n, kid, cap?, rd?}. Donem ya da anahtar degisince sifirlanir.
  function ctr(p,k){let c=st[p];if(!c||typeof c!=='object'||!fin(c.n)||c.n<0)c=st[p]={n:0};
    const id=k?kid(k):null;if(id&&c.kid!==id){if(c.kid){delete c.rd;delete c.cap}c.kid=id;c.n=0;c.per=null}
    const pk=LIMITS[p].unit==='day'?dayKey(now()):period(now(),c.rd);if(c.per!==pk){c.per=pk;c.n=0}
    return c}
  const capOf=c=>fin(c.cap)&&c.cap>0?c.cap:null;
  const leftOf=(p,k)=>{const c=ctr(p,k);return Math.max(0,(p==='fx'&&capOf(c)||LIMITS[p].cap)-c.n)};
  const use=(p,k)=>{ctr(p,k).n++;save()};
  const exhaust=(p,k)=>{if(!k)return;const c=ctr(p,k);c.n=Math.max(c.n,p==='fx'&&capOf(c)||LIMITS[p].cap);save()};
  const markOk=p=>{info[p].lastOk=now();info[p].lastError=null;info[p].lastErrorAt=null};
  const xe=(code,o={})=>Object.assign(new Error(code),{xcode:code},o);
  const errText=(p,e)=>scrub(message(p,e&&e.xcode||'parse',{...(e||{}),timeoutMs}),allKeys());
  const fail=(p,e)=>{const m=errText(p,e);if(!(e&&e.xcode==='input')){info[p].lastError=m;info[p].lastErrorAt=now()}return m};
  // Ayni anahtar icin es zamanli cagrilar tek istege iner
  const once=(k,fn)=>{if(inflight.has(k))return inflight.get(k);const pr=(async()=>{try{return await fn()}finally{inflight.delete(k)}})();inflight.set(k,pr);return pr};
  const putMem=(k,v,exp)=>{mem.delete(k);mem.set(k,{at:now(),exp,v});while(mem.size>MEM_MAX)mem.delete(mem.keys().next().value)};

  // Tek GET: https denetimi, zaman asimi (fetch + govde), yonlendirme yok. Ag hatasinin ham metni (URL icerebilir) disari cikmaz.
  async function request(url,headers){
    if(!/^https:\/\/[^/]/i.test(String(url)))throw xe('https');
    const ac=typeof AbortController==='function'?new AbortController():null;let timer=null;
    const run=(async()=>{
      const r=await F(url,{method:'GET',headers:{accept:'application/json',...headers},redirect:'error',signal:ac?ac.signal:undefined});
      if(!r||typeof r!=='object')throw xe('net');
      let text='';
      if(typeof r.text==='function')text=await r.text();else if(typeof r.json==='function')text=JSON.stringify(await r.json());
      let j=null;try{j=text?JSON.parse(text):null}catch(e){}
      const status=num(r.status)||0;
      return {status,ok:r.ok!=null?!!r.ok:status>=200&&status<300,j,text:String(text||''),headers:r.headers};
    })();
    const to=new Promise((_,rej)=>{timer=setTimeout(()=>{try{ac&&ac.abort()}catch(e){}rej(xe('timeout'))},timeoutMs)});
    try{return await Promise.race([run,to])}
    catch(e){if(e&&e.xcode)throw e;throw xe(e&&(e.name==='TimeoutError'||e.name==='AbortError')?'timeout':'net')}
    finally{clearTimeout(timer)}
  }

  // ---- NewsAPI ------------------------------------------------------------------------------------------------------
  function newsFail(r){const j=r.j&&typeof r.j==='object'?r.j:{},c=String(j.code||''),s=r.status;
    if(s===401||/^apiKey(Invalid|Missing|Disabled)$/.test(c))return xe('key',{status:s});
    if(s===426)return xe('plan',{status:s});
    if(s===429||c==='rateLimited'||c==='apiKeyExhausted')return xe('limit',{status:s});
    if(s>=500||c==='unexpectedError')return xe('server',{status:s});
    if(r.ok&&!r.j)return xe('parse');
    if(s===400||/^parameter/.test(c))return xe('bad',{status:s,detail:j.message});
    return xe('http',{status:s,detail:j.message})}
  function mapNews(arts,max){const seen=new Set(),out=[];
    for(const a of Array.isArray(arts)?arts:[]){if(!a||typeof a!=='object')continue;
      const url=httpsUrl(a.url);if(!url)continue;
      const source=clean(a.source&&a.source.name,80)||null;
      let title=clean(a.title,300);if(!title||/^\[removed\]$/i.test(title))continue;
      if(source&&title.length>source.length+3&&title.endsWith(' - '+source))title=title.slice(0,-(source.length+3)).trim();
      const uk=url.replace(/[?#].*$/,'').replace(/\/$/,'').toLowerCase(),tk=title.toLowerCase();if(seen.has(uk)||seen.has(tk))continue;seen.add(uk);seen.add(tk);
      const t=Date.parse(a.publishedAt);
      out.push({title,source,url,time:Number.isFinite(t)?t:null,desc:clean(a.description,280)||null});
    }
    out.sort((a,b)=>(b.time||0)-(a.time||0));return out.slice(0,max)}
  // query: NewsAPI sozdizimi (tirnak, AND/OR/NOT, parantez). lang 'tr' | 'en'; days 1..29; max 1..50. Sonuc 30 dk onbellekte.
  async function news(query,{lang='tr',days=7,max=10,searchIn='title,description',fresh=false}={}){
    const P='news',q=String(query==null?'':query).replace(/\s+/g,' ').trim().slice(0,500);
    lang=/^[a-z]{2}$/.test(String(lang||'').toLowerCase())?String(lang).toLowerCase():'tr';days=int(days,1,29,7);max=int(max,1,50,10);
    searchIn=String(searchIn||'').split(',').map(s=>s.trim()).filter(s=>['title','description','content'].includes(s)).join(',');
    if(!q)return {ok:false,query:q,items:[],left:leftOf(P,keyOf(P)),error:fail(P,xe('input',{text:'Haber araması için sorgu boş.'}))};
    const ck=['n',lang,days,max,searchIn,q].join('|'),c=mem.get(ck);
    if(!fresh&&c&&now()<c.exp)return {...c.v,left:leftOf(P,keyOf(P)),cached:true};
    return once(ck+(fresh?'|f':''),async()=>{
      const key=keyOf(P);
      try{
        if(!key)throw xe('nokey');if(!validKey(P,key))throw xe('badkey');
        if(leftOf(P,key)<LIMITS.news.reserve)throw xe('budget');
        const url=NEWS_URL+'?'+qs({q,language:NEWS_LANGS.has(lang)?lang:null,searchIn,sortBy:'publishedAt',from:dayKey(now()-days*DAY),pageSize:Math.min(100,max+10)});
        use(P,key);
        const r=await request(url,{'X-Api-Key':key});
        if(!r.ok||!r.j||r.j.status!=='ok')throw newsFail(r);
        const v={ok:true,query:q,lang,items:mapNews(r.j.articles,max),total:num(r.j.totalResults),time:now(),note:NEWS_NOTE,error:null};
        putMem(ck,v,now()+NEWS_TTL);markOk(P);
        return {...v,left:leftOf(P,key),cached:false};
      }catch(e){
        if(e&&e.xcode==='limit')exhaust(P,key);
        const m=fail(P,e),left=leftOf(P,key);
        if(c)return {...c.v,left,cached:true,stale:true,error:m};
        return {ok:false,query:q,lang,items:[],left,error:m};
      }
    });
  }
  // Hisse haberleri (Turkce): sirket adi + kod
  async function newsFor(symbol,companyName,opts={}){
    const q=newsQuery(symbol,companyName);
    if(!q)return {ok:false,query:'',items:[],left:leftOf('news',keyOf('news')),error:fail('news',xe('input',{text:'Haber araması için hisse kodu ya da şirket adı gerekli.'}))};
    return news(q,{lang:'tr',...opts});
  }

  // ---- ExchangeRate-API -------------------------------------------------------------------------------------------
  function fxFail(r,base){const j=r.j&&typeof r.j==='object'?r.j:{},t=String(j['error-type']||'');
    if(t==='invalid-key')return xe('key',{status:r.status});
    if(t==='inactive-account')return xe('inactive',{status:r.status});
    if(t==='quota-reached')return xe('quota',{status:r.status});
    if(t==='unsupported-code')return xe('unsupported',{status:r.status,base});
    if(t==='malformed-request')return xe('bad',{status:r.status});
    if(r.status===401||r.status===403)return xe('key',{status:r.status});
    if(r.status===429)return xe('quota',{status:r.status});
    if(r.status>=500)return xe('server',{status:r.status});
    if(r.ok)return xe('parse');
    return xe('http',{status:r.status,detail:t})}
  const fxView=v=>({base:v.base,rates:{...v.rates},crosses:crosses(v.rates),time:v.time,next:v.next});
  const fxStore=()=>{if(!st.fxc||typeof st.fxc!=='object'||Array.isArray(st.fxc))st.fxc={};return st.fxc};
  // base: 3 harfli kod. Kurlar gunde bir guncellenir: onbellek sonraki guncellemeye kadar (en az 1 saat), diskte de tutulur.
  async function fx(base='USD',{fresh=false}={}){
    const P='fx';base=String(base==null?'USD':base).trim().toUpperCase();
    const empty=x=>({ok:false,base,rates:{},crosses:{},time:null,next:null,left:leftOf(P,keyOf(P)),...x});
    if(!/^[A-Z]{3}$/.test(base))return empty({error:fail(P,xe('input',{text:'Para birimi kodu geçersiz (ör. USD).'}))});
    const c0=fxStore()[base],c=c0&&c0.v&&c0.v.rates&&fin(c0.exp)?c0:null;
    if(!fresh&&c&&now()<c.exp)return {ok:true,...fxView(c.v),left:leftOf(P,keyOf(P)),cached:true,error:null};
    return once('fx|'+base+(fresh?'|f':''),async()=>{
      const key=keyOf(P);
      try{
        if(!key)throw xe('nokey');if(!validKey(P,key))throw xe('badkey');
        const l=leftOf(P,key);if(l<LIMITS.fx.reserve)throw xe('reserve',{left:l});
        use(P,key);
        const r=await request(FX_URL+encodeURIComponent(key)+'/latest/'+base,{});
        if(!r.j||r.j.result!=='success')throw fxFail(r,base);
        const rates={};for(const [k,v] of Object.entries(r.j.conversion_rates||{}))if(/^[A-Z]{3}$/.test(k)&&fin(v)&&v>0)rates[k]=v;
        if(!Object.keys(rates).length)throw xe('parse');
        const u=num(r.j.time_last_update_unix),n=num(r.j.time_next_update_unix);
        const v={base:/^[A-Z]{3}$/.test(r.j.base_code)?r.j.base_code:base,rates,time:u?u*1000:null,next:n?n*1000:null};
        const exp=Math.min(now()+FX_MAX_TTL,Math.max(now()+FX_MIN_TTL,v.next||0));
        const s=fxStore();delete s[base];s[base]={at:now(),exp,v};
        for(const k of Object.keys(s).slice(0,Math.max(0,Object.keys(s).length-FXC_MAX)))delete s[k];
        save();markOk(P);
        return {ok:true,...fxView(v),left:leftOf(P,key),cached:false,error:null};
      }catch(e){
        if(e&&e.xcode==='quota')exhaust(P,key);
        const m=fail(P,e),left=leftOf(P,key);
        if(c)return {ok:true,...fxView(c.v),left,cached:true,stale:true,error:m};
        return empty({left,error:m});
      }
    });
  }

  // ---- CoinGecko ------------------------------------------------------------------------------------------------------
  const retryAfter=r=>{const h=r&&r.headers&&typeof r.headers.get==='function'?num(r.headers.get('retry-after')):null;return h&&h>0?Math.min(600,h):60};
  function geckoFail(r){const j=r.j&&typeof r.j==='object'?r.j:{},s=j.status&&typeof j.status==='object'?j.status:{};
    const code=num(s.error_code),m=String(s.error_message||j.error||j.message||'');
    if(r.status===429||code===429)return xe('limit',{status:429,wait:retryAfter(r)});
    if(r.status===401||[10002,10005,10010,10011].includes(code)||r.status===403&&/key/i.test(m))return xe('key',{status:r.status});
    if(r.status>=500)return xe('server',{status:r.status});
    if(r.ok)return xe('parse');
    if(r.status===400||r.status===404||r.status===422)return xe('bad',{status:r.status,detail:m});
    return xe('http',{status:r.status,detail:m})}
  const minuteLeft=()=>{const t=now();win=win.filter(x=>t-x<MIN);return Math.max(0,LIMITS.gecko.perMin-win.length)};
  function geckoGuard(key,need){const t=now();
    if(coolUntil>t)throw xe('limit',{wait:(coolUntil-t)/1000});
    if(minuteLeft()<need)throw xe('minute',{wait:Math.max(1,(win[0]+MIN-t)/1000)});
    const l=leftOf('gecko',key);if(l-need<LIMITS.gecko.reserve)throw xe('month',{left:l})}
  async function gget(key,url){win.push(now());use('gecko',key);
    const r=await request(url,{'x-cg-demo-api-key':key});
    if(!r.ok||r.j==null)throw geckoFail(r);
    return r.j}
  const list=(v,re,n)=>[...new Set((Array.isArray(v)?v:String(v==null?'':v).split(',')).map(s=>String(s==null?'':s).trim().toLowerCase()).filter(s=>re.test(s)))].slice(0,n);
  function mapCoins(prim,vs,more){const by={};
    for(const [cur,arr] of Object.entries(more))if(Array.isArray(arr))for(const m of arr)if(m&&typeof m.id==='string')(by[m.id]||(by[m.id]={}))[cur]=num(m.current_price);
    return (Array.isArray(prim)?prim:[]).filter(m=>m&&typeof m.id==='string').map(m=>{
      const price={[vs[0]]:num(m.current_price)};for(const cur of vs.slice(1))price[cur]=by[m.id]&&by[m.id][cur]!=null?by[m.id][cur]:null;
      const sp=m.sparkline_in_7d&&thin(m.sparkline_in_7d.price,56);
      const o={id:m.id,symbol:clean(m.symbol,16).toUpperCase()||m.id.toUpperCase(),name:clean(m.name,60)||m.id,rank:num(m.market_cap_rank),price,
        chg24h:r2(num(m.price_change_percentage_24h_in_currency)??num(m.price_change_percentage_24h)),mcap:num(m.market_cap)};
      if(sp&&sp.length>1)o.spark7d=sp;
      return o})}
  // ids: CoinGecko kimlikleri; vs: para birimleri (ilki ana: 24s degisim, piyasa degeri ve 7 gunluk seri onun cinsinden). 2 dk onbellek.
  async function cryptoQ({ids=COINS,vs=['usd','try'],fresh=false}={}){
    const P='gecko';ids=list(ids,/^[a-z0-9][a-z0-9-]{0,63}$/,50);vs=list(vs,/^[a-z]{3,5}$/,4);if(!vs.length)vs=['usd'];
    const left=()=>({left:leftOf(P,keyOf(P)),minuteLeft:minuteLeft()});
    if(!ids.length)return {ok:false,coins:[],vs,...left(),error:fail(P,xe('input',{text:'Geçerli coin kimliği yok (ör. bitcoin).'}))};
    const ck='c|'+ids.join(',')+'|'+vs.join(','),c=mem.get(ck);
    if(!fresh&&c&&now()<c.exp)return {...c.v,...left(),cached:true};
    return once(ck+(fresh?'|f':''),async()=>{
      const key=keyOf(P);
      try{
        if(!key)throw xe('nokey');if(!validKey(P,key))throw xe('badkey');
        geckoGuard(key,vs.length);
        const url=(cur,i)=>CG_URL+'/coins/markets?'+qs({vs_currency:cur,ids:ids.join(','),order:'market_cap_desc',per_page:Math.max(10,ids.length),page:1,
          sparkline:i===0?'true':'false',price_change_percentage:'24h'});
        const res=await Promise.allSettled(vs.map((cur,i)=>gget(key,url(cur,i))));
        const bad=res.find(x=>x.status==='rejected'&&x.reason&&x.reason.xcode==='limit');if(bad)coolUntil=Math.max(coolUntil,now()+(bad.reason.wait||60)*1000);
        if(res[0].status==='rejected')throw res[0].reason;
        if(!Array.isArray(res[0].value))throw xe('parse');
        const more={};let partial=null;
        vs.slice(1).forEach((cur,i)=>{const x=res[i+1];if(x.status==='fulfilled'&&Array.isArray(x.value))more[cur]=x.value;else partial=partial||(x.reason||xe('parse'))});
        const coins=mapCoins(res[0].value,vs,more);
        if(partial){const m=fail(P,partial);return {ok:true,coins,vs,time:now(),...left(),cached:false,partial:true,error:m}}
        const v={ok:true,coins,vs,time:now(),error:null};putMem(ck,v,now()+CG_TTL);markOk(P);
        return {...v,...left(),cached:false};
      }catch(e){
        if(e&&e.xcode==='limit'&&e.status===429)coolUntil=Math.max(coolUntil,now()+(e.wait||60)*1000);
        const m=fail(P,e);
        if(c)return {...c.v,...left(),cached:true,stale:true,error:m};
        return {ok:false,coins:[],vs,...left(),error:m};
      }
    });
  }

  // ---- durum ve anahtar denemesi -----------------------------------------------------------------------------------
  function status(){const o={};
    for(const p of PROVIDERS){const k=keyOf(p),c=ctr(p,k);
      o[p]={name:NAMES[p],configured:!!k,valid:k?validKey(p,k):false,left:leftOf(p,k),cap:p==='fx'&&capOf(c)||LIMITS[p].cap,
        unit:LIMITS[p].unit,lastOk:info[p].lastOk,lastError:info[p].lastError,lastErrorAt:info[p].lastErrorAt}}
    o.gecko.minuteLeft=minuteLeft();o.news.note=NEWS_NOTE;
    return o}
  // Tek ucuz istek; onbellege bakmaz. news: 1 haberlik arama; fx: /quota (kalan istegi esitler); gecko: BTC fiyati.
  async function test(provider){
    const p=ALIAS[String(provider||'').toLowerCase()];if(!p)return {ok:false,msg:'Bilinmeyen sağlayıcı.'};
    const key=keyOf(p);
    try{
      if(!key)throw xe('nokey');if(!validKey(p,key))throw xe('badkey');
      let msg;
      if(p==='news'){
        if(leftOf(p,key)<LIMITS.news.reserve)throw xe('budget');
        use(p,key);
        const r=await request(NEWS_URL+'?'+qs({q:'borsa',searchIn:'title',sortBy:'publishedAt',pageSize:1}),{'X-Api-Key':key});
        if(!r.ok||!r.j||r.j.status!=='ok')throw newsFail(r);
        msg='NewsAPI anahtarı çalışıyor. Bugün kalan istek: '+leftOf(p,key)+'. '+NEWS_NOTE;
      }else if(p==='fx'){
        use(p,key);
        const r=await request(FX_URL+encodeURIComponent(key)+'/quota',{});
        if(r.j&&r.j.result==='success'){
          const c=ctr(p,key),q=num(r.j.plan_quota),rem=num(r.j.requests_remaining),rd=num(r.j.refresh_day_of_month);
          if(q>0)c.cap=q;if(rd>=1&&rd<=31){c.rd=Math.round(rd);c.per=period(now(),c.rd)}
          if(rem!=null&&rem>=0)c.n=Math.max(0,(capOf(c)||LIMITS.fx.cap)-rem);
          save();
          msg='ExchangeRate-API anahtarı çalışıyor. Bu ay kalan istek: '+th(leftOf(p,key))+' / '+th(capOf(c)||LIMITS.fx.cap)+'.';
        }else if(r.status===404&&!(r.j&&r.j['error-type'])){
          // quota ucu yoksa kur istegiyle dene (sonuc onbellege de girer)
          const f=await fx('USD',{fresh:true});if(!f.ok)return {ok:false,msg:f.error};
          msg='ExchangeRate-API anahtarı çalışıyor'+(f.crosses['USD/TRY']?' (1 USD = '+String(f.crosses['USD/TRY']).replace('.',',')+' TL)':'')+'. Bu ay kalan istek: '+th(f.left)+'.';
        }else throw fxFail(r,'USD');
      }else{
        geckoGuard(key,1);
        let j;try{j=await gget(key,CG_URL+'/simple/price?'+qs({ids:'bitcoin',vs_currencies:'usd'}))}
        catch(e){if(e&&e.xcode==='limit'&&e.status===429)coolUntil=Math.max(coolUntil,now()+(e.wait||60)*1000);throw e}
        const b=num(j&&j.bitcoin&&j.bitcoin.usd);
        msg='CoinGecko Demo anahtarı çalışıyor'+(b?' (BTC '+th(b)+' $)':'')+'. Bu ay kalan istek: '+th(leftOf(p,key))+'.';
      }
      markOk(p);return {ok:true,msg};
    }catch(e){
      if(e&&e.xcode==='limit'&&p==='news')exhaust(p,key);
      if(e&&e.xcode==='quota'&&p==='fx')exhaust(p,key);
      return {ok:false,msg:fail(p,e)};
    }
  }

  return {news,newsFor,fx,crypto:cryptoQ,status,test,validKey};
}

module.exports={createExtApis,newsQuery,crosses,message,scrub,validKey,fold,clean,period,LIMITS,NAMES,NEWS_NOTE,TIMEOUT_MS,COINS,CROSS};
