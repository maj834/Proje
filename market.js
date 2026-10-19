// Piyasa verisi: Yahoo Finance (BIST mumlari + haber, anahtarsiz) ve Alpha Vantage (fiyat, haber + duygu skoru).
// Yahoo'nun bu uclari resmi bir API degildir; BIST verisi ~15 dk gecikmelidir. Az istek, onbellek kullan.
// Alpha Vantage ucretsiz plan: gunde 25 istek; sayac tutulur, sinir dolunca istek atilmaz.
const fs=require('fs'),path=require('path');

const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const AV_DAY_CAP=25;
// Arayuzdeki zaman dilimi -> Yahoo interval/range
const TF={'1dk':{i:'1m',r:'1d',ttl:60},'5dk':{i:'5m',r:'5d',ttl:120},'15dk':{i:'15m',r:'5d',ttl:300},'1s':{i:'60m',r:'3mo',ttl:600},'1g':{i:'1d',r:'2y',ttl:1800},'1h':{i:'1wk',r:'5y',ttl:21600}};

let dir=null,cache={},avUse={day:'',n:0};
function init(d){
  dir=d;
  try{cache=JSON.parse(fs.readFileSync(path.join(dir,'market-cache.json'),'utf8'))}catch(e){cache={}}
  try{avUse=JSON.parse(fs.readFileSync(path.join(dir,'av-usage.json'),'utf8'))}catch(e){}
}
// Disk onbellegi: en yeni CACHE_MAX kayit (BIST100 taramasi + bakilan hisseler sigsin). Yazma kisilir: ilk yazma hemen,
// sonrakiler en fazla PERSIST_MS'de bir (tarama sirasinda dosya her istekte yeniden yazilmasin); kapanista flush().
const CACHE_MAX=220,PERSIST_MS=5000;let lastWrite=0,writeTimer=null;
const writeNow=()=>{if(writeTimer){clearTimeout(writeTimer);writeTimer=null}if(!dir)return;lastWrite=Date.now();try{
  const keep=Object.fromEntries(Object.entries(cache).filter(([,v])=>Date.now()-v.at<7*86400000).slice(-CACHE_MAX));cache=keep;
  fs.writeFileSync(path.join(dir,'market-cache.json'),JSON.stringify(keep))}catch(e){}};
const persist=()=>{if(!dir||writeTimer)return;const wait=lastWrite+PERSIST_MS-Date.now();
  if(wait<=0)return writeNow();writeTimer=setTimeout(writeNow,wait);if(writeTimer.unref)writeTimer.unref()};
const flush=()=>{if(writeTimer)writeNow()};
async function cached(key,ttlSec,fn){
  const c=cache[key];if(c&&Date.now()-c.at<ttlSec*1000)return {...c.v,cached:true};
  // Yenilenen kayit sona tasinir (en eski once silinsin)
  try{const v=await fn();delete cache[key];cache[key]={at:Date.now(),v};persist();return v}
  catch(e){if(c){return {...c.v,cached:true,stale:true,staleReason:e.message}}throw e}
}
async function getJSON(url,headers={}){
  let r;try{r=await fetch(url,{headers:{'user-agent':UA,accept:'application/json',...headers},signal:AbortSignal.timeout(15000)})}
  catch(e){throw new Error(e.name==='TimeoutError'?'Veri sağlayıcı yanıt vermedi.':'Bağlantı yok.')}
  if(r.status===429)throw new Error('Veri sağlayıcı çok sık istek uyarısı verdi; biraz bekle.');
  if(!r.ok)throw new Error('HTTP '+r.status);
  return r.json();
}

// Sembol cevirisi. market='BIST' iken "thyao"/"şişe" -> "THYAO.IS"/"SISE.IS"; market='US' iken "aapl" -> "AAPL".
// Nokta, tire ya da esittir iceren kodlar (XU100.IS, BTC-USD, EURTRY=X) her zaman oldugu gibi kullanilir.
const TR={'Ş':'S','Ç':'C','Ğ':'G','Ö':'O','Ü':'U','İ':'I','I':'I'};
function yahooSymbol(s,market='BIST'){
  s=String(s||'').trim().toLocaleUpperCase('tr-TR').replace(/[ŞÇĞÖÜİ]/g,c=>TR[c]).replace(/\s+/g,'');
  if(!s||!/^[A-Z0-9.=^-]{1,20}$/.test(s))return null;
  if(/[.=^-]/.test(s))return s;
  return market==='BIST'?s+'.IS':s;
}
const plain=s=>String(s||'').toUpperCase().replace(/\.IS$/,'');

// --- Yahoo ------------------------------------------------------------------
// Onceki gunun kapanisi: chartPreviousClose istenen ARALIGIN basindaki kapanistir (1y icin bir yil once), dun degil.
// Son mumun Istanbul gununden onceki son mumun kapanisi alinir (gunluk ve gun ici mumlarda; haftalik mumda gecen hafta olur, kullanilmaz).
const trDayOf=ms=>new Date(ms+3*3600000).toISOString().slice(0,10);
function prevDayClose(rows){if(!rows||rows.length<2)return null;const d=trDayOf(rows[rows.length-1].t);
  for(let i=rows.length-2;i>=0;i--)if(trDayOf(rows[i].t)!==d)return rows[i].c;return null}
async function candles(symbol,tf='1g',mkt='BIST'){
  const y=yahooSymbol(symbol,mkt),t=TF[tf]||TF['1g'];if(!y)throw new Error('Geçerli bir hisse kodu yaz (ör. THYAO).');
  return cached('yc:'+y+':'+tf,t.ttl,async()=>{
    let j;try{j=await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=${t.i}&range=${t.r}&includePrePost=false`)}
    catch(e){if(/HTTP 404/.test(e.message))throw new Error(y+' bulunamadı. Kodu ve borsa seçimini (BIST/ABD) kontrol et.');throw e}
    const res=j&&j.chart&&j.chart.result&&j.chart.result[0];
    if(!res){const e=j&&j.chart&&j.chart.error;throw new Error(e&&e.description?('Yahoo: '+e.description):'Yahoo bu sembol için veri döndürmedi.')}
    const q=(res.indicators&&res.indicators.quote&&res.indicators.quote[0])||{},ts=res.timestamp||[];
    const A=k=>q[k]||[]; // eksik alan (quote:[{}]) TypeError vermesin
    const rows=ts.map((t,i)=>({t:t*1000,o:A('open')[i],h:A('high')[i],l:A('low')[i],c:A('close')[i],v:q.volume?q.volume[i]:null})).filter(r=>[r.o,r.h,r.l,r.c].every(Number.isFinite));
    const m=res.meta||{};
    return {source:'yahoo',symbol:y,tf,rows,quote:{price:m.regularMarketPrice??(rows.length?rows[rows.length-1].c:null),prev:m.regularMarketPreviousClose??m.previousClose??(t.i!=='1wk'?prevDayClose(rows):null)??(t.r==='1d'?m.chartPreviousClose??null:null),
      currency:m.currency||null,name:m.shortName||m.longName||null,exchange:m.exchangeName||null,time:m.regularMarketTime?m.regularMarketTime*1000:null,
      dayHigh:m.regularMarketDayHigh??null,dayLow:m.regularMarketDayLow??null,volume:m.regularMarketVolume??null}};
  });
}
// Anlik fiyat (gun ici 5 dk mumlari, range=1d): 60 sn bellek onbellegi; ayni anda gelen istekler tek istege iner.
// Diske yazilmaz (izleme listesi her dakika yeniler). Cevrimdisi: son bilinen fiyat ya da gunluk mum onbellegi "stale" doner.
// prev: regularMarketPreviousClose > previousClose > (mumlar iki gune yayiliyorsa) onceki gunun son kapanisi > chartPreviousClose.
// range=1d'de chartPreviousClose bir onceki seansin kapanisidir (1y araliktaki tuzak burada yok).
const QTTL=60,qcache={},qwait={};
const fnum=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
function chgOf(price,prev){return price!=null&&prev?{chg:+(price-prev).toFixed(4)||0,chgPct:+((price-prev)/prev*100).toFixed(2)||0}:{chg:null,chgPct:null}}
function parseQuote(y,res){
  const m=res.meta||{},q=(res.indicators&&res.indicators.quote&&res.indicators.quote[0])||{},ts=res.timestamp||[],A=k=>q[k]||[];
  const rows=ts.map((t,i)=>({t:t*1000,h:A('high')[i],l:A('low')[i],c:A('close')[i],v:A('volume')[i]})).filter(r=>Number.isFinite(r.c)&&r.c>0);
  const lastDay=rows.length?trDayOf(rows[rows.length-1].t):null,today=rows.filter(r=>trDayOf(r.t)===lastDay);
  const hs=today.map(r=>r.h).filter(Number.isFinite),ls=today.map(r=>r.l).filter(Number.isFinite),vs=today.map(r=>r.v).filter(Number.isFinite);
  const price=fnum(m.regularMarketPrice)??(rows.length?rows[rows.length-1].c:null);
  const prev=fnum(m.regularMarketPreviousClose)??fnum(m.previousClose)??prevDayClose(rows)??fnum(m.chartPreviousClose);
  return {source:'yahoo',symbol:y,price,prev,...chgOf(price,prev),
    dayHigh:fnum(m.regularMarketDayHigh)??(hs.length?Math.max(...hs):null),dayLow:fnum(m.regularMarketDayLow)??(ls.length?Math.min(...ls):null),
    volume:fnum(m.regularMarketVolume)??(vs.length?vs.reduce((a,b)=>a+b,0):null),
    time:m.regularMarketTime?m.regularMarketTime*1000:(rows.length?rows[rows.length-1].t:null),
    name:m.shortName||m.longName||null,currency:m.currency||null,exchange:m.exchangeName||null,intraday:today.slice(-120).map(r=>r.c)};
}
async function quote(symbol,mkt='BIST'){
  const y=yahooSymbol(symbol,mkt);if(!y)throw new Error('Geçerli bir hisse kodu yaz (ör. THYAO).');
  const c=qcache[y];if(c&&Date.now()-c.at<QTTL*1000)return {...c.v,cached:true};
  if(qwait[y])return qwait[y];
  const p=(async()=>{try{
    let j;try{j=await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=5m&range=1d&includePrePost=false`)}
    catch(e){if(/HTTP 404/.test(e.message))throw new Error(y+' bulunamadı. Kodu ve borsa seçimini (BIST/ABD) kontrol et.');throw e}
    const res=j&&j.chart&&j.chart.result&&j.chart.result[0];
    if(!res){const e=j&&j.chart&&j.chart.error;throw new Error(e&&e.description?('Yahoo: '+e.description):'Yahoo bu sembol için veri döndürmedi.')}
    const v=parseQuote(y,res);if(v.price==null)throw new Error('Yahoo bu sembol için fiyat döndürmedi.');
    const keys=Object.keys(qcache);if(keys.length>400)for(const k of keys.slice(0,100))delete qcache[k];
    qcache[y]={at:Date.now(),v};return v;
  }catch(e){
    if(c)return {...c.v,cached:true,stale:true,staleReason:e.message};
    // Gunluk mum onbellegi (diskten de yuklenir) son care: fiyat eski ama bos ekrandan iyidir.
    const d=cache['yc:'+y+':1g'],dq=d&&d.v&&d.v.quote;
    if(dq&&fnum(dq.price)!=null)return {source:'yahoo',symbol:y,price:dq.price,prev:fnum(dq.prev),...chgOf(dq.price,fnum(dq.prev)),dayHigh:dq.dayHigh??null,dayLow:dq.dayLow??null,
      volume:dq.volume??null,time:dq.time??null,name:dq.name||null,currency:dq.currency||null,exchange:dq.exchange||null,intraday:[],cached:true,stale:true,staleReason:e.message};
    throw e;
  }finally{delete qwait[y]}})();
  qwait[y]=p;return p;
}
async function yahooNews(symbol,mkt='BIST'){
  const y=yahooSymbol(symbol,mkt);if(!y)return {items:[]};
  return cached('yn:'+y,600,async()=>{
    const j=await getJSON(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(y)}&quotesCount=0&newsCount=10&enableFuzzyQuery=false`);
    return {source:'yahoo',items:(j.news||[]).map(n=>({title:n.title,publisher:n.publisher,url:n.link,time:n.providerPublishTime?n.providerPublishTime*1000:null})).filter(n=>n.title&&/^https:\/\//.test(n.url||''))};
  });
}

// --- Alpha Vantage ------------------------------------------------------------
const today=()=>new Date().toISOString().slice(0,10);
function avLeft(){if(avUse.day!==today())avUse={day:today(),n:0};return AV_DAY_CAP-avUse.n}
async function av(key,params,ttlSec){
  if(!/^[A-Z0-9]{8,24}$/i.test(String(key||'')))throw new Error('Alpha Vantage anahtarı geçersiz.');
  const qs=new URLSearchParams({...params,apikey:key}).toString();
  return cached('av:'+new URLSearchParams(params).toString(),ttlSec,async()=>{
    if(avLeft()<=0)throw new Error('Alpha Vantage günlük ücretsiz sınırı (25) doldu; yarın sıfırlanır.');
    avUse.n++;try{dir&&fs.writeFileSync(path.join(dir,'av-usage.json'),JSON.stringify(avUse))}catch(e){}
    const j=await getJSON('https://www.alphavantage.co/query?'+qs);
    // Sinir/uyari mesajlari HTTP 200 ile "Note"/"Information" alaninda gelir.
    if(j&&(j.Note||j.Information))throw new Error('Alpha Vantage: '+String(j.Note||j.Information).slice(0,140));
    if(j&&j['Error Message'])throw new Error('Alpha Vantage bu sembolü tanımıyor.');
    return j;
  });
}
async function avQuote(key,symbol){
  const j=await av(key,{function:'GLOBAL_QUOTE',symbol},900),q=j['Global Quote']||{};
  if(!q['05. price'])throw new Error('Alpha Vantage bu sembol için fiyat döndürmedi.');
  return {source:'alphavantage',price:+q['05. price'],prev:+q['08. previous close'],change:+String(q['10. change percent']||'').replace('%',''),
    dayHigh:+q['03. high'],dayLow:+q['04. low'],volume:+q['06. volume'],time:q['07. latest trading day']||null};
}
async function avNews(key,symbol){
  const j=await av(key,{function:'NEWS_SENTIMENT',tickers:symbol,limit:'20',sort:'LATEST'},3600);
  const items=(j.feed||[]).slice(0,10).map(n=>{
    const ts=(n.ticker_sentiment||[]).find(x=>String(x.ticker).toUpperCase()===String(symbol).toUpperCase());
    const tp=String(n.time_published||'');const time=tp?Date.UTC(+tp.slice(0,4),+tp.slice(4,6)-1,+tp.slice(6,8),+tp.slice(9,11),+tp.slice(11,13)):null;
    return {title:n.title,publisher:n.source,url:n.url,time,sentiment:ts?+ts.ticker_sentiment_score:+n.overall_sentiment_score,label:(ts&&ts.ticker_sentiment_label)||n.overall_sentiment_label};
  }).filter(n=>n.title&&/^https:\/\//.test(n.url||''));
  return {source:'alphavantage',items,sentiment:items.length?+(items.reduce((a,n)=>a+(n.sentiment||0),0)/items.length).toFixed(3):null};
}
async function avSearch(key,q){
  const j=await av(key,{function:'SYMBOL_SEARCH',keywords:q},86400);
  return (j.bestMatches||[]).map(m=>({symbol:m['1. symbol'],name:m['2. name'],region:m['4. region'],currency:m['8. currency']}));
}

// Coklu zaman dilimi: ana dilim + ust dilimler (gunluk, haftalik, saatlik). Her dilim ayri onbelleklidir; hata olan dilim atlanir.
// Kararlar ust dilimlerle teyit edilir (ornegin gunluk AL, haftalik dusus trendinde ise guven azalir).
const MTF={'1dk':['1s','1g'],'5dk':['1s','1g'],'15dk':['1s','1g'],'1s':['1g','1h'],'1g':['1h','1s'],'1h':['1g']};
async function multi(symbol,{tf='1g',market='BIST',extra}={}){
  const tfs=[...new Set([tf,...(extra||MTF[tf]||[])])].filter(k=>TF[k]);
  const out={frames:{},quotes:{},errors:[]};
  await Promise.all(tfs.map(async k=>{try{const r=await candles(symbol,k,market);out.frames[k]=r.rows;out.quotes[k]=r.quote;if(r.stale)out.errors.push((k)+': çevrimdışı, eski veri')}
    catch(e){out.errors.push(k+': '+e.message)}}));
  return out;
}

// Tek cagrida: mumlar (Yahoo), haberler (Yahoo + varsa Alpha Vantage). Hata olan kaynak atlanir, mesaji doner.
async function load(symbol,{tf='1g',avKey=null,news=true,market='BIST'}={}){
  const ys=yahooSymbol(symbol,market);
  const out={symbol:plain(ys||symbol),yahoo:ys,market,errors:[]};
  try{out.chart=await candles(symbol,tf,market)}catch(e){out.errors.push('Mum verisi: '+e.message)}
  if(news){
    try{out.news=await yahooNews(symbol,market)}catch(e){out.errors.push('Yahoo haber: '+e.message)}
    // BIST disi (ABD vb.) sembollerde Alpha Vantage haber/duygu skoru; BIST'te kapsami zayif, kota harcamamak icin atla.
    if(avKey&&ys&&!/\.IS$/.test(ys)){try{out.avNews=await avNews(avKey,plain(ys))}catch(e){out.errors.push(e.message)}}
  }
  if(!out.chart&&avKey&&ys){try{out.quote=await avQuote(avKey,plain(ys))}catch(e){out.errors.push(e.message)}}
  out.avLeft=avLeft();
  return out;
}

module.exports={init,flush,load,candles,quote,multi,MTF,yahooNews,avQuote,avNews,avSearch,avLeft,yahooSymbol,TF};
