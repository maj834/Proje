// Internet hiz testi ve Wi-Fi QR icin saf mantik. Ag katmani (fetch) ve komut calistirici (exec) disaridan verilebilir:
// testler internet olmadan yerel sunucuya ya da sahte fonksiyonlara karsi calisir.
// Hiz testi Cloudflare'in herkese acik uc noktalarini kullanir (speed.cloudflare.com): __down, __up, meta.
const crypto=require('crypto');

const BASE='https://speed.cloudflare.com';
const LIMITS={maxMs:30000,maxBytes:400e6};       // tum test en fazla 30 sn ve 400 MB
const DL_SIZES=[1e5,1e6,1e7,2.5e7];               // indirme: 100 KB -> 1 MB -> 10 MB -> 25 MB
const UL_SIZES=[2.5e5,1e6,2.5e6,5e6,1e7];         // yukleme: yavas hatta bos kalmasin diye 250 KB'tan baslar, 10 MB'a kadar
const HISTORY_MAX=50;

// --- olcu hesaplari -------------------------------------------------------------------------
const num=v=>typeof v==='number'&&isFinite(v)?v:null;
// bayt + milisaniye -> Mbit/sn
const mbps=(bytes,ms)=>ms>0?bytes*8/(ms*1000):0;
// Yuzdelik (dogrusal ara deger). Bos dizi -> null
function percentile(vals,p){
  const v=(vals||[]).filter(x=>num(x)!=null).sort((a,b)=>a-b);if(!v.length)return null;
  const i=(v.length-1)*Math.max(0,Math.min(100,p))/100,lo=Math.floor(i),hi=Math.ceil(i);
  return v[lo]+(v[hi]-v[lo])*(i-lo);
}
const median=v=>percentile(v,50);
// Titreme (jitter): ardisik olcumler arasindaki farklarin mutlak ortalamasi
function jitter(vals){const v=(vals||[]).filter(x=>num(x)!=null);if(v.length<2)return null;
  let s=0;for(let i=1;i<v.length;i++)s+=Math.abs(v[i]-v[i-1]);return s/(v.length-1)}
// Birikimli ornekler [{t(ms),b(bayt)}] -> kayan 1 sn pencerelerde Mbit/sn listesi
function windowRates(samples,win=1000){
  const out=[];let j=0;
  for(let i=0;i<samples.length;i++){const s=samples[i];if(s.t-samples[0].t<win)continue;
    while(j+1<i&&samples[j+1].t<=s.t-win)j++;
    out.push(mbps(s.b-samples[j].b,s.t-samples[j].t))}
  return out;
}
// Sonuc hizi: saniyelik hizlarin 90. yuzdeligi; 1 sn'den kisa olcumde ortalama
function throughput(samples){
  if(!samples||samples.length<2)return null;const r=windowRates(samples);
  if(r.length)return percentile(r,90);
  const a=samples[0],z=samples.at(-1);return z.b>0?mbps(z.b-a.b,z.t-a.t):null;
}
const r1=v=>v==null?null:Math.round(v*10)/10;

// Kisa Turkce yorum. level: cok-iyi | iyi | orta | zayif | cok-zayif
function verdict(r){
  const d=num(r&&r.down)||0,u=num(r&&r.up),p=num(r&&r.ping),j=num(r&&r.jitter),l=num(r&&r.loaded);
  const U=u==null?Infinity:u,P=p==null?0:p,J=j==null?0:j;
  let level,text;
  if(d>=100&&U>=10&&P<=40&&J<=10){level='cok-iyi';text='Çok iyi: 4K video, oyun ve büyük dosyalar için yeterli.'}
  else if(d>=25&&U>=5&&P<=60&&J<=20){level='iyi';text='İyi: 4K video ve görüntülü görüşme için yeterli.'}
  else if(d>=10&&U>=2&&P<=100){level='orta';text='Orta: HD video ve görüntülü görüşme olur; 4K takılabilir.'}
  else if(d>=3){level='zayif';text='Zayıf: Görüntülü görüşme takılabilir, video düşük kalitede açılır.'}
  else{level='cok-zayif';text='Çok zayıf: Yalnızca mesajlaşma ve web gezintisi için uygun.'}
  const notes=[];
  if(l!=null&&p!=null&&l-p>=100)notes.push('Hat doluyken gecikme çok artıyor: indirme sırasında oyun ve görüşme takılabilir.');
  if(J>30)notes.push('Gecikme dalgalı: oyun ve görüntülü görüşmede kesilme olabilir.');
  if(u!=null&&u<2&&d>=10)notes.push('Yükleme hızı düşük: görüntülü görüşmede görüntün bulanık gidebilir.');
  return {level,text,notes};
}
// 94 -> "94", 9,4 -> "9,4"
const fmtMbps=v=>v==null?'—':v.toLocaleString('tr-TR',{maximumFractionDigits:v<10?1:0});

// Gecmise eklenecek kayit: yalniz bilinen alanlar (IP adresi saklanmaz)
function historyItem(r){
  const s=v=>typeof v==='string'?v.slice(0,80):null;
  return {at:num(r.at)||Date.now(),down:r1(num(r.down)),up:r1(num(r.up)),ping:r1(num(r.ping)),jitter:r1(num(r.jitter)),loaded:r1(num(r.loaded)),
    isp:s(r.isp),city:s(r.city),colo:s(r.colo),country:s(r.country),level:r.verdict&&r.verdict.level||verdict(r).level};
}
const pushHistory=(list,item)=>[...(Array.isArray(list)?list:[]),item].slice(-HISTORY_MAX);

// --- hiz testi ------------------------------------------------------------------------------
const cancelErr=()=>Object.assign(new Error('Test iptal edildi.'),{code:'CANCELLED'});
const sleep=(ms,signal)=>new Promise(ok=>{if(signal&&signal.aborted)return ok();const t=setTimeout(ok,ms);
  signal&&signal.addEventListener('abort',()=>{clearTimeout(t);ok()},{once:true})});
const serverMs=h=>{const m=/dur=([\d.]+)/.exec(h||'');return m?+m[1]:0};

// opts: {fetch, base, signal, onProgress({phase,mbps,pct,ping?}), maxMs, maxBytes, dlMs, ulMs, dlStreams, ulStreams, pingCount}
async function runTest(opts={}){
  const F=opts.fetch||globalThis.fetch,base=String(opts.base||BASE).replace(/\/+$/,''),now=()=>performance.now();
  const maxMs=Math.min(opts.maxMs||LIMITS.maxMs,LIMITS.maxMs),maxBytes=Math.min(opts.maxBytes||LIMITS.maxBytes,LIMITS.maxBytes);
  const user=opts.signal||new AbortController().signal;
  if(user.aborted)throw cancelErr();
  // Butce: sure ya da bayt siniri dolunca tum istekler kesilir (iptal sayilmaz; olculen kadariyla sonuc verilir)
  const budget=new AbortController(),t0=now(),started=Date.now();
  const deadline=setTimeout(()=>budget.abort(),maxMs);
  let total=0,reserved=0,lastEmit=0,capped=false;
  const left=()=>maxMs-(now()-t0);
  // Bayt butcesi istek baslamadan ayrilir: paralel istekler toplamda siniri asamaz. Indirme en fazla %70'ini kullanir (yuklemeye pay kalsin)
  const take=(want,cap)=>{const n=Math.max(0,Math.min(want,cap-reserved));reserved+=n;if(n<want)capped=true;return n};
  const emit=(o,force)=>{const t=now();if(!force&&t-lastEmit<100)return;lastEmit=t;try{opts.onProgress&&opts.onProgress(o)}catch(e){}};
  const meta={};
  const res={ok:true,down:null,up:null,ping:null,jitter:null,loaded:null,partial:false};
  try{
    // 1) gecikme (ping) + konum bilgisi
    emit({phase:'ping',mbps:null,pct:0},true);
    const metaP=(async()=>{try{const s=AbortSignal.any([user,budget.signal,AbortSignal.timeout(5000)]);
      const r=await F(base+'/meta',{signal:s});if(!r.ok)return;const j=await r.json();
      for(const k of ['colo','city','country','asOrganization'])if(typeof j[k]==='string')meta[k]=j[k]}catch(e){}})();
    const pings=[],pingN=opts.pingCount||20,pingEnd=now()+Math.min(6000,maxMs/4);
    const pingOnce=async signal=>{const a=now(),r=await F(base+'/__down?bytes=0',{signal});await r.arrayBuffer();
      if(!meta.hdr)meta.hdr={colo:r.headers.get('cf-meta-colo'),city:r.headers.get('cf-meta-city'),country:r.headers.get('cf-meta-country'),
        ray:r.headers.get('cf-ray')};
      return Math.max(0.1,now()-a-serverMs(r.headers.get('server-timing')))};
    let pingErr=null;
    for(let i=0;i<=pingN&&now()<pingEnd;i++){
      if(user.aborted)throw cancelErr();if(budget.signal.aborted)break;
      try{const v=await pingOnce(AbortSignal.any([user,budget.signal,AbortSignal.timeout(3000)]));if(i>0)pings.push(v)} // ilk istek baglanti kurulumu: sayilmaz
      catch(e){if(user.aborted)throw cancelErr();pingErr=e;if(!pings.length&&i>=2)break}
      emit({phase:'ping',mbps:null,ping:median(pings),pct:Math.min(10,i/pingN*10)});
    }
    if(!pings.length&&pingErr)throw Object.assign(new Error('İnternete bağlanılamadı. Bağlantını kontrol et.'),{code:'NET',cause:pingErr});
    res.ping=median(pings);res.jitter=jitter(pings);
    await metaP;

    // Ortak olcum asamasi: N paralel akis, her biri boyut merdiveninde yukselir
    async function phase(kind,durMs,streams,pctFrom,pctTo){
      if(user.aborted)throw cancelErr();
      const dur=Math.max(0,Math.min(durMs,left()-200));
      const ctl=new AbortController(),sig=AbortSignal.any([user,budget.signal,ctl.signal]);
      const p0=now(),samples=[{t:0,b:0}];let bytes=0,errors=0,lastErr=null;
      if(dur<=0||budget.signal.aborted){res.partial=true;return {mbps:null,bytes:0}}
      const timer=setTimeout(()=>ctl.abort(),dur);
      const count=n=>{bytes+=n;total+=n};
      const tick=setInterval(()=>{const t=now()-p0;samples.push({t,b:bytes});
        const w=windowRates(samples.slice(-12)).at(-1);
        emit({phase:kind,mbps:w!=null?w:mbps(bytes,t),pct:pctFrom+(pctTo-pctFrom)*Math.min(1,t/dur)})},100);
      const sizes=kind==='down'?DL_SIZES:UL_SIZES;
      let body=null;if(kind==='up')body=opts.uploadBuffer||crypto.randomBytes(sizes.at(-1));
      async function worker(){
        let lvl=0;
        while(!sig.aborted){
          const size=take(sizes[lvl],kind==='down'?maxBytes*0.7:maxBytes);if(!size)break;
          const a=now();let got=0;
          try{
            if(kind==='down'){
              const r=await F(base+'/__down?bytes='+size,{signal:sig});
              if(!r.ok){r.body&&r.body.cancel().catch(()=>{});throw new Error('HTTP '+r.status)}
              if(r.body){const rd=r.body.getReader();for(;;){const {done,value}=await rd.read();if(done)break;got+=value.byteLength;count(value.byteLength)}}
              else{got=(await r.arrayBuffer()).byteLength;count(got)}
            }else{
              const r=await F(base+'/__up',{method:'POST',body:body.subarray(0,size),headers:{'content-type':'application/octet-stream'},signal:sig});
              await r.arrayBuffer().catch(()=>{});if(!r.ok)throw new Error('HTTP '+r.status);
              got=size;count(size);   // yukleme istek bitince sayilir
            }
            reserved-=Math.max(0,size-got);
            if(now()-a<(kind==='down'?1500:1000)&&lvl<sizes.length-1)lvl++;
          }catch(e){reserved-=Math.max(0,size-got);if(sig.aborted)break;errors++;lastErr=e;if(errors>=6)break;await sleep(200,sig)}
        }
      }
      // Yuklu gecikme: indirme surerken (1. saniyeden sonra) gecikme olcumu
      const loaded=[];
      async function loadedPing(){await sleep(1000,sig);
        while(!sig.aborted){try{loaded.push(await pingOnce(sig))}catch(e){}await sleep(250,sig)}}
      // tum akislar bittiyse (bayt siniri) asama erken biter
      const ws=Promise.all(Array.from({length:streams},worker)).then(()=>ctl.abort());
      try{await Promise.all([ws,...(kind==='down'?[loadedPing()]:[])])}
      finally{clearTimeout(timer);clearInterval(tick)}
      if(user.aborted)throw cancelErr();
      samples.push({t:now()-p0,b:bytes});
      if(budget.signal.aborted||capped)res.partial=true;
      if(!bytes&&lastErr)throw Object.assign(new Error((kind==='down'?'İndirme':'Yükleme')+' ölçülemedi: '+lastErr.message),{code:'NET'});
      if(kind==='down')res.loaded=median(loaded);
      return {mbps:throughput(samples),bytes};
    }

    // 2) indirme  3) yukleme
    emit({phase:'down',mbps:0,pct:10},true);
    res.down=(await phase('down',opts.dlMs||9000,opts.dlStreams||5,10,55)).mbps;
    emit({phase:'up',mbps:0,pct:55},true);
    try{res.up=(await phase('up',opts.ulMs||8000,opts.ulStreams||3,55,100)).mbps}
    catch(e){if(e.code==='CANCELLED')throw e;res.up=null;res.upError=e.message}
  }finally{clearTimeout(deadline)}
  const h=meta.hdr||{},ray=/-([A-Z]{3})$/.exec(h.ray||'');
  Object.assign(res,{down:r1(res.down),up:r1(res.up),ping:r1(res.ping),jitter:r1(res.jitter),loaded:r1(res.loaded),
    isp:meta.asOrganization||null,city:meta.city||h.city||null,country:meta.country||h.country||null,colo:meta.colo||h.colo||(ray?ray[1]:null),
    bytes:total,ms:Math.round(now()-t0),at:started,capped});
  res.verdict=verdict(res);
  emit({phase:'done',mbps:res.down,pct:100},true);
  return res;
}

// --- Wi-Fi ----------------------------------------------------------------------------------
// WIFI: bicimi icin kacis: \ ; , : " karakterlerinin onune ters bolu
const escWifi=s=>String(s).replace(/([\\;,:"])/g,'\\$1');
function wifiString({ssid,pass,open,hidden}={}){
  ssid=String(ssid||'');if(!ssid)throw new Error('Ağ adı boş.');
  if(open||!pass)return `WIFI:T:nopass;S:${escWifi(ssid)};${hidden?'H:true;':''};`;
  return `WIFI:T:WPA;S:${escWifi(ssid)};P:${escWifi(pass)};${hidden?'H:true;':''};`;
}
const REDACTED=s=>!s||/^<?redacted>?$/i.test(s.trim());
// `ipconfig getsummary en0` ciktisindan SSID (BSSID satiri degil). Gizlenmisse {redacted:true}
function parseIpconfig(out){
  for(const line of String(out||'').split('\n')){const m=/^\s*SSID\s*:\s?(.*)$/.exec(line);
    if(m){const v=m[1].replace(/\s+$/,'');return REDACTED(v)?{ssid:null,redacted:true}:{ssid:v,redacted:false}}}
  return {ssid:null,redacted:false};
}
// `networksetup -getairportnetwork en0` -> "Current Wi-Fi Network: Ev Agi"
function parseAirport(out){
  const m=/^Current (?:Wi-Fi|AirPort) Network:\s?(.*)$/m.exec(String(out||''));if(!m)return {ssid:null,redacted:false};
  const v=m[1].replace(/\s+$/,'');return REDACTED(v)?{ssid:null,redacted:true}:{ssid:v,redacted:false};
}
// `networksetup -listallhardwareports` -> Wi-Fi aygit adlari (en0, en1...)
function parsePorts(out){
  const devs=[];const blocks=String(out||'').split(/\n\s*\n/);
  for(const b of blocks){const p=/Hardware Port:\s*(.+)/.exec(b),d=/Device:\s*(\S+)/.exec(b);
    if(p&&d&&/wi-?fi|airport/i.test(p[1])&&/^[a-z]+\d+$/.test(d[1]))devs.push(d[1])}
  return devs;
}
const validSsid=s=>typeof s==='string'&&s.length>0&&Buffer.byteLength(s)<=32&&!/[\u0000-\u001f\u007f]/.test(s);

// exec(file,args,{timeout}) -> Promise<stdout>. Kabuk yok; SSID arguman olarak gecer.
async function currentSsid(exec){
  let redacted=false;const tried=new Set();
  const tryDev=async dev=>{tried.add(dev);
    try{const r=parseIpconfig(await exec('/usr/sbin/ipconfig',['getsummary',dev],{timeout:5000}));if(r.ssid)return r.ssid;redacted=redacted||r.redacted}catch(e){}
    try{const r=parseAirport(await exec('/usr/sbin/networksetup',['-getairportnetwork',dev],{timeout:5000}));if(r.ssid)return r.ssid;redacted=redacted||r.redacted}catch(e){}
    return null};
  let s=await tryDev('en0');if(s)return {ssid:s,redacted:false,device:'en0'};
  let devs=[];try{devs=parsePorts(await exec('/usr/sbin/networksetup',['-listallhardwareports'],{timeout:5000}))}catch(e){}
  for(const d of devs){if(tried.has(d))continue;s=await tryDev(d);if(s)return {ssid:s,redacted:false,device:d}}
  return {ssid:null,redacted};
}
// Anahtar Zinciri'nden Wi-Fi sifresi. macOS kendi yonetici/anahtar zinciri onayini sorar. Sifre hicbir yere yazilmaz.
// `security -w` ASCII disi (ör. Türkçe "ç") iceren sifreyi hex olarak yazar; gecerli UTF-8 ve ASCII disi bayt iceriyorsa coz
function hexPass(p){
  if(!/^(?:[0-9a-f]{2})+$/.test(p))return p;
  const b=Buffer.from(p,'hex');if(!b.some(x=>x>=0x80))return p;          // saf ASCII: gercek sifre hex rakamlarindan olusuyor olabilir
  const t=b.toString('utf8');return t.includes('\uFFFD')?p:t;
}
async function wifiPassword(exec,ssid){
  if(!validSsid(ssid))throw Object.assign(new Error('Geçersiz ağ adı.'),{code:'BAD'});
  try{const out=await exec('/usr/bin/security',['find-generic-password','-D','AirPort network password','-a',ssid,'-w'],{timeout:60000});
    const p=hexPass(String(out).replace(/\r?\n$/,''));if(!p)throw Object.assign(new Error('empty'),{code:44});return p}
  catch(e){
    const msg=String(e&&(e.stderr||e.message)||'');
    if(e&&e.killed||e&&e.signal)throw Object.assign(new Error('Onay zaman aşımına uğradı.'),{code:'TIMEOUT'});
    if(e&&(e.code===44||/could not be found/i.test(msg)))throw Object.assign(new Error('Bu ağın şifresi Anahtar Zinciri\'nde bulunamadı. Şifreyi elle yazabilirsin.'),{code:'NOTFOUND'});
    if(e&&(e.code===128||e.code===51||/cancel|denied|interaction/i.test(msg)))throw Object.assign(new Error('Şifre erişimine izin verilmedi.'),{code:'DENIED'});
    throw Object.assign(new Error('Şifre okunamadı.'),{code:'FAIL'});
  }
}

module.exports={BASE,LIMITS,DL_SIZES,UL_SIZES,HISTORY_MAX,mbps,percentile,median,jitter,windowRates,throughput,verdict,fmtMbps,
  historyItem,pushHistory,runTest,escWifi,wifiString,parseIpconfig,parseAirport,parsePorts,validSsid,currentSsid,wifiPassword,hexPass};
