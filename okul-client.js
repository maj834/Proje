// Borsa Okulu istemcisi (ana surec). Icerik Supabase'teki public.okul_icerik tablosundan (yalniz okuma, anon anahtar + RLS) gelir;
// icerigi Hisse deposundaki (maj834/Hisse) okul botu ucretsiz yapay zeka API'leriyle uretip okul-ingest edge function'i ile yazar.
// Bu modul hicbir anahtar uretmez/loglamaz: anon anahtar (herkese acik, RLS ile yalniz SELECT yayinda=true) disaridan verilir.
//
// createOkul({fetch, now, dir, url, anon, ai, open, rand, ttl, timeout}) ->
//   list({tur, konu?, seviye?, limit=30, before?}) -> {ok, items:[{slug,tur,baslik,ozet,seviye,konu,etiketler,semboller,tarih,sira,video_url}], stale?}
//       ders: mufredat sirasi (sira artan), before = sira (bundan sonrakiler); diger turler: tarih azalan, before = 'YYYY-MM-DD' (bundan eskiler)
//   get(slug) -> {ok, item (govde dahil), stale?}
//   today() -> {ok, tarih, sabah?, aksam?, ders?, sorular:[...3], stale?}  bugunun icerigi, yoksa en sonuncusu
//   quiz({n=10, konu?}) -> {ok, sorular:[{slug,soru,secenekler,zorluk,konu,ders_slug,tarih}]}  (dogru cevap ve aciklama gonderilmez)
//   answer(slug, secim) -> {ok, dogru, cevap, aciklama, ders_slug, istatistik}   (puanlama burada; ilerleme diske yazilir)
//   progress() -> {okunan:[slug], quiz:{toplam,dogru,seri,enIyi,konular:{konu:{n,dogru}}}, gun:{seri,son}, son:{slug,t}|null}
//   markRead(slug) -> {ok, okunan}; sozluk({q?}) -> {ok, items:[{slug,terim,tanim,ornek,konu}]}
//   ask(soru, {baglam?, gecmis?}) -> {ok, cevap} : enjekte ai({system:OGRETMEN_PROMPT, user}) (uygulamanin Groq/Claude anahtari) ile
//   call(op, args) : arayuz koprusu (bp-okul.js api.okul(op,args)); op: list|get|today|quiz|answer|progress|markRead|sozluk|ask|open
// REST: GET {url}/rest/v1/okul_icerik?select=..&tur=eq.ders&order=sira.asc  basliklar apikey + Authorization: Bearer <anon>.
// Onbellek: bellek (ttl) + disk (dir/okul-onbellek.json): ag yoksa son basarili yanit stale:true ile doner (cevrimdisi calisir).
// Ilerleme: dir/okul-ilerleme.json (yerel; atomik yazim). Hata metinleri Turkce. Yatirim tavsiyesi degildir.
'use strict';
const fsp=require('fs').promises,path=require('path');

const TURLER=['analiz','ders','soru','sozluk','video'];
const SEVIYELER=['baslangic','orta','ileri'];
const KONULAR=['temel-kavramlar','teknik','temel','risk','psikoloji','makro','bist-kurallari','strateji','vergi-maliyet','genel'];
const SLUG_RE=/^[a-z0-9-]{3,120}$/;
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const LIST_COLS='slug,tur,baslik,ozet,seviye,konu,etiketler,semboller,tarih,sira,video_url';
const FULL_COLS=LIST_COLS+',govde,kaynaklar,video_meta,model,updated_at';
const CACHE_FILE='okul-onbellek.json',PROG_FILE='okul-ilerleme.json';
const CACHE_MAX=400;          // disk onbellegindeki en fazla anahtar (en eskiler atilir)
const ANS_MAX=3000;           // ilerlemede saklanan en fazla soru cevabi
const ASK_MAX=2000,CTX_MAX=6000;

const OGRETMEN_PROMPT=[
'Sen "Borsa Okulu"nun öğretmenisin: Borsa İstanbul (BIST) konusunda tarihin en iyi, en sabırlı ve en sevilen borsa öğretmeni.',
'Karşındaki kişi Türkiye\'de yaşayan, BIST\'te işlem yapan ya da öğrenmeye çalışan bireysel bir yatırımcı. Her seviyeden olabilir; önce seviyesini sorudan sez.',
'',
'ÜSLUBUN',
'- Sıcak, cesaretlendirici ve saygılı ol; asla küçümseme. "Güzel soru" klişesiyle değil, sorunun neden önemli olduğunu göstererek başla.',
'- Sokratik öğret: cevabı hazır vermek yerine önce sezgiyi kur, sonra kavramı adlandır, ardından somut bir BIST örneğiyle pekiştir.',
'  Cevabın sonunda öğrencinin anladığını kendi kendine sınayabileceği TEK kısa soru sor (ör. "Sence bu durumda ... ne olurdu?").',
'- Önce sade anlatım, sonra gerekirse formül. Terimi ilk kullandığında parantez içinde bir cümleyle tanımla.',
'- Kısa paragraflar ve gerektiğinde madde işaretleri kullan; 250-400 kelimeyi geçme. Düz metin yaz; yalnız **kalın** ve "- " maddeleri kullan.',
'- Her zaman Türkçe, akıcı ve doğal yaz.',
'',
'BIST\'E ÖZGÜ BİLGİ (uygun düştükçe kullan)',
'- Seanslar: açılış seansı (emir toplama, tek fiyat), sürekli işlem, kapanış seansı; öğle arası yok. Saatleri kesin bilmiyorsan "Borsa İstanbul\'un güncel seans saatleri" de.',
'- Fiyat adımları (kademe): fiyat aralığına göre değişen en küçük fiyat aralığı; emir fiyatı kademeye uymalı.',
'- Günlük fiyat limitleri (taban/tavan), devre kesici (fiyat ani ve sert hareket edince işlemlerin geçici durması), T+2 takas (hisse ve paranın 2 iş günü sonra el değiştirmesi).',
'- SPK/Borsa İstanbul VBTS tedbirleri: brüt takas, kredili işlem ve açığa satış yasağı, tek fiyat yöntemi, emir paketi; tedbirli hissede likidite ve oynaklık riskini anlat.',
'- Maliyetler: aracı kurum komisyonu, BSMV, stopaj. Oranlar değişebildiği için güncel oranı aracı kurumdan/GİB\'den teyit etmesini öner.',
'- Türkiye bağlamı: yüksek enflasyonda nominal ve reel getiri farkı, TL\'nin değer kaybı, faiz kararları (TCMB PPK), TMS 29 enflasyon muhasebesi, bedelli/bedelsiz sermaye artırımı, temettü.',
'- Endeksler: XU100, XU030, sektör endeksleri; yabancı payı, açığa satış, kredili işlem gibi göstergeler.',
'',
'KESİN KURALLAR',
'- ASLA doğrudan al/sat/tut tavsiyesi verme, hedef fiyat söyleme, "şu hisse yükselir" deme. "X alayım mı?" sorusunda kararı onun yerine verme;',
'  bunun yerine o kararı vermek için bakması gerekenleri öğret (vade, risk bütçesi, pozisyon büyüklüğü, zarar-kes, temel/teknik kontrol listesi) ve kararın kendisine ait olduğunu nazikçe hatırlat.',
'- Sayıları uydurma. Fiyat, oran, tarih gibi verileri yalnız sana BAĞLAM olarak verilenlerden kullan; bağlamda yoksa "elimdeki veride yok" de ve genel ilkeyi anlat.',
'- Emin olmadığın mevzuat ayrıntısında kesin konuşma; resmi kaynağa (Borsa İstanbul, SPK, KAP, MKK) yönlendir.',
'- Kaldıraç, kredili işlem, VİOP, kripto gibi yüksek riskli konularda risk bilincini mutlaka vurgula. Borçla yatırım, "garanti kazanç", "kesin sinyal" söylemlerine karşı uyar.',
'- Duygusal zorlanma (büyük zarar, panik) sezersen önce sakinleştir, sonra öğret; kayıp kovalamanın (intikam işlemi) tehlikesini anlat.',
'- Belirli bir hisseden söz ettiğinde cevabın sonuna ayrı bir satır olarak "Yatırım tavsiyesi değildir." ekle.'
].join('\n');

const fin=v=>typeof v==='number'&&Number.isFinite(v);
const str=(v,max=4000)=>typeof v==='string'?v.trim().slice(0,max):'';
const arr=v=>Array.isArray(v)?v:[];
// Istanbul tarihi (Turkiye 2016'dan beri sabit UTC+3)
const isoDay=t=>new Date(t+3*3600000).toISOString().slice(0,10);
const trLow=s=>String(s||'').replace(/İ/g,'i').replace(/I/g,'ı').toLocaleLowerCase('tr-TR');
// arama icin: Turkce harfleri sadelestir (ı->i, ş->s ...) ki "sermaye artirimi" da bulsun
const fold=s=>trLow(s).replace(/̇/g,'').replace(/ı/g,'i').replace(/ş/g,'s').replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ö/g,'o').replace(/ç/g,'c').replace(/â/g,'a').replace(/î/g,'i').replace(/û/g,'u');
const isHttps=u=>{try{const x=new URL(String(u));return x.protocol==='https:'&&!!x.hostname}catch{return false}};

function pickList(r){
  return {slug:r.slug,tur:r.tur,baslik:str(r.baslik,200),ozet:str(r.ozet,1000)||null,seviye:r.seviye||null,konu:r.konu||null,
    etiketler:arr(r.etiketler).filter(x=>typeof x==='string'),semboller:arr(r.semboller).filter(x=>typeof x==='string'),
    tarih:r.tarih||null,sira:fin(r.sira)?r.sira:null,video_url:isHttps(r.video_url)?r.video_url:null};
}
function pickFull(r){
  const g=r.govde&&typeof r.govde==='object'&&!Array.isArray(r.govde)?r.govde:{};
  return {...pickList(r),govde:g,kaynaklar:arr(r.kaynaklar).filter(k=>k&&isHttps(k.url)).map(k=>({ad:str(k.ad,200)||k.url,url:k.url})),
    video_meta:r.video_meta&&typeof r.video_meta==='object'?r.video_meta:null,model:r.model||null,updated_at:r.updated_at||null};
}
// soru satirini dogrula: 4 secenek, dogru 0-3
function soruOk(r){const g=r&&r.govde;return !!(g&&typeof g.soru==='string'&&Array.isArray(g.secenekler)&&g.secenekler.length>=2&&Number.isInteger(g.dogru)&&g.dogru>=0&&g.dogru<g.secenekler.length)}
// arayuze giden soru: dogru ve aciklama YOK (cevap answer() ile gelir)
function publicSoru(r){const g=r.govde;
  return {slug:r.slug,soru:str(g.soru,1000),secenekler:g.secenekler.map(s=>str(String(s),400)),zorluk:fin(g.zorluk)?g.zorluk:null,
    konu:r.konu||null,seviye:r.seviye||null,ders_slug:SLUG_RE.test(g.ders_slug||'')?g.ders_slug:null,tarih:r.tarih||null}}

function emptyProgress(){return {v:1,okunan:[],quiz:{toplam:0,dogru:0,seri:0,enIyi:0,konular:{}},cevaplar:{},gun:{seri:0,son:null},son:null}}
function normProgress(p){
  const e=emptyProgress();if(!p||typeof p!=='object')return e;
  const q=p.quiz&&typeof p.quiz==='object'?p.quiz:{};
  const n=v=>fin(v)&&v>=0?Math.floor(v):0;
  const konular={};for(const [k,v] of Object.entries(q.konular||{}))if(v&&typeof v==='object')konular[k]={n:n(v.n),dogru:Math.min(n(v.dogru),n(v.n))};
  return {v:1,okunan:[...new Set(arr(p.okunan).filter(s=>SLUG_RE.test(s)))],
    quiz:{toplam:n(q.toplam),dogru:Math.min(n(q.dogru),n(q.toplam)),seri:n(q.seri),enIyi:Math.max(n(q.enIyi),n(q.seri)),konular},
    cevaplar:p.cevaplar&&typeof p.cevaplar==='object'?p.cevaplar:{},
    gun:{seri:n(p.gun&&p.gun.seri),son:p.gun&&DATE_RE.test(p.gun.son||'')?p.gun.son:null},
    son:p.son&&SLUG_RE.test(p.son.slug||'')?{slug:p.son.slug,t:fin(p.son.t)?p.son.t:0}:null};
}

function createOkul({fetch=globalThis.fetch,now=()=>Date.now(),dir=null,url='',anon='',ai=null,open=null,rand=Math.random,ttl=600000,timeout=12000}={}){
  const base=String(url||'').replace(/\/+$/,'');
  const mem=new Map();            // anahtar -> {at, data}
  let disk=null,diskLoad=null,prog=null,progLoad=null,saveQ=Promise.resolve();
  const inflight=new Map();

  // ---- disk ----
  async function readJson(f){if(!dir)return null;try{return JSON.parse(await fsp.readFile(path.join(dir,f),'utf8'))}catch{return null}}
  function writeJson(f,obj){
    if(!dir)return Promise.resolve();
    // yazimlar sirayla; tmp + rename ile atomik (yarim dosya kalmasin)
    saveQ=saveQ.then(async()=>{const p=path.join(dir,f),tmp=p+'.'+process.pid+'.tmp';
      try{await fsp.mkdir(dir,{recursive:true});await fsp.writeFile(tmp,JSON.stringify(obj));await fsp.rename(tmp,p)}catch{try{await fsp.unlink(tmp)}catch{}}});
    return saveQ;
  }
  async function loadDisk(){if(disk)return disk;if(!diskLoad)diskLoad=readJson(CACHE_FILE).then(d=>{disk=d&&typeof d==='object'&&d.v===1&&d.k?d:{v:1,k:{}};return disk});return diskLoad}
  async function loadProg(){if(prog)return prog;if(!progLoad)progLoad=readJson(PROG_FILE).then(d=>{prog=normProgress(d);return prog});return progLoad}
  const saveProg=()=>writeJson(PROG_FILE,prog);
  async function putDisk(key,data){
    const d=await loadDisk();d.k[key]={at:now(),data};
    const ks=Object.keys(d.k);if(ks.length>CACHE_MAX){ks.sort((a,b)=>d.k[a].at-d.k[b].at);for(const k of ks.slice(0,ks.length-CACHE_MAX))delete d.k[k]}
    return writeJson(CACHE_FILE,d);
  }

  // ---- REST ----
  async function rest(qs){
    if(!base||!anon)throw new Error('yapilandirma');
    const ctl=typeof AbortController==='function'?new AbortController():null;
    const tm=ctl?setTimeout(()=>ctl.abort(),timeout):null;
    try{
      const r=await fetch(base+'/rest/v1/okul_icerik?'+qs,{headers:{apikey:anon,Authorization:'Bearer '+anon,Accept:'application/json'},signal:ctl?ctl.signal:undefined});
      if(!r||!r.ok){const e=new Error('http');e.status=r&&r.status;throw e}
      const j=await r.json();
      if(!Array.isArray(j))throw new Error('bicim');
      return j;
    }finally{if(tm)clearTimeout(tm)}
  }
  function errText(e){
    if(!e)return 'Borsa Okulu içeriği alınamadı.';
    if(e.message==='yapilandirma')return 'Borsa Okulu bağlantısı yapılandırılmamış (Supabase adresi/anahtarı yok).';
    if(e.status===401||e.status===403)return 'Borsa Okulu içeriğine erişim reddedildi (anahtar geçersiz).';
    if(e.status===404)return 'Borsa Okulu tablosu bulunamadı.';
    if(e.status>=500)return 'Borsa Okulu sunucusu şu an yanıt vermiyor. Biraz sonra tekrar dene.';
    if(e.name==='AbortError')return 'Borsa Okulu zaman aşımına uğradı. İnternet bağlantını kontrol et.';
    if(e.message==='bicim')return 'Borsa Okulu beklenmeyen bir yanıt döndürdü.';
    return 'Borsa Okulu\'na ulaşılamadı. İnternet bağlantını kontrol et.';
  }
  // onbellekli sorgu: taze bellek -> ag -> (hata) disk/bellek eski kopya stale:true
  async function cached(key,qs,{force=false}={}){
    const m=mem.get(key);
    if(!force&&m&&now()-m.at<ttl)return {ok:true,rows:m.data};
    if(inflight.has(key))return inflight.get(key);
    const p=(async()=>{
      try{const rows=await rest(qs);mem.set(key,{at:now(),data:rows});await putDisk(key,rows);return {ok:true,rows}}
      catch(e){
        const old=m||(await loadDisk()).k[key];
        if(old&&Array.isArray(old.data)){if(!m)mem.set(key,{at:0,data:old.data});return {ok:true,rows:old.data,stale:true,at:old.at,uyari:errText(e)}}
        return {ok:false,error:errText(e)};
      }finally{inflight.delete(key)}
    })();
    inflight.set(key,p);return p;
  }
  const out=(r,extra)=>{const o={ok:true,...extra};if(r.stale){o.stale=true;o.uyari=r.uyari;if(fin(r.at))o.at=r.at}return o};
  const staleOf=(...rs)=>rs.some(r=>r&&r.stale);

  // ---- okuma ----
  async function list({tur,konu,seviye,limit=30,before,force}={}){
    if(!TURLER.includes(tur))return {ok:false,error:'Geçersiz içerik türü.'};
    if(konu!=null&&konu!==''&&!KONULAR.includes(konu))return {ok:false,error:'Geçersiz konu.'};
    if(seviye!=null&&seviye!==''&&!SEVIYELER.includes(seviye))return {ok:false,error:'Geçersiz seviye.'};
    const lim=Math.max(1,Math.min(500,Math.floor(+limit)||30));
    let q='select='+LIST_COLS+'&yayinda=eq.true&tur=eq.'+tur;
    if(konu)q+='&konu=eq.'+konu;if(seviye)q+='&seviye=eq.'+seviye;
    if(tur==='ders'){if(before!=null&&before!==''){const b=Math.floor(+before);if(!Number.isFinite(b))return {ok:false,error:'Geçersiz sayfa.'};q+='&sira=gt.'+b}
      q+='&order=sira.asc.nullslast,tarih.asc'}
    else{if(before!=null&&before!==''){if(!DATE_RE.test(String(before)))return {ok:false,error:'Geçersiz tarih.'};q+='&tarih=lt.'+before}
      q+='&order=tarih.desc,slug.desc'}
    q+='&limit='+lim;
    const r=await cached('list:'+q,q,{force});
    if(!r.ok)return r;
    return out(r,{items:r.rows.filter(x=>x&&SLUG_RE.test(x.slug||'')).map(pickList)});
  }
  async function get(slug,{force}={}){
    if(!SLUG_RE.test(String(slug||'')))return {ok:false,error:'Geçersiz içerik kimliği.'};
    const q='select='+FULL_COLS+'&yayinda=eq.true&slug=eq.'+slug+'&limit=1';
    const r=await cached('get:'+slug,q,{force});
    if(!r.ok)return r;
    if(!r.rows.length)return {ok:false,error:'İçerik bulunamadı.'};
    return out(r,{item:pickFull(r.rows[0])});
  }
  // tam satirlar (govde dahil) - bugun ekrani, quiz havuzu, sozluk
  async function fullRows(tur,extra,lim,key){
    const q='select='+FULL_COLS+'&yayinda=eq.true&tur=eq.'+tur+(extra||'')+'&limit='+lim;
    return cached(key||('full:'+q),q);
  }
  async function today(){
    const bugun=isoDay(now());
    const [an,so,de]=await Promise.all([
      fullRows('analiz','&order=tarih.desc,slug.desc',6,'today:analiz'),
      fullRows('soru','&order=tarih.desc,slug.asc',30,'today:soru'),
      list({tur:'ders',limit:500})]);
    if(!an.ok&&!so.ok&&!de.ok)return {ok:false,error:an.error};
    const res={ok:true,tarih:bugun,sorular:[]};
    if(an.ok&&an.rows.length){
      const rows=an.rows.filter(x=>x&&SLUG_RE.test(x.slug||''));
      const gun=rows.some(x=>x.tarih===bugun)?bugun:rows[0]&&rows[0].tarih;
      const g=rows.filter(x=>x.tarih===gun);
      const sab=g.find(x=>/-sabah$/.test(x.slug)),aks=g.find(x=>/-aksam$/.test(x.slug));
      if(sab)res.sabah=pickFull(sab);if(aks)res.aksam=pickFull(aks);
      if(!sab&&!aks&&g[0])res[/sabah/.test(g[0].slug)?'sabah':'aksam']=pickFull(g[0]);
    }
    if(so.ok){
      const rows=so.rows.filter(soruOk);const gun=rows.some(x=>x.tarih===bugun)?bugun:rows[0]&&rows[0].tarih;
      const p=await loadProg();
      // gunun sorulari: once henuz cevaplanmamislar, sonra digerleri; en fazla 3
      const g=rows.filter(x=>x.tarih===gun);const yeni=g.filter(x=>!p.cevaplar[x.slug]),eski=g.filter(x=>p.cevaplar[x.slug]);
      res.sorular=[...yeni,...eski].slice(0,3).map(publicSoru);
      for(const x of rows)soruCache.set(x.slug,x);
    }
    if(de.ok&&de.items.length){
      const p=await loadProg(),ok=new Set(p.okunan);
      const bug=de.items.filter(x=>x.tarih===bugun);
      res.ders=bug.length?bug[bug.length-1]:(de.items.find(x=>!ok.has(x.slug))||de.items[de.items.length-1]);
      res.dersToplam=de.items.length;res.dersOkunan=de.items.filter(x=>ok.has(x.slug)).length;
    }
    if(staleOf(an,so,de)){res.stale=true;res.uyari=[an,so,de].find(r=>r&&r.stale).uyari}
    return res;
  }

  // ---- quiz ----
  const soruCache=new Map();     // slug -> tam soru satiri (answer icin)
  async function quiz({n=10,konu}={}){
    if(konu!=null&&konu!==''&&!KONULAR.includes(konu))return {ok:false,error:'Geçersiz konu.'};
    const k=Math.max(1,Math.min(50,Math.floor(+n)||10));
    const r=await fullRows('soru',(konu?'&konu=eq.'+konu:'')+'&order=tarih.desc,slug.asc',300);
    if(!r.ok)return r;
    const pool=r.rows.filter(soruOk);for(const x of pool)soruCache.set(x.slug,x);
    if(!pool.length)return out(r,{sorular:[]});
    const p=await loadProg();
    // oncelik: hic cevaplanmamis > yanlis cevaplanmis > dogru cevaplanmis; grup ici karisik
    const shuf=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
    const yeni=[],yanlis=[],dogru=[];
    for(const x of pool){const c=p.cevaplar[x.slug];(!c?yeni:c.d?dogru:yanlis).push(x)}
    const sec=[...shuf(yeni),...shuf(yanlis),...shuf(dogru)].slice(0,k);
    return out(r,{sorular:sec.map(publicSoru)});
  }
  async function findSoru(slug){
    if(soruCache.has(slug))return {ok:true,row:soruCache.get(slug)};
    const g=await get(slug);if(!g.ok)return g;
    if(g.item.tur!=='soru'||!soruOk(g.item))return {ok:false,error:'Bu içerik bir soru değil.'};
    return {ok:true,row:g.item};
  }
  function bump(p,d){
    const t=now(),gun=isoDay(t);
    if(p.gun.son!==gun){const dun=isoDay(t-86400000);p.gun.seri=p.gun.son===dun?p.gun.seri+1:1;p.gun.son=gun}
    if(d)p.son={slug:d,t};
  }
  async function answer(slug,secim){
    if(!SLUG_RE.test(String(slug||'')))return {ok:false,error:'Geçersiz soru.'};
    const s=Number(secim);
    const f=await findSoru(slug);if(!f.ok)return f;
    const g=f.row.govde;
    if(!Number.isInteger(s)||s<0||s>=g.secenekler.length)return {ok:false,error:'Geçersiz seçenek.'};
    const p=await loadProg(),dogru=s===g.dogru,konu=f.row.konu||'genel',q=p.quiz;
    q.toplam++;if(dogru){q.dogru++;q.seri++;q.enIyi=Math.max(q.enIyi,q.seri)}else q.seri=0;
    const kk=q.konular[konu]||(q.konular[konu]={n:0,dogru:0});kk.n++;if(dogru)kk.dogru++;
    p.cevaplar[slug]={s,d:dogru,t:now()};
    const ks=Object.keys(p.cevaplar);if(ks.length>ANS_MAX){ks.sort((a,b)=>p.cevaplar[a].t-p.cevaplar[b].t);for(const k of ks.slice(0,ks.length-ANS_MAX))delete p.cevaplar[k]}
    bump(p);await saveProg();
    return {ok:true,dogru,cevap:g.dogru,aciklama:str(g.aciklama,2000)||null,ders_slug:SLUG_RE.test(g.ders_slug||'')?g.ders_slug:null,istatistik:statOf(p)};
  }
  function statOf(p){const q=p.quiz;return {toplam:q.toplam,dogru:q.dogru,oran:q.toplam?Math.round(q.dogru/q.toplam*100):null,seri:q.seri,enIyi:q.enIyi,
    konular:Object.fromEntries(Object.entries(q.konular).map(([k,v])=>[k,{n:v.n,dogru:v.dogru,oran:v.n?Math.round(v.dogru/v.n*100):null}]))}}
  async function progress(){
    const p=await loadProg();
    // gun serisi: son etkinlik dun ya da bugun degilse kirilmistir
    const t=now(),gs=p.gun.son===isoDay(t)||p.gun.son===isoDay(t-86400000)?p.gun.seri:0;
    return {ok:true,okunan:[...p.okunan],quiz:statOf(p),gun:{seri:gs,son:p.gun.son},son:p.son?{...p.son}:null};
  }
  async function markRead(slug){
    if(!SLUG_RE.test(String(slug||'')))return {ok:false,error:'Geçersiz içerik kimliği.'};
    const p=await loadProg();if(!p.okunan.includes(slug))p.okunan.push(slug);
    bump(p,slug);await saveProg();
    return {ok:true,okunan:[...p.okunan]};
  }
  async function sozluk({q}={}){
    const r=await fullRows('sozluk','&order=baslik.asc',1000,'sozluk');
    if(!r.ok)return r;
    let items=r.rows.filter(x=>x&&SLUG_RE.test(x.slug||'')).map(x=>{const g=x.govde&&typeof x.govde==='object'?x.govde:{};
      return {slug:x.slug,terim:str(g.terim,200)||str(x.baslik,200),tanim:str(g.tanim,3000)||str(x.ozet,1000),ornek:str(g.ornek,2000)||null,konu:x.konu||null}}).filter(x=>x.terim);
    const s=fold(str(q,100));
    if(s){const sc=x=>{const t=fold(x.terim);return t===s?0:t.startsWith(s)?1:t.includes(s)?2:fold(x.tanim).includes(s)?3:9};
      items=items.map(x=>[sc(x),x]).filter(a=>a[0]<9).sort((a,b)=>a[0]-b[0]||a[1].terim.localeCompare(b[1].terim,'tr')).map(a=>a[1])}
    else items.sort((a,b)=>a.terim.localeCompare(b.terim,'tr'));
    return out(r,{items});
  }

  // ---- ogretmene sor ----
  function ctxText(b){
    if(!b)return '';
    if(typeof b==='string')return b.slice(0,CTX_MAX);
    try{return JSON.stringify(b,(k,v)=>typeof v==='string'?v.slice(0,1500):v).slice(0,CTX_MAX)}catch{return ''}
  }
  async function ask(soru,{baglam,gecmis}={}){
    const s=str(soru,ASK_MAX+1);
    if(!s)return {ok:false,error:'Önce bir soru yaz.'};
    if(s.length>ASK_MAX)return {ok:false,error:'Soru çok uzun (en fazla '+ASK_MAX+' karakter).'};
    if(typeof ai!=='function')return {ok:false,error:'Öğretmen için yapay zekâ anahtarı tanımlı değil (Ayarlar\'dan Groq ya da Claude anahtarı ekle).'};
    const parts=[];
    const ctx=ctxText(baglam);if(ctx)parts.push('BAĞLAM (yalnız buradaki sayıları kullan):\n'+ctx);
    const h=arr(gecmis).filter(m=>m&&typeof m.metin==='string'&&m.metin.trim()).slice(-6)
      .map(m=>(m.rol==='a'?'Öğretmen: ':'Öğrenci: ')+m.metin.trim().slice(0,1500));
    if(h.length)parts.push('ÖNCEKİ KONUŞMA:\n'+h.join('\n'));
    parts.push('ÖĞRENCİNİN SORUSU:\n'+s);
    let r;
    try{r=await ai({system:OGRETMEN_PROMPT,user:parts.join('\n\n')})}
    catch(e){return {ok:false,error:'Öğretmen şu an cevap veremedi: '+(e&&e.message?String(e.message).slice(0,200):'bilinmeyen hata')}}
    const txt=typeof r==='string'?r:r&&typeof r==='object'?(r.ok===false?null:(r.text||r.cevap||r.answer||r.content||'')):'';
    if(r&&typeof r==='object'&&r.ok===false)return {ok:false,error:str(r.error,300)||'Öğretmen şu an cevap veremedi.'};
    const c=str(txt,20000);
    if(!c)return {ok:false,error:'Öğretmenden boş cevap geldi. Tekrar dene.'};
    const p=await loadProg();bump(p);saveProg();
    return {ok:true,cevap:c};
  }

  async function doOpen(u){
    if(!isHttps(u))return {ok:false,error:'Yalnız https bağlantıları açılabilir.'};
    if(typeof open!=='function')return {ok:false,error:'Bağlantı açılamadı.'};
    try{await open(u);return {ok:true}}catch{return {ok:false,error:'Bağlantı açılamadı.'}}
  }
  // arayuz koprusu: hatalar firlatilmaz, {ok:false,error} doner
  async function call(op,a){
    a=a&&typeof a==='object'?a:{};
    try{
      switch(op){
        case 'list':return await list(a);
        case 'get':return await get(a.slug,a);
        case 'today':return await today();
        case 'quiz':return await quiz(a);
        case 'answer':return await answer(a.slug,a.secim);
        case 'progress':return await progress();
        case 'markRead':return await markRead(a.slug);
        case 'sozluk':return await sozluk(a);
        case 'ask':return await ask(a.soru,a);
        case 'open':return await doOpen(a.url);
        default:return {ok:false,error:'Bilinmeyen işlem.'};
      }
    }catch(e){return {ok:false,error:'Borsa Okulu hatası: '+(e&&e.message?String(e.message).slice(0,200):'bilinmeyen')}}
  }
  return {list,get,today,quiz,answer,progress,markRead,sozluk,ask,call,flush:()=>saveQ};
}

module.exports={createOkul,OGRETMEN_PROMPT,TURLER,SEVIYELER,KONULAR,_util:{isoDay,fold,isHttps,pickList,pickFull,publicSoru,soruOk,normProgress}};
