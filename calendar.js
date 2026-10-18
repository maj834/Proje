// BIST seans takvimi: hafta sonu, resmi tatiller ve yarim gunler (arife).
// Saatler Europe/Istanbul (TSI, yaz saati uygulamasi yok). Veri asagidaki duz nesnede; yeni yil icin bir satir ekle.
// Yarim gun: surekli islem 12:40'ta biter; otomatik yenileme penceresi 09:55-12:45.
// verified:false => o yilin dini bayram tarihleri tahmindir, arayuz uyari gosterir.
const OPEN=9*60+55,CLOSE=18*60+15,HALF_CLOSE=12*60+45;
const FIXED={'01-01':['full','Yılbaşı'],'04-23':['full','Ulusal Egemenlik ve Çocuk Bayramı'],'05-01':['full','Emek ve Dayanışma Günü'],
  '05-19':['full','Atatürk\'ü Anma, Gençlik ve Spor Bayramı'],'07-15':['full','Demokrasi ve Milli Birlik Günü'],'08-30':['full','Zafer Bayramı'],
  '10-28':['half','Cumhuriyet Bayramı arifesi'],'10-29':['full','Cumhuriyet Bayramı']};
const YEARS={
  2026:{verified:true,days:{
    '03-19':['half','Ramazan Bayramı arifesi'],'03-20':['full','Ramazan Bayramı'],'03-21':['full','Ramazan Bayramı'],'03-22':['full','Ramazan Bayramı'],
    '05-26':['half','Kurban Bayramı arifesi'],'05-27':['full','Kurban Bayramı'],'05-28':['full','Kurban Bayramı'],'05-29':['full','Kurban Bayramı'],'05-30':['full','Kurban Bayramı']}},
  // 2027 dini bayram tarihleri tahmindir: dogrulanmali (Borsa Istanbul takvimi)
  2027:{verified:false,days:{
    // Diyanet hesabina gore (2025 ile ayni desen): arife 8 Mart, bayram 9-11 Mart 2027
    '03-08':['half','Ramazan Bayramı arifesi'],'03-09':['full','Ramazan Bayramı'],'03-10':['full','Ramazan Bayramı'],'03-11':['full','Ramazan Bayramı'],
    '05-15':['half','Kurban Bayramı arifesi'],'05-16':['full','Kurban Bayramı'],'05-17':['full','Kurban Bayramı'],'05-18':['full','Kurban Bayramı'],'05-19':['full','Kurban Bayramı']}}
};
const hhmm=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
function parts(date){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(date||new Date()).map(x=>[x.type,x.value]));
  return {year:+p.year,md:p.month+'-'+p.day,day:p.weekday,min:(+p.hour%24)*60+(+p.minute)};
}
// Gun bilgisi: ['full'|'half', ad] ya da null. Yil verisi varsa ona, yoksa yalnizca sabit tatillere bakar.
function dayInfo(year,md){const y=YEARS[year];return (y&&y.days[md])||FIXED[md]||null}
function yearInfo(year){const y=YEARS[year||parts().year];return {known:!!y,verified:!!(y&&y.verified)}}
// {open, reason, closeMin, half}: reason kapaliysa nedeni, acik yarim gunde not; closeMin o gunun yenileme bitisi (dk) ya da null.
function status(date){
  const t=parts(date);
  if(t.day==='Sat'||t.day==='Sun')return {open:false,reason:'hafta sonu',closeMin:null,half:false};
  const d=dayInfo(t.year,t.md);
  if(d&&d[0]==='full')return {open:false,reason:d[1]+' tatili',closeMin:null,half:false};
  const half=!!d,end=half?HALF_CLOSE:CLOSE;
  if(t.min<OPEN)return {open:false,reason:'seans '+hhmm(OPEN)+'\'te açılır',closeMin:end,half};
  if(t.min>end)return {open:false,reason:half?d[1]+' (yarım gün, seans 12:40\'ta kapandı)':'seans '+hhmm(CLOSE)+'\'te kapandı',closeMin:end,half};
  return {open:true,reason:half?d[1]+': yarım gün, 12:40\'ta kapanır':null,closeMin:end,half};
}
const isOpen=date=>status(date).open;
module.exports={isOpen,status,yearInfo,dayInfo,YEARS,FIXED,OPEN,CLOSE,HALF_CLOSE};
