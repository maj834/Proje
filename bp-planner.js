// Borsa Pro sermaye planlayici (saf; ag yok). Aday hisselerden (tarama + bp-quant olasiliklari + Hisse Radar konsensusu) sermayeye ve
// risk tercihine gore en fazla maxPos pozisyonluk bir ALIM plani cikarir. Yatirim tavsiyesi degildir.
//
// Secim kurallari (sirayla; ilk takilan kural red nedeni olur):
// - Yalniz alim (bireysel yatirimci icin BIST'te aciga satis pratik degil). "AL": rating varsa 'Al'/'Güçlü Al' (bp-quant analist notu,
//   daha kalibre), yoksa verdict.label 'AL'. Plan olmali, plan.wait olmamali, plan.dir >= 0 ve stop giris referansinin altinda olmali.
// - R/O: plan.rr >= 1,5 (rr yoksa hedef1'den hesaplanir). Giris bolgesinin ust ucundan R/O 1,5'in altina iniyorsa yalniz uyari.
// - odds (bp-quant planOdds, yuzde) varsa hedef1'e stoptan once ulasma olasiligi p1 > basabas (breakEven). odds yoksa uyari, red yok.
// - Likidite (gunluk ortalama islem hacmi, TL) >= minLiquidityTL. Bilinmiyorsa uyari, red yok.
// - Ayni sektorden en fazla 1 hisse (maxPos >= 2 iken). Sektoru bilinmeyen hisse kendi basina sayilir.
// Siralama puani (yuksek once; esitlikte yuksek R/O, sonra kod):
//   puan = 0,40*EV + 0,30*guven + 0,15*aralik + 0,15*radar
//   EV     = clamp(odds.ev, -1, 1)               odds.ev: islem basina beklenen kazanc (R cinsinden); odds yoksa 0
//   guven  = rating.confidence (yoksa verdict.confidence) / 100                       (0..1)
//   aralik = clamp((p50 - giris) / (giris - stop), -1, 1)   vadeye gore ranges.h5 (1h) ya da h20 (1a); yoksa 0
//   radar  = clamp(radar.skor, -1, 1) * radar.guven / 100   Hisse Radar yapay zeka konsensusu; yoksa 0
// Lot ve risk:
// - Risk: temkinli %0,5 / dengeli %1 / atak %2 sermaye (pozisyon basina; stopa gelinirse kayip). Sayi verilirse yuzde (0 < r <= 5).
// - Giris referansi: giris bolgesinin UST siniri (limit emir icin en kotu dolum; bp-quant planOdds ile ayni).
// - Komisyon: her islemde (alis ve satis ayri ayri) yuzde `commission` (varsayilan %0,2 = binde 2).
//   Hisse basina risk = (giris - stop) + giris*k + stop*k.  Lot = floor(sermaye * risk / hisse basina risk).
// - Pozisyon tutari (alis komisyonu dahil) sermaye/maxPos ve kalan nakdi asamaz; asarsa lot kisilir. Lot 0 ise red.
// Beklenen aralik: ranges.h5 (1 hafta) / h20 (1 ay) p16-p50-p84 fiyatlari -> (fiyat - giris)*lot - gidis-donus komisyonu (TL).
//   Stop oldugu icin kayip -maxLossTL ile sinirlanir (fiyat boslugu/gap haric). ranges yoksa null.
// evTL = odds.ev * lot * (giris - stop) - gidis-donus komisyonu (gecmis simulasyon ortalamasi; garanti degil).
// Toplamlar hisseler arasi korelasyonu yok sayan basit toplamdir: yaklasiktir (hisseler birlikte dusebilir).
const fin=v=>typeof v==='number'&&Number.isFinite(v);
const num=v=>fin(v)?v:typeof v==='string'&&v.trim()&&Number.isFinite(+v)?+v:null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const r2=v=>fin(v)?Math.round(v*100)/100:null;
const nf=(v,d=2)=>fin(v)?v.toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const tl=v=>nf(v,2)+' TL';
const mn=v=>fin(v)?(v>=1e9?nf(v/1e9,1)+' mr TL':nf(v/1e6,1)+' mn TL'):'—';
const pct=(v,d=1)=>fin(v)?'%'+nf(v,d):'—';

const RISK={temkinli:0.5,dengeli:1,atak:2};
const RISK_AD={temkinli:'temkinli',dengeli:'dengeli',atak:'atak'};
const HORIZON={'1h':{key:'h5',ad:'1 hafta',gun:5},'1a':{key:'h20',ad:'1 ay',gun:20}};
const MIN_RR=1.5,MAX_RISK=5,MAX_POS=10;
const W={ev:0.40,conf:0.30,range:0.15,radar:0.15};
const AL_RATING=new Set(['al','güçlü al']);
const SAY=['','','iki','üç','dört','beş','altı','yedi','sekiz','dokuz','on'];

// Aralik girdisi iki bicimde olabilir: {h5:{p16,p50,p84},h20:{..}} ya da bp-quant ranges() {horizons:[{h:5,p16,..}]}
function rangeOf(ranges,h){if(!ranges||typeof ranges!=='object')return null;
  let x=ranges['h'+h];if(!x&&Array.isArray(ranges.horizons))x=ranges.horizons.find(q=>q&&q.h===h);
  if(!x)return null;const p16=num(x.p16),p50=num(x.p50),p84=num(x.p84);
  return fin(p16)&&fin(p50)&&fin(p84)&&p16>0&&p16<=p50&&p50<=p84?{p16,p50,p84}:null}
// odds: bp-quant planOdds yuzde verir (p1 55 = %55). Ikisi de <=1 ise oran sayilip yuzdeye cevrilir.
function oddsOf(o){if(!o||typeof o!=='object')return null;let p1=num(o.p1),be=num(o.breakEven);const ev=num(o.ev),ps=num(o.pStop),n=num(o.n);
  if(!fin(p1)||!fin(be))return null;if(p1<=1&&be<=1&&be>0){p1*=100;be*=100}
  return {p1,breakEven:be,ev:fin(ev)?ev:null,pStop:fin(ps)?(ps<=1&&p1>1&&ps>0&&o.pStop<=1&&num(o.p1)<=1?ps*100:ps):null,n:fin(n)?n:null}}
const labelOf=c=>c.rating&&typeof c.rating.label==='string'&&c.rating.label?c.rating.label:c.verdict&&c.verdict.label?String(c.verdict.label):'—';
const isBuy=c=>c.rating&&typeof c.rating.label==='string'&&c.rating.label?AL_RATING.has(c.rating.label.toLocaleLowerCase('tr-TR').trim()):!!(c.verdict&&String(c.verdict.label).toUpperCase()==='AL');
const confOf=c=>{const v=c.rating&&fin(num(c.rating.confidence))?num(c.rating.confidence):c.verdict&&fin(num(c.verdict.confidence))?num(c.verdict.confidence):null;return fin(v)?clamp(v,0,100):null};
const codeOf=s=>{s=String(s||'').trim().toLocaleUpperCase('tr-TR').replace(/\.IS$/,'');return /^[A-Z0-9]{2,12}$/.test(s)?s:null};
const sectorKey=s=>typeof s==='string'&&s.trim()?s.trim().toLocaleLowerCase('tr-TR'):null;

// Tek aday: kurallari uygula. Gecerse hesaplanmis alanlarla {ok:true,...}, gecmezse {ok:false,why}
function screen(c,{minLiquidityTL,horizon,commission}){
  const sym=codeOf(c.symbol);if(!sym)return {ok:false,why:'Geçersiz hisse kodu.'};
  if(!isBuy(c))return {ok:false,why:'AL sinyali yok (karar: '+labelOf(c)+').'};
  const p=c.plan;if(!p||typeof p!=='object')return {ok:false,why:'İşlem planı yok.'};
  if(p.wait)return {ok:false,why:'Plan giriş tetiği bekliyor; henüz alım bölgesinde değil.'};
  if(fin(num(p.dir))&&num(p.dir)<0)return {ok:false,why:'Plan aşağı yönlü; planlayıcı yalnız alım yapar.'};
  const en=Array.isArray(p.entry)?p.entry.map(num).filter(fin):fin(num(p.entry))?[num(p.entry)]:[];
  const stop=num(p.stop),t1=num(p.t1),t2=num(p.t2);
  if(!en.length||!fin(stop)||stop<=0||en.some(v=>v<=0))return {ok:false,why:'Plan seviyeleri eksik (giriş/stop).'};
  const lo=Math.min(...en),hi=Math.max(...en),ref=hi;
  if(stop>=ref)return {ok:false,why:'Plan seviyeleri geçersiz: stop girişin altında olmalı.'};
  if(fin(t1)&&t1<=ref)return {ok:false,why:'Plan seviyeleri geçersiz: hedef 1 girişin üstünde olmalı.'};
  const rrRef=fin(t1)?(t1-ref)/(ref-stop):null,rr=fin(num(p.rr))?num(p.rr):rrRef;
  if(!fin(rr))return {ok:false,why:'Ödül/risk hesaplanamadı (hedef yok).'};
  if(rr<MIN_RR)return {ok:false,why:'Ödül/risk '+nf(rr,2)+' (en az '+nf(MIN_RR,1)+' gerekli).'};
  const od=oddsOf(c.odds);
  if(od&&!(od.p1>od.breakEven))return {ok:false,why:'Hedefe stoptan önce ulaşma olasılığı '+pct(od.p1,0)+', başabaş '+pct(od.breakEven,0)+' üstünde değil.'};
  const liq=num(c.liquidityTL);
  if(fin(liq)&&liq<minLiquidityTL)return {ok:false,why:'Günlük işlem hacmi '+mn(liq)+' (en az '+mn(minLiquidityTL)+' gerekli).'};
  const H=HORIZON[horizon],rg={week:rangeOf(c.ranges,5),month:rangeOf(c.ranges,20)},rh=H.key==='h5'?rg.week:rg.month;
  const conf=confOf(c),rd=c.radar&&typeof c.radar==='object'?c.radar:null,rs=rd?num(rd.skor):null,rgv=rd?num(rd.guven):null;
  const part={ev:od&&fin(od.ev)?clamp(od.ev,-1,1):0,conf:fin(conf)?conf/100:0,range:rh?clamp((rh.p50-ref)/(ref-stop),-1,1):0,
    radar:fin(rs)?clamp(rs,-1,1)*(fin(rgv)?clamp(rgv,0,100)/100:0.5):0};
  const score=W.ev*part.ev+W.conf*part.conf+W.range*part.range+W.radar*part.radar;
  return {ok:true,c,sym,lo,hi,ref,stop,t1,t2,rr,rrRef,od,liq,rg,conf,rd,part,score,
    sector:typeof c.sector==='string'&&c.sector.trim()?c.sector.trim():null,k:commission/100}}

// Beklenen K/Z (TL) bir fiyat icin: (fiyat - giris)*lot - alis ve satis komisyonu; stop kaybiyla sinirli
const pnlAt=(s,lots,px,maxLoss)=>Math.max(-maxLoss,(px-s.ref)*lots-lots*(s.ref+px)*s.k);
const expOf=(s,lots,r,maxLoss)=>r?{lo:r2(pnlAt(s,lots,r.p16,maxLoss)),mid:r2(pnlAt(s,lots,r.p50,maxLoss)),hi:r2(pnlAt(s,lots,r.p84,maxLoss))}:null;

function plan({capital,risk='dengeli',horizon='1h',maxPos=3,commission=0.2,minLiquidityTL=5e6,candidates=[]}={}){
  const cap=num(capital),base={ok:false,capital:fin(cap)?r2(cap):null,riskPct:null,horizon,picks:[],totals:null,rejected:[],notes:['Yatırım tavsiyesi değildir.']};
  const fail=error=>({...base,error});
  if(!fin(cap)||cap<=0)return fail('Sermaye gir (TL, sıfırdan büyük).');
  let rp=null;if(typeof risk==='string'&&RISK[risk.trim().toLocaleLowerCase('tr-TR')]!=null)rp=RISK[risk.trim().toLocaleLowerCase('tr-TR')];
  else if(fin(num(risk)))rp=num(risk);
  if(!fin(rp))return fail('Risk seçimi geçersiz (temkinli, dengeli, atak ya da yüzde).');
  if(rp<=0||rp>MAX_RISK)return fail('Pozisyon başına risk %0 ile %'+MAX_RISK+' arasında olmalı.');
  base.riskPct=rp;
  if(horizon==null||horizon==='')horizon='1h';
  if(!HORIZON[horizon])return fail('Vade geçersiz (1h: 1 hafta, 1a: 1 ay).');
  base.horizon=horizon;
  const mp=num(maxPos);if(!fin(mp)||mp<1)return fail('En az 1 pozisyon olmalı.');
  maxPos=Math.min(MAX_POS,Math.floor(mp));
  const com=commission==null?0.2:num(commission);if(!fin(com)||com<0||com>=5)return fail('Komisyon yüzdesi geçersiz (ör. 0,2 = binde 2).');
  const minLiq=minLiquidityTL==null?5e6:num(minLiquidityTL);if(!fin(minLiq)||minLiq<0)return fail('Likidite sınırı geçersiz.');
  const list=Array.isArray(candidates)?candidates.filter(c=>c&&typeof c==='object'):[];
  const budget=cap*rp/100,posCap=cap/maxPos,H=HORIZON[horizon];
  const rejected=[],ok=[],seen=new Set();
  for(const c of list){const sym=codeOf(c.symbol)||String(c.symbol||'?');
    if(seen.has(sym)){rejected.push({symbol:sym,why:'Aday listesinde tekrar.'});continue}seen.add(sym);
    const s=screen(c,{minLiquidityTL:minLiq,horizon,commission:com});
    if(s.ok)ok.push(s);else rejected.push({symbol:sym,why:s.why})}
  ok.sort((a,b)=>b.score-a.score||b.rr-a.rr||(a.sym<b.sym?-1:a.sym>b.sym?1:0));
  const picks=[],usedSec=new Map();let cash=cap;
  for(const s of ok){const c=s.c;
    if(picks.length>=maxPos){rejected.push({symbol:s.sym,why:'Daha güçlü '+(SAY[maxPos]||maxPos)+' aday seçildi (en fazla '+maxPos+' pozisyon).'});continue}
    const sk=sectorKey(s.sector);
    if(maxPos>=2&&sk&&usedSec.has(sk)){rejected.push({symbol:s.sym,why:'Aynı sektörden ('+s.sector+') daha güçlü aday seçildi: '+usedSec.get(sk)+'.'});continue}
    const perRisk=(s.ref-s.stop)+s.ref*s.k+s.stop*s.k,perCost=s.ref*(1+s.k);
    let lots=Math.floor(budget/perRisk+1e-9),capped=false;
    const room=Math.min(posCap,cash),maxByCash=Math.floor(room/perCost+1e-9);
    if(lots>maxByCash){lots=maxByCash;capped=true}
    if(lots<1){const why=Math.floor(budget/perRisk+1e-9)<1?'Sermaye bu hisse için yetersiz: 1 lotun stop riski '+tl(perRisk)+', pozisyon başı risk bütçesi '+tl(budget)+'.'
        :cash<posCap?'Sermaye bu hisse için yetersiz: kalan nakit '+tl(cash)+', 1 lot '+tl(perCost)+'.'
        :'Sermaye bu hisse için yetersiz: 1 lot '+tl(perCost)+', pozisyon sınırı '+tl(posCap)+' (sermaye / '+maxPos+').';
      rejected.push({symbol:s.sym,why});continue}
    const positionTL=lots*perCost,maxLossTL=lots*perRisk,riskTL=lots*(s.ref-s.stop),rtCom=lots*s.ref*s.k*2;
    cash-=positionTL;if(sk)usedSec.set(sk,s.sym);
    const reasons=[],warnings=[];
    const lbl=labelOf(c);
    reasons.push((c.rating&&c.rating.label?'Analist notu: '+lbl:'Teknik karar: '+lbl)+(fin(s.conf)?' (güven %'+Math.round(s.conf)+')':'')+
      (c.verdict&&fin(num(c.verdict.score))?', teknik skor '+(num(c.verdict.score)>0?'+':'')+Math.round(num(c.verdict.score)):'')+'.');
    reasons.push('Giriş '+(s.lo<s.hi?nf(s.lo)+'–'+nf(s.hi):nf(s.hi))+', stop '+nf(s.stop)+(fin(s.t1)?', hedef 1 '+nf(s.t1):'')+(fin(s.t2)?', hedef 2 '+nf(s.t2):'')+'; ödül/risk '+nf(s.rr,2)+'.');
    if(s.od)reasons.push('Geçmiş benzer kurulumlarda hedef 1 stoptan önce '+pct(s.od.p1,0)+' (başabaş '+pct(s.od.breakEven,0)+(fin(s.od.n)?', '+s.od.n+' örnek':'')+')'+(fin(s.od.ev)?'; beklenen '+(s.od.ev>0?'+':'')+nf(s.od.ev,2)+'R':'')+'.');
    if(s.rd&&s.rd.karar)reasons.push('Hisse Radar yapay zekâ konsensüsü '+s.rd.karar+(fin(num(s.rd.guven))?' (güven %'+Math.round(num(s.rd.guven))+')':'')+'.');
    const rh=s.rg[H.key==='h5'?'week':'month'];
    if(rh)reasons.push(H.ad+'lık olası fiyat aralığı (%16–%84): '+nf(rh.p16)+'–'+nf(rh.p84)+', ortanca '+nf(rh.p50)+'.');
    if(fin(s.liq))reasons.push('Günlük ortalama işlem hacmi '+mn(s.liq)+'.');
    for(const w of Array.isArray(c.warnings)?c.warnings:[])if(typeof w==='string'&&w.trim()&&!warnings.includes(w.trim()))warnings.push(w.trim());
    if(!s.od)warnings.push('Olasılık verisi yok; seçim yalnız teknik plana dayanıyor.');
    if(!fin(s.liq))warnings.push('Likidite bilinmiyor; emir öncesi işlem hacmini kontrol et.');
    else if(positionTL>s.liq*0.01)warnings.push('Pozisyon günlük hacmin %'+nf(positionTL/s.liq*100,1)+'\'i; emir fiyatı etkileyebilir.');
    if(fin(s.rrRef)&&s.rrRef<MIN_RR&&s.rr>=MIN_RR)warnings.push('Giriş bölgesinin üst ucundan alınırsa ödül/risk '+nf(s.rrRef,2)+'\'ye düşer.');
    const px=num(c.price);if(fin(px)&&px>s.hi*1.005)warnings.push('Fiyat ('+nf(px)+') giriş bölgesinin üstünde; bölgeye geri çekilme için limit emir gerekir.');
    if((s.ref-s.stop)/s.ref<0.01)warnings.push('Stop girişe çok yakın (%'+nf((s.ref-s.stop)/s.ref*100,1)+'); olağan dalgalanma stopu tetikleyebilir.');
    if(s.rd&&s.rd.karar==='SAT')warnings.push('Hisse Radar yapay zekâ konsensüsü SAT; teknik plan ile çelişiyor.');
    if(capped)warnings.push('Pozisyon sınırı nedeniyle lot azaltıldı; stop riski sermayenin %'+nf(maxLossTL/cap*100,2)+'\'i.');
    picks.push({symbol:s.sym,name:typeof c.name==='string'?c.name:null,sector:s.sector,lots,entry:[r2(s.lo),r2(s.hi)],ref:r2(s.ref),stop:r2(s.stop),
      t1:r2(s.t1),t2:r2(s.t2),positionTL:r2(positionTL),maxLossTL:r2(maxLossTL),maxLossPct:r2(maxLossTL/cap*100),
      p1:s.od?r2(s.od.p1):null,evTL:s.od&&fin(s.od.ev)?r2(s.od.ev*riskTL-rtCom):null,
      expected:{week:expOf(s,lots,s.rg.week,maxLossTL),month:expOf(s,lots,s.rg.month,maxLossTL)},
      rr:r2(s.rr),score:Math.round(s.score*1000)/1000,commissionTL:r2(rtCom),reasons,warnings})}
  const sum=(k,h)=>{const xs=picks.map(p=>p.expected[h]).filter(Boolean);if(!xs.length)return null;
    return {lo:r2(xs.reduce((a,x)=>a+x.lo,0)),mid:r2(xs.reduce((a,x)=>a+x.mid,0)),hi:r2(xs.reduce((a,x)=>a+x.hi,0))}};
  const invested=picks.reduce((a,p)=>a+p.positionTL,0),maxLoss=picks.reduce((a,p)=>a+p.maxLossTL,0);
  const totals={invested:r2(invested),cash:r2(cap-invested),maxLoss:r2(maxLoss),maxLossPct:r2(maxLoss/cap*100),
    expWeek:sum('lo','week'),expMonth:sum('lo','month'),positions:picks.length};
  const notes=['Yatırım tavsiyesi değildir. Seviyeler ve olasılıklar geçmiş veriden hesaplanır; gerçekleşme garanti değildir.',
    'Pozisyon başına risk: sermayenin %'+nf(rp,rp%1?1:0)+(typeof risk==='string'&&RISK_AD[risk]?' ('+RISK_AD[risk]+')':'')+' = '+tl(budget)+'. Stopa gelinirse kayıp en fazla bu kadar olur (fiyat boşluğu hariç).',
    'Giriş referansı giriş bölgesinin üst ucu (limit emir); komisyon alışta ve satışta ayrı ayrı %'+nf(com,2)+' varsayıldı.'];
  if(!list.length)notes.push('Aday yok: önce tarama yap ya da izleme listesine hisse ekle.');
  else if(!picks.length)notes.push('Kriterlere uyan hisse çıkmadı; nakitte beklemek de bir karardır.');
  else if(picks.length<maxPos)notes.push('Kriterlere uyan '+picks.length+' hisse çıktı; kalan sermaye nakitte bekler.');
  if(picks.length)notes.push('Kullanılmayan nakit: '+tl(cap-invested)+' (sermayenin %'+nf((cap-invested)/cap*100,1)+'i).');
  if(picks.length>1)notes.push('Toplam beklenen aralıklar hisseler arası korelasyonu yok sayar, yaklaşıktır: hisseler birlikte düşebilir.');
  const miss=picks.filter(p=>!p.expected[H.key==='h5'?'week':'month']).length;
  if(miss)notes.push(miss+' hissede '+H.ad+'lık aralık verisi yok; toplam aralık eksik hesaplandı.');
  return {ok:true,capital:r2(cap),riskPct:rp,horizon,picks,totals,rejected,notes}}

module.exports={plan,RISK,MIN_RR,WEIGHTS:W,_util:{rangeOf,oddsOf,screen,isBuy,codeOf}};
