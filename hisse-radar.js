// Hisse Radar baglantisi (ana surec). Kullanicinin herkese acik "Hisse Radar" deposundaki (GitHub: maj834/Hisse) bot ciktilarini okur.
// Depodaki GitHub Actions botlari 9 farkli yapay zeka/veri API'sini kullanip main dalina data/*.json, data dalina canli fiyat dosyalarini yazar.
// Ham adres: <base>/<dal>/<yol>; anahtar gerekmez, bu modul hicbir anahtar kullanmaz. Dosya basina onbellek (ttl), ETag/If-None-Match
// (304 -> govde inmez), ag hatasinda eski veri (stale), 12 sn zaman asimi; ayni dosyaya eszamanli istekler tek istekte birlesir,
// basarisiz dosya retryMs dolmadan yeniden istenmez.
// Dosya bicimleri depodaki scraper/*.py yazicilarindan ve app/app.html okuyucusundan cikarildi (alan adlari Turkce, alanlar eksik olabilir):
//   ai.json        {updatedAt, veri, modeller:[{id,ad,model,durum:'ok'|'eski'|'hata'}], hisseler:{KOD:{modelId:{karar,guven,hedef,neden,karar1a,..}}},
//                   isabet:{modelId:{'1h':{n,oran(%)},'1a'..}}}  (BIST 30; isabet = son ~30 gunde vadesi dolan kararlarin dogru cikma orani)
//   ai_genis.json  {modeller, hisseler:{KOD:{ts(sn), modelId:{..ayni + aciklama, model}, haber:[..]}}} (BIST 30 disi kademeli tarama; 10 gunden eskisi kullanilmaz)
//   outlook.json   Claude beklentisi {updatedAt, yukselis:[{sembol,hedef,guven,neden,olay,vade}], dusus:[..], kararlar:{KOD:{..}}}
//                  (telefon uygulamasi 30 Eylul 2026'dan beri kullanmiyor; burada yalniz OUTLOOK_MAX'tan tazeyse alinir)
//   olasilik.json  {son, dogrulama:{vade:{brier_kosullu,brier_kosulsuz}}, hisseler:{KOD:{r20,dilim,ust200,'1h':{p,pu,q,qu,n,N},..}}} q: %25/%50/%75 getiri
//   secim.json     {updatedAt, zayif:[..], guclu:[..], riskli:{hisse:{KOD:neden}}, canli, gecmis}   backtest.json {bugun:[{kod,karar,vade,kosul,isabet,n,..}]}
//   temel.json     {hisseler:{KOD:{ceyrek,puan,ozet,oranlar,satirlar,..}}}   gundem.json {haber_ai:{piyasa_havasi,ozet,sektorler,hisseler}, makro, sirket:{KOD:{haberler}}}
//   endeksler.json {endeksler:{XU030:{ad,hisseler}}}   data dali: market.json {sutun:[..], hisseler:[[k,ad,fiyat,deg,..]]}, news.json {items:[{title,url,kaynak,ts}]}
//
// Konsensus (consensus()): model kararlari AL=+1 TUT=0 SAT=-1.
//   agirlik = isabet * guven/100. isabet = ai.json isabet[model]['1h'].oran/100, yalniz n >= 20 ise (yoksa olculmemis sayilir).
//   Hic olculmus model yoksa isabet herkes icin 1 (agirlik:'esit'); olculmemis model olculmuslerin ortalamasini alir (ne odul ne ceza).
//   Guven yoksa 0,5. Tum agirliklar 0 ise yalniz isabet, o da 0 ise esit agirlik.
//   skor = sum(agirlik*oy)/sum(agirlik) (-1..1). karar: skor >= 0,5 AL, <= -0,5 SAT, arasi TUT. En az iki model varken ayni yonde en az iki
//   model yoksa TUT (telefon uygulamasindaki "AL/SAT icin en az 2 kaynak" kurali). uyum = karari veren modellerin agirlik payi (0-1);
//   guven = sum(karari verenlerin agirligi*guveni)/sum(agirlik) (0-100; = agirlikli guven * uyum).
//   hedef = gecerli hedeflerin agirlikli ortalamasi; gecerli: fiyat biliniyorsa 1 haftada en fazla %10 uzakta ve karar yonuyle celismiyor
//   (AL'da fiyatin ustunde, SAT'ta altinda) -- uygulamadaki hedefOk ile ayni. hedefYuzde fiyata gore %.
//   Riskli hisse (secim.json riskli: sorusturma, temerrut, tasfiye ...) AL ise TUT'a indirilir (hamKarar ve not alanlari).
// Yatirim tavsiyesi degildir.
const BASE='https://raw.githubusercontent.com/maj834/Hisse';
const FILES={ai:['main','data/ai.json'],ai_genis:['main','data/ai_genis.json'],outlook:['main','data/outlook.json'],olasilik:['main','data/olasilik.json'],
  secim:['main','data/secim.json'],backtest:['main','data/backtest.json'],temel:['main','data/temel.json'],gundem:['main','data/gundem.json'],
  endeksler:['main','data/endeksler.json'],market:['data','market.json'],news:['data','news.json']};
const SYM_FILES=['ai','ai_genis','outlook','olasilik','secim','backtest','temel','gundem','market','news'];
const MKT_FILES=['ai','ai_genis','gundem','endeksler','secim','outlook','backtest'];
const DAY=864e5,H=36e5;
const MIN_ISABET_N=20,ESIK=0.5,HEDEF_SINIR=0.10,BRIER=0.2475;            // BRIER: yazi-tura 0,25; belirgin iyi olmali (uygulama ile ayni)
const OUTLOOK_MAX=3*DAY,GENIS_MAX=10*DAY,GENIS_ESKI=3*DAY,OLS_MAX=12*DAY,SECIM_MAX=100*H,HABER_AI_MAX=3*DAY,MAX_BYTES=8e6;
const VADE={'1h':5,'1a':21,'3a':63};
const KARAR=new Set(['AL','TUT','SAT']),OY={AL:1,TUT:0,SAT:-1};
// Haber eslestirme: kod, bilinen ad (uygulamadaki ALIAS) ya da sirket adinin ilk kelimesi (genel kelimeler haric)
const ALIAS={AEFES:['EFES'],AKBNK:['AKBANK'],ASELS:['ASELSAN'],BIMAS:['BİM'],EKGYO:['EMLAK KONUT'],ENKAI:['ENKA'],EREGL:['ERDEMİR','EREĞLİ'],FROTO:['FORD OTOSAN'],
  GARAN:['GARANTİ'],GUBRF:['GÜBRETAŞ'],ISCTR:['İŞ BANKASI','İŞBANK'],KCHOL:['KOÇ HOLDİNG'],TRALT:['KOZA','TÜRK ALTIN'],KRDMD:['KARDEMİR'],MGROS:['MİGROS'],
  PETKM:['PETKİM'],SAHOL:['SABANCI'],SASA:['SASA'],SISE:['ŞİŞECAM'],TAVHL:['TAV'],TCELL:['TURKCELL'],THYAO:['THY','TÜRK HAVA YOLLARI'],TOASO:['TOFAŞ'],
  TTKOM:['TÜRK TELEKOM'],TUPRS:['TÜPRAŞ'],VAKBN:['VAKIFBANK'],YKBNK:['YAPI KREDİ'],PGSUS:['PEGASUS'],ASTOR:['ASTOR'],DSTKF:['DESTEK FAKTORİNG','DESTEK FİNANS']};
const GENEL_AD=new Set(['TURKIYE','TURK','ANADOLU','BORSA','ISTANBUL','GLOBAL','YENI','DOGU','BATI','EGE','GRUP','HOLDING','THE']);
const AY=['oca','şub','mar','nis','may','haz','tem','ağu','eyl','eki','kas','ara'];

const fin=v=>typeof v==='number'&&Number.isFinite(v);
const num=v=>fin(v)?v:typeof v==='string'&&v.trim()&&Number.isFinite(+v)?+v:null;
const pos=v=>{v=num(v);return fin(v)&&v>0?v:null};
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const arr=v=>Array.isArray(v)?v:[];
const has=v=>v&&typeof v==='object'&&Object.keys(v).length>0;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const r2=v=>fin(v)?Math.round(v*100)/100:null,r3=v=>fin(v)?Math.round(v*1000)/1000:null;
const str=(v,n=400)=>typeof v==='string'&&v.trim()?v.trim().slice(0,n):null;
const T=v=>{if(fin(v))return v<1e12?v*1000:v;const t=Date.parse(typeof v==='string'?v:'');return Number.isFinite(t)?t:null};
const TRU={'Ş':'S','Ç':'C','Ğ':'G','Ö':'O','Ü':'U','İ':'I'};
const upN=s=>' '+String(s||'').toLocaleUpperCase('tr-TR').replace(/[ŞÇĞÖÜİ]/g,c=>TRU[c]).replace(/[^A-Z0-9&]+/g,' ').trim()+' ';
const codeOf=s=>{s=String(s||'').trim().toLocaleUpperCase('tr-TR').replace(/\.IS$/,'').replace(/[ŞÇĞÖÜİ]/g,c=>TRU[c]);return /^[A-Z0-9]{2,8}$/.test(s)?s:null};
const kararOf=v=>{const s=String(v||'').trim().toLocaleUpperCase('tr-TR');return KARAR.has(s)?s:null};
const sum=a=>a.reduce((x,y)=>x+y,0);
// "15 Eki" -> Istanbul gun basi (ms); yil yazmaz: simdiden ileri dusmeyen en yakin yil
function gunAy(s,t){const m=/^(\d{1,2})\s+(\S+)/.exec(String(s||'').trim());if(!m)return null;const ay=AY.indexOf(m[2].slice(0,3).toLocaleLowerCase('tr-TR'));
  const g=+m[1];if(ay<0||g<1||g>31)return null;const y=new Date(t+3*H).getUTCFullYear();let ms=Date.UTC(y,ay,g)-3*H;if(ms>t+DAY)ms=Date.UTC(y-1,ay,g)-3*H;return ms}

// --- normallestirme (saf; testler dogrudan cagirir) -------------------------------------------
const isabetOf=(ai,id,vade='1h')=>{const x=obj(obj(obj(obj(ai).isabet)[id])[vade]),n=num(x.n),o=num(x.oran);return fin(n)&&fin(o)?{n,oran:o}:null};
function modelOf(id,ad,model,v,extra){if(!v||typeof v!=='object')return null;const karar=kararOf(v.karar);if(!karar)return null;const g=num(v.guven);
  return {id,ad:str(ad,60)||id,model:str(v.model,80)||str(model,80),karar,guven:fin(g)?Math.round(clamp(g,0,100)):null,hedef:pos(v.hedef),neden:str(v.neden),
    karar1a:kararOf(v.karar1a),hedef1a:pos(v.hedef1a),karar3a:kararOf(v.karar3a),hedef3a:pos(v.hedef3a),...extra}}
// Bir hissenin model kararlari: BIST 30 (ai.json); orada yoksa kademeli tarama (ai_genis.json); taze Claude beklentisi (outlook.json kararlar)
function modelsFor(code,{ai,genis,out},t){const list=[],A=obj(ai),G=obj(genis),O=obj(out);
  const m=obj(obj(A.hisseler)[code]),at=T(A.updatedAt);
  for(const md of arr(A.modeller)){if(!md||md.durum==='hata'||!str(md.id,40))continue;
    const x=modelOf(md.id,md.ad,md.model,m[md.id],{isabet:isabetOf(A,md.id),kaynak:'ai',eski:md.durum==='eski',zaman:at});if(x)list.push(x)}
  if(!list.length){const g=obj(obj(G.hisseler)[code]),ts=T(g.ts);
    if(ts&&t-ts<GENIS_MAX)for(const md of arr(G.modeller)){if(!md||!str(md.id,40))continue;const v=obj(g[md.id]);
      const x=modelOf(md.id,md.ad,md.model,v,{isabet:isabetOf(A,md.id),kaynak:'ai_genis',eski:t-ts>GENIS_ESKI,zaman:ts,aciklama:str(v.aciklama)});if(x)list.push(x)}}
  const oa=T(O.updatedAt);
  if(oa&&t-oa<=OUTLOOK_MAX&&!list.some(x=>x.id==='claude')){const x=modelOf('claude','Claude','claude',obj(O.kararlar)[code],{isabet:isabetOf(A,'claude'),kaynak:'outlook',eski:t-oa>DAY,zaman:oa});if(x)list.push(x)}
  return list}

function consensus(models,{price=null,risk=null}={}){
  const vs=arr(models).filter(m=>m&&kararOf(m.karar));if(!vs.length)return null;
  const okIs=m=>!!(m.isabet&&fin(num(m.isabet.n))&&num(m.isabet.n)>=MIN_ISABET_N&&fin(num(m.isabet.oran)));
  const meas=vs.filter(okIs),mode=meas.length?'isabet':'esit';
  const accM=m=>clamp(num(m.isabet.oran),0,100)/100,avg=meas.length?sum(meas.map(accM))/meas.length:1;
  const acc=m=>okIs(m)?accM(m):avg,cf=m=>fin(num(m.guven))?clamp(num(m.guven),0,100)/100:0.5;
  let ws=vs.map(m=>acc(m)*cf(m));if(!(sum(ws)>0))ws=vs.map(acc);if(!(sum(ws)>0))ws=vs.map(()=>1);
  const W=sum(ws),k=vs.map(m=>kararOf(m.karar)),skor=sum(vs.map((m,i)=>ws[i]*OY[k[i]]))/W;
  const say={AL:0,TUT:0,SAT:0};k.forEach(x=>say[x]++);
  let karar=skor>=ESIK?'AL':skor<=-ESIK?'SAT':'TUT',ham=null;const notlar=[];
  if(karar!=='TUT'&&vs.length>=2&&say[karar]<2){notlar.push('Yalnız bir model '+karar+' diyor; AL/SAT için en az iki model aynı yönde olmalı.');ham=karar;karar='TUT'}
  const rn=risk&&(typeof risk==='string'?str(risk):str(risk.neden));
  if(rn&&karar==='AL'){ham='AL';karar='TUT';notlar.push('Risk uyarısı: '+rn+' Bu yüzden AL verilmiyor.')}
  if(vs.length===1)notlar.push('Yalnız bir model var; konsensüs zayıf.');
  const agree=vs.map((m,i)=>k[i]===karar?ws[i]:0),uyum=sum(agree)/W,guven=Math.round(sum(vs.map((m,i)=>agree[i]*cf(m)*100))/W);
  const p=pos(price),hOk=(m,i)=>{const h=pos(m.hedef);if(!h)return false;if(!p)return true;const r=h/p-1;return Math.abs(r)<=HEDEF_SINIR&&!(k[i]==='AL'&&r<=0)&&!(k[i]==='SAT'&&r>=0)};
  let hw=0,hs=0;vs.forEach((m,i)=>{if(hOk(m,i)&&ws[i]>0){hw+=ws[i];hs+=ws[i]*m.hedef}});
  const hedef=hw>0?r2(hs/hw):null;
  return {karar,skor:r3(skor),guven,hedef,hedefYuzde:hedef!=null&&p?r2((hedef/p-1)*100):null,n:vs.length,uyum:r2(uyum),agirlik:mode,
    dagilim:say,hamKarar:ham,not:notlar.length?notlar.join(' '):null}}

function outlookOf(out,code,t){const O=obj(out),at=T(O.updatedAt);if(!at||t-at>OUTLOOK_MAX)return null;
  const f=(x,yon)=>({yon,hedef:pos(x.hedef),guven:fin(num(x.guven))?Math.round(clamp(num(x.guven),0,100)):null,neden:str(x.neden),olay:str(x.olay),vade:str(x.vade,40),
    karar:kararOf(x.karar),zaman:at,eski:t-at>DAY});
  for(const yon of ['yukselis','dusus']){const x=arr(O[yon]).find(o=>o&&codeOf(o.sembol)===code);if(x)return f(x,yon)}
  const k=obj(obj(O.kararlar)[code]);return has(k)&&kararOf(k.karar)?f(k,null):null}

function olasilikOf(ols,code,t){const L=obj(ols),o=obj(obj(L.hisseler)[code]);if(!has(o))return null;const son=T(L.son);if(son&&t-son>OLS_MAX)return null;
  const vadeler={};let beceri=false;
  for(const [v,gun] of Object.entries(VADE)){const x=obj(o[v]);if(!has(x))continue;const d=obj(obj(L.dogrulama)[v]),bk=num(d.brier_kosullu),bu=num(d.brier_kosulsuz);
    // Uygulamadaki olsVade: kosullu oran yalniz yazi-turadan belirgin iyi ve kosulsuzdan kotu degilse; degilse kosulsuz, o da iyi degilse beceri yok
    const kos=fin(bk)&&bk<BRIER&&(!fin(bu)||bk<=bu),b=kos||(fin(bu)&&bu<BRIER);beceri=beceri||b;
    const q=arr(kos?x.q:(x.qu||x.q)).map(num);
    vadeler[v]={gun,p:r3(num(kos?x.p:x.pu)),pKosullu:r3(num(x.p)),pKosulsuz:r3(num(x.pu)),q:q.length===3&&q.every(fin)?q.map(r2):null,
      n:num(kos?x.n:x.N),kosullu:kos,beceri:b}}
  if(!has(vadeler))return null;
  return {son:str(L.son,12),updatedAt:T(L.updatedAt),r20:num(o.r20),dilim:num(o.dilim),ust200:num(o.ust200),vadeler,
    not:beceri?null:'Geçmiş benzer durumlar yön tahmininde yazı-turadan iyi çıkmadı; aralık yalnız oynaklık bilgisi verir.'}}

function secimOf(sec,code,t){const S=obj(sec),at=T(S.updatedAt);if(!at||t-at>SECIM_MAX)return null;
  const z=arr(S.zayif).find(x=>x&&codeOf(x.kod)===code),g=z?null:arr(S.guclu).find(x=>x&&codeOf(x.kod)===code),x=z||g;if(!x)return null;
  const tur=z?'zayif':'guclu',grup=num(x.kural_sayisi)>1&&fin(num(x.grup_isabet));
  const tk=arr(S.gecmis).filter(s=>s&&codeOf(s.kod)===code&&s.tur===tur).pop()||null;
  return {tur,yon:z?-1:1,text:z?'1 ayda piyasadan (BIST 100) zayıf kalması bekleniyor':'1 ayda piyasadan (BIST 100) güçlü gitmesi bekleniyor',tarih:str(S.tarih,12),
    neden:str(x.neden),kosul:arr(x.kosul).map(String).slice(0,6),isabet:num(grup?x.grup_isabet:x.isabet),n:num(grup?x.grup_n:x.n),kuralSayisi:num(x.kural_sayisi),
    oy:str(x.oy,12),durum:has(x.durum)?x.durum:null,takip:tk?{tarih:str(tk.tarih,12),fiyat:num(tk.fiyat),ara:num(tk.ara),araGun:num(tk.ara_gun),sonuc:has(tk.sonuc)?tk.sonuc:null}:null,
    canli:has(obj(S.canli)[tur])?S.canli[tur]:null,updatedAt:at}}

function backtestOf(bt,code,t){const B=obj(bt),at=T(B.updatedAt);if(at&&t-at>SECIM_MAX)return null;const x=arr(B.bugun).find(b=>b&&codeOf(b.kod)===code);if(!x)return null;
  return {karar:kararOf(x.karar),vade:str(x.vade,8),hedef:str(x.hedef,16),kosul:arr(x.kosul).map(String).slice(0,6),isabet:num(x.isabet),n:num(x.n),
    kuralSayisi:num(x.kural_sayisi),rsi:num(x.rsi),donem:has(B.donem)?B.donem:null,updatedAt:at}}

function temelOf(tm,code){const M=obj(tm),x=obj(obj(M.hisseler)[code]);if(!has(x)||!('ozet' in x))return null;const p=num(x.puan);
  return {ceyrek:str(x.ceyrek,12),tarih:str(x.tarih,12),para:str(x.para,8),puan:p,karar:fin(p)?(p>=2?'AL':p<=-2?'SAT':'TUT'):null,ozet:str(x.ozet),
    oranlar:has(x.oranlar)?x.oranlar:null,satirlar:arr(x.satirlar).slice(0,8),marjlar:arr(x.marjlar).slice(0,6),sapmalar:arr(x.sapmalar).slice(0,10),
    updatedAt:T(M.updatedAt),kaynak:str(M.kaynak,80)}}

// data dali market.json satiri (TradingView): sutun adlarina gore
function marketRow(mk,code){const M=obj(mk),cols=arr(M.sutun),ik=cols.indexOf('k');if(ik<0)return null;const r=arr(M.hisseler).find(x=>Array.isArray(x)&&codeOf(x[ik])===code);
  if(!r)return null;const g=n=>{const i=cols.indexOf(n);return i<0?undefined:r[i]};const fiyat=pos(g('fiyat')),hacim=num(g('hacim'));
  return {ad:str(g('ad'),120),sektor:str(g('sektor'),60),fiyat,degisimYuzde:num(g('deg')),hacim,hacimTL:fiyat&&fin(hacim)?Math.round(fiyat*hacim):null,
    piyasaDegeri:num(g('pd')),tv:num(g('tv')),rsi:num(g('rsi')),hafta:num(g('h1')),ay:num(g('a1')),ay3:num(g('a3')),yilbasi:num(g('yb')),
    gunYuksek:num(g('yuk')),gunDusuk:num(g('dus')),updatedAt:T(M.updatedAt)}}

const etkiOf=d=>{d=num(d);return fin(d)?(d>=0.15?'olumlu':d<=-0.15?'olumsuz':'nötr'):null};
function haberlerFor(code,{gundem,genis,news,ad},t){const out=[],seen=new Set();
  const add=(baslik,zaman,kaynak,etki,url,yazi)=>{baslik=str(baslik,300);if(!baslik)return;const key=upN(baslik);if(seen.has(key))return;seen.add(key);
    out.push({baslik,zaman,kaynak:str(kaynak,80),etki:etki||null,url:typeof url==='string'&&/^https:\/\//.test(url)?url.slice(0,1000):null,yazi:str(yazi,20)})};
  for(const h of arr(obj(obj(obj(gundem).sirket)[code]).haberler))if(h)add(h.baslik,T(h.ts)||gunAy(h.zaman,t),h.kaynak,etkiOf(h.duygu),h.url,h.zaman);
  const g=obj(obj(obj(genis).hisseler)[code]),gt=T(g.ts);if(gt&&t-gt<GENIS_MAX)for(const h of arr(g.haber))if(h)add(h.baslik,gt,h.kaynak==='web'?null:h.kaynak,etkiOf(h.duygu),h.url,null);
  const words=[code,...(ALIAS[code]||[])].map(w=>upN(w).trim()).filter(Boolean),w0=upN(ad).trim().split(' ')[0];
  if(w0&&w0.length>=3&&!GENEL_AD.has(w0)&&!words.includes(w0))words.push(w0);
  for(const n of arr(obj(news).items)){if(!n||typeof n.title!=='string')continue;const u=upN(n.title);
    if(codeOf(n.sym)===code||words.some(w=>u.includes(' '+w+' ')))add(n.title,T(n.ts),n.kaynak,null,n.url,n.t)}
  out.sort((a,b)=>(b.zaman||0)-(a.zaman||0));return out.length?out.slice(0,10):null}

// Piyasa ozeti icin BIST 30 konsensus listesi (fiyatsiz: yalniz karar/skor/guven)
function consensusList(ai,genis,out,risk,t){const A=obj(ai),res=[];
  for(const code of Object.keys(obj(A.hisseler))){const c=codeOf(code);if(!c)continue;const cs=consensus(modelsFor(c,{ai:A,genis,out},t),{risk:obj(risk)[c]||null});
    if(cs)res.push({symbol:c,karar:cs.karar,skor:cs.skor,guven:cs.guven})}
  return res}

// --- ag + onbellek -----------------------------------------------------------------------------
const hdr=(r,n)=>{const h=r&&r.headers;if(!h)return null;if(typeof h.get==='function')return h.get(n);const k=Object.keys(h).find(x=>x.toLowerCase()===n);return k?h[k]:null};
function httpErr(s){return s===404?'Dosya bulunamadı (HTTP 404).':s===403||s===429?'GitHub istek sınırına takıldı (HTTP '+s+'); biraz sonra yeniden denenecek.':
  s>=500?'GitHub yanıt vermedi (HTTP '+s+').':'GitHub hata verdi (HTTP '+s+').'}

function createRadar({fetch=globalThis.fetch,now=()=>Date.now(),ttl=300000,base=BASE,timeout=12000,retryMs=60000}={}){
  base=String(base||BASE).replace(/\/+$/,'');
  const store={};
  const entry=n=>store[n]||(store[n]={data:null,etag:null,at:0,tried:0,ok:null,err:null,upd:null,stale:false,p:null});
  async function fetchFile(n){const [dal,yol]=FILES[n],e=entry(n),url=base+'/'+dal+'/'+yol;
    if(typeof fetch!=='function')throw new Error('Bu ortamda ağ erişimi yok.');
    const ctl=typeof AbortController==='function'?new AbortController():null;let tm;
    const run=(async()=>{let r;
      try{r=await fetch(url,{headers:{accept:'application/json',...(e.etag&&e.data?{'if-none-match':e.etag}:{})},signal:ctl?ctl.signal:undefined,cache:'no-store'})}
      catch(x){throw new Error(x&&x.name==='AbortError'?'Hisse Radar yanıt vermedi (zaman aşımı).':'Hisse Radar\'a bağlanılamadı.')}
      if(r.status===304&&e.data)return {same:true};
      if(!r.ok)throw new Error(httpErr(r.status));
      const tx=await r.text();if(typeof tx!=='string'||tx.length>MAX_BYTES)throw new Error('Dosya beklenenden büyük; okunmadı.');
      let j;try{j=JSON.parse(tx)}catch(x){throw new Error('Dosya okunamadı (geçersiz JSON).')}
      if(!j||typeof j!=='object'||Array.isArray(j))throw new Error('Dosya biçimi beklenmedik.');
      return {data:j,etag:hdr(r,'etag')}})();
    try{return await Promise.race([run,new Promise((_,no)=>{tm=setTimeout(()=>{try{ctl&&ctl.abort()}catch(x){}no(new Error('Hisse Radar yanıt vermedi (zaman aşımı).'))},timeout);if(tm&&tm.unref)tm.unref()})])}
    finally{clearTimeout(tm);run.catch(()=>{})}}
  // Dosya: taze onbellek -> dogrudan; degilse (ETag ile) iste; hata -> eski veri (stale) ya da hata firlat
  function load(n){const e=entry(n),t=now();
    if(e.data&&e.ok&&t-e.at<ttl)return Promise.resolve({data:e.data,stale:false});
    if(e.ok===false&&t-e.tried<retryMs){if(e.data)return Promise.resolve({data:e.data,stale:true});return Promise.reject(new Error(e.err))}
    if(e.p)return e.p;
    e.p=(async()=>{e.tried=now();
      try{const r=await fetchFile(n),t2=now();if(!r.same){e.data=r.data;e.etag=typeof r.etag==='string'&&r.etag?r.etag:null;e.upd=T(r.data.updatedAt)||T(r.data.zaman)}
        e.at=t2;e.ok=true;e.err=null;e.stale=false;return {data:e.data,stale:false}}
      catch(x){e.ok=false;e.err=String(x&&x.message||x);if(e.data){e.stale=true;return {data:e.data,stale:true}}throw x}
      finally{e.p=null}})();
    return e.p}
  async function loadMany(names){const rs=await Promise.all(names.map(n=>load(n).then(r=>r,()=>null)));const o={};let stale=false,any=false;
    names.forEach((n,i)=>{o[n]=rs[i]?rs[i].data:null;if(rs[i]){any=true;stale=stale||rs[i].stale}});return {d:o,stale,any}}
  const errs=()=>Object.keys(FILES).filter(n=>store[n]&&store[n].ok===false).map(n=>FILES[n][1].replace(/^data\//,'')+': '+store[n].err);

  async function forSymbol(code){const c=codeOf(code);if(!c)return null;
    const {d,stale,any}=await loadMany(SYM_FILES);if(!any)throw new Error('Hisse Radar verisi alınamadı: '+(errs()[0]||'bağlantı yok.'));
    const t=now(),risk=obj(obj(obj(d.secim).riskli).hisse)[c],mk=marketRow(d.market,c);
    const models=modelsFor(c,{ai:d.ai,genis:d.ai_genis,out:d.outlook},t);
    const rk=str(risk)?{neden:str(risk),kaynak:'Hisse Radar risk listesi (elle doğrulanmış + haberlerden)'}:null;
    const out={symbol:c,ad:mk&&mk.ad,sektor:mk&&mk.sektor,updatedAt:null,veriZamani:null,models,
      consensus:consensus(models,{price:mk&&mk.fiyat,risk:rk}),outlook:outlookOf(d.outlook,c,t),olasilik:olasilikOf(d.olasilik,c,t),
      secim:secimOf(d.secim,c,t),backtest:backtestOf(d.backtest,c,t),risk:rk,temel:temelOf(d.temel,c),haberler:null,haberAi:null,sektorEtkisi:null,piyasa:mk,stale};
    if(!models.length&&!out.outlook&&!out.olasilik&&!out.secim&&!out.backtest&&!rk&&!out.temel)return null;     // kapsam disi
    const src=models[0];
    if(src&&src.kaynak==='ai'){out.updatedAt=T(obj(d.ai).updatedAt);out.veriZamani=str(obj(d.ai).veri,40)}
    else if(src){out.updatedAt=src.zaman;out.veriZamani=new Date(src.zaman).toISOString()}
    else out.updatedAt=[out.olasilik,out.temel,out.secim].map(x=>x&&x.updatedAt).find(fin)||null;
    out.haberler=haberlerFor(c,{gundem:d.gundem,genis:d.ai_genis,news:d.news,ad:mk&&mk.ad},t);
    const ha=obj(obj(d.gundem).haber_ai),hz=T(ha.zaman)||T(ha.ts);
    if(hz&&t-hz<=HABER_AI_MAX){const hx=obj(obj(ha.hisseler)[c]);if(str(hx.etki,20))out.haberAi={etki:str(hx.etki,20),onem:num(hx.onem),neden:str(hx.neden),zaman:hz};
      const sx=mk&&mk.sektor?arr(ha.sektorler).find(s=>s&&s.sektor===mk.sektor):null;if(sx)out.sektorEtkisi={sektor:sx.sektor,etki:str(sx.etki,20),onem:num(sx.onem),neden:str(sx.neden),zaman:hz}}
    return out}

  async function market(){const {d,stale,any}=await loadMany(MKT_FILES);if(!any)return null;const t=now(),A=obj(d.ai),G=obj(d.ai_genis);
    const modeller=[...arr(A.modeller).map(m=>({m,kapsam:'BIST 30'})),...arr(G.modeller).map(m=>({m,kapsam:'Geniş tarama'}))].filter(x=>x.m&&str(x.m.id,40)).map(({m,kapsam})=>({
      id:m.id,ad:str(m.ad,60)||m.id,model:str(m.model,80),durum:str(m.durum,12)||'ok',isabet:isabetOf(A,m.id),kapsam,hata:m.durum==='hata'||m.durum==='eski'?str(m.hata,120):null}));
    const GU=obj(d.gundem),ha=obj(GU.haber_ai),mak=obj(GU.makro);
    const gundem=has(GU)?{havasi:str(ha.piyasa_havasi,20),ozet:str(ha.ozet,1200),sektorler:arr(ha.sektorler).slice(0,12),hisseler:has(ha.hisseler)?ha.hisseler:{},
      zaman:T(ha.zaman)||T(ha.ts),makro:arr(mak.seriler).slice(0,8),piyasaOzet:str(obj(GU.piyasa).ozet,1500),updatedAt:T(GU.updatedAt)}:null;
    const E=obj(obj(d.endeksler).endeksler),endeksler={};
    for(const [k,v] of Object.entries(E)){const hs=arr(obj(v).hisseler).map(codeOf).filter(Boolean);if(hs.length)endeksler[k]={ad:str(v.ad,40)||k,hisseler:hs,n:hs.length}}
    // Yukselis/dusus beklentisi: taze secim.json (gecmis testte dogrulanmis kurallar + yapay zeka), yoksa taze Claude beklentisi
    const S=obj(d.secim),O=obj(d.outlook),st=T(S.updatedAt),ot=T(O.updatedAt);let ozet={yukselis:[],dusus:[],kaynak:null};
    if(st&&t-st<=SECIM_MAX)ozet={yukselis:arr(S.guclu).map(x=>codeOf(x&&x.kod)).filter(Boolean),dusus:arr(S.zayif).map(x=>codeOf(x&&x.kod)).filter(Boolean),kaynak:'secim'};
    if(!ozet.yukselis.length&&!ozet.dusus.length&&ot&&t-ot<=OUTLOOK_MAX)ozet={yukselis:arr(O.yukselis).map(x=>codeOf(x&&x.sembol)).filter(Boolean),dusus:arr(O.dusus).map(x=>codeOf(x&&x.sembol)).filter(Boolean),kaynak:'outlook'};
    const cl=consensusList(A,G,O,obj(S.riskli).hisse,t).sort((a,b)=>b.skor-a.skor||(a.symbol<b.symbol?-1:1));
    ozet.al=cl.filter(x=>x.karar==='AL');ozet.sat=cl.filter(x=>x.karar==='SAT').reverse();ozet.dagilim={AL:ozet.al.length,TUT:cl.length-ozet.al.length-ozet.sat.length,SAT:ozet.sat.length};
    ozet.riskli=Object.keys(obj(obj(S.riskli).hisse)).map(codeOf).filter(Boolean);
    const neden=h=>!h?'.':/\b429\b|rate.?limit/i.test(h)?': kullanım sınırı doldu (429).':/\b40[13]\b|unauthor|invalid.?api/i.test(h)?': anahtar geçersiz ya da yetkisiz.':': '+h.slice(0,100);
    const hatalar=[...errs(),...modeller.filter(m=>m.durum==='hata').map(m=>m.ad+' ('+m.kapsam+') çalışmadı'+neden(m.hata))];
    return {updatedAt:T(A.updatedAt),veriZamani:str(A.veri,40),modeller,gundem,endeksler,ozet,hatalar,stale}}

  // Durum: dosya basina son basarili indirme (at), son denemenin sonucu (ok), eski veri kullaniliyor mu; updatedAt = ai.json'un (yoksa en yeni dosyanin) zamani
  function status(){const files={};let upd=null;
    for(const n of Object.keys(FILES)){const e=store[n];if(!e||!(e.tried||e.at))continue;files[n]={at:e.at||null,ok:e.ok,stale:e.stale,updatedAt:e.upd,error:e.err};if(e.upd)upd=Math.max(upd||0,e.upd)}
    const er=errs();return {ok:Object.keys(files).length>0&&!er.length,updatedAt:(store.ai&&store.ai.upd)||upd,errors:er,files}}

  return {forSymbol,market,status,_load:load}}

module.exports={createRadar,consensus,FILES,BASE,_util:{modelsFor,outlookOf,olasilikOf,secimOf,backtestOf,temelOf,marketRow,haberlerFor,isabetOf,codeOf,gunAy,consensusList}};
