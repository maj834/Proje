// Borsa Pro grafik bileseni: lightweight-charts v5 (TradingView, Apache-2.0) + engine.js gostergeleri.
// Tarayicida window.BPChart, Node'da module.exports (yalniz saf yardimcilar _util calisir; testler icin).
// Zaman: kutuphane UTC gosterir; Istanbul saati (yaz saati yok) icin her zaman damgasina +3 saat eklenir.
(function(root){
'use strict';
const TZ=3*3600;
const fin=v=>typeof v==='number'&&Number.isFinite(v);
const toTime=ms=>Math.floor(ms/1000)+TZ;
const INTRA=['1dk','5dk','15dk','1s'];
const isIntraday=tf=>INTRA.includes(tf);
const MON=['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
// Ondalik: fiyat buyuklugune gore (BIST adim araligi 0,01; kucuk fiyatlarda daha fazla)
const decimals=p=>{p=Math.abs(p);return p>=1000?2:p>=1?2:p>=0.1?3:4};
const fmtNum=(v,d)=>fin(v)?v.toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const fmtPrice=v=>fin(v)?fmtNum(v,decimals(v)):'—';
function fmtVol(v){if(!fin(v))return '—';const a=Math.abs(v);
  return a>=1e9?fmtNum(v/1e9,2)+' Mr':a>=1e6?fmtNum(v/1e6,2)+' Mn':a>=1e3?fmtNum(v/1e3,1)+' B':fmtNum(v,0)}
const pad=n=>String(n).padStart(2,'0');
// Kaydirilmis saniye -> "19 Eki 2026 14:35" (gun ici) / "19 Eki 2026"
function fmtTime(sec,intraday){const d=new Date(sec*1000);
  const s=d.getUTCDate()+' '+MON[d.getUTCMonth()]+' '+d.getUTCFullYear();return intraday?s+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes()):s}
// Eksen etiketi: tickMarkType 0 yil, 1 ay, 2 gun, 3 saat, 4 saniyeli saat
function fmtTick(sec,type){const d=new Date(sec*1000);
  return type===0?String(d.getUTCFullYear()):type===1?MON[d.getUTCMonth()]:type===2?d.getUTCDate()+' '+MON[d.getUTCMonth()]:pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())}

// Gecerli, siralanmis, zamani tekrarsiz mumlar (kutuphane kesin artan zaman ister)
function cleanRows(rows){
  const out=[];let last=-Infinity;
  for(const r of (Array.isArray(rows)?rows:[]).filter(r=>r&&fin(r.t)&&[r.o,r.h,r.l,r.c].every(fin)).sort((a,b)=>a.t-b.t)){
    const t=toTime(r.t);if(t===last){out[out.length-1]={...r,time:t};continue}last=t;out.push({...r,time:t})}
  return out}

// Gostergeler (engine.js). Isinma degerleri null.
function indicators(rows,E){
  const c=rows.map(r=>r.c),o={};if(!E||!rows.length)return o;
  o.ema20=E.emaS(c,20);o.ema50=E.emaS(c,50);o.ema200=E.emaS(c,200);
  const bb=E.bollinger(c,20,2);o.bbU=bb.up;o.bbM=bb.mid;o.bbL=bb.lo;
  o.vwap=E.vwapS(rows);o.rsi=E.rsi(c,14);const m=E.macdS(c);o.macd=m.macd;o.sig=m.signal;o.hist=m.hist;
  return o}
const series=(rows,arr)=>{const out=[];for(let i=0;i<rows.length;i++)if(arr&&fin(arr[i]))out.push({time:rows[i].time,value:arr[i]});return out};

// Analizin (pro) indeksleri, analiz edilen mumlara gore: grafik mumlari ayni son muma bitiyorsa kaydirma = fark.
// Son mum farkliysa (eski analiz) indeks isaretleri cizilmez (null).
function proOffset(rows,pro){
  if(!pro||!pro.ok||!fin(pro.n)||!rows.length)return null;
  const last=rows[rows.length-1];if(fin(pro.time)&&last.t!==pro.time)return null;
  return rows.length-pro.n}

// Destek/direnc bolgeleri: [{lo,hi,kind:'R'|'S',label}]
function zones(pro){
  if(!pro||!pro.ok||!pro.levels)return [];
  const L=pro.levels,z=[],lab=(k,i,q)=>k+(i+1)+' '+fmtPrice(q.lo)+(Math.abs(q.hi-q.lo)/q.hi>0.0005?'–'+fmtPrice(q.hi):'')+(q.touches?' · '+q.touches+' temas':'')+(q.poc?' · POC':'');
  (L.resistance||[]).forEach((q,i)=>{if(fin(q.lo)&&fin(q.hi))z.push({lo:Math.min(q.lo,q.hi),hi:Math.max(q.lo,q.hi),kind:'R',label:lab('R',i,q),strength:q.strength||0})});
  (L.support||[]).forEach((q,i)=>{if(fin(q.lo)&&fin(q.hi))z.push({lo:Math.min(q.lo,q.hi),hi:Math.max(q.lo,q.hi),kind:'S',label:lab('S',i,q),strength:q.strength||0})});
  return z}

// Islem plani cizgileri: [{price,kind,title}] kind: entry|stop|t1|t2|up|down|neck|target
function planLines(pro){
  const out=[];if(!pro||!pro.ok)return out;const p=pro.plan;
  if(p&&!p.wait){
    if(Array.isArray(p.entry)&&p.entry.every(fin))out.push({price:p.entry[0],kind:'entry',title:'Giriş'},{price:p.entry[1],kind:'entry',title:'Giriş'});
    if(fin(p.stop))out.push({price:p.stop,kind:'stop',title:'Stop'});
    if(fin(p.t1))out.push({price:p.t1,kind:'t1',title:'Hedef 1'});
    if(fin(p.t2))out.push({price:p.t2,kind:'t2',title:'Hedef 2'});
  }else if(p&&p.wait){
    if(fin(p.triggerUp))out.push({price:p.triggerUp,kind:'up',title:'AL tetik'});
    if(fin(p.triggerDown))out.push({price:p.triggerDown,kind:'down',title:'SAT tetik'});
  }
  for(const f of (pro.structure&&pro.structure.patterns)||[]){
    if(fin(f.neck))out.push({price:f.neck,kind:'neck',title:f.name+' boyun'});
    if(fin(f.trigger))out.push({price:f.trigger,kind:'neck',title:f.name+' tetik'});
    if(fin(f.target)&&f.confirmed)out.push({price:f.target,kind:'target',title:f.name+' hedef'});
  }
  return out}

// Trend cizgileri (pro.trend.trendlines): mum indeksinden zamana
function trendSegs(pro,rows){
  const off=proOffset(rows,pro);if(off==null)return [];
  return ((pro.trend&&pro.trend.trendlines)||[]).map(t=>{const a=rows[t.i1+off],b=rows[t.i2+off];
    if(!a||!b||a.time>=b.time||!fin(t.p1)||!fin(t.p2))return null;
    return {type:t.type,broken:!!t.broken,pts:[{time:a.time,value:t.p1},{time:b.time,value:t.p2}],channel:fin(t.channel)?t.channel:null}}).filter(Boolean)}

// Isaretler: sistem AL/SAT, kirilimlar, strateji islemleri. Zamana gore sirali.
function markers({rows,signals,pro,trades,show},col){
  const m=[],byT=new Map(rows.map(r=>[r.time,r])),at=t=>{const s=toTime(t);return byT.has(s)?s:null};
  col=col||{up:'#26a69a',dn:'#ef5350',acc:'#e6ad48',muted:'#888'};show=show||{};
  if(show.signals!==false)for(const s of signals||[]){if(!s||!fin(s.t))continue;const time=at(s.t);if(time==null)continue;
    m.push(s.dir>0?{time,position:'belowBar',shape:'arrowUp',color:col.up,text:'AL',id:'s'+time}:{time,position:'aboveBar',shape:'arrowDown',color:col.dn,text:'SAT',id:'s'+time})}
  const off=proOffset(rows,pro);
  if(show.patterns!==false&&off!=null)for(const b of (pro.structure&&pro.structure.breakouts)||[]){const r=rows[b.i+off];if(!r)continue;
    m.push({time:r.time,position:b.dir>0?'belowBar':'aboveBar',shape:'circle',color:b.dir>0?col.up:col.dn,text:b.dir>0?'Kırılım':'Kırılım ↓',id:'b'+r.time})}
  if(show.trades&&Array.isArray(trades))for(const x of trades){if(!x)continue;
    const t0=fin(x.t0)?at(x.t0):null,t1=fin(x.t1)?at(x.t1):null,long=x.dir!==-1;
    if(t0!=null)m.push({time:t0,position:long?'belowBar':'aboveBar',shape:long?'arrowUp':'arrowDown',color:col.acc,text:long?'Al':'Aç',id:'e'+t0});
    if(t1!=null&&x.exit!=='son')m.push({time:t1,position:long?'aboveBar':'belowBar',shape:'square',color:fin(x.ret)&&x.ret>=0?col.up:col.dn,
      text:fin(x.ret)?(x.ret>=0?'+':'')+fmtNum(x.ret,1)+'%':'Çık',id:'x'+t1})}
  // Ayni zamanda birden cok isaret: kutuphane hepsini ciziyor, ama sira zorunlu
  return m.sort((a,b)=>a.time-b.time)}

// Gorunur alanin sag kenarina hacim profili (son n mum)
function profileBins(rows,E,n=120){if(!E||!E.volumeProfile||rows.length<10)return null;return E.volumeProfile(rows.slice(-n),28)}

const DEF_SHOW={ema:true,ema200:true,bb:false,vwap:'auto',volume:true,rsi:true,macd:true,levels:true,plan:true,signals:true,patterns:true,trades:false,profile:false,trendlines:true};
const PAL={
  dark:{bg:'#181b1f',text:'#a2a8b1',muted:'#6e757f',grid:'rgba(160,170,185,0.07)',border:'#2a2f36',up:'#3dbd7d',dn:'#ef6a5b',upV:'rgba(61,189,125,0.38)',dnV:'rgba(239,106,91,0.38)',
    acc:'#e6ad48',ema20:'#e6ad48',ema50:'#5b8def',ema200:'#b07cf0',bb:'rgba(150,165,190,0.55)',bbF:'rgba(150,165,190,0.06)',vwap:'#f0894b',rsi:'#a48cf2',macd:'#5b8def',sig:'#e6ad48',
    zoneR:[239,106,91],zoneS:[61,189,125],entry:[230,173,72],wm:'rgba(200,210,225,0.05)',cross:'#59606b',legendBg:'rgba(20,23,27,0.72)'},
  light:{bg:'#fcfcfd',text:'#545b65',muted:'#8a909a',grid:'rgba(60,70,90,0.07)',border:'#dde1e6',up:'#1e8a52',dn:'#d0413a',upV:'rgba(30,138,82,0.32)',dnV:'rgba(208,65,58,0.32)',
    acc:'#c4870f',ema20:'#c4870f',ema50:'#2f6fe0',ema200:'#8a4fd8',bb:'rgba(90,105,130,0.55)',bbF:'rgba(90,105,130,0.06)',vwap:'#d9692a',rsi:'#7a5fe0',macd:'#2f6fe0',sig:'#c4870f',
    zoneR:[208,65,58],zoneS:[30,138,82],entry:[196,135,15],wm:'rgba(40,50,70,0.05)',cross:'#9aa1ab',legendBg:'rgba(252,252,253,0.8)'}};
const rgba=(c,a)=>'rgba('+c[0]+','+c[1]+','+c[2]+','+a+')';

const _util={TZ,toTime,isIntraday,decimals,fmtPrice,fmtVol,fmtTime,fmtTick,cleanRows,indicators,series,proOffset,zones,planLines,trendSegs,markers,DEF_SHOW,PAL};

// --- tarayici bileseni ---------------------------------------------------------------------
// Bant (bolge) cizici: aday serinin fiyat olcegiyle tam genislikte yari saydam dikdortgen + sol ust etiket
class Bands{
  constructor(){this.items=[];this.p=null;this.right=0;this._views=[{zOrder:()=>'bottom',renderer:()=>({draw:()=>{},drawBackground:t=>this.draw(t)})}]}
  attached(p){this.p=p}
  detached(){this.p=null}
  set(items){this.items=items||[];if(this.p)this.p.requestUpdate()}
  updateAllViews(){}
  paneViews(){return this._views}
  draw(target){
    const p=this.p;if(!p||!this.items.length)return;const s=p.series;
    target.useMediaCoordinateSpace(({context:ctx,mediaSize})=>{
      const W=mediaSize.width;ctx.save();ctx.font='500 10.5px "Plex Mono", ui-monospace, Menlo, monospace';ctx.textBaseline='top';
      for(const z of this.items){const y1=s.priceToCoordinate(z.hi),y2=s.priceToCoordinate(z.lo);if(y1==null||y2==null)continue;
        let a=Math.min(y1,y2),b=Math.max(y1,y2);if(b-a<2){const m=(a+b)/2;a=m-1;b=m+1}
        if(b<-20||a>mediaSize.height+20)continue;
        const x0=z.x0!=null?Math.max(0,z.x0):0,x1=z.x1!=null?Math.min(W,z.x1):W;if(x1<=x0)continue;
        ctx.fillStyle=z.fill;ctx.fillRect(x0,a,x1-x0,b-a);
        if(z.edge){ctx.fillStyle=z.edge;ctx.fillRect(x0,a,x1-x0,1);ctx.fillRect(x0,b-1,x1-x0,1)}
        // Etiket sagda (sol ust lejantla cakismasin), hacim profili alaninin solunda; bant inceyse ustune tasar
        if(z.label){const tw=ctx.measureText(z.label).width,lx=Math.max(x0+6,W*(1-this.right)-tw-14),ly=b-a>=17?a+2:a-16;
          ctx.fillStyle=z.labelBg||'rgba(0,0,0,0)';ctx.fillRect(lx-4,ly,tw+8,15);ctx.fillStyle=z.text;ctx.fillText(z.label,lx,ly+2)}}
      ctx.restore()})}
}
// Hacim profili: sag kenarda yatay cubuklar (POC vurgulu)
class Profile{
  constructor(){this.prof=null;this.p=null;this.col=null;this._views=[{zOrder:()=>'bottom',renderer:()=>({draw:()=>{},drawBackground:t=>this.draw(t)})}]}
  attached(p){this.p=p}detached(){this.p=null}
  set(prof,col){this.prof=prof;this.col=col;if(this.p)this.p.requestUpdate()}
  updateAllViews(){}paneViews(){return this._views}
  draw(target){const p=this.p,pr=this.prof;if(!p||!pr||!pr.bins)return;const s=p.series,mx=Math.max(...pr.bins.map(b=>b.v))||1,w=(pr.hi-pr.lo)/pr.bins.length;
    target.useMediaCoordinateSpace(({context:ctx,mediaSize})=>{const W=mediaSize.width,maxW=W*0.12;ctx.save();
      for(const b of pr.bins){const y1=s.priceToCoordinate(b.p+w/2),y2=s.priceToCoordinate(b.p-w/2);if(y1==null||y2==null)continue;
        const h=Math.max(1,Math.abs(y2-y1)-1),len=b.v/mx*maxW,isPoc=Math.abs(b.p-pr.poc)<w/2,inVA=b.p>=pr.val&&b.p<=pr.vah;
        ctx.fillStyle=isPoc?rgba(this.col.entry,0.55):inVA?rgba(this.col.zoneS.map((v,i)=>Math.round((v+this.col.zoneR[i])/2)),0.22):rgba([128,136,150],0.16);
        ctx.fillRect(W-len,Math.min(y1,y2),len,h)}
      ctx.restore()})}
}

function create(el,opts={}){
  const LW=root.LightweightCharts,E=root.Engine;
  if(!LW)throw new Error('Grafik kütüphanesi yüklenemedi.');
  let theme=opts.theme==='light'?'light':'dark',C=PAL[theme],show={...DEF_SHOW,...(opts.show||{})};
  let D={rows:[],tf:'1g',pro:null,signals:[],trades:null,alarms:[],positions:[],symbol:''},R=[],I={},key='';
  const S={},PL=[],WMS=[];let markerApi=null,bands=null,prof=null,wm=null,paneWm=[],hoverFn=null,clickFn=null;
  // Kullanici cizimleri: {id,kind:'trend'|'ray'|'hline'|'fib'|'rect',a:{t,p},b:{t,p}} (t: ms, p: fiyat). Kalicilik uygulamada (onDrawings).
  let DR=[],tool=null,pend=null,drawFn=null,toolFn=null,prevS=null;const DS=[],DPL=[];
  if(getComputedStyle(el).position==='static')el.style.position='relative';
  const legend=document.createElement('div');legend.className='bpc-legend';
  legend.style.cssText='position:absolute;left:10px;top:8px;z-index:3;pointer-events:none;font:500 11.5px/1.5 "Plex Mono",ui-monospace,Menlo,monospace;white-space:nowrap;max-width:calc(100% - 90px);overflow:hidden';
  el.appendChild(legend);
  const pf={type:'custom',minMove:0.0001,formatter:fmtPrice};
  const chart=LW.createChart(el,{autoSize:true,
    layout:{background:{type:'solid',color:C.bg},textColor:C.text,fontFamily:'"Plex Sans",-apple-system,sans-serif',fontSize:11,attributionLogo:true,
      panes:{separatorColor:C.border,separatorHoverColor:C.cross,enableResize:true}},
    grid:{vertLines:{color:C.grid},horzLines:{color:C.grid}},
    rightPriceScale:{borderColor:C.border,scaleMargins:{top:0.08,bottom:0.2}},
    timeScale:{borderColor:C.border,rightOffset:8,barSpacing:7,minBarSpacing:1.5,tickMarkFormatter:(t,type)=>fmtTick(t,type)},
    crosshair:{mode:0,vertLine:{color:C.cross,labelBackgroundColor:C.cross},horzLine:{color:C.cross,labelBackgroundColor:C.cross}},
    localization:{locale:'tr-TR',timeFormatter:t=>fmtTime(t,isIntraday(D.tf))},
    handleScale:{axisPressedMouseMove:{time:true,price:true}}});

  const clearAll=()=>{
    if(markerApi){try{markerApi.detach()}catch(e){}markerApi=null}
    for(const k of Object.keys(S)){try{chart.removeSeries(S[k])}catch(e){}delete S[k]}
    // Yazi filigranlari panelde kalir (seri silinince gitmez): yeniden cizimde eski panele/yanlis panele tasinmasin
    for(const w of WMS.splice(0))try{w.detach()}catch(e){}
    for(const x of DS.splice(0))try{chart.removeSeries(x)}catch(e){}if(prevS)try{chart.removeSeries(prevS)}catch(e){}
    PL.length=0;bands=null;prof=null;wm=null;paneWm=[];DPL.length=0;prevS=null};
  const line=(color,width,pane,extra)=>chart.addSeries(LW.LineSeries,{color,lineWidth:width,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,priceFormat:pf,...(extra||{})},pane);

  function build(){
    // Gorunen aralik korunur (ayni sembol ve dilimde gosterge ac/kapa)
    let range=null;try{range=chart.timeScale().getVisibleLogicalRange()}catch(e){}
    clearAll();
    chart.applyOptions({timeScale:{timeVisible:isIntraday(D.tf),secondsVisible:false}});
    if(!R.length){legend.textContent='';return}
    const c=S.candle=chart.addSeries(LW.CandlestickSeries,{upColor:C.up,downColor:C.dn,wickUpColor:C.up,wickDownColor:C.dn,borderVisible:false,priceFormat:pf,
      priceLineColor:C.muted,priceLineStyle:2},0);
    c.setData(R.map(r=>({time:r.time,open:r.o,high:r.h,low:r.l,close:r.c})));
    if(D.symbol&&LW.createTextWatermark)try{wm=LW.createTextWatermark(chart.panes()[0],{horzAlign:'center',vertAlign:'center',
      lines:[{text:D.symbol,color:C.wm,fontSize:72,fontStyle:'600'}]});WMS.push(wm)}catch(e){}
    if(show.volume&&R.some(r=>fin(r.v)&&r.v>0)){S.vol=chart.addSeries(LW.HistogramSeries,{priceScaleId:'vol',priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false},0);
      chart.priceScale('vol',0).applyOptions({scaleMargins:{top:0.82,bottom:0},visible:false});
      S.vol.setData(R.map(r=>({time:r.time,value:fin(r.v)?r.v:0,color:r.c>=r.o?C.upV:C.dnV})))}
    if(show.bb){S.bbU=line(C.bb,1,0);S.bbL=line(C.bb,1,0);S.bbM=line(C.bb,1,0,{lineStyle:2});
      S.bbU.setData(series(R,I.bbU));S.bbL.setData(series(R,I.bbL));S.bbM.setData(series(R,I.bbM))}
    if(show.ema){S.e20=line(C.ema20,1,0);S.e50=line(C.ema50,1,0);S.e20.setData(series(R,I.ema20));S.e50.setData(series(R,I.ema50))}
    if(show.ema&&show.ema200!==false){const d=series(R,I.ema200);if(d.length){S.e200=line(C.ema200,2,0);S.e200.setData(d)}}
    const vw=show.vwap==='auto'?isIntraday(D.tf)&&D.tf!=='1s':!!show.vwap;
    if(vw&&R.some(r=>fin(r.v)&&r.v>0)){S.vwap=line(C.vwap,1,0,{lineStyle:1});S.vwap.setData(series(R,I.vwap))}
    if(show.trendlines!==false)trendSegs(D.pro,R).forEach((t,k)=>{const s=S['tl'+k]=line(t.type==='destek'?C.up:C.dn,2,0,{lineStyle:t.broken?2:0,lastValueVisible:true,
      title:(t.type==='destek'?'Trend desteği':'Trend direnci')+(t.broken?' (kırıldı)':'')});s.setData(t.pts)});
    // Alt paneller
    let pane=1;
    if(show.rsi){const s=S.rsi=line(C.rsi,1,pane,{lastValueVisible:true,priceFormat:{type:'custom',minMove:0.1,formatter:v=>fmtNum(v,1)}});s.setData(series(R,I.rsi));
      for(const [v,a] of [[70,0.5],[50,0.25],[30,0.5]])s.createPriceLine({price:v,color:C.muted,lineWidth:1,lineStyle:2,axisLabelVisible:false,title:''});
      chart.priceScale('right',pane).applyOptions({scaleMargins:{top:0.1,bottom:0.1},autoScale:false});
      try{s.applyOptions({autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})})}catch(e){}
      paneWm.push([pane,'RSI 14']);pane++}
    if(show.macd){const mf={type:'custom',minMove:0.0001,formatter:v=>fmtNum(v,Math.abs(v)>=1||v===0?2:4)};
      const h=S.hist=chart.addSeries(LW.HistogramSeries,{priceLineVisible:false,lastValueVisible:false,priceFormat:mf},pane);
      h.setData(R.map((r,i)=>fin(I.hist[i])?{time:r.time,value:I.hist[i],color:I.hist[i]>=0?(i&&I.hist[i]>=I.hist[i-1]?C.upV.replace(/[\d.]+\)$/,'0.75)'):C.upV):(i&&I.hist[i]<=I.hist[i-1]?C.dnV.replace(/[\d.]+\)$/,'0.75)'):C.dnV)}:{time:r.time}));
      S.macd=line(C.macd,1,pane,{priceFormat:mf});S.sig=line(C.sig,1,pane,{priceFormat:mf});S.macd.setData(series(R,I.macd));S.sig.setData(series(R,I.sig));
      paneWm.push([pane,'MACD 12 26 9']);pane++}
    const panes=chart.panes();if(panes[0])panes[0].setStretchFactor(pane>2?3.2:pane>1?3.6:1);for(let k=1;k<panes.length;k++)panes[k].setStretchFactor(1);
    if(LW.createTextWatermark)for(const [p,t] of paneWm)try{WMS.push(LW.createTextWatermark(panes[p],{horzAlign:'left',vertAlign:'top',lines:[{text:t,color:C.muted,fontSize:10.5}]}))}catch(e){}
    // Seviye bantlari, plan cizgileri, alarmlar, maliyet
    if(show.levels||show.plan){bands=new Bands();c.attachPrimitive(bands);bands.right=show.profile?0.13:0;bands.set(bandItems())}
    if(show.profile&&E){prof=new Profile();c.attachPrimitive(prof);prof.set(profileBins(R,E),C)}
    if(show.plan)for(const l of planLines(D.pro)){
      const sty={entry:[C.acc,2,0],stop:[C.dn,2,2],t1:[C.up,2,2],t2:[C.up,1,2],up:[C.up,1,1],down:[C.dn,1,1],neck:[C.muted,1,3],target:[C.muted,1,3]}[l.kind];
      if(l.kind==='entry')continue;   // giris bant olarak cizilir; eksende tek etiket asagida
      PL.push(c.createPriceLine({price:l.price,color:sty[0],lineWidth:sty[1],lineStyle:sty[2],axisLabelVisible:true,title:l.title}))}
    const pl=D.pro&&D.pro.ok&&D.pro.plan;
    if(show.plan&&pl&&!pl.wait&&Array.isArray(pl.entry))PL.push(c.createPriceLine({price:(pl.entry[0]+pl.entry[1])/2,color:C.acc,lineWidth:1,lineStyle:3,axisLabelVisible:true,title:'Giriş'}));
    for(const a of D.alarms||[])if(a&&fin(a.price))PL.push(c.createPriceLine({price:a.price,color:C.acc,lineWidth:1,lineStyle:1,axisLabelVisible:true,title:a.label||'Alarm'+(a.kind==='above'?' ↑':a.kind==='below'?' ↓':'')}));
    for(const p of D.positions||[])if(p&&fin(p.cost))PL.push(c.createPriceLine({price:p.cost,color:C.muted,lineWidth:1,lineStyle:0,axisLabelVisible:true,title:p.label||'Maliyet'}));
    const mk=markers({rows:R,signals:D.signals,pro:D.pro,trades:D.trades,show},C);
    if(LW.createSeriesMarkers)markerApi=LW.createSeriesMarkers(c,mk);
    if(range&&key===D.symbol+'|'+D.tf)try{chart.timeScale().setVisibleLogicalRange(range)}catch(e){}
    else{key=D.symbol+'|'+D.tf;fit()}
    drawUser();renderLegend(null)}

  function bandItems(){
    const out=[];
    if(show.levels)for(const z of zones(D.pro)){const col=z.kind==='R'?C.zoneR:C.zoneS;
      out.push({lo:z.lo,hi:z.hi,fill:rgba(col,0.09+Math.min(0.08,(z.strength||0)*0.012)),edge:rgba(col,0.35),label:z.label,text:rgba(col,0.95),labelBg:theme==='dark'?'rgba(20,23,27,0.75)':'rgba(252,252,253,0.8)'})}
    const p=D.pro&&D.pro.ok&&D.pro.plan;
    if(show.plan&&p&&!p.wait&&Array.isArray(p.entry)&&p.entry.every(fin))
      out.push({lo:Math.min(...p.entry),hi:Math.max(...p.entry),fill:rgba(C.entry,0.13),edge:rgba(C.entry,0.5),label:null});
    return out}

  // Lejant: imlecteki (yoksa son) mum + gostergeler
  const span=(t,color,bold)=>'<span style="color:'+(color||C.text)+(bold?';font-weight:600':'')+'">'+t+'</span>';
  const esc=s=>String(s).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[ch]);
  function renderLegend(i){
    if(!R.length){legend.innerHTML='';return}
    if(i==null||i<0||i>=R.length)i=R.length-1;
    const r=R[i],pv=i?R[i-1].c:r.o,ch=pv?(r.c-pv)/pv*100:0,cc=r.c>=r.o?C.up:C.dn;
    const head=span(esc(D.symbol||''),theme==='dark'?'#e8ebef':'#1d2228',true)+(D.symbol?'&nbsp;&nbsp;':'')+span(esc(fmtTime(r.time,isIntraday(D.tf))),C.muted);
    const ohlc=['A',r.o,'Y',r.h,'D',r.l,'K',r.c].map((v,k)=>k%2?span(fmtPrice(v),cc):span(v,C.muted)).join(' ')+'&nbsp;&nbsp;'+span((ch>=0?'+':'')+fmtNum(ch,2)+'%',ch>=0?C.up:C.dn)
      +(fin(r.v)&&r.v>0?'&nbsp;&nbsp;'+span('Hcm',C.muted)+' '+span(fmtVol(r.v)):'');
    const ind=[];
    if(show.ema){if(fin(I.ema20&&I.ema20[i]))ind.push(span('EMA20 ',C.muted)+span(fmtPrice(I.ema20[i]),C.ema20));if(fin(I.ema50&&I.ema50[i]))ind.push(span('EMA50 ',C.muted)+span(fmtPrice(I.ema50[i]),C.ema50));
      if(show.ema200!==false&&fin(I.ema200&&I.ema200[i]))ind.push(span('EMA200 ',C.muted)+span(fmtPrice(I.ema200[i]),C.ema200))}
    if(show.bb&&fin(I.bbU&&I.bbU[i]))ind.push(span('BB ',C.muted)+span(fmtPrice(I.bbL[i])+' – '+fmtPrice(I.bbU[i]),C.bb));
    if(S.vwap&&fin(I.vwap&&I.vwap[i]))ind.push(span('VWAP ',C.muted)+span(fmtPrice(I.vwap[i]),C.vwap));
    const sub=[];if(show.rsi&&fin(I.rsi&&I.rsi[i]))sub.push(span('RSI ',C.muted)+span(fmtNum(I.rsi[i],1),C.rsi));
    if(show.macd&&fin(I.hist&&I.hist[i]))sub.push(span('MACD ',C.muted)+span(fmtPrice(I.macd[i]),C.macd)+' '+span(fmtPrice(I.sig[i]),C.sig)+' '+span(fmtPrice(I.hist[i]),I.hist[i]>=0?C.up:C.dn));
    legend.innerHTML='<div style="display:inline-block;padding:2px 6px;border-radius:4px;background:'+C.legendBg+'">'+head+'<br>'+ohlc+(ind.length?'<br>'+ind.join('&nbsp;&nbsp;'):'')+(sub.length?'<br>'+sub.join('&nbsp;&nbsp;'):'')+'</div>'}


  // --- kullanici cizimleri --------------------------------------------------------------------------------------------
  const FIB=[0,0.236,0.382,0.5,0.618,0.786,1];
  // Cizim noktasi (ms) -> bu dilimdeki en yakin mum (zaman olcegine yeni nokta eklenmesin); idx ile dogru uzatma
  function nearest(t){if(!R.length)return -1;let lo=0,hi=R.length-1;const x=t/1000;
    while(lo<hi){const m=(lo+hi)>>1;if(R[m].time<x)lo=m+1;else hi=m}
    return lo>0&&Math.abs(R[lo-1].time-x)<Math.abs(R[lo].time-x)?lo-1:lo}
  function drawUser(){
    for(const s of DS.splice(0))try{chart.removeSeries(s)}catch(e){}
    for(const pl of DPL.splice(0))try{S.candle&&S.candle.removePriceLine(pl)}catch(e){}
    if(!S.candle||!R.length)return;const last=R.length-1;
    const seg=(i1,p1,i2,p2,color,style,width,title)=>{if(i1===i2)i2=Math.min(last,i1+1);if(i1>i2){[i1,i2]=[i2,i1];[p1,p2]=[p2,p1]}
      const s=line(color,width||2,0,{lineStyle:style||0,lastValueVisible:!!title,title:title||''});s.setData(i1===i2?[{time:R[i1].time,value:p1}]:[{time:R[i1].time,value:p1},{time:R[i2].time,value:p2}]);DS.push(s);return s};
    for(const d of DR){const col=d.color||C.acc;
      if(d.kind==='hline'){DPL.push(S.candle.createPriceLine({price:d.a.p,color:col,lineWidth:1,lineStyle:0,axisLabelVisible:true,title:''}));continue}
      const i1=nearest(d.a.t),i2=nearest(d.b.t);if(i1<0||i2<0)continue;
      if(d.kind==='trend'||d.kind==='ray'){
        if(d.kind==='ray'&&i2!==i1){const m=(d.b.p-d.a.p)/(i2-i1),lo=Math.min(i1,i2);seg(lo,lo===i1?d.a.p:d.b.p,last,(lo===i1?d.a.p:d.b.p)+m*(last-lo),col,0,2,'')}
        else seg(i1,d.a.p,i2,d.b.p,col,0,2,'')}
      else if(d.kind==='fib'){const hi=d.a.p,lo=d.b.p,from=Math.min(i1,i2);
        for(const f of FIB){const p=hi+(lo-hi)*f;seg(from,p,last,p,f===0.5||f===0.618?col:C.muted,f===0||f===1?0:2,1,'Fib '+(f*100).toFixed(1).replace('.0',''))}}
      else if(d.kind==='rect'){const top=Math.max(d.a.p,d.b.p),bot=Math.min(d.a.p,d.b.p);seg(i1,top,i2,top,col,0,1,'');seg(i1,bot,i2,bot,col,0,1,'')}}}
  const NEED={trend:2,ray:2,fib:2,rect:2,hline:1};
  function snap(i,price){const r=R[i];if(!r)return price;const c=[r.h,r.l,r.o,r.c].sort((a,b)=>Math.abs(a-price)-Math.abs(b-price))[0];
    return Math.abs(c-price)/price<0.006?c:price}
  function preview(i,price){if(prevS){try{chart.removeSeries(prevS)}catch(e){}prevS=null}
    if(!pend||i==null||!S.candle)return;const i1=nearest(pend.t);if(i1<0)return;
    prevS=line(C.acc,1,0,{lineStyle:2});const a=Math.min(i1,i),b=Math.max(i1,i);
    prevS.setData(a===b?[{time:R[a].time,value:pend.p}]:[{time:R[a].time,value:a===i1?pend.p:price},{time:R[b].time,value:b===i1?pend.p:price}])}
  function placePoint(i,price){if(!tool||!R[i])return;const pt={t:R[i].time*1000,p:+snap(i,price).toFixed(decimals(price))};
    if(NEED[tool]===1||pend){const d={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),kind:tool,a:pend||pt,b:pt};
      if(tool==='hline')d.a=pt;DR=[...DR,d];pend=null;preview(null);const t=tool;tool=null;drawUser();
      if(drawFn)try{drawFn(DR.slice())}catch(e){}if(toolFn)try{toolFn(null,t)}catch(e){}}
    else{pend=pt;if(toolFn)try{toolFn(tool,null,1)}catch(e){}}}
  const idxOf=new Map();
  function hoverInfo(i){const r=R[i];if(!r)return null;const pv=i?R[i-1].c:r.o;
    const g=k=>I[k]&&fin(I[k][i])?I[k][i]:null;
    return {t:r.t,o:r.o,h:r.h,l:r.l,c:r.c,v:fin(r.v)?r.v:null,chg:pv?(r.c-pv)/pv*100:null,
      ind:{ema20:g('ema20'),ema50:g('ema50'),ema200:g('ema200'),rsi:g('rsi'),macd:g('macd'),hist:g('hist'),bbU:g('bbU'),bbL:g('bbL'),vwap:g('vwap')}}}
  chart.subscribeCrosshairMove(p=>{
    const i=p&&p.time!=null&&idxOf.has(p.time)?idxOf.get(p.time):null;renderLegend(i);
    if(pend&&i!=null&&p.point&&S.candle){const pr=S.candle.coordinateToPrice(p.point.y);if(fin(pr))preview(i,pr)}
    if(hoverFn)try{hoverFn(i==null?null:hoverInfo(i))}catch(e){}});
  chart.subscribeClick(p=>{
    if(!p||!p.point||!S.candle||p.paneIndex>0)return;const ev=p.sourceEvent||{};
    if(tool&&!(ev.altKey||ev.metaKey)){const i=p.time!=null&&idxOf.has(p.time)?idxOf.get(p.time):null,pr=S.candle.coordinateToPrice(p.point.y);if(i!=null&&fin(pr))placePoint(i,pr);return}
    if(!clickFn)return;
    if(!(ev.altKey||ev.metaKey))return;          // Alt (ya da Cmd) + tik: o fiyata alarm
    const price=S.candle.coordinateToPrice(p.point.y);if(fin(price))try{clickFn(+price.toFixed(decimals(price)))}catch(e){}});

  function fit(){if(!R.length)return;const n=R.length,vis=isIntraday(D.tf)?Math.min(n,220):D.tf==='1h'?Math.min(n,160):Math.min(n,180);
    try{chart.timeScale().setVisibleLogicalRange({from:n-vis-0.5,to:n+6})}catch(e){chart.timeScale().fitContent()}}

  const api={
    setData(d){d=d||{};
      D={rows:d.rows||[],tf:d.tf||'1g',pro:d.pro||null,signals:Array.isArray(d.signals)?d.signals:[],trades:Array.isArray(d.trades)?d.trades:null,
        alarms:Array.isArray(d.alarms)?d.alarms:[],positions:Array.isArray(d.positions)?d.positions:[],symbol:d.symbol||''};
      if(d.show)show={...show,...d.show};
      R=cleanRows(D.rows);I=indicators(R,E);idxOf.clear();R.forEach((r,i)=>idxOf.set(r.time,i));
      build()},
    setShow(s){show={...show,...(s||{})};build()},
    getShow(){return {...show}},
    setOverlays(o){o=o||{};if('trades' in o)D.trades=Array.isArray(o.trades)?o.trades:null;if(Array.isArray(o.alarms))D.alarms=o.alarms;if(Array.isArray(o.positions))D.positions=o.positions;if(o.show)show={...show,...o.show};build()},
    setTheme(t){theme=t==='light'?'light':'dark';C=PAL[theme];
      chart.applyOptions({layout:{background:{type:'solid',color:C.bg},textColor:C.text,panes:{separatorColor:C.border,separatorHoverColor:C.cross}},grid:{vertLines:{color:C.grid},horzLines:{color:C.grid}},
        rightPriceScale:{borderColor:C.border},timeScale:{borderColor:C.border},crosshair:{vertLine:{color:C.cross,labelBackgroundColor:C.cross},horzLine:{color:C.cross,labelBackgroundColor:C.cross}}});
      build()},
    fit,resize(){try{chart.resize(el.clientWidth,el.clientHeight)}catch(e){}},
    destroy(){clearAll();try{chart.remove()}catch(e){}legend.remove()},
    snapshot(){try{return chart.takeScreenshot().toDataURL('image/png')}catch(e){return null}},
    onHover(f){hoverFn=typeof f==='function'?f:null},
    onClickPrice(f){clickFn=typeof f==='function'?f:null},
    // Cizim araclari: setTool('trend'|'ray'|'hline'|'fib'|'rect'|null); setDrawings(list); onDrawings(f(list)); onTool(f(tool,done,step))
    setTool(t){tool=NEED[t]?t:null;pend=null;preview(null);if(toolFn)try{toolFn(tool,null,0)}catch(e){}},
    getTool:()=>tool,
    setDrawings(list){DR=(Array.isArray(list)?list:[]).filter(d=>d&&NEED[d.kind]&&d.a&&fin(d.a.t)&&fin(d.a.p)&&(d.kind==='hline'||d.b&&fin(d.b.t)&&fin(d.b.p))).slice(0,100);drawUser()},
    getDrawings:()=>DR.slice(),
    undoDrawing(){DR=DR.slice(0,-1);drawUser();if(drawFn)try{drawFn(DR.slice())}catch(e){}},
    clearDrawings(){DR=[];drawUser();if(drawFn)try{drawFn([])}catch(e){}},
    onDrawings(f){drawFn=typeof f==='function'?f:null},
    onTool(f){toolFn=typeof f==='function'?f:null},
    colors:()=>({...C}),_chart:chart};
  return api}

const BPChart={create,_util,version:1};
if(typeof module!=='undefined'&&module.exports)module.exports=BPChart;
if(root&&typeof root==='object')root.BPChart=BPChart;
})(typeof window!=='undefined'?window:this);
