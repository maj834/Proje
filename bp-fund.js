// Borsa Pro temel analiz puani (saf; ag yok). Girdi: market.fundamentals() normalize verisi (yuzdeler % cinsinden, debtToEquity oran).
// Cikti: degerleme, karlilik, buyume, bilanco ayaklari + analist hedefi, Turkce satirlar ve uyarilar. Yatirim tavsiyesi degildir.
//
// Turkiye baglami (yuksek enflasyon) ve esik mantigi:
// - Nominal TL buyume enflasyonla sisirilmistir: satis/kar buyumesi yillik enflasyon varsayimiyla reele cevrilir, reel=(1+g)/(1+enf)-1
//   (opts.inflation; varsayilan INFL.TRY). Puan REEL buyumeye gore verilir; satirda nominal ve reel birlikte yazilir.
//   TMS 29 (enflasyon muhasebesi) uygulayan sirketlerin tablolari zaten duzeltilmis olabilir; Yahoo bunu belirtmez -> uyari satiri.
// - Analist hedefleri 12 aylik ve nominaldir: potansiyel ayni varsayimla reele cevrilir (+%30 hedef, %25 enflasyonda reel ~ +%4).
// - ROE: TL'de nominal %15 ROE enflasyonun altindadir; TMS 29'lu tabloda ise iyidir. Egri bu belirsizlik yuzunden orta yolda (%15 ~ notr);
//   ROE < enflasyon ise uyari verilir.
// - Banka ve sigorta: F/K ve FD/FAVOK yerine PD/DD odakli. Hak edilen PD/DD = ROE / ozkaynak maliyeti (Gordon modeli, g=0 sadelestirmesi);
//   ozkaynak maliyeti (COE) = TL enflasyonu + COE_PREMIUM puan (TL) | COE_DEV (diger). PD/DD'nin hak edilene orani ucuz/pahaliyi belirler.
//   Bankalar BDDK karariyla TMS 29 uygulamadi: ROE nominaldir ve COE ile kiyaslanir. Borc/ozkaynak, cari oran bankacilikta anlamsiz -> bilanco yok.
// - GYO/gayrimenkul: PD/DD (net aktif degerine iskonto vekili) agirlikli; F/K degerleme kazanclariyla sisebilir (dusuk agirlik).
// - Holding: PD/DD (NAD iskontosu vekili) + F/K. Diger finans (leasing, faktoring, araci kurum): PD/DD + F/K; borc oranlari anlamsiz.
// - TL disi (ABD) hisselerde gelismis piyasa carpan egrileri (CURVES.dev) ve %3 enflasyon.
// Esikler: CURVES tablosu. Her egri [[x, puan], ...] parcali dogrusaldir (puan -1..1; noktalar arasi dogrusal, uclarda sabit).
// Ayak puani = mevcut olcutlerin agirlikli ortalamasi (KINDS); olcut agirliginin %30'undan azi varsa ayak "Belirsiz". Etiket esigi |puan| >= 0.3.
// Genel puan: degerleme 0.35, karlilik 0.25, buyume 0.15, bilanco 0.15, analist hedefi 0.10 (en az 3 analist) agirlikli ortalama;
// eksik ayaklar disarida kalir ve puan kapsamla (0.5 + 0.5 * kapsam) kucultulur: az veriyle asiri emin sonuc verilmez.
// Yahoo'nun BIST temel verisi gecikmeli/eksik olabilir; makul olmayan degerler (SANE) yok sayilip uyarilir.
const fin=v=>typeof v==='number'&&Number.isFinite(v);
const num=v=>fin(v)?v:typeof v==='string'&&v.trim()&&Number.isFinite(+v)?+v:null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const own=(o,k)=>typeof k==='string'&&Object.prototype.hasOwnProperty.call(o,k);
const r2=v=>fin(v)?Math.round(v*100)/100:null,r1=v=>fin(v)?Math.round(v*10)/10:null;
const nf=(v,d=2)=>fin(v)?v.toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
// Isaretli yuzde (+%12,3 / −%4,5); yuvarlanmis sifirda isaret yok. pu: isaretsiz yuzde (negatifte eksi)
const pc=(v,d=1)=>{if(!fin(v))return '—';const k=10**d,x=Math.round(v*k)/k;return (x>0?'+':x<0?'−':'')+'%'+nf(Math.abs(x),d)};
const pu=(v,d=1)=>{if(!fin(v))return '—';const k=10**d,x=Math.round(v*k)/k;return (x<0?'−':'')+'%'+nf(Math.abs(x),d)};

const INFL={TRY:25,other:3};          // yillik enflasyon varsayimi (%); TL icin guncel TUFE opts.inflation ile gecilmeli
const COE_PREMIUM=8,COE_DEV=10;       // TL ozkaynak maliyeti = enflasyon + 8 puan; diger para birimlerinde %10
const LABEL_T=0.3;
const CURVES={
  // Degerleme (dusuk carpan = ucuz = +). BIST: tarihsel F/K bandi ~5-12; TMS 29 sonrasi karlar dustu, carpanlar yukseldi.
  tr:{pe:[[3,1],[6,0.7],[10,0.2],[14,0],[20,-0.5],[30,-1]],fwdPe:[[3,1],[5,0.6],[8,0.2],[12,0],[18,-0.5],[25,-1]],
    pb:[[0.6,1],[1,0.5],[2,0],[3.5,-0.5],[6,-1]],ps:[[0.4,0.8],[1,0.3],[2,0],[4,-0.6],[8,-1]],evEbitda:[[3,1],[5,0.5],[8,0],[12,-0.5],[18,-1]],
    bankPb:[[0.5,1],[0.8,0.5],[1.2,0],[1.8,-0.5],[2.5,-1]],bankPe:[[2,0.8],[4,0.4],[6,0],[9,-0.5],[14,-1]],
    roe:[[-10,-1],[0,-0.6],[10,-0.2],[15,0],[20,0.2],[30,0.5],[45,1]]},
  // Gelismis piyasa (TL disi): daha yuksek carpanlar normaldir
  dev:{pe:[[8,1],[12,0.5],[18,0],[25,-0.5],[40,-1]],fwdPe:[[7,1],[11,0.5],[16,0],[22,-0.5],[35,-1]],
    pb:[[1,1],[1.8,0.5],[3,0],[5,-0.5],[10,-1]],ps:[[0.8,0.8],[1.5,0.3],[3,0],[6,-0.6],[12,-1]],evEbitda:[[6,1],[9,0.5],[13,0],[18,-0.5],[28,-1]],
    bankPb:[[0.7,1],[1,0.5],[1.4,0],[2,-0.5],[3,-1]],bankPe:[[6,0.8],[9,0.4],[12,0],[16,-0.5],[22,-1]],
    roe:[[-10,-1],[0,-0.6],[8,0],[15,0.5],[25,1]]},
  navPb:[[0.4,1],[0.7,0.5],[1,0],[1.5,-0.5],[2.5,-1]],          // GYO/holding: PD/DD ~ net aktif degerine gore
  pbJust:[[0.5,1],[0.75,0.5],[1,0],[1.3,-0.5],[1.8,-1]],        // PD/DD / hak edilen PD/DD (ROE/COE)
  roeSpread:[[-20,-1],[-10,-0.5],[0,0],[8,0.6],[15,1]],         // ROE - COE (puan): deger yaratma
  bankRoa:[[0,-1],[1,-0.3],[2,0.2],[3,0.6],[4.5,1]],
  // Karlilik (marjlar ayni donemin oranlari: enflasyondan en az etkilenen olcut)
  roa:[[-3,-1],[0,-0.4],[3,0],[8,0.5],[14,1]],grossMargin:[[5,-0.5],[15,0],[30,0.5],[45,1]],
  opMargin:[[-5,-1],[0,-0.5],[5,0],[12,0.5],[20,1]],netMargin:[[-5,-1],[0,-0.4],[4,0],[10,0.5],[18,1]],
  // Buyume: REEL yillik % (Yahoo: ceyreklik yillik degisim)
  revReal:[[-20,-1],[-8,-0.5],[0,0],[10,0.5],[25,1]],epsReal:[[-40,-1],[-15,-0.5],[0,0],[20,0.5],[50,1]],
  // Bilanco
  de:[[0.2,1],[0.5,0.5],[1,0],[2,-0.6],[3,-1]],cr:[[0.7,-1],[1,-0.3],[1.3,0.2],[2,0.8],[3,1]],
  // Analist hedefi: REEL 12 ay potansiyeli %
  upReal:[[-20,-1],[0,-0.3],[10,0.2],[25,0.6],[40,1]]
};
// Sektor turune gore olcut agirliklari (health:null -> bilanco olcutleri anlamsiz)
const KINDS={
  banka:{name:'Banka',val:{bankPb:0.35,pbJust:0.45,bankPe:0.2},qual:{roeSpread:0.6,bankRoa:0.4},health:null},
  sigorta:{name:'Sigorta',val:{bankPb:0.2,pbJust:0.45,pe:0.35},qual:{roeSpread:0.6,roa:0.2,netMargin:0.2},health:null},
  gyo:{name:'GYO / gayrimenkul',val:{navPb:0.75,pe:0.25},qual:{roe:0.5,roa:0.3,opMargin:0.2},health:{de:0.6,cr:0.4}},
  holding:{name:'Holding',val:{navPb:0.55,pe:0.3,fwdPe:0.15},qual:{roe:0.5,roa:0.25,netMargin:0.25},health:{de:0.6,cr:0.4}},
  finans:{name:'Finans',val:{pb:0.5,pe:0.35,fwdPe:0.15},qual:{roe:0.6,roa:0.2,netMargin:0.2},health:null},
  genel:{name:'Sanayi / hizmet',val:{pe:0.3,evEbitda:0.25,pb:0.2,fwdPe:0.15,ps:0.1},qual:{roe:0.3,opMargin:0.25,netMargin:0.2,roa:0.15,grossMargin:0.1},health:{de:0.6,cr:0.4}}
};
const WEIGHTS={valuation:0.35,quality:0.25,growth:0.15,health:0.15,target:0.1};
// Makul aralik disi deger veri hatasi sayilir (Yahoo'da birim/bolunme hatalari gorulur). pe<=0 zarar, evEbitda<0 negatif FAVOK, D/E<0 negatif ozkaynak ayrica ele alinir.
const SANE={pe:[1,2000],fwdPe:[1,2000],pb:[0.05,200],ps:[0.01,500],evEbitda:[0.5,500],roe:[-300,300],roa:[-100,100],grossMargin:[-200,100],opMargin:[-1000,100],
  netMargin:[-1000,300],revenueGrowth:[-100,2000],earningsGrowth:[-100,5000],debtToEquity:[0,60],currentRatio:[0.01,60],divYield:[0,30],payout:[0,1000],beta:[-5,5]};
const NAMES={pe:'F/K',fwdPe:'İleri F/K',pb:'PD/DD',ps:'F/S',evEbitda:'FD/FAVÖK',roe:'ROE',roa:'ROA',grossMargin:'brüt marj',opMargin:'faaliyet marjı',netMargin:'net marj',
  revenueGrowth:'satış büyümesi',earningsGrowth:'kâr büyümesi',debtToEquity:'borç/özkaynak',currentRatio:'cari oran',divYield:'temettü verimi',payout:'dağıtım oranı',beta:'beta'};
const REC={strong_buy:'Güçlü Al',buy:'Al',hold:'Tut',underperform:'Endeks Altı',sell:'Sat',strong_sell:'Güçlü Sat'};
const NOHEALTH={banka:'bankacılıkta',sigorta:'sigortacılıkta',finans:'finans şirketlerinde (kaldıraç iş modelinin parçası)'};
const PCT=new Set(['roe','roa','grossMargin','opMargin','netMargin','revenueGrowth','earningsGrowth','divYield','payout']);

// Parcali dogrusal egri: x -> puan
function lin(x,pts){if(!fin(x)||!Array.isArray(pts)||!pts.length)return null;if(x<=pts[0][0])return pts[0][1];
  for(let i=1;i<pts.length;i++)if(x<=pts[i][0]){const [x0,y0]=pts[i-1],[x1,y1]=pts[i];return x1===x0?y1:y0+(y1-y0)*(x-x0)/(x1-x0)}
  return pts[pts.length-1][1]}
// parts: [[puan|null, agirlik]] -> {score, cover}
function blend(parts){let s=0,w=0,W=0;for(const [v,wt] of parts){W+=wt;if(fin(v)){s+=v*wt;w+=wt}}return {score:w?clamp(s/w,-1,1):null,cover:W?w/W:0}}
const lbl=(sc,cover,[pos,mid,neg])=>!fin(sc)||cover<0.3?'Belirsiz':sc>=LABEL_T?pos:sc<=-LABEL_T?neg:mid;
// Gercek (enflasyondan arindirilmis) yuzde
const real=(g,inf)=>fin(g)&&fin(inf)?((1+g/100)/(1+inf/100)-1)*100:null;

// Sektor turu: Yahoo sector/industry (Ingilizce) ya da Turkce adlar
function kindOf(f){
  const s=[f&&f.sector,f&&f.industry].filter(x=>typeof x==='string').join(' | ');
  if(/bank|banka|katılım|katilim/i.test(s))return 'banka';
  if(/insur|sigorta|reas[uü]r|emeklilik/i.test(s))return 'sigorta';
  if(/reit|real estate|gayrimenkul|\bgyo\b/i.test(s))return 'gyo';
  if(/conglomerate|holding/i.test(s))return 'holding';
  if(/financ|finans|capital markets|credit services|asset management|leasing|kiralama|faktoring|factoring/i.test(s))return 'finans';
  return 'genel'}

const money=(v,cur)=>{if(!fin(v)||v<=0)return null;const u=cur==='TRY'?' TL':cur==='USD'?' $':cur?' '+cur:'';
  return v>=1e12?nf(v/1e12,2)+' trilyon'+u:v>=1e9?nf(v/1e9,1)+' milyar'+u:v>=1e6?nf(v/1e6,1)+' milyon'+u:nf(v,0)+u};
const fp=v=>nf(v,Math.abs(v)>=1?2:4);
const dayFmt=t=>{try{return new Date(t).toLocaleDateString('tr-TR',{timeZone:'Europe/Istanbul',day:'numeric',month:'long',year:'numeric'})}catch(e){return new Date(t).toISOString().slice(0,10)}};
const EMPTY=()=>({label:'Belirsiz',score:null});

function scoreFundamentals(f,opts={}){
  opts=opts&&typeof opts==='object'?opts:{};
  const fail=error=>({ok:false,error,score:null,label:'Belirsiz',kind:null,kindName:null,valuation:EMPTY(),quality:EMPTY(),growth:EMPTY(),health:EMPTY(),target:null,lines:[],flags:[],
    note:'Yatırım tavsiyesi değildir.'});
  if(!f||typeof f!=='object'||Array.isArray(f))return fail('Temel veri yok.');
  const flags=[],lines=[],bad=[];
  // Temizlik: sayilar, zarar/negatif FAVOK/negatif ozkaynak ayrimi, makul aralik
  const v={};for(const k of Object.keys(SANE))v[k]=num(f[k]);
  const loss=(v.pe!=null&&v.pe<=0)||(v.pe==null&&v.netMargin!=null&&v.netMargin<0);if(v.pe!=null&&v.pe<=0)v.pe=null;
  if(v.fwdPe!=null&&v.fwdPe<=0)v.fwdPe=null;
  const negEbitda=v.evEbitda!=null&&v.evEbitda<0;if(negEbitda)v.evEbitda=null;
  const negEq=v.debtToEquity!=null&&v.debtToEquity<0;if(negEq)v.debtToEquity=null;
  for(const [k,[lo,hi]] of Object.entries(SANE))if(v[k]!=null&&(v[k]<lo||v[k]>hi)){bad.push(NAMES[k]+' '+(PCT.has(k)?pu(v[k]):nf(v[k],2)));v[k]=null}
  const has=Object.values(v).some(x=>x!=null)||loss||negEbitda||negEq||bad.length>0;
  const cur=typeof f.currency==='string'?f.currency.toUpperCase():null,fcur=typeof f.financialCurrency==='string'?f.financialCurrency.toUpperCase():cur;
  const region=opts.region==='tr'||opts.region==='dev'?opts.region:cur==='TRY'||/\.IS$/i.test(String(f.symbol||''))||!cur?'tr':'dev';
  const inflTRY=fin(opts.inflation)?clamp(opts.inflation,-50,500):INFL.TRY;
  const inflOf=c=>c==='TRY'||(!c&&region==='tr')?inflTRY:INFL.other;
  const infl=inflOf(fcur),pInfl=inflOf(cur),coe=clamp(fin(opts.coe)?opts.coe:region==='tr'?inflTRY+COE_PREMIUM:COE_DEV,1,200);
  const kind=own(KINDS,opts.kind)?opts.kind:kindOf(f),K=KINDS[kind],C=CURVES[region],fin2=kind==='banka'||kind==='sigorta';
  const now=fin(opts.now)?opts.now:Date.now(),last=num(opts.last);

  // --- degerleme ---
  const just=fin2&&v.roe!=null&&v.pb!=null?clamp(v.roe/coe,0.2,3):null;
  const vs={pe:loss?-0.5:lin(v.pe,C.pe),fwdPe:lin(v.fwdPe,C.fwdPe),pb:lin(v.pb,C.pb),ps:lin(v.ps,C.ps),evEbitda:negEbitda?-0.5:lin(v.evEbitda,C.evEbitda),
    bankPb:lin(v.pb,C.bankPb),bankPe:loss?-0.5:lin(v.pe,C.bankPe),navPb:lin(v.pb,CURVES.navPb),pbJust:just?lin(v.pb/just,CURVES.pbJust):null};
  const V=blend(Object.entries(K.val).map(([k,w])=>[vs[k],w]));
  const valuation={label:lbl(V.score,V.cover,['Ucuz','Makul','Pahalı']),score:null};if(valuation.label!=='Belirsiz')valuation.score=r2(V.score);
  {const m=[];const pe=loss?'F/K — (zarar)':v.pe!=null?'F/K '+nf(v.pe,1):null;
    if(fin2){if(v.pb!=null)m.push('PD/DD '+nf(v.pb,2));if(just)m.push('hak edilen ≈ '+nf(just,2)+' (ROE '+pu(v.roe)+' / özkaynak maliyeti %'+nf(coe,0)+')');if(pe)m.push(pe)}
    else{if(pe)m.push(pe);if(v.fwdPe!=null&&'fwdPe' in K.val)m.push('İleri F/K '+nf(v.fwdPe,1));if(v.pb!=null)m.push('PD/DD '+nf(v.pb,2));
      if('evEbitda' in K.val&&(v.evEbitda!=null||negEbitda))m.push(negEbitda?'FD/FAVÖK — (FAVÖK negatif)':'FD/FAVÖK '+nf(v.evEbitda,1));if(v.ps!=null&&'ps' in K.val)m.push('F/S '+nf(v.ps,2))}
    const hd=kind==='banka'?'Değerleme (banka, PD/DD odaklı)':kind==='sigorta'?'Değerleme (sigorta, PD/DD odaklı)':kind==='gyo'?'Değerleme (GYO, PD/DD odaklı)':kind==='holding'?'Değerleme (holding, PD/DD + F/K)':'Değerleme';
    if(m.length)lines.push(hd+': '+valuation.label+' — '+m.join(' · ')+(valuation.label==='Belirsiz'?' (yeterli çarpan yok)':''))}

  // --- karlilik ---
  const spread=v.roe!=null?v.roe-coe:null;
  const qs={roe:lin(v.roe,C.roe),roeSpread:lin(spread,CURVES.roeSpread),roa:lin(v.roa,CURVES.roa),bankRoa:lin(v.roa,CURVES.bankRoa),
    grossMargin:lin(v.grossMargin,CURVES.grossMargin),opMargin:lin(v.opMargin,CURVES.opMargin),netMargin:lin(v.netMargin,CURVES.netMargin)};
  const Q=blend(Object.entries(K.qual).map(([k,w])=>[qs[k],w]));
  const quality={label:lbl(Q.score,Q.cover,['Güçlü','Orta','Zayıf']),score:null};if(quality.label!=='Belirsiz')quality.score=r2(Q.score);
  {const m=[];if(v.roe!=null)m.push('ROE '+pu(v.roe)+(fin2?' (özkaynak maliyeti %'+nf(coe,0)+': '+(spread>=0?'+':'−')+nf(Math.abs(spread),1)+' puan)':''));
    if(v.roa!=null)m.push('ROA '+pu(v.roa));
    for(const k of ['grossMargin','opMargin','netMargin'])if(v[k]!=null&&k in K.qual)m.push(NAMES[k]+' '+pu(v[k]));
    if(m.length)lines.push('Kârlılık: '+quality.label+' — '+m.join(' · '))}

  // --- buyume (reel) ---
  const rg=real(v.revenueGrowth,infl),eg=real(v.earningsGrowth,infl),base=v.earningsGrowth!=null&&Math.abs(v.earningsGrowth)>300;
  const G=blend([[lin(rg,CURVES.revReal),0.55],[lin(eg,CURVES.epsReal),base?0.15:0.45]]);
  const growth={label:lbl(G.score,G.cover,['Güçlü','Orta','Zayıf']),score:null};if(growth.label!=='Belirsiz')growth.score=r2(G.score);
  {const m=[];const one=(n,g,r)=>n+' '+pc(g)+' nominal → reel '+pc(r);
    if(v.revenueGrowth!=null)m.push(one('satışlar',v.revenueGrowth,rg));if(v.earningsGrowth!=null)m.push(one('net kâr',v.earningsGrowth,eg));
    if(m.length)lines.push('Büyüme (reel, '+(fcur&&fcur!=='TRY'?fcur+' ':'')+'enflasyon %'+nf(infl,0)+' varsayımı): '+growth.label+' — '+m.join(' · '))}

  // --- bilanco ---
  let health=EMPTY(),H={score:null,cover:0};
  if(K.health){H=blend([[negEq?-1:lin(v.debtToEquity,CURVES.de),K.health.de],[lin(v.currentRatio,CURVES.cr),K.health.cr]]);
    health={label:lbl(H.score,H.cover,['Sağlam','Orta','Zayıf']),score:null};if(health.label!=='Belirsiz')health.score=r2(H.score);
    const m=[];if(negEq)m.push('özkaynak negatif');else if(v.debtToEquity!=null)m.push('borç/özkaynak '+nf(v.debtToEquity,2));if(v.currentRatio!=null)m.push('cari oran '+nf(v.currentRatio,2));
    if(m.length)lines.push('Bilanço: '+health.label+' — '+m.join(' · '))}
  else if(has)lines.push('Bilanço: '+(NOHEALTH[kind]||'bu sektörde')+' borç/özkaynak ve cari oran anlamlı değil; sermaye yeterliliği verisi yok.');

  // --- analist hedefi ---
  let target=null,tScore=null;const T=f.target&&typeof f.target==='object'?f.target:null,tm=T?num(T.mean):null;
  if(tm!=null&&tm>0){const n=T.n!=null&&fin(num(T.n))?Math.round(num(T.n)):null,rec=typeof T.rec==='string'?T.rec.toLowerCase():null;
    const up=last!=null&&last>0?(tm/last-1)*100:null,ru=real(up,pInfl),hi=num(T.high),lo=num(T.low);
    target={mean:tm,upside:r1(up),realUpside:r1(ru),n,rec:own(REC,rec)?rec:null,label:own(REC,rec)?REC[rec]:null,high:hi,low:lo};
    const odd=up!=null&&(up>150||up<-60);
    if(odd)flags.push('Analist hedefi fiyattan çok uzak ('+pc(up)+'): eski ya da bedelsiz sermaye artırımı/bölünme öncesine ait olabilir; puana katılmadı.');
    else if(n!=null&&n<3)flags.push('Az analist ('+n+'): hedef fiyat güvenilirliği düşük; puana katılmadı.');
    else if(n!=null&&ru!=null)tScore=lin(ru,CURVES.upReal);
    lines.push('Analist hedefi: '+fp(tm)+(cur==='TRY'?' TL':cur?' '+cur:'')+(up!=null?' ('+pc(up)+'; reel ≈ '+pc(ru)+')':'')+(hi!=null&&lo!=null?' · aralık '+fp(lo)+'–'+fp(hi):'')+
      (n!=null?' · '+n+' analist':'')+(target.label?' · '+target.label:''))}

  // --- diger satirlar ---
  {const m=[];if(v.divYield!=null)m.push('Temettü verimi '+pu(v.divYield));if(v.payout!=null)m.push('dağıtım oranı '+pu(v.payout,0));if(m.length)lines.push(m.join(' · '))}
  {const mc=money(num(f.marketCap),cur),m=[];if(mc)m.push('Piyasa değeri '+mc);if(v.beta!=null)m.push('beta '+nf(v.beta,2));if(m.length)lines.push(m.join(' · '))}
  const ne=num(f.nextEarnings);let days=null;
  if(ne!=null&&ne>0){days=Math.ceil((ne-now)/86400000);if(days>=0)lines.push('Sonraki bilanço: '+dayFmt(ne)+(days===0?' (bugün)':' ('+days+' gün)'))}

  // --- uyarilar ---
  if(f.stale)flags.push('Temel veri güncellenemedi; eski veri gösteriliyor.');
  if(cur==='TRY'&&fcur==='TRY'&&(v.revenueGrowth!=null||v.earningsGrowth!=null||kind==='genel'&&v.roe!=null))
    flags.push('Yüksek enflasyon: nominal TL büyüme ve kârlar şişkin görünür; reel değerler %'+nf(inflTRY,0)+' enflasyon varsayımıyla hesaplandı (TMS 29 ile düzeltilmiş tablolarda nominal rakam zaten reel olabilir).');
  if(fcur&&cur&&fcur!==cur)flags.push('Finansal tablolar '+fcur+', fiyat '+cur+': çarpanlar Yahoo\'nun kur çevrimine dayanır.');
  if(loss)flags.push('Şirket zarar ediyor: F/K anlamsız, değerleme kârla desteklenmiyor.');
  if(!fin2&&v.pe!=null&&v.pe<3&&region==='tr')flags.push('F/K çok düşük ('+nf(v.pe,1)+'): tek seferlik kazanç (parasal kazanç, varlık satışı, ertelenmiş vergi) olabilir; kalıcılığını kontrol et.');
  if(negEbitda&&!fin2)flags.push('FAVÖK negatif: faaliyetler nakit üretmiyor, FD/FAVÖK anlamsız.');
  if(base)flags.push('Kâr büyümesi aşırı ('+pc(v.earningsGrowth,0)+'): düşük baz etkisi olası; puanda az ağırlık verildi.');
  if(fin2&&spread!=null&&spread<0)flags.push('ROE ('+pu(v.roe)+') özkaynak maliyetinin (%'+nf(coe,0)+') altında: değer yaratmıyor, hak edilen PD/DD 1\'in altında.');
  else if(!fin2&&v.roe!=null&&fcur==='TRY'&&v.roe<inflTRY)flags.push('ROE ('+pu(v.roe)+') enflasyon varsayımının (%'+nf(inflTRY,0)+') altında: tablolar nominalse reel özkaynak getirisi negatif.');
  if(K.health){if(negEq)flags.push('Özkaynak negatif: bilanço riski yüksek.');
    else if(v.debtToEquity!=null&&v.debtToEquity>2)flags.push('Borç/özkaynak yüksek ('+nf(v.debtToEquity,2)+'): faiz ve kur şoklarına duyarlı'+(kind==='holding'?' (holding konsolide; banka iştiraki varsa şişkin görünür).':'.'));
    if(v.currentRatio!=null&&v.currentRatio<1)flags.push('Cari oran 1\'in altında ('+nf(v.currentRatio,2)+'): kısa vadeli likidite baskısı olabilir.')}
  if(v.payout!=null&&v.payout>100)flags.push('Dağıtım oranı %100 üstü ('+pu(v.payout,0)+'): temettü kârla karşılanmıyor, sürdürülebilir olmayabilir.');
  if(v.beta!=null&&v.beta>1.5)flags.push('Beta yüksek ('+nf(v.beta,2)+'): piyasadan sert dalgalanır.');
  if(days!=null&&days>=0&&days<=7)flags.push('Bilanço '+(days===0?'bugün':days+' gün içinde')+': açıklama sonrası sert fiyat hareketi olabilir.');
  if(bad.length)flags.push('Şüpheli değer yok sayıldı: '+bad.join(', ')+'.');

  // --- genel puan ---
  const pillars=[[valuation.score,WEIGHTS.valuation],[quality.score,WEIGHTS.quality],[growth.score,WEIGHTS.growth]];if(K.health)pillars.push([health.score,WEIGHTS.health]);
  const core=blend(pillars),okP=pillars.some(p=>fin(p[0]));
  if(!okP){const r=fail(has?'Yeterli temel veri yok.':'Temel veri yok.');return {...r,kind,kindName:K.name,target,lines,flags}}
  const all=blend([...pillars,[tScore,WEIGHTS.target]]);
  const score=r2(clamp(all.score*(0.5+0.5*core.cover),-1,1));
  if(core.cover<0.5)flags.push('Temel veri sınırlı; sonuç düşük güvenilirlikte.');
  const label=score>=0.35?'Güçlü':score>=0.12?'Olumlu':score>-0.12?'Nötr':score>-0.35?'Zayıf':'Olumsuz';
  return {ok:true,score,label,coverage:r2(core.cover),kind,kindName:K.name,valuation,quality,growth,health,target,lines,flags,
    assumptions:{inflation:r1(infl),priceInflation:r1(pInfl),coe:r1(coe),region},note:'Kaynak: Yahoo Finance (gecikmeli/eksik olabilir). Yatırım tavsiyesi değildir.'};
}

module.exports={scoreFundamentals,kindOf,lin,real,CURVES,KINDS,WEIGHTS,SANE,INFL,COE_PREMIUM,COE_DEV,REC};
