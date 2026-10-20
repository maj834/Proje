// borsa-mcp istemcisi: kullanicinin Render'daki Borsa MCP sunucusu (FastMCP, Streamable HTTP, stateless) -> KAP haberleri,
// bilanco, oranlar, temettu/sermaye artirimi, ekonomik takvim, tahvil faizi. Anahtar yok; adres kullanicinin kendi sunucusu.
// Stateless sunucuda oturum/initialize gerekmez: her istek dogrudan tools/call. Yanit duz JSON ya da SSE ("data: {...}").
// Render ucretsiz plani 15 dk bostaysa uyur: ilk istek HTML "uyaniyor" sayfasi ya da zaman asimi doner -> /health yoklanir
// (5 sn arayla, en fazla ~90 sn), sonra istek bir kez daha denenir. Hata olursa eldeki eski onbellek doner.
// Fiyatlar 15 dk gecikmelidir (sunucu TradingView'e yetkisiz baglanir). fetch ve now enjekte edilir (testlerde sahte).
'use strict';
const DEF_URL='https://borsa-mcp-a07f.onrender.com';
const MIN=60000,HOUR=3600000;
const TOOLS=['search_symbol','get_profile','get_quote','get_historical_data','get_technical_analysis','get_analyst_data','get_earnings',
  'get_financial_statements','get_financial_ratios','get_corporate_actions','get_news','screen_securities','scan_stocks','compare_assets',
  'get_sector_comparison','get_crypto_market','get_economic_calendar','get_bond_yields','get_fund_data','screen_funds','get_index_data',
  'get_macro_data','get_evds_data'];
const TTL={get_quote:MIN,get_news:10*MIN,get_financial_statements:12*HOUR,get_financial_ratios:12*HOUR,get_corporate_actions:12*HOUR,
  get_economic_calendar:HOUR,get_bond_yields:30*MIN,get_fund_data:HOUR};
const DEF_TTL=15*MIN,TEXT_MAX=20000,MEM_MAX=80;
const TR={Ç:'C',Ğ:'G',İ:'I',Ö:'O',Ş:'S',Ü:'U'};

// Adres: yalniz https, kullanici/parola yok, yol/sorgu atilir (kok adres)
function cleanUrl(u){try{const x=new URL(String(u||'').trim());if(x.protocol!=='https:'||!x.hostname||x.username||x.password)return null;return x.origin}catch(e){return null}}
// BIST kodu: "thyao" / "THYAO.IS" / "şişe" -> "THYAO" / "SISE"; ABD: "AAPL" (".US" atilir)
function sym(s){const t=String(s==null?'':s).trim().toLocaleUpperCase('tr-TR').replace(/[ÇĞİÖŞÜ]/g,c=>TR[c]).replace(/\.(IS|US)$/,'');
  return /^[A-Z][A-Z0-9.\-]{0,11}$/.test(t)?t:null}
const mkt=m=>m==='US'||m==='us'?'us':'bist';
// Yanit govdesi -> JSON-RPC mesaji (duz JSON ya da SSE'deki son "data:" satiri). HTML -> null (uyaniyor sayfasi)
function parseBody(text,ctype){const t=String(text||'').trim();if(!t)return null;
  if(/text\/html/i.test(ctype||'')||/^<(!doctype|html)/i.test(t))return {html:true};
  if(t[0]==='{'){try{return JSON.parse(t)}catch(e){return null}}
  let last=null;for(const line of t.split(/\r?\n/)){const m=/^data:\s?(.*)$/.exec(line);if(m)try{const j=JSON.parse(m[1]);if(j&&(j.result||j.error))last=j}catch(e){}}
  return last}
// tools/call sonucu -> {text, data, isError}
function resultOf(j){const r=j&&j.result||{},c=Array.isArray(r.content)?r.content:[];
  const text=c.filter(x=>x&&x.type==='text'&&typeof x.text==='string').map(x=>x.text).join('\n\n').trim();
  return {text:text.length>TEXT_MAX?text.slice(0,TEXT_MAX)+'\n\n…(kısaltıldı)':text,data:r.structuredContent&&typeof r.structuredContent==='object'?r.structuredContent:null,isError:!!r.isError}}

function createBorsaMcp({fetch:F=(...a)=>globalThis.fetch(...a),now=()=>Date.now(),url=DEF_URL,timeoutMs=25000,wakeMs=90000,pollMs=5000,
  sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  let base=cleanUrl(url)||DEF_URL,id=0,waking=null;
  const st={awake:false,lastOk:null,lastError:null,waking:false};
  const mem=new Map(),inflight=new Map();
  const xe=(code,msg)=>Object.assign(new Error(msg||code),{xcode:code});

  async function req(path,init,ms){const ac=typeof AbortController==='function'?new AbortController():null;let timer;
    const to=new Promise((_,rej)=>{timer=setTimeout(()=>{try{ac&&ac.abort()}catch(e){}rej(xe('timeout'))},ms)});
    try{return await Promise.race([(async()=>{const r=await F(base+path,{...init,redirect:'error',signal:ac?ac.signal:undefined});
      const h=r.headers&&typeof r.headers.get==='function'?r.headers.get('content-type')||'':'';
      return {status:r.status,ok:r.ok!=null?!!r.ok:r.status>=200&&r.status<300,ctype:h,text:typeof r.text==='function'?await r.text():''}})(),to])}
    catch(e){if(e&&e.xcode)throw e;throw xe(e&&(e.name==='AbortError'||e.name==='TimeoutError')?'timeout':'net')}
    finally{clearTimeout(timer)}}

  // /health JSON {status:'healthy'} donene kadar yokla (Render uyaniyor sayfasi HTML doner)
  function wake(){if(waking)return waking;
    waking=(async()=>{st.waking=true;const t0=now();
      try{for(;;){
        try{const r=await req('/health',{method:'GET',headers:{accept:'application/json'}},Math.min(30000,wakeMs));
          const j=parseBody(r.text,r.ctype);if(r.ok&&j&&!j.html&&j.status==='healthy'){st.awake=true;return true}}catch(e){}
        if(now()-t0+pollMs>wakeMs)return false;await sleep(pollMs)}}
      finally{st.waking=false;waking=null}})();
    return waking}

  async function rpc(tool,args){
    const body=JSON.stringify({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name:tool,arguments:args}});
    const r=await req('/mcp/',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body},timeoutMs);
    const j=parseBody(r.text,r.ctype);
    if(j&&j.html)throw xe('sleep');
    if(r.status===502||r.status===503||r.status===504)throw xe('sleep');
    if(!j)throw xe(r.ok?'parse':'http','HTTP '+r.status);
    if(j.error)throw xe('rpc',String(j.error.message||'MCP hatası').slice(0,200));
    const o=resultOf(j);if(o.isError)throw xe('tool',(o.text||'Araç hata döndürdü.').slice(0,300));
    return o}
  const MSG={timeout:'Borsa MCP sunucusu yanıt vermedi.',net:'Borsa MCP sunucusuna bağlanılamadı.',sleep:'Borsa MCP sunucusu uyanamadı (Render ücretsiz plan). Biraz sonra tekrar dene.',
    parse:'Borsa MCP yanıtı okunamadı.',http:'Borsa MCP isteği başarısız.'};
  const errText=e=>e&&e.xcode==='rpc'||e&&e.xcode==='tool'?'Borsa MCP: '+e.message:(MSG[e&&e.xcode]||'Borsa MCP hatası.')+(e&&e.xcode==='http'?' ('+e.message+')':'');

  // Genel cagri: izinli arac, onbellek, es zamanli tekillestirme; uykudaysa uyandir + bir kez daha dene; hata -> eski onbellek
  function call(tool,args={}){
    if(!TOOLS.includes(tool))return Promise.resolve({ok:false,text:'',data:null,error:'Bilinmeyen araç.'});
    const ck=tool+'|'+JSON.stringify(args),c=mem.get(ck);
    if(c&&now()<c.exp)return Promise.resolve({ok:true,text:c.v.text,data:c.v.data,cached:true,error:null});
    if(inflight.has(ck))return inflight.get(ck);
    const p=(async()=>{try{
        let v;try{v=await rpc(tool,args)}
        catch(e){if(!['sleep','timeout','net'].includes(e.xcode))throw e;if(!await wake())throw xe('sleep');v=await rpc(tool,args)}
        mem.delete(ck);mem.set(ck,{v,exp:now()+(TTL[tool]||DEF_TTL)});while(mem.size>MEM_MAX)mem.delete(mem.keys().next().value);
        st.awake=true;st.lastOk=now();st.lastError=null;
        return {ok:true,text:v.text,data:v.data,cached:false,error:null}}
      catch(e){const m=errText(e);st.lastError=m;if(e.xcode==='sleep')st.awake=false;
        if(c)return {ok:true,text:c.v.text,data:c.v.data,cached:true,stale:true,error:m};
        return {ok:false,text:'',data:null,error:m}}
      finally{inflight.delete(ck)}})();
    inflight.set(ck,p);return p}
  const bad=()=>Promise.resolve({ok:false,text:'',data:null,error:'Geçerli bir hisse kodu yaz (ör. THYAO).'});

  return {
    call,wake,
    kapNews:(s,{limit=10}={})=>{const x=sym(s);return x?call('get_news',{symbol:x,limit:Math.max(1,Math.min(50,limit|0||10))}):bad()},
    financials:(s,{market='BIST',period='quarterly',type='all'}={})=>{const x=sym(s);return x?call('get_financial_statements',{symbol:x,market:mkt(market),
      statement_type:['balance','income','cashflow','all'].includes(type)?type:'all',period:period==='annual'?'annual':'quarterly'}):bad()},
    ratios:(s,{market='BIST',set='valuation'}={})=>{const x=sym(s);return x?call('get_financial_ratios',{symbol:x,market:mkt(market),
      ratio_set:['valuation','buffett','core_health','advanced','comprehensive'].includes(set)?set:'valuation'}):bad()},
    corporateActions:(s,{market='BIST'}={})=>{const x=sym(s);return x?call('get_corporate_actions',{symbol:x,market:mkt(market)}):bad()},
    quote:(s,{market='BIST'}={})=>{const x=sym(s);return x?call('get_quote',{symbol:x,market:mkt(market)}):bad()},
    econCalendar:({country='TR',period='this_week',importance=null}={})=>call('get_economic_calendar',{
      country:['TR','US','EU','DE','GB','JP','CN'].includes(country)?country:'TR',period:['today','this_week','next_week'].includes(period)?period:'this_week',
      ...(['high','medium','low'].includes(importance)?{importance}:{})}),
    bondYields:()=>call('get_bond_yields',{country:'TR'}),
    fund:code=>{const x=String(code||'').trim().toUpperCase();return /^[A-Z0-9]{3}$/.test(x)?call('get_fund_data',{symbol:x}):Promise.resolve({ok:false,text:'',data:null,error:'Fon kodu 3 karakter olmalı (ör. TTE).'})},
    setUrl(u){const x=cleanUrl(u);if(!x)return false;if(x!==base){base=x;mem.clear();st.awake=false;st.lastOk=null;st.lastError=null}return true},
    status:()=>({url:base,...st}),
  };
}

module.exports={createBorsaMcp,parseBody,resultOf,cleanUrl,sym,TOOLS,DEF_URL};
