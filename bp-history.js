// Uzun gunluk gecmis (Yahoo, 10 yil): olasilik motoru (bp-quant) icin. Yalniz bellekte tutulur (diske yazilmaz; ~2500 mum/hisse),
// 12 saat onbellek, en fazla 24 hisse (en eski once silinir). Ayni hisse icin eszamanli istekler tek istege iner.
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const TTL=12*3600000,MAX=24;
function createHistory({fetch:F=(...a)=>globalThis.fetch(...a),now=()=>Date.now(),years=10}={}){
  const mem=new Map(),wait=new Map();
  async function load(y){
    let r;try{r=await F('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(y)+'?interval=1d&range='+years+'y&includePrePost=false',
      {headers:{'user-agent':UA,accept:'application/json'},signal:AbortSignal.timeout(20000)})}
    catch(e){throw new Error(e&&e.name==='TimeoutError'?'Veri sağlayıcı yanıt vermedi.':'Bağlantı yok.')}
    if(!r.ok)throw new Error('HTTP '+r.status);
    const j=await r.json(),res=j&&j.chart&&j.chart.result&&j.chart.result[0];if(!res)throw new Error('Geçmiş veri yok.');
    const q=(res.indicators&&res.indicators.quote&&res.indicators.quote[0])||{},ts=res.timestamp||[],A=k=>q[k]||[];
    return ts.map((t,i)=>({t:t*1000,o:A('open')[i],h:A('high')[i],l:A('low')[i],c:A('close')[i],v:q.volume?q.volume[i]:null}))
      .filter(x=>[x.o,x.h,x.l,x.c].every(Number.isFinite)&&x.c>0)}
  // y: Yahoo sembolu (THYAO.IS). Hata olursa eski kayit varsa o doner (stale), yoksa hata atar.
  async function get(y){
    y=String(y||'').toUpperCase();if(!/^[A-Z0-9.=^-]{1,24}$/.test(y))throw new Error('Geçersiz sembol.');
    const c=mem.get(y);if(c&&now()-c.at<TTL)return c.rows;
    if(wait.has(y))return wait.get(y);
    const p=load(y).then(rows=>{mem.delete(y);mem.set(y,{at:now(),rows});while(mem.size>MAX)mem.delete(mem.keys().next().value);return rows},
      e=>{if(c)return c.rows;throw e}).finally(()=>wait.delete(y));
    wait.set(y,p);return p}
  return {get,size:()=>mem.size}}
module.exports={createHistory};
