// Sanal islem (kagit uzerinde alim satim): sahte bakiye ile AL/SAT. Hicbir araci kuruma emir gonderilmez; gercek para degildir.
// Para tutarlari kurus/sent cinsinden tam sayi tutulur (kayan nokta yuvarlama hatasi birikmez).
// Uc ayri hesap: BIST (TRY), ABD (USD) ve Kripto (USD, Yahoo '-USD' ciftleri, 7/24).
// Miktar: BIST tam lot; ABD tam adet (Ayarlar'dan kesirli hisse acilabilir: 0,0001 adim); kripto 0,00000001 adim.
// Kesirli islemlerde en kucuk islem tutari 1 $ (pozisyonun tamamini kapatan satis haric).
// Yalnizca uzun pozisyon (aciga satis yok). Emir turleri: piyasa, limit (al/sat), zarar durdur (yalniz sat).
// Bekleyen emirler 1 dk mumlarla kontrol edilir: emirden SONRA baslayan mumun dusugu/yuksegi seviyeye degerse dolar
// (mum fiyatin otesinde acildiysa acilis fiyatindan: bosluk). Boylece iki yenileme arasindaki dokunuslar da kacmaz.
// Her hesap icin gunluk oz sermaye anlik goruntusu (Istanbul gunu) tutulur: sermaye egrisi, gunluk K/Z ve en buyuk dusus bundan.
'use strict';
const fs=require('fs'),path=require('path');
const calendar=require('./calendar');

const MARKETS={BIST:{ccy:'TRY',start:100000,name:'BIST'},US:{ccy:'USD',start:10000,name:'ABD'},CRYPTO:{ccy:'USD',start:10000,name:'Kripto'}};
// dec: miktar ondalik basamagi; fracDec: ABD kesirli hisse acikken; minValue: kesirli islemde en kucuk tutar (sent)
const QTY={BIST:{dec:0},US:{dec:0,fracDec:4,minValue:100},CRYPTO:{dec:8,minValue:100}};
const LIM={maxQty:100000000,maxPrice:10000000,maxOrders:50,maxPositions:50,maxTrades:500,minStart:1000,maxStart:1000000000,maxCommission:0.01,maxSlippage:100,maxCurve:400,maxLog:200};
const DEF_SET={commission:0.002,slippage:0,anyTime:false,usFrac:false}; // komisyon orani (binde 2), kayma (baz puan), seans disi islem, ABD kesirli hisse
const SYM=/^[A-Z0-9.=^-]{1,20}$/;
const DAY_RE=/^\d{4}-\d{2}-\d{2}$/;

const cents=x=>Math.round(x*100);
const px4=x=>Math.round(x*1e4)/1e4;
// Fiyat yuvarlama: hisselerde 4 ondalik; kriptoda 10 anlamli basamak (PEPE gibi 0,00001 $ fiyatlar sifirlanmasin)
const prc=(mkt,x)=>mkt==='CRYPTO'?+(+x).toPrecision(10):px4(x);
const roundQ=(x,dec)=>{const f=10**dec;return Math.round(x*f)/f};
const err=(msg,code)=>Object.assign(new Error(msg),{code:code||'PAPER'});
const isPos=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const fmt=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('tr-TR',{minimumFractionDigits:0,maximumFractionDigits:d}):'—';
const money=(c,mkt)=>(c/100).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+MARKETS[mkt].ccy;
const what=mkt=>mkt==='CRYPTO'?'coin':'hisse';
// Istanbul gunu (Turkiye 2016'dan beri sabit UTC+3)
const isoDay=t=>new Date(t+3*3600000).toISOString().slice(0,10);
const dayMs=d=>Date.parse(d+'T12:00:00+03:00');
// Dosyadaki miktar o hesabin en ince adimina uyuyor mu (ABD: kesirli ayar kapali olsa da eski kesirli pozisyon gecerli)
const qtyOk=(mkt,q)=>{if(!isPos(q)||q>LIM.maxQty)return false;const d=mkt==='US'?QTY.US.fracDec:QTY[mkt].dec;return Math.abs(roundQ(q,d)-q)<1e-12};

// ABD seansi: hafta ici 09:30-16:00 New York saati. NYSE resmi tatilleri ve yarim gunleri modellenmez (kapsam disi).
function usStatus(date){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(date||new Date()).map(x=>[x.type,x.value]));
  if(p.weekday==='Sat'||p.weekday==='Sun')return {open:false,reason:'ABD piyasası hafta sonu kapalı'};
  const m=(+p.hour%24)*60+(+p.minute);
  if(m<570)return {open:false,reason:'ABD seansı 09:30\'da (New York) açılır'};
  if(m>=960)return {open:false,reason:'ABD seansı 16:00\'da (New York) kapandı'};
  return {open:true,reason:null};
}
// Kripto 7/24 islem gorur: seans kontrolu yok.
function session(mkt,date,cal=calendar){if(mkt==='CRYPTO')return {open:true,reason:null};if(mkt==='US')return usStatus(date);const s=cal.status(date);return {open:s.open,reason:s.open?null:'BIST '+s.reason}}

const blankAcc=st=>({cash:cents(st),start:cents(st),since:null,realized:0,fees:0,closed:0,wins:0,n:0});
function blank(){
  const acc={},eq={};for(const k in MARKETS){acc[k]=blankAcc(MARKETS[k].start);eq[k]=[]}
  return {v:2,seq:0,acc,pos:{},orders:[],trades:[],eq,log:[],set:{...DEF_SET}};
}
// Dosyadan gelen durumu dogrula; bozuk alanlar atilir, para alanlari tam sayi olmali.
function sanitize(s){
  const b=blank();if(!s||typeof s!=='object')return b;
  const int=v=>Number.isSafeInteger(v);
  for(const k in MARKETS){const a=s.acc&&s.acc[k];if(a&&int(a.cash)&&int(a.start)&&a.start>0)b.acc[k]={...b.acc[k],cash:a.cash,start:a.start,since:Number.isFinite(a.since)?a.since:null}}
  if(s.pos&&typeof s.pos==='object')for(const sym in s.pos){const p=s.pos[sym];
    if(SYM.test(sym)&&p&&MARKETS[p.market]&&qtyOk(p.market,p.qty)&&int(p.cost)&&p.cost>=0)b.pos[sym]={market:p.market,qty:p.qty,cost:p.cost,at:+p.at||0,last:isPos(p.last)?p.last:null,lastAt:+p.lastAt||null,name:typeof p.name==='string'?p.name.slice(0,80):null}}
  if(Array.isArray(s.orders))b.orders=s.orders.filter(o=>o&&typeof o.id==='string'&&SYM.test(o.sym)&&MARKETS[o.market]&&['buy','sell'].includes(o.side)
    &&['limit','stop'].includes(o.type)&&!(o.type==='stop'&&o.side==='buy')&&qtyOk(o.market,o.qty)&&isPos(o.price)&&int(o.reserve)&&o.reserve>=0&&Number.isFinite(o.at)).slice(0,LIM.maxOrders);
  if(Array.isArray(s.trades))b.trades=s.trades.filter(t=>t&&typeof t.id==='string'&&MARKETS[t.market]&&int(t.value)&&int(t.fee)).slice(-LIM.maxTrades);
  for(const k in MARKETS){const a=s.acc&&s.acc[k],tr=b.trades.filter(t=>t.market===k),sales=tr.filter(t=>t.side==='sell');
    const stats={realized:sales.reduce((v,t)=>v+(Number.isSafeInteger(t.pnl)?t.pnl:0),0),fees:tr.reduce((v,t)=>v+t.fee,0),closed:sales.length,wins:sales.filter(t=>t.pnl>0).length,n:tr.length};
    for(const key in stats)b.acc[k][key]=a&&Number.isSafeInteger(a[key])&&(key==='realized'||a[key]>=0)?a[key]:stats[key];
    const e=s.eq&&Array.isArray(s.eq[k])?s.eq[k]:[];
    b.eq[k]=e.filter(x=>Array.isArray(x)&&DAY_RE.test(x[0])&&int(x[1])).sort((x,y)=>x[0]<y[0]?-1:x[0]>y[0]?1:0)
      .filter((x,i,arr)=>i===arr.length-1||arr[i+1][0]!==x[0]).slice(-LIM.maxCurve);
  }
  if(Array.isArray(s.log))b.log=s.log.filter(x=>x&&Number.isFinite(x.at)&&MARKETS[x.m]&&['order','cancel'].includes(x.ev)&&['buy','sell'].includes(x.side)&&['market','limit','stop'].includes(x.type))
    .map(x=>({at:x.at,m:x.m,ev:x.ev,side:x.side,type:x.type})).slice(-LIM.maxLog);
  if(s.set&&typeof s.set==='object'){const c=s.set;
    if(Number.isFinite(c.commission)&&c.commission>=0&&c.commission<=LIM.maxCommission)b.set.commission=c.commission;
    if(Number.isFinite(c.slippage)&&c.slippage>=0&&c.slippage<=LIM.maxSlippage)b.set.slippage=c.slippage;
    b.set.anyTime=c.anyTime===true;b.set.usFrac=c.usFrac===true}
  b.seq=Number.isSafeInteger(s.seq)&&s.seq>=0?s.seq:0;
  // Satis emirleri pozisyondan fazla adet ayiramaz (elle bozulmus dosya)
  for(const sym in b.pos){let left=b.pos[sym].qty;b.orders=b.orders.filter(o=>{if(o.sym!==sym||o.side!=='sell')return true;if(o.qty>left+1e-12)return false;left=roundQ(left-o.qty,8);return true})}
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
  const qdec=mkt=>mkt==='US'&&S.set.usFrac?QTY.US.fracDec:QTY[mkt].dec;
  const rq=(mkt,x)=>roundQ(x,mkt==='US'?QTY.US.fracDec:QTY[mkt].dec);
  const reserved=mkt=>S.orders.reduce((a,o)=>a+(o.market===mkt?o.reserve:0),0);
  const reservedQty=sym=>roundQ(S.orders.reduce((a,o)=>a+(o.sym===sym&&o.side==='sell'?o.qty:0),0),8);
  const fee=v=>Math.round(v*S.set.commission);
  const slip=(p,side,mkt)=>prc(mkt,p*(1+(side==='buy'?1:-1)*S.set.slippage/1e4));
  const canTrade=mkt=>{const s=marketSession(mkt,new Date(now()));return s.open||S.set.anyTime?null:s.reason+'. Limit emir verebilir ya da Ayarlar\'dan seans dışı işlemi açabilirsin.'};
  const log=(m,ev,side,type)=>{S.log.push({at:now(),m,ev,side,type});if(S.log.length>LIM.maxLog)S.log=S.log.slice(-LIM.maxLog)};
  // Hesabin oz sermayesi (kurus): nakit + pozisyonlar (son fiyat, yoksa maliyet)
  const equityOf=mkt=>S.acc[mkt].cash+Object.values(S.pos).filter(p=>p.market===mkt).reduce((v,p)=>v+(p.last!=null?cents(p.last*p.qty):p.cost),0);
  // Gunluk anlik goruntu: bugunun noktasi guncellenir ya da eklenir
  function snap(mkt){if(!MARKETS[mkt])return;const d=isoDay(now()),e=S.eq[mkt],v=equityOf(mkt);
    if(e.length&&e[e.length-1][0]===d)e[e.length-1][1]=v;else if(!e.length||e[e.length-1][0]<d)e.push([d,v]);
    if(e.length>LIM.maxCurve)S.eq[mkt]=e.slice(-LIM.maxCurve)}
  // Miktar dogrulama ve yuvarlama (hesabin adimina gore). sell: eldeki kesirli ABD pozisyonu ayar kapali olsa da satilabilir.
  function normQty(mkt,q,sym,side){
    if(typeof q!=='number'||!Number.isFinite(q)||q<=0)throw err(mkt==='CRYPTO'?'Geçerli bir miktar yaz (ör. 0,0005).':'Geçerli bir adet yaz.','QTY');
    const held=side==='sell'&&S.pos[sym],dec=mkt==='US'&&held&&!Number.isInteger(held.qty)?QTY.US.fracDec:qdec(mkt);
    if(dec===0){if(!Number.isSafeInteger(q)||q<1||q>LIM.maxQty)throw err('Adet 1 ile '+LIM.maxQty.toLocaleString('tr-TR')+' arasında tam sayı olmalı'+(mkt==='BIST'?' (BIST\'te kesirli hisse yok).':' (kesirli ABD hissesi Ayarlar\'dan açılabilir).'),'QTY');return q}
    const r=roundQ(q,dec);
    if(r<=0)throw err('Miktar en az '+(1/10**dec).toFixed(dec).replace('.',',')+' olmalı.','QTY');
    if(r>LIM.maxQty)throw err('Miktar en fazla '+LIM.maxQty.toLocaleString('tr-TR')+' olabilir.','QTY');
    return r;
  }

  function checkQuote(q,mkt){
    if(!q||!isPos(q.price))throw err('Güncel fiyat alınamadı.');
    if(q.currency&&q.currency!==MARKETS[mkt].ccy)throw err('Bu sembolün para birimi '+q.currency+'; '+MARKETS[mkt].name+' hesabı '+MARKETS[mkt].ccy+'. Hesap seçimini kontrol et.');
  }
  // Tek bir dolumu uygular (dogrulama cagirani yapar ya da burada tekrar edilir).
  function fill({sym,mkt,side,qty,price,type,orderId=null,name=null,at=now()}){
    const value=cents(price*qty),f=fee(value),A=S.acc[mkt],t=Math.min(at,now());
    if(!Number.isSafeInteger(value)||!Number.isSafeInteger(value+f))throw err('Emir tutarı güvenli işlem sınırını aşıyor.');
    if(side==='buy'){
      const other=reserved(mkt)-(orderId?(S.orders.find(o=>o.id===orderId)||{reserve:0}).reserve:0);
      if(value+f>A.cash-other)throw err('Yetersiz bakiye: gereken '+money(value+f,mkt)+', kullanılabilir '+money(A.cash-other,mkt)+'.','CASH');
      if(!S.pos[sym]&&Object.keys(S.pos).length>=LIM.maxPositions)throw err('En fazla '+LIM.maxPositions+' farklı sembol tutulabilir.');
      A.cash-=value+f;
      const p=S.pos[sym]||(S.pos[sym]={market:mkt,qty:0,cost:0,at:t,last:null,lastAt:null,name:null});
      p.qty=rq(mkt,p.qty+qty);p.cost+=value+f;p.last=price;p.lastAt=t;if(name)p.name=name;
      if(!A.since)A.since=t;
      S.trades.push({id:nid('t'),at:t,sym,market:mkt,side,type,qty,price,value,fee:f,pnl:null,order:orderId});
    }else{
      const p=S.pos[sym];
      if(!p||p.market!==mkt)throw err('Bu '+what(mkt)+'de pozisyon yok.','QTY');
      const free=rq(mkt,p.qty-reservedQty(sym)+(orderId?(S.orders.find(o=>o.id===orderId)||{qty:0}).qty:0));
      if(qty>free)throw err('Satılabilir miktar '+fmt(free,8)+(free<p.qty?' (kalanı bekleyen satış emirlerinde)':'')+'.','QTY');
      const part=qty===p.qty?p.cost:Math.round(p.cost*qty/p.qty);
      A.realized+=value-f-part;A.closed++;if(value-f-part>0)A.wins++;
      A.cash+=value-f;p.qty=rq(mkt,p.qty-qty);p.cost-=part;p.last=price;p.lastAt=t;
      if(p.qty<=0)delete S.pos[sym];
      S.trades.push({id:nid('t'),at:t,sym,market:mkt,side,type,qty,price,value,fee:f,pnl:value-f-part,order:orderId});
    }
    A.fees+=f;A.n++;
    if(orderId)S.orders=S.orders.filter(o=>o.id!==orderId);
    if(S.trades.length>LIM.maxTrades)S.trades=S.trades.slice(-LIM.maxTrades);
    return S.trades[S.trades.length-1];
  }

  // req: {symbol (Yahoo kodu, ör. THYAO.IS / AAPL / BTC-USD), market, side, type, qty, price?}; quote: {price, currency, time, name}
  function place(req,quote){
    const r=req||{},mkt=r.market,sym=String(r.symbol||'').toUpperCase(),side=r.side,type=r.type||'market';
    if(!MARKETS[mkt])throw err('Geçersiz hesap.');
    if(!SYM.test(sym))throw err('Geçerli bir sembol yaz.');
    if(mkt==='CRYPTO'&&!/^[A-Z0-9]{2,15}-USD$/.test(sym))throw err('Kripto hesabında yalnız USD çiftleri işlem görür (ör. BTC-USD).');
    if(mkt==='US'&&/-USD$/.test(sym))throw err('Kripto paralar için Kripto hesabını kullan.');
    if(mkt==='US'&&/\.IS$/.test(sym))throw err('BIST hisseleri için BIST hesabını kullan.');
    if(!['buy','sell'].includes(side))throw err('Geçersiz yön.');
    if(!['market','limit','stop'].includes(type))throw err('Geçersiz emir türü.');
    if(type==='stop'&&side==='buy')throw err('Zarar durdur yalnızca satış emri olabilir.');
    const qty=normQty(mkt,r.qty,sym,side);
    checkQuote(quote,mkt);
    const last=quote.price;
    if(quote.stale)throw err('Eski veriyle emir verilemez.');
    if(S.pos[sym]&&S.pos[sym].market!==mkt)throw err('Sembol başka hesaba ait.');
    if(type==='market'&&last>LIM.maxPrice)throw err('Fiyat işlem sınırını aşıyor.');
    let closing=false;
    if(side==='sell'){const p=S.pos[sym];const free=p&&p.market===mkt?rq(mkt,p.qty-reservedQty(sym)):0;
      if(qty>free)throw err(free>0?'Satılabilir miktar '+fmt(free,8)+'.':'Bu '+what(mkt)+'de satılabilir pozisyon yok (açığa satış kapalı).','QTY');
      closing=qty===free}
    // Kesirli hesaplarda en kucuk islem tutari (pozisyonun tamamini kapatan satis haric)
    const minV=qdec(mkt)>0||!Number.isInteger(qty)?QTY[mkt].minValue||0:0,ref=type==='market'?last:isPos(r.price)?r.price:last;
    if(minV&&!closing&&cents(ref*qty)<minV)throw err('En küçük işlem tutarı '+money(minV,mkt)+'; miktarı artır.','QTY');
    return commit(()=>{
      if(S.pos[sym]){S.pos[sym].last=last;S.pos[sym].lastAt=Number.isFinite(quote.time)?Math.min(quote.time,now()):now()}
      log(mkt,'order',side,type);
      if(type==='market'){
        const why=canTrade(mkt);if(why)throw err(why,'CLOSED');
        const trade=fill({sym,mkt,side,qty,price:slip(last,side,mkt),type,name:quote.name});snap(mkt);return {trade};
      }
      const lp=r.price;
      if(!isPos(lp)||lp>LIM.maxPrice)throw err('Geçerli bir fiyat yaz.');
      const level=prc(mkt,lp);
      if(level<=0||!Number.isSafeInteger(cents(level*qty)+fee(cents(level*qty))))throw err('Emir tutarı güvenli işlem sınırını aşıyor.');
      if(type==='stop'&&level>=last)throw err('Zarar durdur fiyatı güncel fiyatın ('+fmt(last,10)+') altında olmalı.');
      // Hemen gerceklesebilir limit emir (al: limit >= fiyat, sat: limit <= fiyat) seans aciksa guncel fiyattan dolar.
      const marketable=type==='limit'&&(side==='buy'?level>=last:level<=last);
      if(marketable&&!canTrade(mkt)){const trade=fill({sym,mkt,side,qty,price:last,type,name:quote.name});snap(mkt);return {trade}}
      if(S.orders.length>=LIM.maxOrders)throw err('En fazla '+LIM.maxOrders+' bekleyen emir olabilir.');
      let reserve=0;
      if(side==='buy'){const v=cents(level*qty);reserve=v+fee(v);
        if(reserve>S.acc[mkt].cash-reserved(mkt))throw err('Yetersiz bakiye: emir için '+money(reserve,mkt)+' ayrılmalı, kullanılabilir '+money(S.acc[mkt].cash-reserved(mkt),mkt)+'.','CASH')}
      const o={id:nid('o'),at:now(),sym,market:mkt,side,type,qty,price:level,reserve,name:quote.name||null};
      S.orders.push(o);
      return {order:{...o}};
    });
  }
  function cancel(id){
    const o=S.orders.find(o=>o.id===id);
    if(!o)throw err('Emir bulunamadı (dolmuş ya da iptal edilmiş olabilir).');
    commit(()=>{S.orders=S.orders.filter(x=>x.id!==id);log(o.market,'cancel',o.side,o.type)});
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
          if(o.type==='stop'&&b.l<=o.price){price=slip(Math.min(b.o,o.price),'sell',o.market);at=b.t;break}}
        // Mum yoksa: emirden sonraki bir fiyat (quote.time) seans icinde seviyeyi gectiyse
        if(price==null&&qOk&&Number.isFinite(quote.time)&&quote.time>=o.at&&quote.time<=now()&&(S.set.anyTime||marketSession(o.market,new Date(quote.time)).open)){const q=quote.price;at=quote.time;
          if(o.type==='limit'&&o.side==='buy'&&q<=o.price)price=q;
          else if(o.type==='limit'&&o.side==='sell'&&q>=o.price)price=q;
          else if(o.type==='stop'&&q<=o.price)price=slip(q,'sell',o.market)}
        if(price==null)continue;
        try{out.push(fill({sym,mkt:o.market,side:o.side,qty:o.qty,price:prc(o.market,price),type:o.type,orderId:o.id,name:o.name,at}))}
        catch(e){S.orders=S.orders.filter(x=>x.id!==o.id);failed.push({order:o,msg:e.message})}
      }
      const p=S.pos[sym],qt=quote&&Number.isFinite(quote.time)?Math.min(quote.time,now()):now();if(p&&qOk&&qt>=(p.lastAt||0)){p.last=quote.price;p.lastAt=qt;if(quote.name)p.name=quote.name}
      if(mk)snap(mk);
    });
    return {fills:out,failed};
  }
  function reset(mkt,start){
    if(!MARKETS[mkt])throw err('Geçersiz hesap.');
    const st=start==null?S.acc[mkt].start/100:start;
    if(!isPos(st)||st<LIM.minStart||st>LIM.maxStart)throw err('Başlangıç bakiyesi '+LIM.minStart.toLocaleString('tr-TR')+' ile '+LIM.maxStart.toLocaleString('tr-TR')+' '+MARKETS[mkt].ccy+' arasında olmalı.');
    commit(()=>{S.acc[mkt]=blankAcc(st);
      for(const k in S.pos)if(S.pos[k].market===mkt)delete S.pos[k];
      S.orders=S.orders.filter(o=>o.market!==mkt);S.trades=S.trades.filter(t=>t.market!==mkt);S.eq[mkt]=[]});
  }
  function settings(o){o=o||{};
    const c=o.commission,sl=o.slippage;
    if(c!==undefined&&!(Number.isFinite(c)&&c>=0&&c<=LIM.maxCommission))throw err('Komisyon %0 ile %1 arasında olmalı.');
    if(sl!==undefined&&!(Number.isFinite(sl)&&sl>=0&&sl<=LIM.maxSlippage))throw err('Kayma 0 ile '+LIM.maxSlippage+' baz puan arasında olmalı.');
    commit(()=>{if(c!==undefined)S.set.commission=c;if(sl!==undefined)S.set.slippage=sl;if(typeof o.anyTime==='boolean')S.set.anyTime=o.anyTime;if(typeof o.usFrac==='boolean')S.set.usFrac=o.usFrac;
      for(const order of S.orders)if(order.side==='buy'){const v=cents(order.price*order.qty);order.reserve=v+fee(v)}
      for(const mkt in MARKETS)if(reserved(mkt)>S.acc[mkt].cash)throw err('Yeni komisyon bekleyen emirler için bakiyeyi aşıyor; önce emir iptal et.');
    });
  }
  // Performans: son islemler (en fazla 500, uc hesap ortak) ve gunluk sermaye egrisinden
  function statsOf(mkt,curve){
    const tr=S.trades.filter(t=>t.market===mkt),sells=tr.filter(t=>Number.isSafeInteger(t.pnl)),wins=sells.filter(t=>t.pnl>0),losses=sells.filter(t=>t.pnl<0);
    const sum=a=>a.reduce((v,t)=>v+t.pnl,0),avg=a=>a.length?sum(a)/a.length/100:null;
    let peak=-Infinity,dd=0,ddAmt=0;for(const p of curve){if(p.v>peak)peak=p.v;if(peak>0){const x=(peak-p.v)/peak;if(x>dd){dd=x;ddAmt=peak-p.v}}}
    return {trades:tr.length,buys:tr.length-sells.length,sells:sells.length,wins:wins.length,losses:losses.length,
      winRate:sells.length?Math.round(wins.length/sells.length*100):null,avgWin:avg(wins),avgLoss:avg(losses),
      best:sells.length?Math.max(...sells.map(t=>t.pnl))/100:null,worst:sells.length?Math.min(...sells.map(t=>t.pnl))/100:null,
      profitFactor:losses.length?+(sum(wins)/Math.abs(sum(losses))).toFixed(2):null,
      maxDD:+(dd*100).toFixed(2),maxDDAmt:+ddAmt.toFixed(2)};
  }
  // Arayuz icin ozet (tutarlar para birimi cinsinden).
  function summary(){
    const t=now(),today=isoDay(t),accounts={};
    for(const k in MARKETS){const A=S.acc[k],res=reserved(k);let val=0,unr=0,stale=0;
      const pos=Object.entries(S.pos).filter(([,p])=>p.market===k).map(([sym,p])=>{
        const last=p.last,v=last!=null?cents(last*p.qty):p.cost;val+=v;const u=last!=null?v-p.cost:0;unr+=u;if(last==null)stale++;
        return {sym,name:p.name,qty:p.qty,free:rq(k,p.qty-reservedQty(sym)),avg:prc(k,p.cost/100/p.qty),last,lastAt:p.lastAt,value:v/100,cost:p.cost/100,pnl:u/100,pnlPct:p.cost?+(u/p.cost*100).toFixed(2):0}}).sort((a,b)=>b.value-a.value);
      const eq=A.cash+val;
      for(const p of pos)p.weight=eq>0?+(p.value*100/eq*100).toFixed(2):0;
      // Sermaye egrisi: baslangic + gunluk noktalar; bugunun noktasi anlik deger
      const pts=S.eq[k].filter(x=>x[0]<today).map(x=>({t:dayMs(x[0]),d:x[0],v:x[1]/100}));
      const curve=[];if(A.since&&(!pts.length||pts[0].t>A.since))curve.push({t:Math.min(A.since,dayMs(today)),d:isoDay(A.since),v:A.start/100});
      curve.push(...pts,{t:Math.max(dayMs(today),A.since||0),d:today,v:eq/100});
      const prevPt=pts.length?pts[pts.length-1]:null,base=prevPt&&A.since&&isoDay(A.since)<today?Math.round(prevPt.v*100):A.start;
      accounts[k]={ccy:MARKETS[k].ccy,name:MARKETS[k].name,cash:A.cash/100,reserved:res/100,available:(A.cash-res)/100,positions:val/100,equity:eq/100,start:A.start/100,
        pnl:(eq-A.start)/100,pnlPct:+((eq-A.start)/A.start*100).toFixed(2),unrealized:unr/100,realized:A.realized/100,fees:A.fees/100,
        dayPnl:(eq-base)/100,dayPct:base>0?+((eq-base)/base*100).toFixed(2):0,
        closed:A.closed,wins:A.wins,fills:A.n,winRate:A.closed?Math.round(A.wins/A.closed*100):null,since:A.since,pos,priceMissing:stale,
        qtyDec:qdec(k),minValue:(QTY[k].minValue||0)/100,curve,stats:statsOf(k,curve),
        session:marketSession(k,new Date(t))}}
    // Islem gecmisi: her hesaptan en yeni 150 islem
    const trades=Object.keys(MARKETS).flatMap(k=>S.trades.filter(x=>x.market===k).slice(-150)).sort((a,b)=>b.at-a.at)
      .map(x=>({...x,value:x.value/100,fee:x.fee/100,pnl:x.pnl==null?null:x.pnl/100}));
    return {accounts,orders:S.orders.map(o=>({...o,reserve:o.reserve/100})).sort((a,b)=>b.at-a.at),trades,
      set:{...S.set},limits:{...LIM,qty:Object.fromEntries(Object.keys(MARKETS).map(k=>[k,qdec(k)]))}};
  }
  // Borsa Okulu pratik gorevleri icin kisa gecmis (emir/iptal kayitlari, dolumlar, pozisyon sayilari). Fiyat ve tutar yok.
  function history(){
    const positions={};for(const k in MARKETS)positions[k]=Object.values(S.pos).filter(p=>p.market===k).length;
    return {events:S.log.map(x=>({...x})),trades:S.trades.map(t=>({at:t.at,m:t.market,side:t.side,type:t.type,pnl:t.pnl==null?null:t.pnl/100})),positions,
      since:Object.fromEntries(Object.keys(MARKETS).map(k=>[k,S.acc[k].since]))};
  }
  // Fiyat tahmini (emir onizlemesi): tutar + komisyon
  function estimate(side,qty,price,mkt='BIST'){if(!isPos(price)||!isPos(qty))return null;
    const p=slip(price,side,mkt),v=cents(p*qty),f=fee(v);return {price:p,value:v/100,fee:f/100,total:(side==='buy'?v+f:v-f)/100}}
  function maxBuy(mkt,price){if(!MARKETS[mkt]||!isPos(price))return 0;const p=slip(price,'buy',mkt),avail=S.acc[mkt].cash-reserved(mkt),dec=qdec(mkt),f=10**dec;
    const cost=q=>cents(p*q)+fee(cents(p*q));
    let q=Math.floor(avail/(p*100*(1+S.set.commission))*f)/f;q=Math.max(0,Math.min(q,LIM.maxQty));
    for(let i=0;q>0&&cost(q)>avail&&i<1000;i++)q=roundQ(q-1/f,dec);return Math.max(0,q)}
  const symbols=()=>[...new Set([...Object.keys(S.pos),...S.orders.map(o=>o.sym)])];
  const marketOf=sym=>(S.pos[sym]&&S.pos[sym].market)||((S.orders.find(o=>o.sym===sym)||{}).market)||null;
  return {place,cancel,process,reset,settings,summary,history,estimate,maxBuy,symbols,marketOf,hasOrders:()=>S.orders.length>0,raw:()=>JSON.parse(JSON.stringify(S))};
}

module.exports={create,sanitize,session,usStatus,isoDay,MARKETS,QTY,LIM,DEF_SET};
