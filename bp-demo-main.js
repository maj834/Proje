// Borsa Pro demo IPC denetleyicisi. Broker/API emri yok; yalniz yerel sahte hesap.
'use strict';
function create({lib,app,path,market,calendar,now,active,isOn,timers,send,Notification,open,timeout}){
  let D=null,queue=Promise.resolve(),timer=null,epoch=0;
  const engine=()=>{if(!lib)throw new Error('Demo motoru kullanılamıyor.');return D||(D=lib.create({file:path.join(app.getPath('userData'),'bp-demo.json'),now,calendar}))};
  const guard=e=>{if(e!==epoch||!isOn())throw new Error('Demo işlemi durduruldu.');};
  const enqueue=fn=>{const e=epoch,p=queue.then(()=>{guard(e);return fn(e)});queue=p.catch(()=>{});return p};
  function announce(r){if(!r.fills.length&&!r.failed.length)return;
    send({type:'demo',...r,summary:engine().summary()});
    for(const t of r.fills)try{if(Notification&&Notification.isSupported()){
      const n=new Notification({title:'Borsa Pro · Demo',body:'DEMO: '+t.sym.replace(/\.IS$/,'')+' '+t.qty+' adet '+(t.side==='buy'?'alındı':'satıldı')+' · '+t.price.toLocaleString('tr-TR')});
      n.on('click',()=>open());n.show();}}catch(_){}
  }
  function schedule(force=false){
    if(timer!=null&&force){timers.clearTimeout(timer);timer=null}
    if(!lib||!active()||!D||!D.hasOrders()){if(timer!=null)timers.clearTimeout(timer);timer=null;return}
    if(timer!=null)return;
    const a=D.summary().accounts,closed=!a.BIST.session.open&&!a.US.session.open;
    timer=timers.setTimeout(()=>{timer=null;if(!active())return;enqueue(e=>refresh(e)).catch(()=>{}).finally(schedule)},closed?900000:(active('battery')?180000:60000));
    if(timer&&timer.unref)timer.unref();
  }
  async function fetch(sym,mkt,e){
    const r=await timeout(market.candles(sym,'1dk',mkt),15000);guard(e);
    const q=r&&r.quote;
    if(!q||r.stale||q.stale||!Number.isFinite(q.price)||q.price<=0)throw new Error('Güncel fiyat alınamadı; eski veriyle emir işlenmedi.');
    if(q.currency!==lib.MARKETS[mkt].ccy)throw new Error('Sembolün para birimi bu demo hesabıyla eşleşmiyor.');
    let bars=Array.isArray(r.rows)?r.rows:[];
    const pending=engine().raw().orders.filter(o=>o.sym===sym),first=bars.length?Math.min(...bars.map(b=>b.t)):now();
    // Gunluk mumun baslangici emirden sonra olmali. Bugunun gunluk mumu kullanilmaz:
    // gun ici emirden ONCE gorulmus bir yuksek/dusuk yanlis dolum yaratmamali.
    if(pending.some(o=>o.at<first-86400000)){
      const d=await timeout(market.candles(sym,'1g',mkt),15000);guard(e);
      const day=t=>new Date(t).toISOString().slice(0,10),cut=day(Math.min(first,now()));
      if(d&&!d.stale&&!(d.quote&&d.quote.stale)&&Array.isArray(d.rows))bars=[...d.rows.filter(b=>Number.isFinite(b.t)&&day(b.t)<cut),...bars];
    }
    return {quote:{...q,stale:false},bars};
  }
  async function update(sym,mkt,e){const r=await fetch(sym,mkt,e);guard(e);return {...r,...engine().process(sym,r.bars,r.quote)}}
  async function refresh(e){const d=engine(),symbols=d.symbols(),out={fills:[],failed:[],errors:[]};let i=0;
    await Promise.all(Array.from({length:Math.min(3,symbols.length)},async()=>{while(i<symbols.length){const sym=symbols[i++];try{const r=await update(sym,d.marketOf(sym),e);out.fills.push(...r.fills);out.failed.push(...r.failed)}catch(x){out.errors.push({symbol:sym,error:x.message})}}}));
    guard(e);announce(out);return {ok:true,...out,summary:d.summary()};
  }
  async function run(o,e){o=o&&typeof o==='object'?o:{};const d=engine(),op=o.op||'state';
    if(op==='state')return {ok:true,summary:d.summary()};
    if(op==='refresh')return refresh(e);
    if(op==='cancel'){d.cancel(o.id);return {ok:true,summary:d.summary()}}
    if(op==='reset'){d.reset(o.market,o.start);return {ok:true,summary:d.summary()}}
    if(op==='settings'){const set={};if(o.commissionPct!==undefined){if(typeof o.commissionPct!=='number'||!Number.isFinite(o.commissionPct))throw new Error('Geçerli komisyon yüzdesi yaz.');set.commission=o.commissionPct/100;}if(o.slippageBp!==undefined)set.slippage=o.slippageBp;if(o.anyTime!==undefined){if(typeof o.anyTime!=='boolean')throw new Error('Geçersiz seans ayarı.');set.anyTime=o.anyTime;}d.settings(set);return {ok:true,summary:d.summary()}}
    if(op!=='quote'&&op!=='order')throw new Error('Geçersiz demo işlemi.');
    if(!lib.MARKETS[o.market])throw new Error('Geçersiz borsa.');
    const sym=market.yahooSymbol(o.symbol,o.market);if(!sym||!/^[A-Z0-9.=^-]{1,20}$/.test(sym))throw new Error('Geçerli hisse kodu yaz.');
    const r=await update(sym,o.market,e);announce(r);guard(e);
    let placed={};if(op==='order'){
      // Yahoo/BIST fiyatlari yaklasik 15 dk gecikmeli olabilir. Daha eski fiyatla
      // acik seansta ya da seans disi zorlanmis piyasa islemi yapilmaz.
      const q=r.quote,session=d.summary().accounts[o.market].session;
      if(!Number.isFinite(q.time)||q.time>now()+60000||((session.open||d.summary().set.anyTime)&&now()-q.time>25*60000))throw new Error('Fiyat zamanı güncel değil; yenileyip tekrar dene.');
      placed=d.place({...o,symbol:sym},q);announce({fills:placed.trade?[placed.trade]:[],failed:[]});
    }
    return {ok:true,...placed,quote:{...r.quote,symbol:sym},maxBuy:d.maxBuy(o.market,r.quote.price),summary:d.summary()};
  }
  return {op:o=>enqueue(e=>run(o,e)).finally(schedule),
    enable(){if(lib)try{engine();schedule(true)}catch(_){}},
    disable(){epoch++;if(timer!=null)timers.clearTimeout(timer);timer=null},
    schedule};
}
module.exports={create};
