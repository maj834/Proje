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

// --- Yahoo temel veriler (v10 quoteSummary) --------------------------------------------------------------
// quoteSummary cerez + crumb ister: fc.yahoo.com cevabinin set-cookie'sinden A3/A1 cerezi (yonlendirme izlenmez, cerez ilk cevaptadir),
// sonra v1/test/getcrumb (cerezle) -> crumb. Ikisi ~6 sa bellekte; 401/403 (suresi doldu) -> bir kez yenilenip tekrar denenir.
// Sonuc 12 sa bellekte (diske yazilmaz; temel veri gun ici degismez). Ayni anda gelen istekler tek istege iner. Cevrimdisi: eski sonuc "stale".
// Degerler {raw,fmt}: raw alinir. Oranlar yuzdeye cevrilir (0.123 -> 12.3). debtToEquity ORANDIR (Yahoo yuzde verir: 85 -> 0.85).
// Eksik alan null. financialCurrency: tablolarin para birimi (fiyattan farkli olabilir; ornegin USD raporlayan sirket).
const CRUMB_TTL=6*3600000,FTTL=12*3600000,FMODS='summaryDetail,defaultKeyStatistics,financialData,assetProfile,calendarEvents';
const RATE_MSG='Veri sağlayıcı çok sık istek uyarısı verdi; biraz bekle.';
let yauth=null,yauthWait=null;const fcache={},fwait={};
async function yget(url,headers={},extra={}){
  try{return await fetch(url,{headers:{'user-agent':UA,...headers},signal:AbortSignal.timeout(15000),...extra})}
  catch(e){throw new Error(e.name==='TimeoutError'?'Veri sağlayıcı yanıt vermedi.':'Bağlantı yok.')}
}
// set-cookie -> "ad=deger; ad2=deger2". getSetCookie yoksa birlesik basliktan ayrilir (Expires icindeki virgul bolunmez).
function cookiesOf(h){
  let a=[];try{if(h&&typeof h.getSetCookie==='function')a=h.getSetCookie()||[]}catch(e){}
  if(!a.length){let s=null;try{s=h&&typeof h.get==='function'?h.get('set-cookie'):null}catch(e){}if(s)a=String(s).split(/,(?=\s*[\w.-]+=)/)}
  const kv=a.map(s=>String(s).split(';')[0].trim()).filter(s=>/^[\w.-]+=\S+$/.test(s));
  return [...new Map(kv.map(s=>[s.slice(0,s.indexOf('=')),s])).values()].join('; ');
}
// bad: 401 alan oturum; o hala gecerli kayitsa yenilenir (baska istek coktan yeniledi ise yenisi kullanilir).
async function yahooAuth(bad=null){
  if(yauth&&yauth!==bad&&Date.now()-yauth.at<CRUMB_TTL)return yauth;
  if(yauthWait)return yauthWait;
  yauthWait=(async()=>{try{
    const r=await yget('https://fc.yahoo.com',{accept:'text/html'},{redirect:'manual'});   // genelde 404 doner; cerez yine gelir
    const cookie=cookiesOf(r.headers);try{if(r.body&&typeof r.body.cancel==='function')r.body.cancel().catch(()=>{})}catch(e){}
    if(!cookie)throw new Error('Yahoo oturum çerezi alınamadı.');
    const c=await yget('https://query2.finance.yahoo.com/v1/test/getcrumb',{cookie,accept:'text/plain'});
    if(c.status===429)throw new Error(RATE_MSG);
    let crumb='';if(c.ok)try{crumb=String(await c.text()).trim()}catch(e){}
    if(!crumb||crumb.length>64||/[\s<>{}"]/.test(crumb))throw new Error('Yahoo erişim anahtarı (crumb) alınamadı'+(c.ok?'.':' (HTTP '+c.status+').'));
    return yauth={cookie,crumb,at:Date.now()};
  }finally{yauthWait=null}})();
  return yauthWait;
}
async function ysummary(y,a){
  const r=await yget(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(y)}?modules=${FMODS}&crumb=${encodeURIComponent(a.crumb)}`,{cookie:a.cookie,accept:'application/json'});
  let j=null;try{j=await r.json()}catch(e){}
  return {status:r.status,ok:r.ok,j};
}
const rawOf=x=>x&&typeof x==='object'?fnum(x.raw):fnum(x);
const fstr=s=>typeof s==='string'&&s.trim()?s.trim():null;
function parseFund(y,res){
  const o=k=>res[k]&&typeof res[k]==='object'?res[k]:{},sd=o('summaryDetail'),ks=o('defaultKeyStatistics'),fd=o('financialData'),ap=o('assetProfile'),ce=o('calendarEvents');
  const R=(...xs)=>{for(const x of xs){const v=rawOf(x);if(v!=null)return v}return null};
  const P=(...xs)=>{const v=R(...xs);return v==null?null:+(v*100).toFixed(2)},D=(v,d=2)=>v==null?null:+v.toFixed(d);
  let summary=fstr(ap.longBusinessSummary);
  if(summary&&summary.length>600){const cut=summary.slice(0,599),sp=cut.lastIndexOf(' ');summary=(sp>400?cut.slice(0,sp):cut).replace(/[\s,;:.]+$/,'')+'…'}
  const tMean=R(fd.targetMeanPrice),tN=R(fd.numberOfAnalystOpinions),rec=fstr(fd.recommendationKey);
  const target=tMean!=null&&tMean>0&&tN!==0?{mean:tMean,high:R(fd.targetHighPrice),low:R(fd.targetLowPrice),n:tN!=null?Math.round(tN):null,
    rec:rec&&rec.toLowerCase()!=='none'?rec.toLowerCase():null}:null;
  // Bilanco tarihi: Yahoo 1-2 tarih (aralik) verir, saniye; gecmis tarih (BIST'te sik eskir) "sonraki" sayilmaz.
  const now=Date.now(),eds=(ce.earnings&&Array.isArray(ce.earnings.earningsDate)?ce.earnings.earningsDate:[]).map(rawOf)
    .filter(v=>v!=null&&v>0).map(v=>v>1e12?v:v*1000).sort((a,b)=>a-b);
  const de=R(fd.debtToEquity);
  return {source:'yahoo',symbol:y,currency:fstr(sd.currency)||(/\.IS$/.test(y)?'TRY':fstr(fd.financialCurrency)),financialCurrency:fstr(fd.financialCurrency),
    sector:fstr(ap.sector),industry:fstr(ap.industry),summary,
    marketCap:R(sd.marketCap),pe:D(R(sd.trailingPE,ks.trailingPE)),fwdPe:D(R(sd.forwardPE,ks.forwardPE)),pb:D(R(ks.priceToBook),3),
    ps:D(R(sd.priceToSalesTrailing12Months),3),evEbitda:D(R(ks.enterpriseToEbitda)),
    divYield:P(sd.dividendYield,sd.trailingAnnualDividendYield),payout:P(sd.payoutRatio),roe:P(fd.returnOnEquity),roa:P(fd.returnOnAssets),
    grossMargin:P(fd.grossMargins),opMargin:P(fd.operatingMargins),netMargin:P(fd.profitMargins,ks.profitMargins),
    revenueGrowth:P(fd.revenueGrowth),earningsGrowth:P(fd.earningsGrowth,ks.earningsQuarterlyGrowth),
    debtToEquity:de==null?null:+(de/100).toFixed(3),currentRatio:D(R(fd.currentRatio),3),beta:D(R(sd.beta,ks.beta),3),
    target,nextEarnings:eds.find(t=>t>=now-86400000)??null,at:now};
}
async function fundamentals(symbol,mkt='BIST'){
  const y=yahooSymbol(symbol,mkt);if(!y)throw new Error('Geçerli bir hisse kodu yaz (ör. THYAO).');
  const c=fcache[y];if(c&&Date.now()-c.at<FTTL)return {...c.v,cached:true};
  if(fwait[y])return fwait[y];
  const p=(async()=>{try{
    let a=await yahooAuth(),r=await ysummary(y,a);
    if(r.status===401||r.status===403){a=await yahooAuth(a);r=await ysummary(y,a)}
    if(r.status===401||r.status===403){if(yauth===a)yauth=null;throw new Error('Yahoo erişimi reddetti (HTTP '+r.status+').')}
    if(r.status===429)throw new Error(RATE_MSG);
    const qs=r.j&&typeof r.j==='object'?(r.j.quoteSummary||r.j.finance):null,res=qs&&Array.isArray(qs.result)?qs.result[0]:null,err=qs&&qs.error;
    if(!res||typeof res!=='object'){
      if(r.status===404||(err&&/not ?found/i.test(String(err.code||'')+' '+String(err.description||''))))throw new Error(y+' için temel veri bulunamadı.');
      if(err&&err.description)throw new Error('Yahoo: '+String(err.description).slice(0,140));
      throw new Error(r.ok?'Yahoo bu sembol için temel veri döndürmedi.':'Yahoo hata verdi (HTTP '+r.status+').');
    }
    const v=parseFund(y,res);
    const keys=Object.keys(fcache);if(keys.length>300)for(const k of keys.slice(0,100))delete fcache[k];
    fcache[y]={at:Date.now(),v};return v;
  }catch(e){
    if(c)return {...c.v,cached:true,stale:true,staleReason:e.message};
    throw new Error('Temel veri alınamadı: '+e.message);
  }finally{delete fwait[y]}})();
  fwait[y]=p;return p;
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

module.exports={init,flush,load,candles,quote,multi,MTF,yahooNews,fundamentals,avQuote,avNews,avSearch,avLeft,yahooSymbol,TF};
