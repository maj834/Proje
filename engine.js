// Yerel (ucretsiz, cevrimdisi) mum grafigi okuyucu.
// Ekran goruntusundeki yesil/kirmizi mumlari piksel duzeyinde bulur; destek/direnc,
// trend cizgileri, trend yonu ve basit formasyonlari cikarir. Fiyat eksenini okumaz,
// tum konumlar ekran goruntusune gore 0-1 araliginda normalize edilir.
(function(root){

// Mum rengi: doygun ve parlak yesil/kirmizi. Yari saydam hacim cubuklari ve
// soluk metinler esiklere takilir.
function classify(r,g,b){
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
  if(mx<120||mx-mn<90)return 0;
  if(g>r+60&&g>=b-30)return 1;           // yesil / turkuaz
  if(r>g+70&&r>b+50)return 2;            // kirmizi
  return 0;
}

// En genis dolu araligi bul (bosluk toleransiyla).
function runs(arr,gap,minVal=1){
  const out=[];let s=-1,last=-1,sum=0;
  for(let i=0;i<arr.length;i++){
    if(arr[i]>=minVal){if(s<0)s=i;else if(i-last>gap){out.push({s,e:last,sum});s=i;sum=0}last=i;sum+=arr[i]}
  }
  if(s>=0)out.push({s,e:last,sum});
  return out;
}


// --- indikatorler ----------------------------------------------------------
// Fiyat ekseni okunmadigi icin hesaplar piksel uzayinda yapilir: p = -y. EMA, Bollinger
// ve MACD dogrusal donusumle birebir tasinir; RSI ise olcekten bagimsizdir.
function ema(a,n){const k=2/(n+1),o=[];let e=a[0];for(let i=0;i<a.length;i++){e=i?a[i]*k+e*(1-k):a[0];o.push(e)}return o}
function sma(a,n){const o=[];let s=0;for(let i=0;i<a.length;i++){s+=a[i];if(i>=n)s-=a[i-n];o.push(i>=n-1?s/n:null)}return o}
function rsi(a,n=14){const o=new Array(a.length).fill(null);if(a.length<=n)return o;let g=0,l=0;
  for(let i=1;i<=n;i++){const d=a[i]-a[i-1];if(d>0)g+=d;else l-=d}g/=n;l/=n;o[n]=l?100-100/(1+g/l):g?100:50;
  for(let i=n+1;i<a.length;i++){const d=a[i]-a[i-1];g=(g*(n-1)+Math.max(d,0))/n;l=(l*(n-1)+Math.max(-d,0))/n;o[i]=l?100-100/(1+g/l):g?100:50}return o} // hareketsiz seri: 50

// Son mumlardaki klasik mum formasyonlari. Degerler fiyat yonunde (yukari = buyuk).
function candlePattern(cs){
  const n=cs.length;if(n<3)return null;
  const P=c=>({o:-c.open,c:-c.close,h:-c.hi,l:-c.lo}),a=P(cs[n-3]),b=P(cs[n-2]),c=P(cs[n-1]);
  const body=x=>Math.abs(x.c-x.o),rng=x=>Math.max(1e-6,x.h-x.l),up=x=>x.c>x.o;
  const uw=x=>x.h-Math.max(x.o,x.c),lw=x=>Math.min(x.o,x.c)-x.l;
  const avg=cs.slice(-12).reduce((s,k)=>s+Math.abs(k.open-k.close),0)/Math.min(12,n)||1;
  if(rng(c)<avg*0.6)return null; // cok kucuk mumlarda formasyon arama
  if(!up(b)&&up(c)&&c.c>=b.o&&c.o<=b.c&&body(c)>body(b))return{name:'Yutan boğa',dir:1};
  if(up(b)&&!up(c)&&c.c<=b.o&&c.o>=b.c&&body(c)>body(b))return{name:'Yutan ayı',dir:-1};
  if(!up(a)&&body(a)>avg&&body(b)<avg*0.4&&up(c)&&c.c>(a.o+a.c)/2)return{name:'Sabah yıldızı',dir:1};
  if(up(a)&&body(a)>avg&&body(b)<avg*0.4&&!up(c)&&c.c<(a.o+a.c)/2)return{name:'Akşam yıldızı',dir:-1};
  if(lw(c)>=2*body(c)&&uw(c)<=Math.max(body(c),rng(c)*0.1)&&body(c)>0)return{name:'Çekiç',dir:1};
  if(uw(c)>=2*body(c)&&lw(c)<=Math.max(body(c),rng(c)*0.1)&&body(c)>0)return{name:'Kayan yıldız',dir:-1};
  if(body(c)<=rng(c)*0.1)return{name:'Doji',dir:0};
  return null;
}

// Renk yardimcilari: ton (derece), ton farki, '#rrggbb' -> [r,g,b].
function hueOf(r,g,b){const mx=Math.max(r,g,b),d=mx-Math.min(r,g,b);if(!d)return 0;let h=mx===r?((g-b)/d)%6:mx===g?(b-r)/d+2:(r-g)/d+4;h*=60;return h<0?h+360:h}
function hueDist(a,b){const d=Math.abs(a-b)%360;return d>180?360-d:d}
function parseHex(s){const m=/^#?([0-9a-f]{6})$/i.exec(String(s==null?'':s).trim());if(!m)return null;const v=parseInt(m[1],16);return[v>>16,(v>>8)&255,v&255]}
// Iki renge RGB uzakligiyla siniflandir (1 = yukselis, 2 = dusus).
function maskByColors(buf,W,H,bgra,up,dn,tol){
  const mask=new Uint8Array(W*H),t2=tol*tol;
  for(let i=0,p=0;i<W*H;i++,p+=4){
    const r=bgra?buf[p+2]:buf[p],g=buf[p+1],b=bgra?buf[p]:buf[p+2];
    const du=(r-up[0])**2+(g-up[1])**2+(b-up[2])**2,dd=(r-dn[0])**2+(g-dn[1])**2+(b-dn[2])**2;
    if(du<=t2&&du<=dd)mask[i]=1;else if(dd<=t2)mask[i]=2;
  }
  return mask;
}

// Secili alanin piksellerini ayri bir tampona kopyala (alan cok kucuk/gecersizse null: tum goruntu kullanilir).
function cropRoi(buf,W,H,r){
  if(!r||![r.x,r.y,r.w,r.h].every(Number.isFinite))return null;
  const x=Math.max(0,Math.round(r.x*W)),y=Math.max(0,Math.round(r.y*H)),x2=Math.min(W,Math.round((r.x+r.w)*W)),y2=Math.min(H,Math.round((r.y+r.h)*H));
  const w=x2-x,h=y2-y;if(w<60||h<40||(w===W&&h===H))return null;
  const out=new Uint8Array(w*h*4);
  for(let j=0;j<h;j++){const s=((y+j)*W+x)*4;out.set(buf.subarray(s,s+w*4),j*w*4)}
  return {buf:out,W:w,H:h,x,y};
}

// opts.colors: undefined/'auto' (yesil-kirmizi, yetmezse baskin iki tonu otomatik bul),
// 'green-red' (yalniz klasik), {up:'#rrggbb',down:'#rrggbb',tol:60} (ozel renkler).
// opts.roi: {x,y,w,h} (0-1) yalniz bu alanda (kullanicinin sectigi grafik alani) ara; cikti yine tum goruntuye gore 0-1.
function analyzeBitmap(buf,W,H,opts={}){
  const roi=cropRoi(buf,W,H,opts.roi);
  if(roi){const out=analyzeBitmap(roi.buf,roi.W,roi.H,{...opts,roi:null,frame:{ox:roi.x,oy:roi.y,FW:W,FH:H}});out.roi=opts.roi;return out}
  const fr=opts.frame;
  const bgra=opts.format!=='rgba',col=opts.colors;
  if(col&&typeof col==='object'){
    const up=parseHex(col.up),dn=parseHex(col.down);
    if(up&&dn){const out=analyzeMask(maskByColors(buf,W,H,bgra,up,dn,+col.tol>0?+col.tol:60),W,H,fr);out.colorMode='custom';return out}
  }
  const mask=new Uint8Array(W*H),q=new Uint32Array(32768);let c1=0,c2=0;
  for(let i=0,p=0;i<W*H;i++,p+=4){
    const r=bgra?buf[p+2]:buf[p],g=buf[p+1],b=bgra?buf[p]:buf[p+2];
    const m=classify(r,g,b);mask[i]=m;if(m===1)c1++;else if(m===2)c2++;
    // doygun+parlak piksellerin kaba renk histogrami (5 bit/kanal)
    const mx=Math.max(r,g,b);if(mx>=120&&mx-Math.min(r,g,b)>=90)q[(r>>3)<<10|(g>>3)<<5|b>>3]++;
  }
  // Yesil/kirmizi az ya da tek yanliysa (mavi-kirmizi, turkuaz-turuncu temalar) baskin iki rengi bul.
  if(col!=='green-red'&&(Math.min(c1,c2)<Math.max(c1,c2)*0.25||c1+c2<W*H*0.002)){
    const rep=k=>[(k>>10)*8+4,((k>>5)&31)*8+4,(k&31)*8+4],ks=[],hs=[],chs=[],hist=new Float64Array(36);
    for(let k=0;k<32768;k++)if(q[k]){const c=rep(k),h=hueOf(c[0],c[1],c[2]);ks.push(k);hs.push(h);chs.push(Math.max(...c)-Math.min(...c));hist[Math.floor(h/10)%36]+=q[k]}
    const sm=i=>hist[(i+35)%36]+hist[i]+hist[(i+1)%36];
    let b1=0;for(let i=1;i<36;i++)if(sm(i)>sm(b1))b1=i;
    let b2=-1;for(let i=0;i<36;i++)if(hueDist(i*10+5,b1*10+5)>=50&&(b2<0||sm(i)>sm(b2)))b2=i;
    // Kumedeki temsilci: en doygun renklere yakin (yari saydam hacim karisimlari daha soluk) en sik renk.
    const pickRep=bin=>{const hc=bin*10+5,idx=[];let tot=0,cmax=0;for(let j=0;j<ks.length;j++)if(hueDist(hs[j],hc)<=20){idx.push(j);tot+=q[ks[j]]}
      for(const j of idx)if(q[ks[j]]>=Math.max(20,tot*0.01)&&chs[j]>cmax)cmax=chs[j];
      let best=-1;for(const j of idx)if(chs[j]>=cmax*0.8&&(best<0||q[ks[j]]>q[ks[best]]))best=j;return best<0?-1:ks[best]};
    const k1=pickRep(b1),k2=b2>=0&&sm(b2)>=sm(b1)*0.08?pickRep(b2):-1,hk=k=>{const c=rep(k);return hueOf(c[0],c[1],c[2])};
    if(k1>=0&&k2>=0&&q[k2]>=W*H*0.0003){
      const a=rep(k1),b=rep(k2),ca=classify(...a),cb=classify(...b);
      if(!(ca&&cb&&ca!==cb)){ // klasik cift degilse ton modu
        const aUp=hueDist(hk(k1),120)<=hueDist(hk(k2),120);
        const out=analyzeMask(maskByColors(buf,W,H,bgra,aUp?a:b,aUp?b:a,60),W,H,fr);
        if(out.chart_found){out.colorMode='auto-hue';return out}
      }
    }
  }
  const out=analyzeMask(mask,W,H,fr);out.colorMode='green-red';return out;
}

function analyzeMask(mask,W,H,frame){
  const none={chart_found:false,engine:'yerel'};
  // 1) Yatay ince cizgileri (son fiyat cizgisi, izgara) temizle.
  const rowCov=new Uint32Array(H);
  for(let y=0;y<H;y++){let c=0;for(let x=0;x<W;x++)if(mask[y*W+x])c++;rowCov[y]=c}
  for(let y=0;y<H;y++){
    const nb=Math.max(y>=3?rowCov[y-3]:0,y+3<H?rowCov[y+3]:0);
    if(rowCov[y]>W*0.12&&rowCov[y]>2.5*nb+4)for(let x=0;x<W;x++)mask[y*W+x]=0;
  }
  // 2) Once kaba dikey bant (ust arac cubugundaki Al/Sat butonlari disarida kalsin),
  //    sonra o bantta mumlarin bulundugu sutun araligi.
  for(let y=0;y<H;y++){let c=0;for(let x=0;x<W;x++)if(mask[y*W+x])c++;rowCov[y]=c}
  const vGap=Math.max(20,Math.round(H*0.04));
  const band0=runs(rowCov,vGap).sort((a,b)=>b.sum-a.sum)[0];
  if(!band0)return none;
  const colCov=new Uint32Array(W);
  for(let y=band0.s;y<=band0.e;y++)for(let x=0;x<W;x++)if(mask[y*W+x])colCov[x]++;
  const cr=runs(colCov,Math.max(8,Math.round(W*0.012))).filter(r=>r.e-r.s>W*0.12).sort((a,b)=>b.sum-a.sum)[0];
  if(!cr)return none;
  // 3) Bu sutunlarda dikey bant (ust menu, butonlar vb. disarida kalsin).
  const rowIn=new Uint32Array(H);
  for(let y=0;y<H;y++){let c=0;for(let x=cr.s;x<=cr.e;x++)if(mask[y*W+x])c++;rowIn[y]=c}
  const rr=runs(rowIn,vGap).sort((a,b)=>b.sum-a.sum)[0];
  if(!rr||rr.e-rr.s<H*0.08)return none;
  const X0=cr.s,X1=cr.e,Y0=rr.s;let Y1=rr.e;
  // 3b) Grafik alanina gore ince yatay cizgiler: ekranin kucuk bir bolumundeki grafikte son fiyat cizgisi
  //     (kesikli, mum renginde) tum ekran genisligine gore esigin altinda kalir ve mumlari birlestirir.
  const cw=X1-X0+1,rowC=new Uint32Array(H);
  for(let y=Y0;y<=Y1;y++){let c=0;for(let x=X0;x<=X1;x++)if(mask[y*W+x])c++;rowC[y]=c}
  for(let y=Y0;y<=Y1;y++){const nb=Math.max(y-3>=Y0?rowC[y-3]:0,y+3<=Y1?rowC[y+3]:0);
    if(rowC[y]>cw*0.3&&rowC[y]>2.5*nb+4)for(let x=X0;x<=X1;x++)mask[y*W+x]=0}
  // 3c) Hacim cubuklari (ayni tabandan yukselen dolu cubuklar): mumlarin altini bozmasin diye temizlenir.
  Y1=stripVolume(mask,W,X0,X1,Y0,Y1);

  // 4) Sutunlari mumlara ayir.
  const hiC=new Int32Array(W).fill(-1),loC=new Int32Array(W).fill(-1),colG=new Uint32Array(W),colR=new Uint32Array(W);
  for(let x=X0;x<=X1;x++)for(let y=Y0;y<=Y1;y++){const m=mask[y*W+x];if(!m)continue;
    if(hiC[x]<0)hiC[x]=y;loC[x]=y;if(m===1)colG[x]++;else colR[x]++}
  let candles=[];
  for(let x=X0;x<=X1;){
    if(hiC[x]<0){x++;continue}
    let e=x;while(e+1<=X1&&hiC[e+1]>=0)e++;
    let hi=1e9,lo=-1,g=0,r=0;for(let k=x;k<=e;k++){hi=Math.min(hi,hiC[k]);lo=Math.max(lo,loC[k]);g+=colG[k];r+=colR[k]}
    candles.push({x0:x,x1:e,x:(x+e)/2,hi,lo,up:g>=r});
    x=e+1;
  }
  // Fiyat ekseni etiketi (son fiyat kutusu) ya da kenardaki dugme mum sayilmasin: uclardaki asiri genis parca atilir.
  const widths=candles.map(c=>c.x1-c.x0+1).sort((a,b)=>a-b),medW=widths[widths.length>>1]||0;
  if(candles.length>=15){const wide=c=>c.x1-c.x0+1>Math.max(medW*2.5,medW+6);
    while(candles.length>=15&&wide(candles[candles.length-1]))candles.pop();
    while(candles.length>=15&&wide(candles[0]))candles.shift()}
  // Mumlar birlesmisse (cok uzaklastirilmis grafik) sutun bazli calis.
  if(candles.length<15||medW>(X1-X0)/12){
    candles=[];const step=Math.max(2,Math.round((X1-X0)/150));
    for(let x=X0;x<=X1;x+=step){let hi=1e9,lo=-1,g=0,r=0;
      for(let k=x;k<Math.min(X1+1,x+step);k++)if(hiC[k]>=0){hi=Math.min(hi,hiC[k]);lo=Math.max(lo,loC[k]);g+=colG[k];r+=colR[k]}
      if(lo>=0)candles.push({x0:x,x1:x+step-1,x:x+step/2,hi,lo,up:g>=r})}
  }
  if(candles.length<10)return none;
  const N=candles.length;
  // Kapanis: govdenin (en az 2 sutun dolu satirlar) ust/alt kenari.
  let hollowN=0;
  for(const c of candles){
    let bt=-1,bb=-1;
    if(c.x1-c.x0>=2)for(let y=c.hi;y<=c.lo;y++){let n=0;for(let x=c.x0;x<=c.x1;x++)if(mask[y*W+x])n++;if(n>=2){if(bt<0)bt=y;bb=y}}
    // Ici bos (cerceve) govde: sol ve sag kenar sutunlari ayni satirlarda dolu, ic kisim bos.
    // Govde = kenarlarin birlikte dolu oldugu satirlarin dikdortgeni. Dolu mumlarda ic dolu oldugundan degismez.
    if(c.x1-c.x0>=3&&bt>=0&&bb-bt>=3){
      const on=(x,y)=>mask[y*W+x]||mask[y*W+x+(x===c.x0?1:-1)];
      let et=-1,eb=-1,rows=0,fill=0,inner=0;
      for(let y=bt;y<=bb;y++){if(on(c.x0,y)&&on(c.x1,y)){if(et<0)et=y;eb=y;rows++;for(let x=c.x0+2;x<=c.x1-2;x++){inner++;if(mask[y*W+x])fill++}}}
      if(rows>=3&&inner&&fill/inner<0.45&&rows>=(eb-et+1)*0.8){c.hollow=true;hollowN++;bt=et;bb=eb}
    }
    if(bt<0){bt=c.hi;bb=c.lo}
    c.open=c.up?bb:bt;c.close=c.up?bt:bb;
  }

  const out=analyzeCandles(candles,{X0:candles[0].x0,X1:candles[N-1].x1,Y0,Y1,W,H,minTol:3,frame});
  out.candleStyle=hollowN>=Math.max(3,N*0.15)?'hollow':'filled';
  return out;
}

// Hacim paneli: sutunlarin en alt pikseli cogunlukla ayni satirdaysa (ortak taban) alttan yukselen dolu cubuklar vardir.
// Her sutunda tabandan yukari kesintisiz parca (hacim cubugu) silinir; mumla birlesen sutunlarda yalniz tipik cubuk boyu.
// Yeni alt sinir (Y1) doner.
function stripVolume(mask,W,X0,X1,Y0,Y1){
  const lo=new Int32Array(X1-X0+1).fill(-1),cnt=new Map();let occ=0;
  for(let x=X0;x<=X1;x++){for(let y=Y1;y>=Y0;y--)if(mask[y*W+x]){lo[x-X0]=y;break}if(lo[x-X0]>=0){occ++;cnt.set(lo[x-X0],(cnt.get(lo[x-X0])||0)+1)}}
  if(occ<20)return Y1;
  let base=-1,bn=0;for(const [y,n] of cnt){const m=n+(cnt.get(y-1)||0)+(cnt.get(y+1)||0);if(m>bn){bn=m;base=y}}
  if(bn<occ*0.4||base<Y1-3)return Y1;
  // Panel arasinda bos satir varsa (ayri hacim paneli) bosluktan asagisi tamamen hacimdir.
  for(let y=base,lim=base-(Y1-Y0)*0.6;y>lim&&y>Y0;y--){let c=0;for(let x=X0;x<=X1&&!c;x++)if(mask[y*W+x])c=1;
    if(!c){for(let k=y;k<=Y1;k++)for(let x=X0;x<=X1;x++)mask[k*W+x]=0;let t=y;while(t>Y0){let e=0;for(let x=X0;x<=X1&&!e;x++)if(mask[t*W+x])e=1;if(e)break;t--}return t>Y0?t:Y1}}
  // Her cubuk (yan yana taban sutunlari) icin boy = en kisa sutun parcasi: fitil cubuga degse de govde sutunlari cubugun ustunde biter.
  const run=x=>{let y=lo[x-X0],n=0;while(y>=Y0&&mask[y*W+x]){y--;n++}return n};
  const isB=x=>lo[x-X0]>=0&&Math.abs(lo[x-X0]-base)<=1;
  const hs=[];
  for(let x=X0;x<=X1;){if(!isB(x)){x++;continue}let e=x,m=1e9;while(e<=X1&&isB(e)){m=Math.min(m,run(e));e++}hs.push({s:x,e:e-1,h:m});x=e}
  const hv=hs.map(b=>b.h).sort((a,b)=>a-b)[Math.floor(hs.length*0.5)]||0;
  if(hv<2||hv>(Y1-Y0)*0.6)return Y1;
  for(const b of hs)for(let x=b.s;x<=b.e;x++){const l=lo[x-X0];for(let k=0;k<b.h;k++)mask[(l-k)*W+x]=0}
  let nY1=Y0;for(let x=X0;x<=X1;x++)for(let y=Y1;y>nY1;y--)if(mask[y*W+x]){nY1=y;break}
  return nY1>Y0?nY1:Y1;
}

// Mumlardan analiz. Koordinatlar "y" ekseninde: buyuk y = dusuk fiyat (ekran pikseli gibi).
// Ekran icin W/H normalize eder; gercek fiyat serisi icin analyzeSeries y=-fiyat ve H=-1 verir.
function analyzeCandles(candles,{X0,X1,Y0,Y1,W,H,minTol=3,frame}){
  // frame: kirpilmis alanin tum goruntudeki yeri; normalize koordinatlar tum goruntuye gore verilir.
  const ox=frame?frame.ox:0,oy=frame?frame.oy:0,FW=frame?frame.FW:W,FH=frame?frame.FH:H;
  const N=candles.length;
  // Yatay (hareketsiz) seride yukseklik 0 olur: bolmeler icin kucuk bir pozitif deger
  const span=(Y1-Y0)||Math.abs(Y0)*0.01||1,tol=Math.max(minTol,span*0.012);
  // 5) Pivotlar.
  const k=Math.max(2,Math.round(N/30)),ph=[],pl=[];
  for(let i=k;i<N-1;i++){
    let isH=true,isL=true;
    for(let j=Math.max(0,i-k);j<=Math.min(N-1,i+k);j++){if(j===i)continue;if(candles[j].hi<candles[i].hi)isH=false;if(candles[j].lo>candles[i].lo)isL=false}
    if(isH)ph.push(i);if(isL)pl.push(i);
  }
  const last=candles[N-1],lastY=last.close;

  // 6) Destek/direnc kumeleri.
  const pts=[...ph.map(i=>({y:candles[i].hi,i})),...pl.map(i=>({y:candles[i].lo,i}))].sort((a,b)=>a.y-b.y);
  const clusters=[];
  for(const p of pts){const c=clusters[clusters.length-1];
    if(c&&p.y-c.ys[c.ys.length-1]<=tol){c.ys.push(p.y);c.is.push(p.i)}else clusters.push({ys:[p.y],is:[p.i]})}
  const lv=clusters.map(c=>{const y=c.ys.reduce((a,b)=>a+b,0)/c.ys.length;const rec=Math.max(...c.is)/N;
    return{y,touches:c.ys.length,first:Math.min(...c.is),score:c.ys.length+rec*1.5}});
  const pick=(arr,dir)=>{const out=[];
    for(const l of arr.sort((a,b)=>b.score-a.score)){if(out.length>=3)break;if(out.every(o=>Math.abs(o.y-l.y)>tol*2))out.push(l)}
    return out.sort((a,b)=>dir*(a.y-b.y))};
  const top=Math.min(...candles.map(c=>c.hi)),bot=Math.max(...candles.map(c=>c.lo));
  const strong=l=>l.touches>=2||Math.abs(l.y-top)<=tol||Math.abs(l.y-bot)<=tol;
  const side=f=>{const a=lv.filter(f),s=a.filter(strong);return s.length?s:a.slice(0,1)};
  const res=pick(side(l=>l.y<lastY-tol*0.5),-1),sup=pick(side(l=>l.y>lastY+tol*0.5),1);

  // 7) Trend cizgileri: son pivot ciftlerinden ihlal edilmeyen en cok temasli dogru.
  const line=(idx,key,dir)=>{let best=null;const cand=idx.slice(-6);
    for(let a=0;a<cand.length;a++)for(let b=a+1;b<cand.length;b++){
      const i=cand[a],j=cand[b];if(j-i<3)continue;
      const y1=candles[i][key],y2=candles[j][key],m=(y2-y1)/(j-i);
      if(dir*m<=0)continue; // destek yukselen (y azalan), direnc alcalan (y artan)
      let ok=true,touch=0;
      for(let t=i;t<N;t++){const ly=y1+m*(t-i),v=candles[t][key];
        if(key==='lo'?v>ly+tol*1.5:v<ly-tol*1.5){if(t<N-3){ok=false;break}}
        if(Math.abs(v-ly)<=tol)touch++}
      if(!ok)continue;
      const sc=touch+j/N;if(!best||sc>best.sc)best={sc,i,j,y1,m,touch}}
    if(!best||best.touch<2)return null;
    return{x1:candles[best.i].x,y1:best.y1,x2:candles[N-1].x+(X1-X0)*0.04,y2:best.y1+best.m*(N-1-best.i+(X1-X0)*0.04/((X1-X0)/N)),touch:best.touch}};
  const tSup=line(pl,'lo',-1),tRes=line(ph,'hi',1);

  // 8) Trend: kapanislara dogrusal regresyon.
  const n=Math.min(N,Math.max(20,Math.round(N*0.6))),xs=[],ys=[];
  for(let i=N-n;i<N;i++){xs.push(i);ys.push(candles[i].close)}
  const mx=xs.reduce((a,b)=>a+b,0)/n,my=ys.reduce((a,b)=>a+b,0)/n;
  let sxy=0,sxx=0,syy=0;for(let i=0;i<n;i++){sxy+=(xs[i]-mx)*(ys[i]-my);sxx+=(xs[i]-mx)**2;syy+=(ys[i]-my)**2}
  const slope=sxx?sxy/sxx:0,r2=syy?(sxy*sxy)/(sxx*syy):0;
  const move=-slope*n/span; // pozitif = yukari
  const bias=move>0.12?'yukselis':move<-0.12?'dusus':'notr';
  const trend=bias==='yukselis'?(r2>0.6?'Güçlü yükselen trend':'Yükselen trend'):bias==='dusus'?(r2>0.6?'Güçlü düşen trend':'Düşen trend'):'Yatay seyir';
  const confidence=Math.round(Math.min(90,35+r2*40+Math.min(15,Math.abs(move)*30)));

  // 9) Formasyonlar.
  const patterns=[];
  const dbl=(idx,key,name)=>{const a=idx.slice(-2);if(a.length===2&&a[1]-a[0]>=5&&Math.abs(candles[a[0]][key]-candles[a[1]][key])<=tol*1.2&&N-1-a[1]<N*0.3)patterns.push(name)};
  dbl(ph,'hi','İkili tepe');dbl(pl,'lo','İkili dip');
  if(tSup&&tRes)patterns.push('Daralan üçgen');
  else if(tSup)patterns.push('Yükselen dipler');
  else if(tRes)patterns.push('Alçalan tepeler');

  // 10) Kirilim: son 3 mumda en yakin seviyenin gecilmesi.
  let breakout=null;const prev=candles[Math.max(0,N-4)].close;
  const crossedUp=lv.filter(l=>prev>l.y+tol*0.5&&lastY<l.y-tol*0.5&&l.touches>=2);
  const crossedDn=lv.filter(l=>prev<l.y-tol*0.5&&lastY>l.y+tol*0.5&&l.touches>=2);
  if(crossedUp.length)breakout='Fiyat '+crossedUp[0].touches+' temaslı direnci yukarı kırdı.';
  else if(crossedDn.length)breakout='Fiyat '+crossedDn[0].touches+' temaslı desteği aşağı kırdı.';

  const nx=x=>+((x+ox)/FW).toFixed(4),ny=y=>+((y+oy)/FH).toFixed(4);
  const L=a=>a.map(l=>({price:null,y:ny(l.y),touches:l.touches}));

  // 11) Indikatorler (kapanislar fiyat yonunde: -y).
  const cl=candles.map(c=>-c.close),xsN=candles.map(c=>nx(c.x));
  const e20=ema(cl,20),e50=ema(cl,50),m20=sma(cl,20),R=rsi(cl,14);
  const sd=cl.map((_,i)=>{if(i<19)return null;let s2=0;for(let j=i-19;j<=i;j++)s2+=(cl[j]-m20[i])**2;return Math.sqrt(s2/20)});
  const e26=ema(cl,26),macd=ema(cl,12).map((v,i)=>v-e26[i]),sig=ema(macd,9),hist=macd.map((v,i)=>v-sig[i]);
  const poly=(arr,from)=>arr.map((v,i)=>i>=from&&v!=null?[xsN[i],ny(-v)]:null).filter(Boolean);
  // Esitlikte (yuvarlama payi icinde) yon 0: yatay seri ayi sayilmasin
  const sgn=v=>Math.abs(v)<=span*1e-9?0:Math.sign(v);
  const r=R[N-1],eUp=e20[N-1]>e50[N-1],eD=sgn(e20[N-1]-e50[N-1]),aD=sgn(cl[N-1]-e20[N-1]),hD=sgn(hist[N-1]);
  const crossM=hist[N-1]>0&&hist.slice(-4,-1).some(h=>h<=0)?1:hist[N-1]<0&&hist.slice(-4,-1).some(h=>h>=0)?-1:0;
  const crossE=e20[N-1]>e50[N-1]&&e20.slice(-6,-1).some((v,i)=>v<=e50[N-6+i])?1:e20[N-1]<e50[N-1]&&e20.slice(-6,-1).some((v,i)=>v>=e50[N-6+i])?-1:0;
  const bbU=m20[N-1]!=null?m20[N-1]+2*sd[N-1]:null,bbL=m20[N-1]!=null?m20[N-1]-2*sd[N-1]:null;
  // RSI uyumsuzlugu: son iki pivot dip/tepe.
  let div=null;
  const l2=pl.slice(-2),h2=ph.slice(-2);
  if(l2.length===2&&R[l2[0]]!=null&&N-1-l2[1]<N*0.25&&-candles[l2[1]].lo<-candles[l2[0]].lo-tol*0.3&&R[l2[1]]>R[l2[0]]+3)div={name:'Pozitif RSI uyumsuzluğu',dir:1};
  else if(h2.length===2&&R[h2[0]]!=null&&N-1-h2[1]<N*0.25&&-candles[h2[1]].hi>-candles[h2[0]].hi+tol*0.3&&R[h2[1]]<R[h2[0]]-3)div={name:'Negatif RSI uyumsuzluğu',dir:-1};
  const cp=candlePattern(candles);
  if(cp&&cp.dir!==0)patterns.push(cp.name);
  if(div)patterns.push(div.name);

  // 12) Otomatik Fibonacci: son %70'lik bolumdeki en buyuk salinim.
  const from=Math.floor(N*0.3);let iH=from,iL=from;
  for(let i=from;i<N;i++){if(candles[i].hi<candles[iH].hi)iH=i;if(candles[i].lo>candles[iL].lo)iL=i}
  const fibUp=iL<iH; // dipten tepeye: geri cekilme seviyeleri asagi dogru
  const fy0=candles[fibUp?iH:iL][fibUp?'hi':'lo'],fy1=candles[fibUp?iL:iH][fibUp?'lo':'hi'];
  const fib=Math.abs(fy1-fy0)>span*0.15?{x1:nx(candles[Math.min(iH,iL)].x),x2:nx(X1),up:fibUp,
    levels:[0,0.236,0.382,0.5,0.618,0.786,1].map(f=>({f,y:ny(fy0+(fy1-fy0)*f)}))}:null;

  // 13) Teknik gorunum skoru (-100..100) ve gerekceleri.
  const F=[];const add=(v,t)=>{if(v)F.push({v,t})};
  add(bias==='yukselis'?Math.round(10+r2*15):bias==='dusus'?-Math.round(10+r2*15):0,trend);
  add(eD*12,eD>0?'EMA20 > EMA50':'EMA20 < EMA50');
  add(crossE*10,crossE>0?'EMA20, EMA50\'yi yukarı kesti':'EMA20, EMA50\'yi aşağı kesti');
  add(aD*6,aD>0?'Fiyat EMA20 üzerinde':'Fiyat EMA20 altında');
  if(r!=null)add(r>=70?-10:r<=30?10:r>=55?6:r<=45?-6:0,r>=70?'RSI aşırı alımda ('+Math.round(r)+')':r<=30?'RSI aşırı satımda ('+Math.round(r)+')':'RSI '+Math.round(r));
  add(hD*8,hD>0?'MACD pozitif':'MACD negatif');
  add(crossM*7,crossM>0?'MACD sinyal kesişimi (yukarı)':'MACD sinyal kesişimi (aşağı)');
  if(cp)add(cp.dir*10,cp.name+' mumu');
  if(div)add(div.dir*14,div.name);
  if(crossedUp.length)add(14,'Direnç kırılımı');else if(crossedDn.length)add(-14,'Destek kırılımı');
  if(res.length&&(lastY-res[0].y)/span<0.04)add(-5,'Dirence çok yakın');
  if(sup.length&&(sup[0].y-lastY)/span<0.04)add(5,'Desteğe çok yakın');
  const score=Math.max(-100,Math.min(100,F.reduce((a,f)=>a+f.v,0)));
  // Risk/odul: en yakin dirence uzaklik / en yakin destege uzaklik.
  const riskReward=res.length&&sup.length?+((lastY-res[0].y)/Math.max(span*1e-3,sup[0].y-lastY)).toFixed(2):null;
  const ind={rsi:r!=null?Math.round(r):null,rsiSeries:R.slice(-60).map(v=>v==null?null:Math.round(v)),
    macd:hD>0?'pozitif':hD<0?'negatif':'notr',macdCross:crossM,emaTrend:eD>0?'yukari':eD<0?'asagi':'yatay',emaCross:crossE,
    bb:bbU!=null?{pos:Math.round((cl[N-1]-bbL)/Math.max(1e-6,bbU-bbL)*100),width:Math.round((bbU-bbL)/span*100)}:null,
    candle:cp&&cp.name,divergence:div&&div.name};
  // 14) Gecmis AL/SAT isaretleri: trendin dondugu mumlar (her biri gerekceleriyle).
  const signals=[];let lastDir=0,lastI=-99;
  for(let i=Math.max(26,20);i<N;i++){
    let v=0;const why=[];
    if(e20[i]>e50[i]&&e20[i-1]<=e50[i-1]){v+=2;why.push('EMA20↑EMA50')}
    if(e20[i]<e50[i]&&e20[i-1]>=e50[i-1]){v-=2;why.push('EMA20↓EMA50')}
    if(hist[i]>0&&hist[i-1]<=0){v+=1;why.push('MACD↑')}
    if(hist[i]<0&&hist[i-1]>=0){v-=1;why.push('MACD↓')}
    if(R[i]!=null&&R[i-1]!=null){if(R[i-1]<30&&R[i]>=30){v+=1.5;why.push('RSI dipten döndü')}if(R[i-1]>70&&R[i]<=70){v-=1.5;why.push('RSI tepeden döndü')}}
    const lb=Math.max(0,i-12),hh=Math.max(...cl.slice(lb,i)),ll=Math.min(...cl.slice(lb,i));
    if(cl[i]>hh&&cl[i-1]<=hh){v+=1;why.push('12 mumun zirvesi kırıldı')}
    if(cl[i]<ll&&cl[i-1]>=ll){v-=1;why.push('12 mumun dibi kırıldı')}
    // Trend filtresi: EMA50 yonune ters zayif isaretleri ele.
    const slope50=e50[i]-e50[Math.max(0,i-5)];
    if(v>0&&slope50<0&&v<2.5)v=0;if(v<0&&slope50>0&&v>-2.5)v=0;
    const dir=v>=2?1:v<=-2?-1:0;
    if(!dir||(dir===lastDir&&i-lastI<8))continue;
    signals.push({i,x:nx(candles[i].x),y:ny(dir>0?candles[i].lo:candles[i].hi),dir,why});lastDir=dir;lastI=i;
  }
  const lines={ema20:poly(e20,10),ema50:poly(e50,30),bbU:poly(m20.map((m,i)=>m==null?null:m+2*sd[i]),19),bbL:poly(m20.map((m,i)=>m==null?null:m-2*sd[i]),19)};
  const comment=[trend+' ('+N+' mum).',
    res.length?'En yakın direnç '+res[0].touches+' temaslı, grafik yüksekliğinin %'+Math.round((lastY-res[0].y)/span*100)+' kadar yukarısında.':'Yukarıda belirgin direnç yok.',
    sup.length?'En yakın destek '+sup[0].touches+' temaslı, %'+Math.round((sup[0].y-lastY)/span*100)+' aşağıda.':'Aşağıda belirgin destek yok.',
    tSup?'Yükselen destek trend çizgisi '+tSup.touch+' temasla çalışıyor.':null,
    tRes?'Alçalan direnç trend çizgisi '+tRes.touch+' temasla çalışıyor.':null,
    r!=null?'RSI '+Math.round(r)+(r>=70?' (aşırı alım)':r<=30?' (aşırı satım)':'')+', MACD '+ind.macd+'.':null,
    cp&&cp.dir?'Son mum: '+cp.name+'.':null,div?div.name+' var.':null].filter(Boolean).join(' ');
  return{chart_found:true,engine:'yerel',symbol:null,timeframe:null,bias,confidence,trend,
    resistances:L(res),supports:L(sup),breakout,patterns,comment,
    trendlines:[tSup&&{type:'destek',...tSup},tRes&&{type:'direnc',...tRes}].filter(Boolean).map(t=>({type:t.type,x1:nx(t.x1),y1:ny(t.y1),x2:nx(t.x2),y2:ny(t.y2)})),
    chart_box:{x1:nx(X0),y1:ny(Y0),x2:nx(X1),y2:ny(Y1)},last:{x:nx(last.x),y:ny(lastY)},candles:N,
    rawCandles:W>1?candles.map(c=>({hi:+((c.hi+oy)/FH).toFixed(5),lo:+((c.lo+oy)/FH).toFixed(5)})):undefined,
    ind,score,factors:F.sort((a,b)=>Math.abs(b.v)-Math.abs(a.v)),rr:riskReward,fib,lines,signals:signals.slice(-12),allSignals:signals,lastCandle:{x:nx(last.x),hi:ny(last.hi),lo:ny(last.lo)}};
}

// Gercek OHLC serisinden analiz (Yahoo / Alpha Vantage). candles: [{t,o,h,l,c,v}] eskiden yeniye.
// Cikti fiyat cinsindendir: seviyelerin y'si = fiyat, sinyallerin x'i = mum sirasi (t ile tarih).
function analyzeSeries(rows,opts={}){
  const rs=(rows||[]).filter(r=>[r.o,r.h,r.l,r.c].every(Number.isFinite)&&r.c>0&&r.l>0); // sifir/eksi fiyat getiriyi bozar
  if(rs.length<30)return {chart_found:false,engine:'piyasa'};
  const candles=rs.map((r,i)=>({x:i,x0:i,x1:i,hi:-r.h,lo:-r.l,open:-r.o,close:-r.c,up:r.c>=r.o}));
  const Y0=Math.min(...candles.map(c=>c.hi)),Y1=Math.max(...candles.map(c=>c.lo));
  const a=analyzeCandles(candles,{X0:0,X1:rs.length-1,Y0,Y1,W:1,H:-1,minTol:0});
  const P=v=>+(+v).toFixed(4);
  const fix=l=>({...l,price:P(l.y),y:undefined});
  const out={...a,engine:'piyasa',resistances:a.resistances.map(fix),supports:a.supports.map(fix),
    signals:a.signals.map(s=>({...s,t:rs[s.i].t,price:rs[s.i].c})),allSignals:undefined,
    last_price:rs[rs.length-1].c,backtest:backtest(rs,a.allSignals,opts.horizon||5,{cost:opts.cost!=null?opts.cost:0.2})};
  if(out.fib)out.fib.levels=out.fib.levels.map(l=>({f:l.f,price:P(l.y)}));
  delete out.lines;delete out.chart_box;delete out.lastCandle;
  out.trendlines=a.trendlines.map(t=>({type:t.type,i1:t.x1,p1:P(t.y1),i2:t.x2,p2:P(t.y2)}));
  return out;
}
// Basit geriye donuk test: sinyalden h mum sonra yon dogru mu? opts.cost = gidis-donus komisyon+kayma (%),
// her islemin getirisinden dusulur. Ayrica kural (why) bazinda ve 3/5/10 mum ufuklarinda ozet. (Tavsiye degil.)
function backtest(rs,sigs,h,opts={}){
  h=h||5;const cost=opts&&opts.cost!=null&&Number.isFinite(+opts.cost)?+opts.cost:0.2;
  const all=sigs||[],gross=(s,hh)=>(rs[s.i+hh].c-rs[s.i].c)/rs[s.i].c*100*s.dir;
  const stat=(sg,hh)=>{const d=sg.filter(s=>s.i+hh<rs.length),r=d.map(s=>gross(s,hh)-cost);
    return{count:d.length,winRate:d.length?Math.round(r.filter(x=>x>0).length/d.length*100):null,avgRet:d.length?+(r.reduce((a,b)=>a+b,0)/d.length).toFixed(2):null}};
  const done=all.filter(s=>s.i+h<rs.length);
  if(!done.length)return {count:0,horizon:h,cost};
  const g=done.map(s=>gross(s,h)),rets=g.map(x=>x-cost);
  const wins=rets.filter(r=>r>0).length;
  const reasons=[...new Set(done.flatMap(s=>s.why||[]))];
  const minN=opts.minSamples||10,byRule=reasons.map(rule=>({rule,...stat(done.filter(s=>(s.why||[]).includes(rule)),h)})).sort((a,b)=>b.count-a.count);
  return {count:done.length,horizon:h,cost,winRate:Math.round(wins/done.length*100),avgRet:+(rets.reduce((a,b)=>a+b,0)/rets.length).toFixed(2),
    maxDD:maxDrawdown(rets),minSamples:minN,reliable:done.length>=minN,
    rules:byRule.filter(r=>r.count>=minN),hiddenRules:byRule.filter(r=>r.count<minN).length,
    avgRetGross:+(g.reduce((a,b)=>a+b,0)/g.length).toFixed(2),
    byDir:[1,-1].map(d=>{const x=done.map((s,i)=>[s,rets[i]]).filter(([s])=>s.dir===d);return {dir:d,count:x.length,winRate:x.length?Math.round(x.filter(([,r])=>r>0).length/x.length*100):null}}),
    byRule,
    horizons:[3,5,10].map(hh=>({h:hh,...stat(all,hh)}))};
}

// Islem getirileri (%) sirayla bilesik uygulandiginda sermaye egrisinin en buyuk tepe-dip dususu (%, pozitif sayi).
function maxDrawdown(rets){let eq=1,peak=1,dd=0;for(const r of rets||[]){eq*=1+r/100;if(eq>peak)peak=eq;dd=Math.max(dd,(peak-eq)/peak)}return +(dd*100).toFixed(2)}

// Ekrandaki mumlari gercek mumlarla eslestirip fiyat olcegi cikar (Claude'suz fiyat ekseni).
// screen: analyzeBitmap ciktisi + .rawCandles (normalize hi/lo); rows: gercek mumlar.
// Sag kenar hizalanir, +-shift kaydirilarak en iyi dogrusal uyum aranir. price = my + k*(y - mx)
function calibrateFromSeries(screenCandles,rows,{maxShift=4,minN=15}={}){
  if(!screenCandles||screenCandles.length<minN||!rows||rows.length<minN)return null;
  let best=null;
  for(let sh=-maxShift;sh<=maxShift;sh++){
    const xs=[],ys=[];
    // Eksi kayma: ekranda veriden yeni mumlar var (gecikmeli Yahoo); karsiligi olmayanlari atla. En fazla 80 cift.
    for(let k=1;k<=screenCandles.length&&xs.length<160;k++){
      const sc=screenCandles[screenCandles.length-k],r=rows[rows.length-k-sh];if(!r){if(sh<0)continue;break}if(!sc)break;
      xs.push(sc.hi,sc.lo);ys.push(r.h,r.l);
    }
    if(xs.length<minN*2)continue;
    const n=xs.length,mx=xs.reduce((a,b)=>a+b,0)/n,my=ys.reduce((a,b)=>a+b,0)/n;
    let sxy=0,sxx=0,syy=0;for(let i=0;i<n;i++){sxy+=(xs[i]-mx)*(ys[i]-my);sxx+=(xs[i]-mx)**2;syy+=(ys[i]-my)**2}
    if(!sxx||!syy||sxy>=0)continue;
    const r2=sxy*sxy/(sxx*syy);
    if(!best||r2>best.r2)best={mx,my,k:sxy/sxx,r2,shift:sh,n:n/2};
  }
  return best&&best.r2>=0.97?best:null;
}


// =====================================================================================
// Gelismis analiz: gercek OHLCV (Yahoo) uzerinden indikatorler, yapi, seviyeler, coklu zaman dilimi,
// karar (AL/SAT/BEKLE), islem plani ve geriye donuk test. Tum fonksiyonlar saf JS; satirlar {t,o,h,l,c,v} eskiden yeniye.
// Isinma (warm-up) donemindeki degerler null'dur. Yatirim tavsiyesi degildir.
// =====================================================================================
const fin=v=>v!=null&&Number.isFinite(v);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const firstIdx=a=>{let f=0;while(f<a.length&&!fin(a[f]))f++;return f};
// Basit hareketli ortalama (bastaki null'lar atlanir).
function smaS(a,n){const o=new Array(a.length).fill(null),f=firstIdx(a);let s=0;
  for(let i=f;i<a.length;i++){s+=a[i];if(i-f>=n)s-=a[i-n];if(i-f>=n-1)o[i]=s/n}return o}
// Ustel hareketli ortalama: ilk deger n elemanin basit ortalamasi (standart/TradingView tanimi).
function emaS(a,n){const o=new Array(a.length).fill(null),f=firstIdx(a);if(a.length-f<n)return o;
  let e=0;for(let i=f;i<f+n;i++)e+=a[i];e/=n;o[f+n-1]=e;const k=2/(n+1);
  for(let i=f+n;i<a.length;i++){e=a[i]*k+e*(1-k);o[i]=e}return o}
// Wilder ortalamasi (RMA): ilk deger n elemanin ortalamasi, sonra (onceki*(n-1)+x)/n.
function wilder(a,n){const o=new Array(a.length).fill(null),f=firstIdx(a);if(a.length-f<n)return o;
  let e=0;for(let i=f;i<f+n;i++)e+=a[i];e/=n;o[f+n-1]=e;for(let i=f+n;i<a.length;i++){e=(e*(n-1)+a[i])/n;o[i]=e}return o}
function macdS(c,fast=12,slow=26,sig=9){const ef=emaS(c,fast),es=emaS(c,slow);
  const m=c.map((_,i)=>fin(ef[i])&&fin(es[i])?ef[i]-es[i]:null),sg=emaS(m,sig),h=m.map((v,i)=>fin(v)&&fin(sg[i])?v-sg[i]:null);
  return {macd:m,signal:sg,hist:h}}
// Stokastik: son m degerin araligindaki konum (0-100). Aralik sifirsa 50.
function stoch(a,m){const o=new Array(a.length).fill(null);
  for(let i=m-1;i<a.length;i++){let lo=Infinity,hi=-Infinity,ok=true;for(let j=i-m+1;j<=i;j++){if(!fin(a[j])){ok=false;break}lo=Math.min(lo,a[j]);hi=Math.max(hi,a[j])}
    if(ok)o[i]=hi===lo?50:(a[i]-lo)/(hi-lo)*100}return o}
function stochRsi(c,n=14,m=14,k=3,d=3){const st=stoch(rsi(c,n),m),K=smaS(st,k),D=smaS(K,d);return {st,k:K,d:D}}
function trueRange(rows){return rows.map((r,i)=>i?Math.max(r.h-r.l,Math.abs(r.h-rows[i-1].c),Math.abs(r.l-rows[i-1].c)):r.h-r.l)}
function atrS(rows,n=14){return wilder(trueRange(rows),n)}
// ADX/DI (Wilder): +DM/-DM ve TR Wilder toplamlari, DX'in Wilder ortalamasi. Ilk ADX indeksi 2n-1.
function adxS(rows,n=14){
  const N=rows.length,adx=new Array(N).fill(null),pdi=new Array(N).fill(null),mdi=new Array(N).fill(null),dx=new Array(N).fill(null);
  if(N<=n)return {adx,pdi,mdi};
  const tr=trueRange(rows),pdm=[0],mdm=[0];
  for(let i=1;i<N;i++){const up=rows[i].h-rows[i-1].h,dn=rows[i-1].l-rows[i].l;pdm.push(up>dn&&up>0?up:0);mdm.push(dn>up&&dn>0?dn:0)}
  let sT=0,sP=0,sM=0;for(let i=1;i<=n;i++){sT+=tr[i];sP+=pdm[i];sM+=mdm[i]}
  for(let i=n;i<N;i++){
    if(i>n){sT=sT-sT/n+tr[i];sP=sP-sP/n+pdm[i];sM=sM-sM/n+mdm[i]}
    const p=sT?100*sP/sT:0,m=sT?100*sM/sT:0;pdi[i]=p;mdi[i]=m;dx[i]=p+m?100*Math.abs(p-m)/(p+m):0}
  const a=wilder(dx,n);for(let i=0;i<N;i++)adx[i]=a[i];
  return {adx,pdi,mdi}}
function bollinger(c,n=20,k=2){const m=smaS(c,n),up=[],lo=[],bw=[];
  for(let i=0;i<c.length;i++){if(!fin(m[i])){up.push(null);lo.push(null);bw.push(null);continue}
    let s2=0;for(let j=i-n+1;j<=i;j++)s2+=(c[j]-m[i])**2;const sd=Math.sqrt(s2/n);up.push(m[i]+k*sd);lo.push(m[i]-k*sd);bw.push(m[i]?2*k*sd/m[i]:null)}
  return {mid:m,up,lo,bw}}
function obvS(rows){const o=[0];for(let i=1;i<rows.length;i++){const v=rows[i].v||0;o.push(o[i-1]+(rows[i].c>rows[i-1].c?v:rows[i].c<rows[i-1].c?-v:0))}return o}
// Gun ici VWAP: her Istanbul gununde sifirlanir (tipik fiyat * hacim / hacim).
function vwapS(rows){const o=[];let day=null,pv=0,vv=0;
  for(const r of rows){const d=new Date((r.t||0)+3*3600000).toISOString().slice(0,10);if(d!==day){day=d;pv=0;vv=0}
    const v=r.v||0;pv+=(r.h+r.l+r.c)/3*v;vv+=v;o.push(vv?pv/vv:null)}return o}
// Hacim / onceki n mumun ortalama hacmi.
function volRatio(rows,n=20){return rows.map((r,i)=>{if(i<n)return null;let s=0;for(let j=i-n;j<i;j++)s+=rows[j].v||0;return s?(r.v||0)/(s/n):null})}
const slopeLR=a=>{const n=a.length;if(n<2)return 0;const mx=(n-1)/2,my=a.reduce((x,y)=>x+y,0)/n;let sxy=0,sxx=0;for(let i=0;i<n;i++){sxy+=(i-mx)*(a[i]-my);sxx+=(i-mx)**2}return sxx?sxy/sxx:0};

// --- fiyat yapisi ---
// Fraktal tepe/dip: solundaki k mumdan kesin, sagindaki k mumdan esit-ya-da-buyuk tepe (dip). Son k mum onaysizdir.
function swings(rows,k=3){const hi=[],lo=[];
  for(let i=k;i<rows.length-k;i++){let H=true,L=true;
    for(let j=i-k;j<=i+k&&(H||L);j++){if(j===i)continue;const r=rows[j];
      if(j<i?r.h>=rows[i].h:r.h>rows[i].h)H=false;if(j<i?r.l<=rows[i].l:r.l<rows[i].l)L=false}
    if(H)hi.push({i,p:rows[i].h});if(L)lo.push({i,p:rows[i].l})}
  return {hi,lo}}
// Hacim profili: her mumun hacmi [l,h] araligina esit dagitilir. POC en yogun fiyat, deger alani hacmin %70'i.
function volumeProfile(rows,bins=24){
  const rs=rows.filter(r=>(r.v||0)>0);if(rs.length<10)return null;
  const lo=Math.min(...rs.map(r=>r.l)),hi=Math.max(...rs.map(r=>r.h)),w=(hi-lo)/bins;if(!(w>0))return null;
  const b=new Array(bins).fill(0);
  for(const r of rs){const a=Math.min(bins-1,Math.floor((r.l-lo)/w)),z=Math.min(bins-1,Math.floor((r.h-lo)/w)),per=r.v/(z-a+1);for(let i=a;i<=z;i++)b[i]+=per}
  let p=0;for(let i=1;i<bins;i++)if(b[i]>b[p])p=i;
  const tot=b.reduce((x,y)=>x+y,0);let L=p,U=p,acc=b[p];
  while(acc<tot*0.7&&(L>0||U<bins-1)){const dn=L>0?b[L-1]:-1,up=U<bins-1?b[U+1]:-1;if(up>=dn){U++;acc+=b[U]}else{L--;acc+=b[L]}}
  const mid=i=>lo+(i+0.5)*w;
  return {poc:mid(p),val:lo+L*w,vah:lo+(U+1)*w,lo,hi,bins:b.map((v,i)=>({p:mid(i),v}))}}
// Destek/direnc bolgeleri: tepe/dipler fiyatca kumelenir (tolerans ~0.5 ATR); temas, yakinlik ve POC ile guc.
function zones(rows,sw,atr,prof){
  const N=rows.length,pts=[...sw.hi.map(x=>({...x,k:'h'})),...sw.lo.map(x=>({...x,k:'l'}))].sort((a,b)=>a.p-b.p);
  const last=rows[N-1].c,tol=Math.max(atr*0.5,last*0.004),cl=[];
  for(const p of pts){const c=cl[cl.length-1];if(c&&p.p-c.pts[c.pts.length-1].p<=tol)c.pts.push(p);else cl.push({pts:[p]})}
  return cl.map(c=>{const ps=c.pts.map(x=>x.p),lo=Math.min(...ps),hi=Math.max(...ps),pad=Math.max(0,(atr*0.2-(hi-lo))/2);
    const z={lo:lo-pad,hi:hi+pad,mid:ps.reduce((a,b)=>a+b,0)/ps.length,touches:ps.length,last:Math.max(...c.pts.map(x=>x.i))};
    z.poc=!!(prof&&prof.poc>=z.lo-tol*0.5&&prof.poc<=z.hi+tol*0.5);
    z.strength=+(z.touches+1.5*z.last/N+(z.poc?1:0)).toFixed(2);return z})}
// Iki tepe/dip yapisi: son iki tepe ve dip (HH/HL = yukselen, LH/LL = dusen).
function structure(sw){const h=sw.hi.slice(-2),l=sw.lo.slice(-2);
  if(h.length<2||l.length<2)return {dir:0,text:'Yapı için yeterli tepe/dip yok'};
  const HH=h[1].p>h[0].p,HL=l[1].p>l[0].p;
  return HH&&HL?{dir:1,text:'Yükselen tepeler ve dipler (HH/HL)'}:!HH&&!HL?{dir:-1,text:'Alçalan tepeler ve dipler (LH/LL)'}:{dir:0,text:HH?'Yükselen tepe, alçalan dip (genişleme)':'Alçalan tepe, yükselen dip (daralma)'}}
// Trend cizgileri: son iki yukselen dip (destek) / alcalan tepe (direnc); arada kapanis ihlali olmamali. Kanal: karsi uctan paralel.
function trendlines(rows,sw,atr){const N=rows.length,out=[];
  const mk=(pts,type)=>{if(pts.length<2)return;const [a,b]=pts.slice(-2),m=(b.p-a.p)/(b.i-a.i);
    if(type==='destek'?m<=0:m>=0)return;
    for(let i=a.i;i<N;i++){const y=a.p+m*(i-a.i);if(type==='destek'?rows[i].c<y-atr*0.25:rows[i].c>y+atr*0.25){if(i<N-1)return}}
    const at=i=>a.p+m*(i-a.i);let off=0;
    for(let i=a.i;i<N;i++)off=type==='destek'?Math.max(off,rows[i].h-at(i)):Math.min(off,rows[i].l-at(i));
    out.push({type,i1:a.i,p1:a.p,i2:N-1,p2:+at(N-1).toFixed(4),now:+at(N-1).toFixed(4),slopePct:+(m/last(rows).c*100).toFixed(3),
      channel:Math.abs(off)>atr?+(at(N-1)+off).toFixed(4):null,broken:type==='destek'?rows[N-1].c<at(N-1)-atr*0.25:rows[N-1].c>at(N-1)+atr*0.25})};
  mk(sw.lo,'destek');mk(sw.hi,'direnc');return out}
const last=a=>a[a.length-1];
// Kirilim ve tekrar test: en az iki temasli bolgenin son 6 mumda kapanisla gecilmesi; sonrasinda bolgeye geri cekilip ustunde kalma.
function breakouts(rows,zs,atr){const N=rows.length,out=[];
  for(const z of zs){if(z.touches<2)continue;
    for(let k=Math.max(1,N-6);k<N;k++){
      // Kirilim mumu bolgenin disinda kapanir; sonraki kapanislar bolgenin ortasinin otesinde kalmali (geri cekilme serbest).
      const up=rows[k-1].c<=z.hi&&rows[k].c>z.hi&&rows.slice(k).every(r=>r.c>z.mid),dn=rows[k-1].c>=z.lo&&rows[k].c<z.lo&&rows.slice(k).every(r=>r.c<z.mid);
      if(!up&&!dn)continue;
      const after=rows.slice(k+1),retest=after.length>=1&&(up?after.some(r=>r.l<=z.hi+atr*0.2):after.some(r=>r.h>=z.lo-atr*0.2));
      out.push({dir:up?1:-1,zone:{lo:+z.lo.toFixed(4),hi:+z.hi.toFixed(4)},i:k,ago:N-1-k,touches:z.touches,retest,
        text:(up?'Direnç bölgesi yukarı kırıldı':'Destek bölgesi aşağı kırıldı')+' ('+z.touches+' temas'+(retest?', tekrar test edildi':'')+')'});break}}
  return out.sort((a,b)=>a.ago-b.ago||b.touches-a.touches).slice(0,2)}
// Formasyonlar: yalniz nesnel kurallar. Ikili tepe/dip: esit (<=0.6 ATR) iki tepe/dip, arada >=1.5 ATR geri cekilme;
// boyun cizgisi kapanisla gecildiyse "onaylandi". Bayrak: <=8 mumda >=3 ATR direk, ardindan 4-15 mumluk dar (direk %50'si) ve ters/yatay egimli konsolidasyon.
function patterns(rows,sw,atr){const N=rows.length,out=[],c=rows[N-1].c;
  const dbl=(pts,top)=>{if(pts.length<2)return;const [a,b]=pts.slice(-2);
    if(b.i-a.i<5||b.i-a.i>80||N-1-b.i>25||Math.abs(a.p-b.p)>atr*0.6)return;
    let neck=top?Infinity:-Infinity;for(let i=a.i;i<=b.i;i++)neck=top?Math.min(neck,rows[i].l):Math.max(neck,rows[i].h);
    if((top?Math.min(a.p,b.p)-neck:neck-Math.max(a.p,b.p))<atr*1.5)return;
    const ok=top?c<neck:c>neck;
    out.push({name:top?'İkili tepe':'İkili dip',dir:top?-1:1,confirmed:ok,neck:+neck.toFixed(4),
      target:+(top?neck-(Math.max(a.p,b.p)-neck):neck+(neck-Math.min(a.p,b.p))).toFixed(4),text:(top?'İkili tepe':'İkili dip')+(ok?' (boyun kırıldı, onaylandı)':' (oluşuyor, boyun '+(+neck.toFixed(2))+')')})};
  dbl(sw.hi,true);dbl(sw.lo,false);
  for(const dir of [1,-1]){let best=null;
    for(let len=5;len<=16&&!best;len++){const s=N-len,p1=s-1;if(p1<8)break;
      for(let p0=p1-1;p0>=Math.max(0,p1-8);p0--){const pole=(rows[p1].c-rows[p0].c)*dir;if(pole<atr*3)continue;
        const seg=rows.slice(s,N-1),hi=Math.max(...seg.map(r=>r.h)),lo=Math.min(...seg.map(r=>r.l));
        if(hi-lo>pole*0.5)continue;const sl=slopeLR(seg.map(r=>r.c))*dir;if(sl>atr*0.1)continue;
        if(dir>0?lo<rows[p1].c-pole*0.6:hi>rows[p1].c+pole*0.6)continue;
        best={name:dir>0?'Boğa bayrağı':'Ayı bayrağı',dir,confirmed:dir>0?c>hi:c<lo,trigger:+(dir>0?hi:lo).toFixed(4),
          text:(dir>0?'Boğa bayrağı':'Ayı bayrağı')+' ('+(N-1-s)+' mumluk konsolidasyon, tetik '+(+(dir>0?hi:lo).toFixed(2))+')'};break}}
    if(best)out.push(best)}
  return out}
// RSI/MACD uyumsuzlugu: son iki dipte fiyat daha dusuk, gosterge daha yuksek (pozitif); tepelerde tersi (negatif).
function divergence(sw,ind,N,name){
  const l=sw.lo.slice(-2),h=sw.hi.slice(-2);
  if(l.length===2&&N-1-l[1].i<=20&&l[1].i-l[0].i>=4&&fin(ind[l[0].i])&&fin(ind[l[1].i])&&l[1].p<l[0].p&&ind[l[1].i]>ind[l[0].i])return {dir:1,text:'Pozitif '+name+' uyumsuzluğu'};
  if(h.length===2&&N-1-h[1].i<=20&&h[1].i-h[0].i>=4&&fin(ind[h[0].i])&&fin(ind[h[1].i])&&h[1].p>h[0].p&&ind[h[1].i]<ind[h[0].i])return {dir:-1,text:'Negatif '+name+' uyumsuzluğu'};
  return null}

// Tek zaman dilimi trend ozeti: EMA20/50/200 dizilimi, EMA50 egimi, ADX/DI. s: -1..1.
function tfTrend(rows){
  const N=rows.length;if(N<30)return null;
  const c=rows.map(r=>r.c),e20=emaS(c,20),e50=emaS(c,50),e200=emaS(c,200),A=adxS(rows,14),x=c[N-1];
  const parts=[];let s=0,w=0;const add=(v,wt)=>{s+=v*wt;w+=wt};
  if(fin(e20[N-1]))add(x>e20[N-1]?1:-1,0.2);
  if(fin(e50[N-1])){add(e20[N-1]>e50[N-1]?1:-1,0.3);const p=e50[N-6];if(fin(p))add(Math.sign(e50[N-1]-p),0.2)}
  if(fin(e200[N-1]))add(x>e200[N-1]?1:-1,0.3);
  s=w?s/w:0;const adx=A.adx[N-1];if(fin(adx)&&adx<20)s*=0.6;
  const dir=s>=0.3?1:s<=-0.3?-1:0;
  return {dir,s:+s.toFixed(3),adx:fin(adx)?+adx.toFixed(1):null,pdi:fin(A.pdi[N-1])?+A.pdi[N-1].toFixed(1):null,mdi:fin(A.mdi[N-1])?+A.mdi[N-1].toFixed(1):null,
    ema20:fin(e20[N-1])?+e20[N-1].toFixed(4):null,ema50:fin(e50[N-1])?+e50[N-1].toFixed(4):null,ema200:fin(e200[N-1])?+e200[N-1].toFixed(4):null,
    slope50:fin(e50[N-6])?+((e50[N-1]-e50[N-6])/e50[N-6]*100).toFixed(2):null,
    text:(dir>0?'Yükselen':dir<0?'Düşen':'Yatay/kararsız')+(fin(adx)?(adx>=25?' · güçlü (ADX '+Math.round(adx)+')':adx<20?' · zayıf (ADX '+Math.round(adx)+')':' · ADX '+Math.round(adx)):'')}}

// Gecmis her mum icin hafif bir skor (trend + momentum); +-0.35 esigini gecince AL/SAT. Ayni kurallar geriye donuk test edilir.
function systemSignals(rows){
  const c=rows.map(r=>r.c),e20=emaS(c,20),e50=emaS(c,50),e200=emaS(c,200),R=rsi(c,14),M=macdS(c).hist,out=[];let prev=0;
  for(let i=50;i<rows.length;i++){let s=0,w=0;const add=(v,wt)=>{s+=v*wt;w+=wt};
    add(c[i]>e20[i]?1:-1,0.15);add(e20[i]>e50[i]?1:-1,0.25);add(Math.sign(e50[i]-e50[i-5]),0.15);if(fin(e200[i]))add(c[i]>e200[i]?1:-1,0.15);
    if(fin(M[i]))add(Math.sign(M[i]),0.15);if(fin(R[i]))add(R[i]>=70?-0.5:R[i]>=55?1:R[i]<=30?0.5:R[i]<=45?-1:0,0.15);
    s/=w;const st=s>=0.35?1:s<=-0.35?-1:0;
    if(st&&st!==prev)out.push({i,dir:st,why:[st>0?'Sistem AL':'Sistem SAT']});if(st)prev=st}
  return out}

// --- karar ---
// comp: {key,name,w,v(-1..1),why[]}. Eksik bilesenler cikarilir, agirliklar yeniden olceklenir.
function verdictOf(comps,quality=1){
  const cs=comps.filter(c=>c&&c.w>0&&fin(c.v)),W=cs.reduce((a,c)=>a+c.w,0)||1;
  const total=cs.reduce((a,c)=>a+c.w*clamp(c.v,-1,1),0)/W,score=Math.round(total*100);
  const dir=score>=20?1:score<=-20?-1:0;
  const agree=cs.filter(c=>Math.abs(c.v)>=0.1&&Math.sign(c.v)===Math.sign(total)).reduce((a,c)=>a+c.w,0)/W;
  const mixed=1-Math.abs(cs.reduce((a,c)=>a+c.w*(Math.abs(c.v)>=0.1?Math.sign(c.v):0),0))/W;
  const conf=Math.round(clamp(dir?40*Math.min(1,Math.abs(score)/50)+45*agree+15*quality:40*(1-Math.abs(score)/20)+45*mixed+15*quality,0,100));
  const components=cs.map(c=>({key:c.key,name:c.name,weight:Math.round(c.w/W*100),v:+clamp(c.v,-1,1).toFixed(2),impact:Math.round(c.w/W*clamp(c.v,-1,1)*100),why:c.why||[]}));
  const reasons=components.flatMap(c=>(c.why||[]).map((t,k)=>({t,imp:c.impact*(k?0.8:1),key:c.key})))
    .filter(r=>dir?Math.sign(r.imp)===dir:true).sort((a,b)=>Math.abs(b.imp)-Math.abs(a.imp)).slice(0,3).map(r=>r.t);
  return {dir,label:dir>0?'AL':dir<0?'SAT':'BEKLE',score,confidence:conf,components,reasons}}

// Islem plani: giris bolgesi, stop (yapinin otesi ya da 2 ATR), hedefler (sonraki bolgeler ya da ATR katlari), R/O ve %1 risk icin pozisyon.
function tradePlan(dir,price,atr,sup,res,riskPct=1){
  if(!fin(price)||!fin(atr)||atr<=0)return null;
  const r4=v=>+v.toFixed(4),side=dir>=0?1:-1;
  const near=side>0?sup[0]:res[0],far=side>0?res:sup;
  const entryEdge=near?(side>0?Math.max(near.hi,price-atr*0.5):Math.min(near.lo,price+atr*0.5)):price-side*atr*0.5;
  const entry=[Math.min(entryEdge,price),Math.max(entryEdge,price)],ref=side>0?entry[1]:entry[0];
  const sStruct=near?(side>0?near.lo-atr*0.2:near.hi+atr*0.2):null,sAtr=ref-side*2*atr;
  const dS=sStruct!=null?(ref-sStruct)*side:null;
  const useStruct=dS!=null&&dS>=atr&&dS<=3*atr,stop=useStruct?sStruct:sAtr;
  const tg=far.filter(z=>(side>0?z.lo:z.hi)*side>(ref+side*atr*0.5)*side).map(z=>side>0?z.lo:z.hi);
  const t1=tg[0]!=null?tg[0]:ref+side*2*atr,t2=tg[1]!=null?tg[1]:Math.max(side*t1+atr*1.5,side*(ref+side*3.5*atr))*side;
  const risk=(ref-stop)*side,rr=risk>0?(t1-ref)*side/risk:null,riskPerUnit=risk/ref*100;
  return {dir:side,entry:entry.map(r4),stop:r4(stop),stopType:useStruct?'yapı':'2 ATR',t1:r4(t1),t2:r4(t2),rr:rr!=null?+rr.toFixed(2):null,
    riskPct,stopPct:+riskPerUnit.toFixed(2),positionPct:riskPerUnit>0?+Math.min(100,riskPct/riskPerUnit*100).toFixed(1):null,
    note:'Yatırım tavsiyesi değildir. Pozisyon: sermayenin %'+riskPct+'\'i riske edilirse.'}}

// Ana fonksiyon. frames: {tf: rows} (ornek {'1g':..,'1h':..,'1s':..}); primary: kararin dayandigi zaman dilimi.
// ext.depth: {pressure:-100..100, flow:net lot, live:-1|0|1}; ext.news: [{score}] (bot, -5..5), ext.sentiment: -1..1 (Alpha Vantage).
const TF_NAME={'1dk':'1 dk','5dk':'5 dk','15dk':'15 dk','1s':'Saatlik','1g':'Günlük','1h':'Haftalık'};
const TF_W={'1h':1,'1g':1,'1s':0.5,'15dk':0.4,'5dk':0.3,'1dk':0.2};
function proAnalyze(frames,{primary='1g',depth=null,news=null,sentiment=null,riskPct=1,intraday=false}={}){
  const clean=rs=>(rs||[]).filter(r=>[r.o,r.h,r.l,r.c].every(Number.isFinite)&&r.c>0&&r.l>0&&r.h>=r.l);
  const rows=clean(frames[primary]);
  if(rows.length<50)return {ok:false,error:'Yeterli mum yok ('+rows.length+'/50).'};
  const N=rows.length,c=rows.map(r=>r.c),x=c[N-1];
  const A=atrS(rows,14),atr=A[N-1],R=rsi(c,14),M=macdS(c),SR=stochRsi(c),BB=bollinger(c),OBV=obvS(rows),VR=volRatio(rows);
  const sw=swings(rows,N>150?4:3),prof=volumeProfile(rows.slice(-Math.min(N,120))),zs=zones(rows,sw,atr,prof);
  const res=zs.filter(z=>z.lo>x).sort((a,b)=>a.lo-b.lo),sup=zs.filter(z=>z.hi<x).sort((a,b)=>b.hi-a.hi);
  const strong=l=>{const s=l.filter(z=>z.touches>=2);return (s.length?s:l).slice(0,3)};
  const R3=strong(res),S3=strong(sup),inside=zs.find(z=>z.lo<=x&&z.hi>=x)||null;
  const st=structure(sw),tl=trendlines(rows,sw,atr),bo=breakouts(rows,zs,atr),pt=patterns(rows,sw,atr);
  const dR=divergence(sw,R,N,'RSI'),dM=divergence(sw,M.hist,N,'MACD');
  const tr={};for(const tf in frames){const t=tfTrend(clean(frames[tf]));if(t)tr[tf]=t}
  const T=tr[primary];
  const vw=intraday||['1dk','5dk','15dk','1s'].includes(primary)?vwapS(rows):null;
  const bwNow=BB.bw[N-1],bwHist=BB.bw.slice(-120).filter(fin),squeeze=fin(bwNow)&&bwHist.length>=40&&bwNow<=Math.min(...bwHist)*1.15;
  const sqRecent=BB.bw.slice(-6,-1).some(v=>fin(v)&&bwHist.length>=40&&v<=Math.min(...bwHist)*1.15);
  const bbBreak=fin(BB.up[N-1])?(x>BB.up[N-1]?1:x<BB.lo[N-1]?-1:0):0;
  const hC=M.hist,cross=k=>fin(hC[k])&&fin(hC[k-1])?(hC[k]>0&&hC[k-1]<=0?1:hC[k]<0&&hC[k-1]>=0?-1:0):0;
  let mCross=0,mAgo=null;for(let k=N-1;k>=N-3;k--){const cr=cross(k);if(cr){mCross=cr;mAgo=N-1-k;break}}
  const K=SR.k,D=SR.d,srx=fin(K[N-1])&&fin(D[N-1])&&fin(K[N-2])&&fin(D[N-2])?(K[N-1]>D[N-1]&&K[N-2]<=D[N-2]?1:K[N-1]<D[N-1]&&K[N-2]>=D[N-2]?-1:0):0;
  const comps=[];
  // 1) Trend (ana zaman dilimi + yapi)
  {const why=[];let v=T?T.s:0;if(T)why.push(TF_NAME[primary]+' trend: '+T.text);
    if(T&&fin(T.ema200))why.push('Fiyat EMA200 '+(x>T.ema200?'üzerinde':'altında'));
    v+=st.dir*0.25;if(st.dir)why.push(st.text);
    for(const t of tl)if(t.broken){v+=t.type==='destek'?-0.3:0.3;why.push(t.type==='destek'?'Yükselen destek çizgisi kırıldı':'Alçalan direnç çizgisi kırıldı')}
    comps.push({key:'trend',name:'Trend',w:0.25,v:clamp(v,-1,1),why})}
  // 2) Coklu zaman dilimi uyumu
  {const others=Object.keys(tr).filter(k=>k!==primary);
    if(others.length){let s=0,w=0;const why=[];for(const k of others){const wt=TF_W[k]||0.5;s+=tr[k].s*wt;w+=wt;why.push(TF_NAME[k]+': '+tr[k].text)}
      const all=[primary,...others].map(k=>tr[k]&&tr[k].dir).filter(v=>v!=null),al=all.length>1&&all.every(d=>d===all[0])&&all[0]!==0;
      if(al)why.unshift('Tüm zaman dilimleri '+(all[0]>0?'yükselişte':'düşüşte')+' (uyumlu)');
      comps.push({key:'mtf',name:'Zaman dilimi uyumu',w:0.15,v:clamp(w?s/w:0,-1,1),why})}}
  // 3) Momentum
  {const why=[];let v=0;const r=R[N-1],strongT=T&&T.adx>=25;
    if(fin(r)){if(r>=70){v+=strongT&&T.dir>0?0:-0.3;why.push('RSI '+Math.round(r)+' aşırı alım'+(strongT&&T.dir>0?' (güçlü trendde normal)':''))}
      else if(r>=55){v+=0.3;why.push('RSI '+Math.round(r)+' (pozitif bölge)')}else if(r<=30){v+=strongT&&T.dir<0?0:0.3;why.push('RSI '+Math.round(r)+' aşırı satım')}
      else if(r<=45){v-=0.3;why.push('RSI '+Math.round(r)+' (negatif bölge)')}}
    if(fin(hC[N-1])){v+=Math.sign(hC[N-1])*0.25;if(mCross){v+=mCross*0.2;why.push('MACD histogram sıfırı '+(mCross>0?'yukarı':'aşağı')+' kesti'+(mAgo?' ('+mAgo+' mum önce)':''))}else why.push('MACD '+(hC[N-1]>0?'pozitif':'negatif'))}
    if(srx&&((srx>0&&K[N-1]<=30)||(srx<0&&K[N-1]>=70))){v+=srx*0.2;why.push('Stokastik RSI '+(srx>0?'dipte yukarı':'tepede aşağı')+' kesişim')}
    for(const d of [dR,dM])if(d){v+=d.dir*(d===dR?0.35:0.25);why.push(d.text)}
    comps.push({key:'momentum',name:'Momentum',w:0.2,v:clamp(v,-1,1),why})}
  // 4) Hacim
  {const why=[];let v=0;const hasV=rows.slice(-20).some(r=>(r.v||0)>0);
    if(hasV){const ob=slopeLR(OBV.slice(-20)),pr=slopeLR(c.slice(-20));
      if(ob>0&&pr>0){v+=0.4;why.push('OBV fiyatla birlikte yükseliyor')}else if(ob<0&&pr<0){v-=0.4;why.push('OBV fiyatla birlikte düşüyor')}
      else if(ob<0&&pr>0){v-=0.25;why.push('Yükselişe hacim eşlik etmiyor (OBV düşüyor)')}else if(ob>0&&pr<0){v+=0.25;why.push('Düşüşte birikim var (OBV yükseliyor)')}
      const vr=VR[N-1];if(fin(vr)&&vr>=2){const d=Math.sign(c[N-1]-c[N-2]);v+=d*0.4;why.push('Hacim 20 mum ortalamasının '+vr.toFixed(1).replace('.',',')+' katı ('+(d>0?'yükseliş':'düşüş')+' mumu)')}
      if(vw&&fin(vw[N-1])){v+=x>vw[N-1]?0.2:-0.2;why.push('Fiyat VWAP '+(x>vw[N-1]?'üzerinde':'altında'))}
      if(prof){v+=x>prof.poc?0.1:-0.1;why.push('Fiyat hacim profili POC '+(x>prof.poc?'üzerinde':'altında'))}
      comps.push({key:'hacim',name:'Hacim',w:0.1,v:clamp(v,-1,1),why})}}
  // 5) Yapi: kirilim, formasyon, seviyelere yakinlik, Bollinger
  {const why=[];let v=0;
    for(const b of bo){v+=b.dir*(b.retest?0.7:0.55);why.push(b.text)}
    for(const p of pt){v+=p.dir*(p.confirmed?0.5:0.2);why.push(p.text)}
    if(R3[0]&&(R3[0].lo-x)<atr*0.5){v-=0.2;why.push('Dirence çok yakın ('+(+R3[0].lo.toFixed(2))+')')}
    if(S3[0]&&(x-S3[0].hi)<atr*0.5){v+=0.2;why.push('Desteğe çok yakın ('+(+S3[0].hi.toFixed(2))+')')}
    if(bbBreak&&(squeeze||sqRecent)){v+=bbBreak*0.3;why.push('Bollinger sıkışmasından '+(bbBreak>0?'yukarı':'aşağı')+' çıkış')}
    else if(squeeze)why.push('Bollinger sıkışması: sert hareket yakın olabilir');
    comps.push({key:'yapi',name:'Fiyat yapısı',w:0.2,v:clamp(v,-1,1),why})}
  // 6) Derinlik / kurum akisi (Telegram botu)
  if(depth&&(fin(depth.pressure)||fin(depth.flow)||depth.live)){const why=[];let v=0;
    if(fin(depth.pressure)){v+=depth.pressure/100*0.6;why.push('Derinlik baskısı '+(depth.pressure>0?'+':'')+depth.pressure)}
    if(fin(depth.flow)&&depth.flow){v+=Math.sign(depth.flow)*0.2;why.push('Kurum akışı '+(depth.flow>0?'alıcı':'satıcı'))}
    if(depth.live){v+=depth.live*0.3;why.push('Canlı işlem akışı '+(depth.live>0?'AL':'SAT'))}
    comps.push({key:'derinlik',name:'Derinlik ve AKD',w:0.1,v:clamp(v,-1,1),why})}
  // 7) Haber duygusu
  {const sc=(news||[]).map(n=>n&&n.score).filter(fin);
    if(sc.length||fin(sentiment)){const why=[];let v=0,k=0;
      if(sc.length){const m=sc.reduce((a,b)=>a+b,0)/sc.length;v+=clamp(m/3,-1,1);k++;why.push(sc.length+' haber, ort. skor '+(m>0?'+':'')+m.toFixed(1).replace('.',','))}
      if(fin(sentiment)){v+=clamp(sentiment*2,-1,1);k++;why.push('Haber duygu skoru '+(sentiment>0?'+':'')+sentiment.toFixed(2).replace('.',','))}
      comps.push({key:'haber',name:'Haber',w:0.07,v:clamp(v/k,-1,1),why})}}
  const verdict=verdictOf(comps,Math.min(1,N/200));
  // BEKLE'de plan yerine tetikler: direncin ustunde kapanis AL, destegin altinda kapanis SAT senaryosu.
  const plan=tradePlan(verdict.dir||1,x,atr,S3,R3,riskPct);
  if(plan){if(!verdict.dir){plan.wait=true;plan.triggerUp=R3[0]?+R3[0].hi.toFixed(4):null;plan.triggerDown=S3[0]?+S3[0].lo.toFixed(4):null}
    if(plan.rr!=null&&plan.rr<1.5)plan.warning='Risk/ödül zayıf (1:'+String(plan.rr).replace('.',',')+'): ilk hedef yakın, girişi geri çekilmede düşün.'}
  // Sistem kurallarinin bu hissede gecmisi (10 mum ufuk, %0,2 maliyet)
  const sys=systemSignals(rows),bt=backtest(rows,sys,10,{cost:0.2,minSamples:8});
  const r4=v=>fin(v)?+v.toFixed(4):null,zf=z=>({lo:r4(z.lo),hi:r4(z.hi),mid:r4(z.mid),touches:z.touches,poc:z.poc,strength:z.strength});
  return {ok:true,tf:primary,n:N,last:x,time:rows[N-1].t,verdict,plan,
    trend:{primary:T||null,frames:tr,structure:st,trendlines:tl},
    momentum:{rsi:fin(R[N-1])?+R[N-1].toFixed(1):null,macd:fin(M.macd[N-1])?r4(M.macd[N-1]):null,macdSignal:r4(M.signal[N-1]),macdHist:r4(hC[N-1]),macdCross:mCross,
      stochK:fin(K[N-1])?+K[N-1].toFixed(1):null,stochD:fin(D[N-1])?+D[N-1].toFixed(1):null,stochCross:srx,divergences:[dR,dM].filter(Boolean)},
    volume:{obvSlope:+slopeLR(OBV.slice(-20)).toFixed(2),ratio:fin(VR[N-1])?+VR[N-1].toFixed(2):null,vwap:vw?r4(vw[N-1]):null,profile:prof?{poc:r4(prof.poc),vah:r4(prof.vah),val:r4(prof.val)}:null},
    volatility:{atr:r4(atr),atrPct:fin(atr)?+(atr/x*100).toFixed(2):null,bb:fin(BB.mid[N-1])?{up:r4(BB.up[N-1]),mid:r4(BB.mid[N-1]),lo:r4(BB.lo[N-1]),bw:+(bwNow*100).toFixed(2),squeeze,breakout:bbBreak}:null},
    levels:{resistance:R3.map(zf),support:S3.map(zf),inside:inside?zf(inside):null},
    structure:{breakouts:bo,patterns:pt},backtest:{...bt,system:true,rule:'Trend+momentum skoru ±0,35 eşiği · 10 mum sonrası'}};
}

// Gorsel motorun (Claude/Grok) okudugu sayilari gercek veriyle karsilastir: sembol, son fiyat, seviyeler.
// a: model ciktisi; real: {symbol,lastPrice,cal:{mx,my,k}} -> {warnings[], fixed{...}}. Ekran olcegi (cal) varsa seviye fiyatlari y'den yeniden hesaplanir.
function crossCheckVision(a,real={}){
  const warn=[],fixed={};const norm=s=>String(s||'').toUpperCase().replace(/^BIST:/,'').replace(/\.IS$/,'').replace(/[^A-Z0-9]/g,'');
  if(real.symbol&&a.symbol&&norm(a.symbol)!==norm(real.symbol))warn.push('Model sembolü '+a.symbol+' okudu; seçili hisse '+real.symbol+' kullanıldı.');
  if(real.symbol)fixed.symbol=norm(real.symbol);
  if(fin(real.lastPrice)&&fin(a.last_price)){const d=Math.abs(a.last_price-real.lastPrice)/real.lastPrice;
    if(d>0.03)warn.push('Model son fiyatı '+a.last_price+' okudu; gerçek '+(+real.lastPrice.toFixed(4))+' (%'+(d*100).toFixed(1).replace('.',',')+' fark). Gerçek fiyat kullanıldı.')}
  if(fin(real.lastPrice))fixed.last_price=real.lastPrice;
  const c=real.cal;
  if(c&&fin(c.k)){const P=y=>+(c.my+c.k*(y-c.mx)).toFixed(4);let bad=0;
    const fix=l=>{const p=P(l.y);if(fin(l.price)&&Math.abs(l.price-p)/p>0.02)bad++;return {...l,price:p}};
    fixed.resistances=(a.resistances||[]).map(fix);fixed.supports=(a.supports||[]).map(fix);
    if(bad)warn.push(bad+' seviyenin model fiyatı ekran ölçeğiyle uyuşmadı; fiyatlar gerçek ölçekten yeniden hesaplandı.')}
  return {warnings:warn,fixed}}

// Ekran goruntusu boyutu: ekranin fiziksel cozunurlugu (mantiksal boyut x olcek; Retina'da 2x). Dusuk cozunurluklu
// kucuk resim mumlari birlestirir ve renkleri karistirir. maxW: cok buyuk ekranlarda bellek siniri (oran korunur).
function captureSize(d,maxW=4096){
  const sf=d&&d.scaleFactor>0?d.scaleFactor:1,w=Math.round(((d&&d.size&&d.size.width)||1440)*sf),h=Math.round(((d&&d.size&&d.size.height)||900)*sf);
  if(w<=maxW)return {width:w,height:h};return {width:maxW,height:Math.round(h*maxW/w)}}

// Yalniz ekrandan (hisse kodu yokken) ozet karar: yerel teknik skor. Esikler gelismis kararla ayni degil (piksel verisi daha gurultulu).
function screenVerdict(a){
  if(!a||!a.chart_found||typeof a.score!=='number')return null;
  const sc=a.score,dir=sc>=25?1:sc<=-25?-1:0;
  const reasons=(a.factors||[]).filter(f=>dir?Math.sign(f.v)===dir:true).sort((x,y)=>Math.abs(y.v)-Math.abs(x.v)).slice(0,3).map(f=>f.t);
  return {dir,label:dir>0?'AL':dir<0?'SAT':'BEKLE',score:sc,confidence:Math.round(clamp(a.confidence||0,0,100)),components:[],reasons,source:'ekran'}}
// Gelismis analizin fiyat seviyelerini ekran koordinatina (0-1) cevir: cal = ekran-fiyat olcegi (price = my + k*(y-mx)).
function projectPro(pro,cal,box){
  if(!pro||!pro.ok||!cal||!fin(cal.k)||!cal.k)return null;
  const Y=p=>fin(p)?+(cal.mx+(p-cal.my)/cal.k).toFixed(4):null,ok=y=>y!=null&&y>=-0.02&&y<=1.02;
  const z=(arr,type)=>(arr||[]).map(q=>({type,y1:Y(q.hi),y2:Y(q.lo),lo:q.lo,hi:q.hi,touches:q.touches})).filter(q=>ok(q.y1)&&ok(q.y2));
  const pl=pro.plan,out={x1:box?box.x1:0,x2:box?box.x2:1,zones:[...z(pro.levels.resistance,'R'),...z(pro.levels.support,'S')],plan:null,label:pro.verdict.label};
  if(pl&&!pl.wait)out.plan={dir:pl.dir,entry:pl.entry.map(Y),stop:Y(pl.stop),t1:Y(pl.t1),t2:Y(pl.t2),p:{entry:pl.entry,stop:pl.stop,t1:pl.t1,t2:pl.t2}};
  else if(pl&&pl.wait)out.triggers={up:Y(pl.triggerUp),down:Y(pl.triggerDown),p:{up:pl.triggerUp,down:pl.triggerDown}};
  return out}

const api={captureSize,screenVerdict,projectPro,analyzeBitmap,analyzeMask,analyzeSeries,calibrateFromSeries,backtest,classify,maxDrawdown,
  smaS,emaS,wilder,rsi,macdS,stoch,stochRsi,trueRange,atrS,adxS,bollinger,obvS,vwapS,volRatio,
  swings,volumeProfile,zones,structure,trendlines,breakouts,patterns,divergence,tfTrend,systemSignals,verdictOf,tradePlan,proAnalyze,crossCheckVision};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Engine=api;
})(this);
