// Derinlik verisi: ortak model, bot mesaji ayristirici, al/sat baskisi ve trendi.
//
// Model:
// {symbol,last,change,ceiling,floor,buyRatio,
//  bids:[{price,qty,orders}], asks:[{price,qty,orders}],
//  trades:[{price,qty,buyer,seller,side}], buyers:[{name,net,cost,pct}], sellers:[{name,net,cost,pct}]}
(function(root){

// "4.342.512" -> 4342512, "12,13" / "12.13" -> 12.13, "%26,7" -> 26.7, "1,2M" -> 1200000
function num(s){
  if(s==null)return null;s=String(s).trim().replace(/[%₺TL\s]/gi,'');
  const mul=/[mM]$/.test(s)?1e6:/[kKbB]$/.test(s)?1e3:1;s=s.replace(/[mMkKbB]$/,'');
  // Isaret once ayrilir: "-4.342.512" binlik bicimine de uysun
  const sg=s[0]==='-'?-1:1;s=s.replace(/^[-+]/,'');
  if(!/^[\d.,]+$/.test(s))return null;
  if(/^\d{1,3}(\.\d{3})+$/.test(s))return sg*s.replace(/\./g,'')*mul;       // 4.342.512
  if(/^\d{1,3}(,\d{3})+$/.test(s)&&!/,\d{1,2}$/.test(s))return sg*s.replace(/,/g,'')*mul;
  if(/,\d+$/.test(s)){const v=sg*s.replace(/\./g,'').replace(',','.')*mul;return Number.isFinite(v)?v:null}     // 1.234,56 / 12,13 ("1,2,3" -> null)
  const v=sg*s*mul;return Number.isFinite(v)?v:null;
}
const TOK=/[-+]?%?\d[\d.,]*[mMkK]?%?/g;
const isPrice=s=>(/^\d{1,6}[.,]\d{1,4}$/.test(s)&&!/^\d{1,3}\.\d{3}$/.test(s))||/^\d{1,3}(\.\d{3})+,\d{1,4}$/.test(s); // 1.234,50
// Sembol sanilmamasi gereken buyuk harfli basliklar
const STOP=new Set(['KADEME','TAVAN','TABAN','TOPLAM','ALIŞ','SATIŞ','DERİNLİK','ADET','HACİM','FİYAT','PİYASA','KURUM','İŞLEM']);
const TIME=/\b(\d{2}):(\d{2}):(\d{2})\b/;
// Saat damgasi olmayan islemler icin alinma saati (Turkiye sabit UTC+3)
const hms=now=>new Date((now??Date.now())+3*3600e3).toISOString().slice(11,19);

const SEC=[
  [/derinlik|kademe|emir/i,'depth'],
  [/al[ıi]c[ıi]lar|al[ıi]c[ıi] kurum|en [çc]ok alan|net al[ıi][sş]/i,'buyers'],
  [/sat[ıi]c[ıi]lar|sat[ıi]c[ıi] kurum|en [çc]ok satan|net sat[ıi][sş]/i,'sellers'],
  [/ger[çc]ekle[sş]en|i[sş]lemler|son i[sş]lem|trades?/i,'trades'],
  [/^\W*(al[ıi][sş]|bid)\W*$/i,'bids'],[/^\W*(sat[ıi][sş]|ask)\W*$/i,'asks']];

function parseText(text,hint={}){
  const d={symbol:hint.symbol||null,last:null,change:null,ceiling:null,floor:null,buyRatio:null,bids:[],asks:[],trades:[],buyers:[],sellers:[]};
  const lines=String(text||'').split(/\r?\n/).map(l=>l.replace(/[│┃|]/g,' | ').trim()).filter(Boolean);
  let sec=null;
  const sym=(String(text).match(/(?<!\p{L})[A-ZÇĞİÖŞÜ]{4,6}(?!\p{L})/gu)||[]).find(w=>!STOP.has(w));if(!d.symbol&&sym)d.symbol=sym;
  // Son fiyat: once acik etiket (son/fiyat/last) tum satirlarda; yoksa TL/₺ (hacim/tutar satirlari haric)
  const kv0=(l,re)=>{const m=l.match(re);return m?num(m[1]):null},LS=lines.map(l=>l.replace(/[*_`]/g,''));
  // Etiket kelime basinda olmali ("Ort. fiyat" haric); deger fiyat bicimindeyse ya da ayirac (: = ₺) varsa alinir,
  // "Son 20 İşlem" gibi baslik sayilari alinmaz. Bosluk gruplari tek: uzun bosluk dizisinde yavaslamaz.
  const LAST=/(?<![\p{L}\p{N}])(?<!ort\.?\s?)(?:son(?:\s+fiyat)?|fiyat|anl[ıi]k(?:\s+fiyat)?|last(?:\s+price)?)(\s*[:=]\s*|\s*₺\s*|\s+)(?:₺\s*)?([\d.,]+)(?!\s*(?:işlem|islem|dk|dakika|kurum|lot|adet|gün|gun|saat|%))/iu;
  for(const l of LS){const m=l.match(LAST);if(!m)continue;const sep=/[:=₺]/.test(m[1]);if(!sep&&!isPrice(m[2]))continue;const v=num(m[2]);if(v!=null){d.last=v;break}}
  if(d.last==null)for(const l of LS){if(/hacim|tutar|ciro/i.test(l))continue;const v=kv0(l,/₺\s*([\d.,]+)/)??kv0(l,/([\d.,]+)\s*(?:TL\b|₺)/i);if(v!=null){d.last=v;break}}
  const rcv=hms(hint.now);
  for(const raw of lines){
    const l=raw.replace(/[*_`]/g,'');
    // Ozet alanlar
    const kv=(re)=>kv0(l,re);
    d.ceiling=d.ceiling??kv(/tavan\s*[:=]?\s*([\d.,]+)/i);d.floor=d.floor??kv(/taban\s*[:=]?\s*([\d.,]+)/i);
    d.change=d.change??kv(/([-+]\d[\d.,]*)\s*%/)??kv(/%\s*([-+]\d[\d.,]*)/);
    if(d.change==null){const m=l.match(/([-+])\s*%\s*(\d[\d.,]*)/);if(m)d.change=num(m[1]+m[2])}
    const br=l.match(/al[ıi][sş]\s*\/\s*sat[ıi][sş][^\d%]*%?\s*([\d.,]+)\s*%?/i);if(br)d.buyRatio=num(br[1]);
    if(br||/\d\s*TL\b|tavan|taban|₺|\b(son|fiyat|anl[ıi]k|last)\b\s*[:=]/i.test(l))continue; // ozet satiri
    // Bolum basligi mi?
    // Islem saati (HH:MM:SS) sayi sanilmasin
    const tm=l.match(TIME),lt=tm?l.replace(tm[0],' '):l;
    const toks=lt.match(TOK)||[];
    const s=SEC.find(([re])=>re.test(l));
    if(s&&toks.length<2){sec=s[1];continue}
    if(toks.length<2)continue;
    const words=lt.replace(TOK,' ').replace(/[|:;=•·\-–>]+/g,' ').trim().split(/\s+/).filter(w=>/[a-zçğıöşüİĞŞÇÖÜ]{2,}/i.test(w));
    const name=words.join(' ').replace(/\s*(lot|adet|emir|tl)\b/gi,'').trim();
    if((sec==='buyers'||sec==='sellers')&&name){
      const nums=toks.map(num),prices=toks.filter(isPrice).map(num),pm=l.match(/%\s*([\d.,]+)/)||l.match(/([\d.,]+)\s*%/),pct=pm?num(pm[1]):null;
      const big=nums.filter(n=>n!=null&&!prices.includes(n)&&n!==pct).sort((a,b)=>Math.abs(b)-Math.abs(a))[0];
      d[sec].push({name,net:big??null,cost:prices.find(x=>x!==pct)??null,pct});continue}
    if(sec==='trades'||(name.split(/\s+/).length>=2&&toks.length===2&&isPrice(toks[0]))){
      const p=toks.find(isPrice),q=toks.filter(t=>t!==p).map(num)[0];
      const ws=name.split(/\s+/);
      if(p)d.trades.push({time:tm?tm[0]:rcv,...(tm?{}:{est:true}),price:num(p),qty:q??null,buyer:ws[0]||null,seller:ws[1]||null,side:/al[ıi][sş]|🟢|↑|▲/i.test(l)?'buy':/sat[ıi][sş]|🔴|↓|▼/i.test(l)?'sell':null});
      continue}
    // Kademe satiri: tek tarafli ya da "alis | satis" iki tarafli
    const halves=l.includes(' | ')&&l.split(' | ').filter(h=>(h.match(TOK)||[]).length>=2).length===2?l.split(' | ').filter(h=>(h.match(TOK)||[]).length>=2):[l];
    halves.forEach((h,k)=>{
      const t=h.match(TOK)||[];const pi=t.findIndex(isPrice);if(pi<0)return;
      const rest=t.filter((_,i)=>i!==pi).map(num).filter(n=>n!=null);
      const qty=rest.length?Math.max(...rest):null,orders=rest.length>1?Math.min(...rest):null;
      const side=halves.length===2?(k===0?'bids':'asks'):(sec==='asks'||/sat|ask|🔴/i.test(h)?'asks':sec==='bids'||/al[ıi]|bid|🟢/i.test(h)?'bids':sec==='depth'?null:null);
      if(side)d[side].push({price:num(t[pi]),qty,orders});
    });
  }
  // Fiyata gore sirala: alis yuksekten, satis dusukten
  d.bids.sort((a,b)=>b.price-a.price);d.asks.sort((a,b)=>a.price-b.price);
  return d;
}
const hasData=d=>!!d&&(d.bids.length+d.asks.length+d.trades.length+d.buyers.length+d.sellers.length)>0;

// Ortalamanin cok uzerinde biriken kademeler: "duvar".
function walls(d){
  const pick=(arr,side)=>{const q=arr.map(x=>x.qty||0).filter(Boolean);if(q.length<2)return arr.slice(0,1).filter(x=>x.qty).map(x=>({...x,side,ratio:1}));
    const sorted=[...q].sort((a,b)=>a-b),med=sorted[sorted.length>>1]||1,tot=q.reduce((a,b)=>a+b,0);
    return arr.filter(x=>x.qty&&(x.qty>=med*3||x.qty>=tot*0.25)).slice(0,3).map(x=>({...x,side,ratio:x.qty/tot}))};
  return [...pick(d.bids,'bid'),...pick(d.asks,'ask')];
}

// Al/sat baskisi: -100 (satis) .. +100 (alis), bilesenleriyle.
function pressure(d){
  const parts=[];const clamp=v=>Math.max(-1,Math.min(1,v));
  const sum=a=>a.reduce((s,x)=>s+(x.qty||0),0);
  const bq=sum(d.bids.slice(0,10)),aq=sum(d.asks.slice(0,10));
  if(bq+aq>0)parts.push({k:'Derinlik dengesi',v:clamp((bq-aq)/(bq+aq)),w:0.35});
  if(d.buyRatio!=null)parts.push({k:'Alış/satış oranı',v:clamp((d.buyRatio-50)/50),w:0.25});
  // Saticilarin neti eksi isaretli gelebilir: iki tarafta da buyukluk alinir
  const bn=d.buyers.reduce((s,x)=>s+Math.abs(x.net||0),0),sn=d.sellers.reduce((s,x)=>s+Math.abs(x.net||0),0);
  if(bn+sn>0)parts.push({k:'Kurum net akışı',v:clamp((bn-sn)/(bn+sn)),w:0.2});
  const bestB=d.bids[0]&&d.bids[0].price,bestA=d.asks[0]&&d.asks[0].price;
  let tb=0,ts=0;for(const t of d.trades){const side=t.side||(bestA&&t.price>=bestA?'buy':bestB&&t.price<=bestB?'sell':null);if(side==='buy')tb+=t.qty||1;else if(side==='sell')ts+=t.qty||1}
  if(tb+ts>0)parts.push({k:'Gerçekleşen işlemler',v:clamp((tb-ts)/(tb+ts)),w:0.2});
  if(!parts.length)return null;
  const w=parts.reduce((s,p)=>s+p.w,0);
  return {score:Math.round(parts.reduce((s,p)=>s+p.v*p.w,0)/w*100),parts:parts.map(p=>({k:p.k,v:Math.round(p.v*100)}))};
}

// Trend: son olcumlerin egimi.
function trend(hist){
  const h=hist.slice(-12);if(h.length<3)return {dir:0,text:'Trend için birkaç ölçüm daha gerekli'};
  const n=h.length,mx=(n-1)/2,my=h.reduce((s,x)=>s+x.p,0)/n;
  let sxy=0,sxx=0;h.forEach((x,i)=>{sxy+=(i-mx)*(x.p-my);sxx+=(i-mx)**2});
  const slope=sxy/sxx;const dir=slope>2?1:slope<-2?-1:0;
  return {dir,slope:+slope.toFixed(1),text:dir>0?(my>0?'Alış baskısı artıyor':'Satış baskısı azalıyor'):dir<0?(my<0?'Satış baskısı artıyor':'Alış baskısı azalıyor'):'Baskı yatay seyrediyor'};
}

// --- Islem akisi (tape) -------------------------------------------------------------
// Bot her seferinde son ~20 islemi gonderir; yeni gelenler birikmis listeye eklenir (tekrarlar atilir).
const sec=t=>{const m=String(t||'').match(/^(\d{1,2}):(\d{2}):(\d{2})$/);return m?+m[1]*3600+ +m[2]*60+ +m[3]:null};
const tkey=t=>[t.time,t.price,t.qty,t.buyer,t.seller].join('|');
const ekey=t=>[t.price,t.qty,t.buyer,t.seller].join('|');
// Saati olmayan islemler (est: alinma saati verilmis) tek tek degil SIRAYLA eslenir: bot son ~20 islemi kayan
// pencere olarak gonderir. Yeni mesaj bir onceki mesajla (R) hizalanir; ortusen kisim atilir, gerisi yenidir.
// Boylece ayni fiyat/adet/kurumla gercekten tekrar eden islem de kaybolmaz. Bot yeniden eskiye (NF) ya da
// eskiden yeniye (OF) siralayabilir; tesadufi tek islem eslesmesi sayilmaz (en az 2 ortak islem): ortusmenin pencere ucuna dayandigi ve en az yeni islem veren hizalama secilir.
function estNew(R,X){
  if(!R||!R.length)return X;
  const r=R.map(ekey),x=X.map(ekey),min=Math.min(2,r.length,x.length),eq=(i,j,n)=>{for(let q=0;q<n;q++)if(x[i+q]!==r[j+q])return false;return true};
  let best=null;
  for(let k=0;k<=x.length;k++){const n=x.length-k;if(n>=min&&n<=r.length&&eq(k,0,n)){best={add:X.slice(0,k)};break}}  // NF: X = yeni + R'nin basi
  for(let j=0;j<r.length;j++){const n=r.length-j;if(n>=min&&n<=x.length&&eq(0,j,n)){const add=X.slice(n);if(!best||add.length<best.add.length)best={add};break}} // OF: X = R'nin sonu + yeni
  if(best)return best.add;
  return X;
}
// Saatli islemlerde tekrar sayimi: ayni anahtarli islemden yeni grupta eskisinden fazlasi varsa yalniz fazlasi eklenir.
function mergeTape(tape,trades,max=800){
  const have=new Map(),cnt=new Map(),add=[];for(const t of tape||[])if(!t.est){const k=tkey(t);have.set(k,(have.get(k)||0)+1)}
  const est=[];for(const t of trades||[]){if(sec(t.time)==null)continue;if(t.est){est.push(t);continue}
    const k=tkey(t),c=(cnt.get(k)||0)+1;cnt.set(k,c);if(c>(have.get(k)||0))add.push(t)}
  // Daha once gorulmus bir pencerenin aynisi (gec gelen eski mesaj) yeniden sayilmaz ve son pencere yerine gecmez
  const sig=est.map(ekey).join('\n'),seen=(tape&&tape.estSeen)||[],stale=est.length>0&&sig!==(tape&&tape.estLast||[]).map(ekey).join('\n')&&seen.includes(sig);
  if(est.length&&!stale)add.push(...estNew(tape&&tape.estLast,est));
  const out=[...add,...(tape||[])].sort((a,b)=>sec(b.time)-sec(a.time)).slice(0,max);
  Object.defineProperty(out,'estLast',{value:est.length&&!stale?est:tape&&tape.estLast||null});
  Object.defineProperty(out,'estSeen',{value:est.length&&!stale?[...seen.filter(x=>x!==sig),sig].slice(-5):seen}); // son ham saatsiz mesaj (hizalama icin)
  return out;
}
// Aktif alis/satis dengesi, hacim agirlikli ortalama fiyat (VWAP), kumulatif hacim farki (CVD) ve en agresif kurum.
// Zaman, son islemin saatine gore olculur (bot verisi gecikmeli olabilir). Yon: 5 ve 15 dk pencereleri + fiyatin VWAP'a gore yeri.
function tapeFlow(tape){
  const T=(tape||[]).filter(t=>sec(t.time)!=null&&t.qty>0);if(!T.length)return null;
  const now=sec(T[0].time);
  const win=m=>{let b=0,s=0,n=0,pv=0,v=0;for(const t of T){if(now-sec(t.time)>m*60)break;n++;pv+=t.price*t.qty;v+=t.qty;if(t.side==='buy')b+=t.qty;else if(t.side==='sell')s+=t.qty}
    return {buy:b,sell:s,n,delta:b+s?(b-s)/(b+s):0,vwap:v?pv/v:null,vol:v}};
  const w5=win(5),w15=win(15);
  // Dakikalik CVD (eskiden yeniye)
  const mins=new Map();for(const t of T){if(now-sec(t.time)>30*60)break;const k=Math.floor(sec(t.time)/60);mins.set(k,(mins.get(k)||0)+(t.side==='buy'?t.qty:t.side==='sell'?-t.qty:0))}
  let c=0;const cvd=[...mins.keys()].sort((a,b)=>a-b).map(k=>({m:k,v:c+=mins.get(k)}));
  // En agresif kurum: aktif alista alan, aktif satista satan
  const agg=new Map();for(const t of T){if(now-sec(t.time)>15*60)break;const who=t.side==='buy'?t.buyer:t.side==='sell'?t.seller:null;if(who)agg.set(who,(agg.get(who)||0)+(t.side==='buy'?t.qty:-t.qty))}
  const top=[...agg.entries()].sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))[0]||null;
  const last=T[0].price,sided=T.filter(t=>t.side&&now-sec(t.time)<=15*60).length;
  let v=0.6*w5.delta+0.4*w15.delta;
  if(w15.vwap&&last){const rel=(last-w15.vwap)/w15.vwap;if(Math.abs(rel)>0.0005)v+=Math.sign(rel)*0.15}
  const score=Math.round(Math.max(-1,Math.min(1,v))*100),why=[];
  if(w5.buy+w5.sell)why.push('Son 5 dk aktif '+(w5.delta>=0?'alış':'satış')+' %'+Math.round(Math.max(w5.buy,w5.sell)/(w5.buy+w5.sell)*100));
  if(w15.vwap)why.push('Fiyat VWAP '+(last>=w15.vwap?'üstünde':'altında'));
  if(top&&Math.abs(top[1])>0)why.push(top[0]+' agresif '+(top[1]>0?'alıyor':'satıyor'));
  const enough=sided>=5;
  return {score,dir:enough?(score>=30?1:score<=-30?-1:0):0,enough,why,w5,w15,last,cvd,top:top?{name:top[0],net:top[1]}:null,lastTime:T[0].time,count:T.length};
}

const api={num,parseText,hasData,walls,pressure,trend,mergeTape,tapeFlow};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Depth=api;
})(this);
