// Sanal islem (kagit uzerinde alim satim): sahte bakiye ile AL/SAT. Hicbir araci kuruma emir gonderilmez.
// Para tutarlari kurus/sent cinsinden tam sayi tutulur (kayan nokta yuvarlama hatasi birikmez).
// Yalnizca uzun pozisyon (aciga satis yok). Emir turleri: piyasa, limit (al/sat), zarar durdur (yalniz sat).
// Bekleyen emirler 1 dk mumlarla kontrol edilir: emirden SONRA baslayan mumun dusugu/yuksegi seviyeye degerse dolar
// (mum fiyatin otesinde acildiysa acilis fiyatindan: bosluk). Boylece iki yenileme arasindaki dokunuslar da kacmaz.
'use strict';
const fs=require('fs'),path=require('path');
const calendar=require('./calendar');

const MARKETS={BIST:{ccy:'TRY',start:100000},US:{ccy:'USD',start:10000}};
const LIM={maxQty:100000000,maxPrice:10000000,maxOrders:50,maxPositions:50,maxTrades:500,minStart:1000,maxStart:1000000000,maxCommission:0.01,maxSlippage:100};
const DEF_SET={commission:0.002,slippage:0,anyTime:false}; // komisyon orani (binde 2), kayma (baz puan), seans disi islem
const SYM=/^[A-Z0-9.=^-]{1,20}$/;

const cents=x=>Math.round(x*100);
const px4=x=>Math.round(x*1e4)/1e4;
const err=(msg,code)=>Object.assign(new Error(msg),{code:code||'PAPER'});
const isPos=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;

// ABD seansi: hafta ici 09:30-16:00 New York saati (resmi tatiller dahil degil).
function usStatus(date){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(date||new Date()).map(x=>[x.type,x.value]));
  if(p.weekday==='Sat'||p.weekday==='Sun')return {open:false,reason:'ABD piyasası hafta sonu kapalı'};
  const m=(+p.hour%24)*60+(+p.minute);
  if(m<570)return {open:false,reason:'ABD seansı 09:30\'da (New York) açılır'};
  if(m>=960)return {open:false,reason:'ABD seansı 16:00\'da (New York) kapandı'};
  return {open:true,reason:null};
}
function session(mkt,date,cal=calendar){if(mkt==='US')return usStatus(date);const s=cal.status(date);return {open:s.open,reason:s.open?null:'BIST '+s.reason}}

function blank(){
  const acc={};for(const k in MARKETS)acc[k]={cash:cents(MARKETS[k].start),start:cents(MARKETS[k].start),since:null,realized:0,fees:0,closed:0,wins:0};
  return {v:1,seq:0,acc,pos:{},orders:[],trades:[],set:{...DEF_SET}};
}
// Dosyadan gelen durumu dogrula; bozuk alanlar atilir, para alanlari tam sayi olmali.
function sanitize(s){
  const b=blank();if(!s||typeof s!=='object')return b;
  const int=v=>Number.isSafeInteger(v);
  for(const k in MARKETS){const a=s.acc&&s.acc[k];if(a&&int(a.cash)&&int(a.start)&&a.start>0)b.acc[k]={cash:a.cash,start:a.start,since:Number.isFinite(a.since)?a.since:null}}
  if(s.pos&&typeof s.pos==='object')for(const sym in s.pos){const p=s.pos[sym];
    if(SYM.test(sym)&&p&&MARKETS[p.market]&&int(p.qty)&&p.qty>0&&int(p.cost)&&p.cost>=0)b.pos[sym]={market:p.market,qty:p.qty,cost:p.cost,at:+p.at||0,last:isPos(p.last)?p.last:null,lastAt:+p.lastAt||null,name:typeof p.name==='string'?p.name.slice(0,80):null}}
  if(Array.isArray(s.orders))b.orders=s.orders.filter(o=>o&&typeof o.id==='string'&&SYM.test(o.sym)&&MARKETS[o.market]&&['buy','sell'].includes(o.side)
    &&['limit','stop'].includes(o.type)&&!(o.type==='stop'&&o.side==='buy')&&int(o.qty)&&o.qty>0&&isPos(o.price)&&int(o.reserve)&&o.reserve>=0&&Number.isFinite(o.at)).slice(0,LIM.maxOrders);
  if(Array.isArray(s.trades))b.trades=s.trades.filter(t=>t&&typeof t.id==='string'&&MARKETS[t.market]&&int(t.value)&&int(t.fee)).slice(-LIM.maxTrades);
  for(const k in MARKETS){const a=s.acc&&s.acc[k],tr=b.trades.filter(t=>t.market===k),sales=tr.filter(t=>t.side==='sell');
    const stats={realized:sales.reduce((v,t)=>v+(Number.isSafeInteger(t.pnl)?t.pnl:0),0),fees:tr.reduce((v,t)=>v+t.fee,0),closed:sales.length,wins:sales.filter(t=>t.pnl>0).length};
    for(const key in stats)b.acc[k][key]=a&&Number.isSafeInteger(a[key])&&(key==='realized'||a[key]>=0)?a[key]:stats[key];
  }
  if(s.set&&typeof s.set==='object'){const c=s.set;
    if(Number.isFinite(c.commission)&&c.commission>=0&&c.commission<=LIM.maxCommission)b.set.commission=c.commission;
    if(Number.isFinite(c.slippage)&&c.slippage>=0&&c.slippage<=LIM.maxSlippage)b.set.slippage=c.slippage;
    b.set.anyTime=c.anyTime===true}
  b.seq=Number.isSafeInteger(s.seq)&&s.seq>=0?s.seq:0;
  // Satis emirleri pozisyondan fazla adet ayiramaz (elle bozulmus dosya)
  for(const sym in b.pos){let left=b.pos[sym].qty;b.orders=b.orders.filter(o=>{if(o.sym!==sym||o.side!=='sell')return true;if(o.qty>left)return false;left-=o.qty;return true})}
  b.orders=b.orders.filter(o=>o.side==='buy'||b.pos[o.sym]);
  return b;
}

function create({file=null,now=()=>Date.now(),calendar:cal=calendar}={}){
  const marketSession=(m,d)=>session(m,d,cal);
  let S=blank();
  if(file){try{S=sanitize(JSON.parse(fs.readFileSync(file,'utf8')))}catch(e){
    if(e.code!=='ENOENT')try{fs.copyFileSync(file,file+'.bozuk-'+Date.now())}catch(_){}S=blank()}}
  const persist=()=>{if(!file)return;const t=file+'.tmp';fs.writeFileSync(t,JSON.stringify(S),{mode:0o600});fs.renameSync(t,file)};
  // Degisiklik yalnizca dosyaya yazilabilirse kalici olur; yazilamazsa bellekteki durum geri alinir.
  const commit=fn=>{const snap=JSON.stringify(S);try{const r=fn();persist();return r}catch(e){S=JSON.parse(snap);throw e}};
  const nid=p=>p+(++S.seq);
  const reserved=mkt=>S.orders.reduce((a,o)=>a+(o.market===mkt?o.reserve:0),0);
  const reservedQty=sym=>S.orders.reduce((a,o)=>a+(o.sym===sym&&o.side==='sell'?o.qty:0),0);
  const fee=v=>Math.round(v*S.set.commission);
  const slip=(p,side)=>px4(p*(1+(side==='buy'?1:-1)*S.set.slippage/1e4));
  const canTrade=mkt=>{const s=marketSession(mkt,new Date(now()));return s.open||S.set.anyTime?null:s.reason+'. Limit emir verebilir ya da Ayarlar\'dan seans dışı işlemi açabilirsin.'};

  function checkQuote(q,mkt){
    if(!q||!isPos(q.price))throw err('Güncel fiyat alınamadı.');
    if(q.currency&&q.currency!==MARKETS[mkt].ccy)throw err('Bu sembolün para birimi '+q.currency+'; '+(mkt==='US'?'ABD':'BIST')+' hesabı '+MARKETS[mkt].ccy+'. Borsa seçimini kontrol et.');
  }
  // Tek bir dolumu uygular (dogrulama cagirani yapar ya da burada tekrar edilir).
  function fill({sym,mkt,side,qty,price,type,orderId=null,name=null,at=now()}){
    const value=cents(price*qty),f=fee(value),A=S.acc[mkt],t=Math.min(at,now());
    if(!Number.isSafeInteger(value)||!Number.isSafeInteger(value+f))throw err('Emir tutarı güvenli işlem sınırını aşıyor.');
    if(side==='buy'){
      const other=reserved(mkt)-(orderId?(S.orders.find(o=>o.id===orderId)||{reserve:0}).reserve:0);
      if(value+f>A.cash-other)throw err('Yetersiz bakiye: gereken '+((value+f)/100).toFixed(2)+', kullanılabilir '+((A.cash-other)/100).toFixed(2)+' '+MARKETS[mkt].ccy+'.','CASH');
      if(!S.pos[sym]&&Object.keys(S.pos).length>=LIM.maxPositions)throw err('En fazla '+LIM.maxPositions+' farklı hisse tutulabilir.');
      A.cash-=value+f;
      const p=S.pos[sym]||(S.pos[sym]={market:mkt,qty:0,cost:0,at:t,last:null,lastAt:null,name:null});
      p.qty+=qty;p.cost+=value+f;p.last=price;p.lastAt=t;if(name)p.name=name;
      if(!A.since)A.since=t;
      S.trades.push({id:nid('t'),at:t,sym,market:mkt,side,type,qty,price,value,fee:f,pnl:null,order:orderId});
    }else{
      const p=S.pos[sym];
      if(!p||p.market!==mkt)throw err('Bu hissede pozisyon yok.','QTY');
      const free=p.qty-reservedQty(sym)+(orderId?(S.orders.find(o=>o.id===orderId)||{qty:0}).qty:0);
      if(qty>free)throw err('Satılabilir adet '+free+(free<p.qty?' (kalanı bekleyen satış emirlerinde)':'')+'.','QTY');
      const part=qty===p.qty?p.cost:Math.round(p.cost*qty/p.qty);
      A.realized+=value-f-part;A.closed++;if(value-f-part>0)A.wins++;
      A.cash+=value-f;p.qty-=qty;p.cost-=part;p.last=price;p.lastAt=t;
      if(p.qty===0)delete S.pos[sym];
      S.trades.push({id:nid('t'),at:t,sym,market:mkt,side,type,qty,price,value,fee:f,pnl:value-f-part,order:orderId});
    }
    A.fees+=f;
    if(orderId)S.orders=S.orders.filter(o=>o.id!==orderId);
    if(S.trades.length>LIM.maxTrades)S.trades=S.trades.slice(-LIM.maxTrades);
    return S.trades[S.trades.length-1];
  }

  // req: {symbol (Yahoo kodu, ör. THYAO.IS), market, side, type, qty, price?}; quote: {price, currency, time, name}
  function place(req,quote){
    const r=req||{},mkt=r.market,sym=String(r.symbol||'').toUpperCase(),side=r.side,type=r.type||'market',qty=r.qty;
    if(!MARKETS[mkt])throw err('Geçersiz borsa.');
    if(!SYM.test(sym))throw err('Geçerli bir hisse kodu yaz.');
    if(!['buy','sell'].includes(side))throw err('Geçersiz yön.');
    if(!['market','limit','stop'].includes(type))throw err('Geçersiz emir türü.');
    if(type==='stop'&&side==='buy')throw err('Zarar durdur yalnızca satış emri olabilir.');
    if(!Number.isSafeInteger(qty)||qty<1||qty>LIM.maxQty)throw err('Adet 1 ile '+LIM.maxQty.toLocaleString('tr-TR')+' arasında tam sayı olmalı.');
    checkQuote(quote,mkt);
    const last=quote.price;
    if(quote.stale)throw err('Eski veriyle emir verilemez.');
    if(S.pos[sym]&&S.pos[sym].market!==mkt)throw err('Sembol başka borsa hesabına ait.');
    if(type==='market'&&last>LIM.maxPrice)throw err('Fiyat işlem sınırını aşıyor.');
    if(side==='sell'){const p=S.pos[sym];const free=p&&p.market===mkt?p.qty-reservedQty(sym):0;
      if(qty>free)throw err(free>0?'Satılabilir adet '+free+'.':'Bu hissede satılabilir pozisyon yok (açığa satış kapalı).','QTY')}
    return commit(()=>{
      if(S.pos[sym]){S.pos[sym].last=last;S.pos[sym].lastAt=Number.isFinite(quote.time)?Math.min(quote.time,now()):now()}
      if(type==='market'){
        const why=canTrade(mkt);if(why)throw err(why,'CLOSED');
        return {trade:fill({sym,mkt,side,qty,price:slip(last,side),type,name:quote.name})};
      }
      const lp=r.price;
      if(!isPos(lp)||lp>LIM.maxPrice)throw err('Geçerli bir fiyat yaz.');
      const level=px4(lp);
      if(level<=0||!Number.isSafeInteger(cents(level*qty)+fee(cents(level*qty))))throw err('Emir tutarı güvenli işlem sınırını aşıyor.');
      if(type==='stop'&&level>=last)throw err('Zarar durdur fiyatı güncel fiyatın ('+last+') altında olmalı.');
      // Hemen gerceklesebilir limit emir (al: limit >= fiyat, sat: limit <= fiyat) seans aciksa guncel fiyattan dolar.
      const marketable=type==='limit'&&(side==='buy'?level>=last:level<=last);
      if(marketable&&!canTrade(mkt))return {trade:fill({sym,mkt,side,qty,price:last,type,name:quote.name})};
      if(S.orders.length>=LIM.maxOrders)throw err('En fazla '+LIM.maxOrders+' bekleyen emir olabilir.');
      let reserve=0;
      if(side==='buy'){const v=cents(level*qty);reserve=v+fee(v);
        if(reserve>S.acc[mkt].cash-reserved(mkt))throw err('Yetersiz bakiye: emir için '+(reserve/100).toFixed(2)+' '+MARKETS[mkt].ccy+' ayrılmalı.','CASH')}
      const o={id:nid('o'),at:now(),sym,market:mkt,side,type,qty,price:level,reserve,name:quote.name||null};
      S.orders.push(o);
      return {order:{...o}};
    });
  }
  function cancel(id){
    if(!S.orders.some(o=>o.id===id))throw err('Emir bulunamadı (dolmuş ya da iptal edilmiş olabilir).');
    commit(()=>{S.orders=S.orders.filter(o=>o.id!==id)});
  }
  // Bekleyen emirleri kontrol et. bars: [{t,o,h,l,c}] (1 dk), quote: {price,time,currency}. Dolan islemleri dondurur.
  function process(sym,bars,quote){
    if(quote&&quote.stale)return {fills:[],failed:[]};
    sym=String(sym||'').toUpperCase();
    const list=S.orders.filter(o=>o.sym===sym).sort((a,b)=>a.at-b.at);
    const out=[],failed=[];
    const B=(Array.isArray(bars)?bars:[]).filter(b=>b&&Number.isFinite(b.t)&&b.t<=now()&&[b.o,b.h,b.l,b.c].every(isPos)).sort((a,b)=>a.t-b.t);
    const mk=marketOf(sym),qOk=!!(mk&&quote&&!quote.stale&&isPos(quote.price)&&(!quote.currency||quote.currency===MARKETS[mk].ccy));
    if(quote&&quote.currency&&mk&&quote.currency!==MARKETS[mk].ccy)return {fills:out,failed};
    if(!list.length&&!(qOk&&S.pos[sym]))return {fills:out,failed};
    commit(()=>{
      for(const o of list){
        let price=null,at=now();
        for(const b of B){if(b.t<o.at)continue;
          if(o.type==='limit'&&o.side==='buy'&&b.l<=o.price){price=Math.min(b.o,o.price);at=b.t;break}
          if(o.type==='limit'&&o.side==='sell'&&b.h>=o.price){price=Math.max(b.o,o.price);at=b.t;break}
          if(o.type==='stop'&&b.l<=o.price){price=slip(Math.min(b.o,o.price),'sell');at=b.t;break}}
        // Mum yoksa: emirden sonraki bir fiyat (quote.time) seans icinde seviyeyi gectiyse
        if(price==null&&qOk&&Number.isFinite(quote.time)&&quote.time>=o.at&&quote.time<=now()&&(S.set.anyTime||marketSession(o.market,new Date(quote.time)).open)){const q=quote.price;at=quote.time;
          if(o.type==='limit'&&o.side==='buy'&&q<=o.price)price=q;
          else if(o.type==='limit'&&o.side==='sell'&&q>=o.price)price=q;
          else if(o.type==='stop'&&q<=o.price)price=slip(q,'sell')}
        if(price==null)continue;
        try{out.push(fill({sym,mkt:o.market,side:o.side,qty:o.qty,price:px4(price),type:o.type,orderId:o.id,name:o.name,at}))}
        catch(e){S.orders=S.orders.filter(x=>x.id!==o.id);failed.push({order:o,msg:e.message})}
      }
      const p=S.pos[sym],qt=quote&&Number.isFinite(quote.time)?Math.min(quote.time,now()):now();if(p&&qOk&&qt>=(p.lastAt||0)){p.last=quote.price;p.lastAt=qt;if(quote.name)p.name=quote.name}
    });
    return {fills:out,failed};
  }
  function reset(mkt,start){
    if(!MARKETS[mkt])throw err('Geçersiz borsa.');
    const st=start==null?S.acc[mkt].start/100:start;
    if(!isPos(st)||st<LIM.minStart||st>LIM.maxStart)throw err('Başlangıç bakiyesi '+LIM.minStart.toLocaleString('tr-TR')+' ile '+LIM.maxStart.toLocaleString('tr-TR')+' arasında olmalı.');
    commit(()=>{S.acc[mkt]={cash:cents(st),start:cents(st),since:null,realized:0,fees:0,closed:0,wins:0};
      for(const k in S.pos)if(S.pos[k].market===mkt)delete S.pos[k];
      S.orders=S.orders.filter(o=>o.market!==mkt);S.trades=S.trades.filter(t=>t.market!==mkt)});
  }
  function settings(o){o=o||{};
    const c=o.commission,sl=o.slippage;
    if(c!==undefined&&!(Number.isFinite(c)&&c>=0&&c<=LIM.maxCommission))throw err('Komisyon %0 ile %1 arasında olmalı.');
    if(sl!==undefined&&!(Number.isFinite(sl)&&sl>=0&&sl<=LIM.maxSlippage))throw err('Kayma 0 ile '+LIM.maxSlippage+' baz puan arasında olmalı.');
    commit(()=>{if(c!==undefined)S.set.commission=c;if(sl!==undefined)S.set.slippage=sl;if(typeof o.anyTime==='boolean')S.set.anyTime=o.anyTime;
      for(const order of S.orders)if(order.side==='buy'){const v=cents(order.price*order.qty);order.reserve=v+fee(v)}
      for(const mkt in MARKETS)if(reserved(mkt)>S.acc[mkt].cash)throw err('Yeni komisyon bekleyen emirler için bakiyeyi aşıyor; önce emir iptal et.');
    });
  }
  // Arayuz icin ozet (tutarlar para birimi cinsinden).
  function summary(){
    const t=now(),accounts={};
    for(const k in MARKETS){const A=S.acc[k],res=reserved(k);let val=0,unr=0,stale=0;
      const pos=Object.entries(S.pos).filter(([,p])=>p.market===k).map(([sym,p])=>{
        const last=p.last,v=last!=null?cents(last*p.qty):p.cost;val+=v;const u=last!=null?v-p.cost:0;unr+=u;if(last==null)stale++;
        return {sym,name:p.name,qty:p.qty,free:p.qty-reservedQty(sym),avg:px4(p.cost/100/p.qty),last,lastAt:p.lastAt,value:v/100,cost:p.cost/100,pnl:u/100,pnlPct:p.cost?+(u/p.cost*100).toFixed(2):0}}).sort((a,b)=>b.value-a.value);
      const realized=A.realized,fees=A.fees;
      const eq=A.cash+val;
      accounts[k]={ccy:MARKETS[k].ccy,cash:A.cash/100,reserved:res/100,available:(A.cash-res)/100,positions:val/100,equity:eq/100,start:A.start/100,
        pnl:(eq-A.start)/100,pnlPct:+((eq-A.start)/A.start*100).toFixed(2),unrealized:unr/100,realized:realized/100,fees:fees/100,
        closed:A.closed,winRate:A.closed?Math.round(A.wins/A.closed*100):null,since:A.since,pos,priceMissing:stale,
        session:marketSession(k,new Date(t))}}
    return {accounts,orders:S.orders.map(o=>({...o,reserve:o.reserve/100})).sort((a,b)=>b.at-a.at),
      trades:S.trades.slice(-100).reverse().map(x=>({...x,value:x.value/100,fee:x.fee/100,pnl:x.pnl==null?null:x.pnl/100})),
      set:{...S.set},limits:{...LIM}};
  }
  // Fiyat tahmini (emir onizlemesi): tutar + komisyon
  function estimate(side,qty,price){if(!isPos(price)||!Number.isSafeInteger(qty)||qty<1)return null;
    const p=slip(price,side),v=cents(p*qty),f=fee(v);return {price:p,value:v/100,fee:f/100,total:(side==='buy'?v+f:v-f)/100}}
  function maxBuy(mkt,price){if(!MARKETS[mkt]||!isPos(price))return 0;const p=slip(price,'buy'),avail=S.acc[mkt].cash-reserved(mkt);
    let q=Math.floor(avail/(p*100*(1+S.set.commission)));q=Math.max(0,Math.min(q,LIM.maxQty));
    while(q>0&&cents(p*q)+fee(cents(p*q))>avail)q--;return q}
  const symbols=()=>[...new Set([...Object.keys(S.pos),...S.orders.map(o=>o.sym)])];
  const marketOf=sym=>(S.pos[sym]&&S.pos[sym].market)||((S.orders.find(o=>o.sym===sym)||{}).market)||null;
  return {place,cancel,process,reset,settings,summary,estimate,maxBuy,symbols,marketOf,hasOrders:()=>S.orders.length>0,raw:()=>JSON.parse(JSON.stringify(S))};
}

module.exports={create,sanitize,session,usStatus,MARKETS,LIM,DEF_SET};
