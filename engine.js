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

// opts.colors: undefined/'auto' (yesil-kirmizi, yetmezse baskin iki tonu otomatik bul),
// 'green-red' (yalniz klasik), {up:'#rrggbb',down:'#rrggbb',tol:60} (ozel renkler).
function analyzeBitmap(buf,W,H,opts={}){
  const bgra=opts.format!=='rgba',col=opts.colors;
  if(col&&typeof col==='object'){
    const up=parseHex(col.up),dn=parseHex(col.down);
    if(up&&dn){const out=analyzeMask(maskByColors(buf,W,H,bgra,up,dn,+col.tol>0?+col.tol:60),W,H);out.colorMode='custom';return out}
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
        const out=analyzeMask(maskByColors(buf,W,H,bgra,aUp?a:b,aUp?b:a,60),W,H);
        if(out.chart_found){out.colorMode='auto-hue';return out}
      }
    }
  }
  const out=analyzeMask(mask,W,H);out.colorMode='green-red';return out;
}

function analyzeMask(mask,W,H){
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
  const X0=cr.s,X1=cr.e,Y0=rr.s,Y1=rr.e;

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
  // Mumlar birlesmisse (cok uzaklastirilmis grafik) sutun bazli calis.
  const widths=candles.map(c=>c.x1-c.x0+1).sort((a,b)=>a-b),medW=widths[widths.length>>1]||0;
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

  const out=analyzeCandles(candles,{X0,X1,Y0,Y1,W,H,minTol:3});
  out.candleStyle=hollowN>=Math.max(3,N*0.15)?'hollow':'filled';
  return out;
}

// Mumlardan analiz. Koordinatlar "y" ekseninde: buyuk y = dusuk fiyat (ekran pikseli gibi).
// Ekran icin W/H normalize eder; gercek fiyat serisi icin analyzeSeries y=-fiyat ve H=-1 verir.
function analyzeCandles(candles,{X0,X1,Y0,Y1,W,H,minTol=3}){
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

  const nx=x=>+(x/W).toFixed(4),ny=y=>+(y/H).toFixed(4);
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
    rawCandles:W>1?candles.map(c=>({hi:+(c.hi/H).toFixed(5),lo:+(c.lo/H).toFixed(5)})):undefined,
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
  return {count:done.length,horizon:h,cost,winRate:Math.round(wins/done.length*100),avgRet:+(rets.reduce((a,b)=>a+b,0)/rets.length).toFixed(2),
    avgRetGross:+(g.reduce((a,b)=>a+b,0)/g.length).toFixed(2),
    byDir:[1,-1].map(d=>{const x=done.map((s,i)=>[s,rets[i]]).filter(([s])=>s.dir===d);return {dir:d,count:x.length,winRate:x.length?Math.round(x.filter(([,r])=>r>0).length/x.length*100):null}}),
    byRule:reasons.map(rule=>({rule,...stat(done.filter(s=>(s.why||[]).includes(rule)),h)})).sort((a,b)=>b.count-a.count),
    horizons:[3,5,10].map(hh=>({h:hh,...stat(all,hh)}))};
}

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

const api={analyzeBitmap,analyzeMask,analyzeSeries,calibrateFromSeries,backtest,classify};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Engine=api;
})(this);
