// Gorsel kontrol icin window.bp taklidi: gercek analiz modulleri (engine, bp-data, bp-strategy) + sentetik piyasa verisi.
// shot.js bu preload'u sandbox:false ile yukler. Sekme: BP_TAB ortam degiskeni (grafik|tarama|lab|portfoy|alarm|piyasa|analist|plan|demo|okul).
// Demo: gercek motor (bp-demo) + IPC denetleyicisi (bp-demo-main), 40 gunluk tohumlanmis sanal gecmis (uc hesap), sentetik fiyatlar.
// Okul: gercek okul-client, sahte Supabase REST (kucuk icerik seti); pratik gorevleri demo gecmisinden dogrulanir.
const {contextBridge,ipcRenderer}=require('electron');
const path=require('path'),R=p=>require(path.join(__dirname,'..','..',p));
const engine=R('engine.js'),D=R('bp-data.js'),lab=R('bp-strategy.js'),{summarize}=R('borsa-pro-main.js'),demo=require('./bp-demo-data.js');
const Q=R('bp-quant.js');
const hash=s=>[...String(s)].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7);
const STEP={'5dk':5*60000,'15dk':15*60000,'1s':3600000,'1g':86400000,'1h':7*86400000};
const N={'5dk':400,'15dk':300,'1s':400,'1g':480,'1h':260};
const series=(sym,tf)=>{const h=hash(sym),st=STEP[tf]||86400000;const n=N[tf]||400;
  return demo.rows({n,step:st,start:Date.now()-n*st*(st>=86400000?1.45:3.2),p0:20+h%400,seed:h+(tf.length*13),vol:st>=86400000?0.02:0.006})};
const market={TF:{'1g':1},yahooSymbol:s=>String(s).toUpperCase().replace(/\.IS$/,'')+(/[.=^-]/.test(s)?'':'.IS'),
  candles:async(s,tf)=>{const rows=series(String(s).replace('.IS',''),tf);return {rows,quote:{price:rows[rows.length-1].c,prev:rows[rows.length-2].c}}},
  quote:async s=>{const rows=series(String(s).replace('.IS',''),'1g'),p=rows[rows.length-1].c,prev=rows[rows.length-2].c;return {symbol:s,price:p,prev,chg:p-prev,chgPct:(p/prev-1)*100,time:Date.now()}},
  multi:async(s,{tf})=>{const fr={};for(const k of [tf,'1g','1h'])fr[k]=series(String(s).replace('.IS',''),k);return {frames:fr,quotes:{},errors:[]}}};
const data=D.createData({market,engine,sleep:()=>Promise.resolve()});
const bench=series('XU100','1g');
let watch=['THYAO','ASELS','GARAN','AKBNK','BIMAS','EREGL','KCHOL','TUPRS','SISE','FROTO','YKBNK','PGSUS','AAPL.US','BTC-USD'];
let alarms=[{id:'a1a1a1a1',symbol:'THYAO',kind:'above',price:0,note:'Direnç kırılımı',created:Date.now()-3600e3,fired:null,last:null},
  {id:'b2b2b2b2',symbol:'ASELS',kind:'verdict',price:null,note:'',created:Date.now()-7200e3,fired:null,last:'BEKLE'},
  {id:'c3c3c3c3',symbol:'GARAN',kind:'below',price:100,note:'Stop',created:Date.now()-86400e3,fired:Date.now()-5400e3,text:'GARAN 100,00 seviyesinin altına indi (son 99,40)'}];
let positions=[{id:'p1p1p1p1',symbol:'THYAO',qty:500,cost:0,date:'2026-09-01',note:'',stop:null,target:null},{id:'p2p2p2p2',symbol:'BIMAS',qty:120,cost:0,date:'2026-08-12',note:'',stop:null,target:null},
  {id:'p3p3p3p3',symbol:'EREGL',qty:2000,cost:0,date:'2026-10-02',note:'',stop:null,target:null}];
for(const p of positions){const r=series(p.symbol,'1g'),c=r[r.length-1].c;p.cost=+(c*(p.symbol==='EREGL'?1.06:0.9)).toFixed(2);p.stop=+(c*0.92).toFixed(2)}
alarms[0].price=+(series('THYAO','1g').slice(-1)[0].c*1.05).toFixed(2);
let lastScan=null,capital=250000,prefs={tab:process.env.BP_TAB||'grafik',universe:'BIST30',show:{}};
const px=s=>{const r=series(s,'1g');return {price:r[r.length-1].c,prev:r[r.length-2].c,chgPct:(r[r.length-1].c/r[r.length-2].c-1)*100}};
const port=()=>({positions,summary:summarize(positions,px,new Date().toISOString().slice(0,10))});
let evt=()=>{},liveList=(process.env.BP_LIVE||'').split(',').filter(Boolean);
// --- demo hesap taklidi -----------------------------------------------------------------------
const os=require('os'),fs=require('fs');
const Demo=R('bp-demo.js'),DemoMain=R('bp-demo-main.js'),SYMS=R('bp-symbols.js'),{createOkul}=R('okul-client.js');
const ddir=fs.mkdtempSync(path.join(os.tmpdir(),'bp-demo-mock-'));
const BASE={AAPL:232.4,NVDA:181.2,SPY:668.3,MSFT:512.6,TSLA:438.1,QQQ:603.5,'BTC-USD':108250,'ETH-USD':3912.4,'SOL-USD':187.42,'XRP-USD':2.41,'DOGE-USD':0.1987,'PEPE24478-USD':0.00001034};
const DAYMS=86400000,T_NOW=Date.now();
// Gun indeksine gore belirlenimci fiyat yolu (0 = bugun, -40 = 40 gun once)
const pxAt=(y,d)=>{const h=hash(y),b=/\.IS$/.test(y)?(()=>{const r=series(y.replace('.IS',''),'1g');return r[r.length-1].c})():BASE[y]||(40+h%300);
  const k=1+0.07*Math.sin((d+h%17)/6)+0.0025*d*((h%3)-1)-0.07*Math.sin((h%17)/6);const v=b*k;return v>=1?+v.toFixed(2):+v.toPrecision(6)};
(function seed(){
  let clk=T_NOW-40*DAYMS;const B=Demo.create({file:path.join(ddir,'bp-demo.json'),now:()=>clk,calendar:{status:()=>({open:true,reason:null})}});
  B.settings({anyTime:true,usFrac:true});
  const ccy=y=>/\.IS$/.test(y)?'TRY':'USD',mk=y=>/\.IS$/.test(y)?'BIST':/-USD$/.test(y)?'CRYPTO':'US';
  const q=(y,d)=>({price:pxAt(y,d),currency:ccy(y),time:clk,name:SYMS.nameOf(y)||(D.NAMES&&D.NAMES[y.replace('.IS','')])||y.replace('.IS','')});
  // Alis: hedef tutar (hesap para birimi); satis: pozisyonun orani
  const plan={'-40':[['THYAO.IS','buy',25000],['AAPL','buy',2500],['BTC-USD','buy',3500]],'-37':[['ASELS.IS','buy',20000],['ETH-USD','buy',2500],['NVDA','buy',2200]],
    '-33':[['SOL-USD','buy',2000],['SPY','buy',2000]],'-29':[['GARAN.IS','buy',15000],['SISE.IS','buy',12000]],'-24':[['THYAO.IS','sell',0.4],['SOL-USD','sell',0.4]],
    '-19':[['SISE.IS','sell',1],['NVDA','sell',0.34]],'-12':[['XRP-USD','buy',1500],['MSFT','buy',1500]],'-8':[['XRP-USD','sell',0.45],['GARAN.IS','buy',6000]],'-3':[['DOGE-USD','buy',600]]};
  const qtyFor=(y,v,d)=>{const m=mk(y),p=pxAt(y,d);if(m==='BIST')return Math.max(1,Math.floor(v/p));return m==='CRYPTO'?+(v/p).toFixed(m==='CRYPTO'&&p>1000?4:2):+(v/p).toFixed(1)};
  for(let d=-40;d<=0;d++){clk=T_NOW+d*DAYMS-(d?0:5*60000);
    for(const [y,side,v] of plan[String(d)]||[])try{const pos=B.summary().accounts[mk(y)].pos.find(p=>p.sym===y);
      const qty=side==='buy'?qtyFor(y,v,d):v===1?pos.qty:mk(y)==='BIST'?Math.floor(pos.qty*v):+(pos.qty*v).toFixed(4);
      B.place({symbol:y,market:mk(y),side,type:'market',qty},q(y,d))}catch(e){console.log('seed',y,e.message)}
    for(const y of B.symbols())B.process(y,[],q(y,d))}
  try{const ord=(y,side,type,v,f)=>{const p=pxAt(y,0),qty=side==='buy'?qtyFor(y,v,0):v,price=+(p*f).toPrecision(6);B.place({symbol:y,market:mk(y),side,type,qty,price},q(y,0))};
    ord('EREGL.IS','buy','limit',8000,0.95);ord('ASELS.IS','sell','stop',Math.floor(B.summary().accounts.BIST.pos.find(p=>p.sym==='ASELS.IS').qty/3),0.93);
    ord('TSLA','buy','limit',1200,0.94);ord('BTC-USD','sell','stop',0.01,0.9);ord('ETH-USD','sell','limit',0.2,1.12)}catch(e){console.log('seed emir',e.message)}
  B.settings({anyTime:false,usFrac:false});
})();
const dmarket={yahooSymbol:(s,m)=>{s=String(s).toUpperCase();return /[.=^-]/.test(s)?s:m==='BIST'?s+'.IS':s},
  candles:async y=>({rows:[],quote:{price:pxAt(y,0),currency:/\.IS$/.test(y)?'TRY':'USD',time:Date.now()-60000,name:SYMS.nameOf(y)||y.replace('.IS','')}})};
const demoCtl=DemoMain.create({lib:Demo,app:{getPath:()=>ddir},path,market:dmarket,calendar:R('calendar.js'),now:()=>Date.now(),active:()=>false,isOn:()=>true,
  timers:{setTimeout,clearTimeout},send:d=>evt(d),Notification:null,open:()=>{},timeout:p=>p});
// --- Borsa Okulu taklidi: sahte PostgREST (okul_icerik) -----------------------------------------
const BUGUN=new Date(T_NOW+3*3600000).toISOString().slice(0,10);
const OKUL_ROWS=[
  {slug:'analiz-'+BUGUN+'-aksam',tur:'analiz',baslik:'Bankalar taşıdı, BIST 100 günü %0,84 artıyla tamamladı',ozet:'Endeks, bankacılık hisselerinin öncülüğünde günün zirvesine yakın kapandı. İşlem hacmi 20 günlük ortalamanın yüzde 18 üzerinde.',tarih:BUGUN,konu:'genel',
    govde:{piyasa:{xu100:{son:10482.37,degisim:0.84},xbank:{son:14210.5,degisim:2.36},usdtry:{son:41.86,degisim:0.11},altin:{son:5612,degisim:-0.42}},
      bolumler:[{baslik:'Kapanış',metin:'BIST 100 günü **10.482** puandan, yüzde 0,84 artıyla kapattı. Bankacılık endeksi yüzde 2,4 yükseldi; yükselen hisse sayısı düşenlerin yaklaşık iki katı oldu.'}],
      one_cikanlar:[{sembol:'AKBNK',yon:'yukari',neden:'Hacimli yükseliş; 20 günlük ortalamanın 2,1 katı işlem.'},{sembol:'PGSUS',yon:'asagi',neden:'Kâr satışı; 50 günlük ortalama test ediliyor.'},{sembol:'ASELS',yon:'izle',neden:'Yeni sözleşme açıklaması KAP’ta.'}],
      yarin_izle:['10.350 desteği ve 10.600 direnci','Bankacılıktaki hacmin sürüp sürmediği'],uyari:'Yatırım tavsiyesi değildir.'},yayinda:true},
  {slug:'ders-003-emir-turleri',tur:'ders',baslik:'Emir türleri: limit, piyasa ve zarar durdur',ozet:'Hangi emir ne zaman kullanılır? Limit emirle fiyatı, piyasa emriyle hızı seçersin.',sira:3,seviye:'baslangic',konu:'bist-kurallari',tarih:BUGUN,
    govde:{hedefler:['Limit ve piyasa emrini ayırt etmek','Zarar durdur (stop-loss) emrinin işlevini bilmek'],bolumler:[{baslik:'Limit emir',metin:'Limit emirde fiyatı sen belirlersin; emir yalnız o fiyattan ya da daha iyisinden gerçekleşir.'}],
      ornek:{sembol:'THYAO',aciklama:'THYAO 312 TL iken 305 TL’den limit alış emri verirsen, fiyat 305’e inmedikçe emir bekler.'},
      alistirmalar:[{soru:'THYAO için son fiyatın %2 altına bir limit alış emri ver. Emir ne zaman gerçekleşir?',cevap:'Fiyat limit seviyesine inerse.'},{soru:'Elindeki pozisyon için %5 aşağıda bir zarar durdur (stop) emri kur.',cevap:'Fiyat stop seviyesinin altına inerse piyasa fiyatından satılır.'}],sure_dk:6},yayinda:true},
  {slug:'ders-002-seanslar',tur:'ders',baslik:'BIST seansları',ozet:'Açılış, sürekli işlem ve kapanış seansları.',sira:2,seviye:'baslangic',konu:'bist-kurallari',tarih:'2026-10-01',govde:{bolumler:[]},yayinda:true},
  {slug:'soru-'+BUGUN+'-01',tur:'soru',baslik:'s1',tarih:BUGUN,konu:'bist-kurallari',govde:{soru:'Limit alış emri hangi durumda hemen gerçekleşir?',secenekler:['Limit son fiyatın altındaysa','Limit son fiyatın üstündeyse','Hiçbir zaman','Yalnız kapanışta'],dogru:1,aciklama:'Alış limiti son fiyatın üstündeyse emir hemen eşleşebilir.',zorluk:1},yayinda:true},
  {slug:'soru-'+BUGUN+'-02',tur:'soru',baslik:'s2',tarih:BUGUN,konu:'risk',govde:{soru:'Zarar durdur emrinin amacı nedir?',secenekler:['Kârı artırmak','Kaybı sınırlamak','Komisyonu düşürmek','Takası hızlandırmak'],dogru:1,aciklama:'Stop-loss kaybı önceden belirlenen seviyede sınırlar.',zorluk:1},yayinda:true}];
const okulFetch=async u=>{const x=new URL(u);let out=OKUL_ROWS.slice(),order=[],limit=Infinity;
  for(const [k,v] of x.searchParams){if(k==='select')continue;if(k==='order'){order=v.split(',');continue}if(k==='limit'){limit=+v;continue}
    const [op,...rest]=v.split('.'),val=rest.join('.');out=out.filter(r=>{const a=r[k];return op==='eq'?String(a)===val:op==='lt'?a!=null&&a<val:op==='gt'?a!=null&&+a>+val:true})}
  out.sort((a,b)=>{for(const o of order){const [c,dir]=o.split('.'),av=a[c],bv=b[c];if(av===bv)continue;if(av==null)return 1;if(bv==null)return -1;return (av<bv?-1:1)*(dir==='desc'?-1:1)}return 0});
  const body=out.slice(0,limit).map(r=>{const c={...r};delete c.yayinda;return c});return {ok:true,status:200,json:async()=>body}};
const okulClient=createOkul({fetch:okulFetch,now:()=>Date.now(),dir:ddir,url:'https://ornek.supabase.co',anon:'anon',ai:async()=>'Güzel soru. Yatırım tavsiyesi değildir.',open:async()=>{}});
async function scanNow(u){const syms=u==='WATCH'?watch:D.U[u];const r=await data.scan(syms,{bench,onProgress:p=>evt({type:'scan',...p})});
  const rows=r.rows.map(x=>({...x,presets:D.PRESETS.filter(p=>data.matches(x,p.id)).map(p=>p.id)}));lastScan={...r,rows,universe:u,breadth:data.breadth(rows),sectors:D.sectorStats(rows)};return lastScan}
async function load({symbol='THYAO',tf='1g',market:mkt='BIST'}={}){
  const sym=String(symbol).toUpperCase(),fr={};for(const k of [tf,'1g','1h'])fr[k]=series(sym,k);
  const rows=fr[tf],pro=engine.proAnalyze(fr,{primary:tf,news:[{score:2},{score:1}],depth:{pressure:24,flow:1e6,live:1}});
  const q=await market.quote(sym),fsum={};for(const k in pro.trend.frames){const t=pro.trend.frames[k];fsum[k]={dir:t.dir,text:t.text,adx:t.adx}}
  const h=hash(sym),hist=demo.rows({n:2500,step:86400000,start:Date.now()-2500*86400000*1.45,p0:20+h%400,seed:h+99,vol:0.02});
  const H=[...hist.filter(r=>r.t<fr['1g'][0].t).map(r=>{const k=fr['1g'][0].o/hist.filter(x=>x.t<fr['1g'][0].t).slice(-1)[0].c;return {...r,o:r.o*k,h:r.h*k,l:r.l*k,c:r.c*k}}),...fr['1g']];
  const quant=Q.analyze({rows,daily:fr['1g'],hist:H,pro,bench:bench,breadth:lastScan&&lastScan.breadth});const techFrames={};
  for(const k of [tf,'1g','1h']){const t=Q.techSummary(fr[k]);if(t)techFrames[k]={overall:t.overall,ma:t.ma,osc:t.osc}}
  const us=mkt==='US'||/-USD$/.test(sym),ccy=us?'USD':'TRY';
  return {ok:true,symbol:sym,yahoo:us?sym:sym+'.IS',market:us?'US':'BIST',name:(us?SYMS.nameOf(sym):D.NAMES&&D.NAMES[sym])||sym,tf,currency:ccy,rows,pro,stats:data.stats(fr['1g'],bench),
    quote:{...q,currency:ccy,dayHigh:null,dayLow:null,volume:null,stale:false},signals:engine.systemSignals(rows).map(s=>({t:rows[s.i].t,dir:s.dir,why:s.why})),frames:fsum,
    news:{bot:{list:[{title:'Şirket yeni uçak siparişi için anlaşma imzaladı',summary:'Şirket 2027 teslimli 20 yeni uçak için anlaşma imzaladı; kapasite artışı beklentisi olumlu.',score:3,importance:4,source:'KAP',ts:new Date(Date.now()-5*3600e3).toISOString()},
      {title:'BIST 100 güne yükselişle başladı',score:1,importance:4,source:'AA',general:true,ts:new Date(Date.now()-2*3600e3).toISOString()}],
      calendar:[{day:'2026-10-28',kind:'Bilanço',title:'3. çeyrek finansal tablolar'}],akd:{days:5,top:[{name:'Bank of America',net:1250000,buyDays:4}]}},yahoo:[]},
    quant,techFrames,fund:process.env.BP_NOFUND?null:{raw:{sector:'Ulaştırma',pe:4.8,pb:1.1,evEbitda:5.2,roe:24.5,netMargin:11.2,debtToEquity:1.4,divYield:1.9,target:{mean:420,n:9,rec:'buy'}},score:{ok:true,valuation:{label:'Ucuz',score:0.5},quality:{label:'Güçlü',score:0.4},growth:{label:'Makul',score:0.1},health:{label:'Orta',score:-0.1},target:{mean:420,upside:20.4},flags:[],lines:['F/K 4,8 sektöre göre düşük']}},
    depth:{at:Date.now()-60e3,pressure:24,trend:'Alış baskısı artıyor',flow:{net:1.2e6},signal:{dir:1,why:['Aktif alış ağırlıklı','BofA topluyor']},
      buyers:[{name:'Bank of America',net:820000},{name:'Yapı Kredi',net:310000}],sellers:[{name:'İş Yatırım',net:-540000},{name:'Garanti BBVA',net:-210000}]},errors:[],stale:false}}
contextBridge.exposeInMainWorld('bp',{
  state:async()=>{if(process.env.BP_SCAN&&!lastScan)await scanNow('BIST30');return {watch,tf:'1g',market:'BIST',symbol:process.env.BP_SYM||'THYAO',alarms,portfolio:port(),capital,riskPct:1,prefs,providers:process.env.BP_NOAI?[]:['groq','claude'],
    lastScan,marketStatus:{open:true,reason:null},universes:{BIST30:D.U.BIST30.length,BIST50:D.U.BIST50.length,BIST100:D.U.BIST100.length,WATCH:watch.length},
    presets:D.PRESETS,tags:D.TAGS,strategies:lab.STRATEGIES}},
  load,quotes:async l=>(await data.quotes(l)).map(q=>q&&liveList.includes(q.symbol)?{...q,live:true}:q),search:async q=>data.search(q),overview:async()=>data.overview(),
  watch:async o=>{if(o.op==='add')watch=[...new Set([...watch,String(o.symbol).toUpperCase()])];if(o.op==='remove')watch=watch.filter(x=>x!==o.symbol);return {ok:true,watch}},
  scan:async o=>({ok:true,...await scanNow(o.universe)}),
  scanCancel:async()=>({ok:true}),
  lab:async o=>{const rows=series(o.symbol,o.tf||'1g');return {ok:true,...lab.compare(rows,o.opts),symbol:o.symbol,tf:o.tf}},
  ai:async()=>({ok:true,provider:'groq',model:'openai/gpt-oss-120b',data:{ozet:'Günlük karar AL (skor +38): fiyat EMA20/50 üzerinde, haftalık trend yükselişte ve hacim yükselişi destekliyor. Fiyat en yakın direnç bölgesinin hemen altında.',
    gorunum:'olumlu',boga:'Direnç bölgesi üzerinde günlük kapanış gelirse Hedef 1 ve ardından Hedef 2 seviyeleri gündeme gelir.',ayi:'Destek bölgesinin altında kapanış, stop seviyesine doğru geri çekilme riskini artırır.',
    tetikler:['Direnç bölgesi üstünde kapanış (AL teyidi)','Destek altında kapanış (plan geçersiz)'],riskler:['RSI aşırı alıma yakın','Risk/ödül 1,5 altında'],izle:['Hacim / 20 gün ortalaması','Haftalık EMA20'],sonuc:'Koşullu olumlu görünüm; girişi geri çekilmede düşünmek daha dengeli. Yatırım tavsiyesi değildir.'},cost:0}),
  report:async o=>({ok:true,provider:'groq',model:'openai/gpt-oss-120b',data:{not:'Al',notGerekce:'Teknik karar ve geçmiş benzer durumlar olumlu; piyasa rejimi temkin gerektiriyor.',hedef:{baz:375,dusuk:330,yuksek:400,vade:'1 ay'},ozet:'Trend güçlü, momentum yüksek.',teknik:'EMA dizilimi yükselişte.',temel:'Değerleme makul.',olasiliklar:'Hedef 1 stoptan önce %58.',senaryolar:[{ad:'Boğa',olasilik:45,kosul:'Direnç üstü kapanış',hedef:400},{ad:'Baz',olasilik:35,kosul:'Yatay seyir',hedef:360},{ad:'Ayı',olasilik:20,kosul:'Destek altı kapanış',hedef:325}],katalizorler:['Bilanço 28 Ekim'],riskler:['RSI yüksek'],izle:['Hacim'],sonuc:'Koşullu olumlu. Yatırım tavsiyesi değildir.'}}),
  depth:async o=>{if(o.op==='live')liveList=o.list;const tg={connected:!process.env.BP_NOTG,bot:'@bot',auto:liveList.length?30:0,symbol:null,liveList,safe:{hour:12,hourCap:100,day:48,dayCap:700,market:true}};
    if(o.op==='fetch'||o.op==='state'){const L=await load({symbol:o.symbol||'THYAO'}),p=L.quote.price,lv=(k,s)=>Array.from({length:10},(_,i)=>({price:+(p+s*(i+(s>0?1:0))*0.05).toFixed(2),qty:Math.round(20000+((i*7919)%13)*9000+(i===3&&s<0?220000:0))}));
      const d={...L.depth,at:Date.now()-20e3,last:p,bids:lv('b',-1),asks:lv('a',1),walls:[{side:'bid',price:+(p-0.15).toFixed(2),qty:247000,ratio:0.3}],
        tape:{enough:true,score:42,dir:1,why:['Son 5 dk aktif alış %68'],w5:{buy:68000,sell:32000,delta:0.36,vwap:+(p-0.03).toFixed(2)},top:{name:'Bank of America',net:42000},cvd:[1,3,2,5,7,6,9,12,11,14]},
        trades:Array.from({length:12},(_,i)=>({time:'17:5'+(9-i%10)+':1'+i%10,price:+(p+((i%3)-1)*0.05).toFixed(2),qty:500+i*137,side:i%3?'buy':'sell',buyer:i%2?'BIYKR':'GRM',seller:i%2?'ISY':'YKR'}))};
      return o.op==='state'?{ok:true,tg,depth:null}:{ok:true,tg,depth:d}}
    return {ok:true,tg}},
  plan:async o=>{const cap=+o.capital||10000;for(let i=1;i<=3;i++){evt({type:'plan',done:i-1,total:3,symbol:['THYAO','ASELS','BIMAS'][i-1]});await Promise.resolve()}
    const mk=(symbol,name,sector,ref,lots)=>{const stop=+(ref*0.95).toFixed(2),t1=+(ref*1.07).toFixed(2),t2=+(ref*1.12).toFixed(2),pos=+(ref*lots).toFixed(2),ml=+((ref-stop)*lots+pos*0.002).toFixed(2);
      return {symbol,name,sector,lots,entry:[+(ref*0.99).toFixed(2),ref],ref,stop,t1,t2,positionTL:pos,maxLossTL:ml,maxLossPct:+(ml/cap*100).toFixed(2),p1:58,evTL:+(pos*0.012).toFixed(2),
        expected:{week:{lo:-pos*0.04,mid:pos*0.008,hi:pos*0.05},month:{lo:-pos*0.08,mid:pos*0.02,hi:pos*0.11}},reasons:['Günlük AL +38, haftalık trend yükselişte','Geçmişte benzer kurulumlarda hedef 1 stoptan önce %58 (n=214)','R/Ö 1:1,8'],warnings:symbol==='ASELS'?['Bilanço 6 gün içinde: oynaklık artabilir.']:[]}};
    const P=[mk('THYAO','Türk Hava Yolları','Ulaştırma',312.5,10),mk('ASELS','Aselsan','Savunma',148.2,22)];
    const sum=k=>P.reduce((s,x)=>s+x[k],0),inv=sum('positionTL'),ml=sum('maxLossTL');
    return {ok:true,capital:cap,riskPct:o.risk==='temkinli'?0.5:o.risk==='atak'?2:1,horizon:o.horizon||'1h',picks:P,
      totals:{invested:inv,cash:cap-inv,maxLoss:ml,maxLossPct:ml/cap*100,positions:P.length,expWeek:{lo:-inv*0.035,mid:inv*0.008,hi:inv*0.045},expMonth:{lo:-inv*0.07,mid:inv*0.02,hi:inv*0.1}},
      rejected:[{symbol:'BIMAS',why:'Sermaye bu hisse için yetersiz (1 lot riski aşıyor).'},{symbol:'GARAN',why:'Aynı sektörden (Bankacılık) zaten bir hisse seçildi.'},{symbol:'EREGL',why:'Karar BEKLE: plan yok.'}],
      notes:['Toplamlar yaklaşık: hisseler birlikte hareket edebilir.','Kaynak: son tarama (BIST30) AL listesi.'],source:'scan',at:Date.now()}},
  planApply:async o=>{const add=(o.picks||[]).map((k,i)=>({id:'pp'+i+Date.now().toString(16).slice(-5),symbol:k.symbol,qty:k.lots,cost:k.ref,date:new Date().toISOString().slice(0,10),note:'Sermaye planı',stop:k.stop,target:k.t1}));
    positions=[...positions,...add];return {ok:true,added:add.length,positions,alarms:o.alarms?alarms:undefined}},
  feeds:async o=>{const st={news:{configured:!process.env.BP_NOKEYS,left:84},fx:{configured:!process.env.BP_NOKEYS,left:1460},gecko:{configured:!process.env.BP_NOKEYS,left:null}};
    if(o.op==='news')return process.env.BP_NOKEYS?{ok:false,error:'NewsAPI anahtarı kayıtlı değil: Piyasa sekmesindeki Veri kaynakları bölümünden ekle.',needKey:true}:{ok:true,symbol:o.symbol,left:83,items:[{title:'THY, Avrupa hatlarında kapasiteyi yüzde 12 artırıyor',source:'Anadolu Ajansı',url:'https://www.aa.com.tr/x',time:Date.now()-3*3600e3},{title:'Havacılık hisseleri petrol fiyatlarındaki düşüşle yükseldi',source:'Bloomberg HT',url:'https://www.bloomberght.com/x',time:Date.now()-26*3600e3}]};
    if(o.op!=='market')return {ok:true,status:st};
    const sp=(p0,n=168)=>Array.from({length:n},(_,i)=>p0*(1+Math.sin(i/9)*0.02+i/n*0.03));
    return {ok:true,status:st,at:Date.now(),fx:process.env.BP_NOKEYS?null:{ok:true,base:'USD',time:Math.floor(Date.now()/1000)-3600,rates:{TRY:41.92,EUR:0.861,GBP:0.746,CHF:0.797,JPY:151.2,CNY:7.12,SAR:3.75,AED:3.6725}},
      crypto:process.env.BP_NOKEYS?null:{ok:true,coins:[{id:'bitcoin',symbol:'btc',name:'Bitcoin',price:{usd:108250,try:4537000},chg24h:1.84,spark7d:sp(104000)},{id:'ethereum',symbol:'eth',name:'Ethereum',price:{usd:3912,try:163990},chg24h:-0.72,spark7d:sp(3950)},
        {id:'solana',symbol:'sol',name:'Solana',price:{usd:187.4,try:7856},chg24h:3.1,spark7d:sp(180)},{id:'ripple',symbol:'xrp',name:'XRP',price:{usd:2.41,try:101.03},chg24h:-1.4,spark7d:sp(2.5)}]},
      radar:{updatedAt:Date.now()-40*60e3,modeller:[{id:'groq',ad:'Groq · Llama',durum:'ok',isabet:{'1h':{n:212,oran:57}}},{id:'cohere',ad:'Cohere · Command',durum:'ok',isabet:{'1h':{n:198,oran:54}}},{id:'cerebras',ad:'Cerebras',durum:'kota',isabet:null},{id:'hizli',ad:'Hızlı şerit',durum:'ok',isabet:null}],
        ozet:{yukselis:['THYAO','ASELS','TUPRS','BIMAS'],dusus:['PETKM','SASA']},gundem:[{baslik:'TCMB faiz kararı perşembe açıklanacak',kaynak:'AA',zaman:new Date(Date.now()-5*3600e3).toISOString()}],hatalar:[]}}},
  demo:async o=>demoCtl.op(o).catch(e=>({ok:false,error:e.message})),
  okul:async o=>{o=o||{};const a=o.op==='gorevler'?{history:demoCtl.history()}:o.args;return okulClient.call(o.op,a)},
  ask:async o=>({ok:true,answer:'Stop seviyesi giriş bölgesinin altındaki yapı desteğine göre belirlendi. Yatırım tavsiyesi değildir.'}),
  alarm:async o=>{if(o.op==='add')alarms=[...alarms,{id:Math.random().toString(16).slice(2,10),...o.alarm,created:Date.now(),fired:null,last:null}];if(o.op==='remove')alarms=alarms.filter(a=>a.id!==o.id);return {ok:true,alarms}},
  portfolio:async o=>{if(o.op==='remove')positions=positions.filter(p=>p.id!==o.id);return {ok:true,...port()}},
  capital:async v=>({ok:true,capital:v==null?null:+v}),prefs:async o=>({...prefs,...o}),open:async()=>({ok:true}),
  on:f=>{evt=f;return ()=>{}}});
