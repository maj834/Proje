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

function analyzeBitmap(buf,W,H,opts={}){
  const bgra=opts.format!=='rgba';
  const mask=new Uint8Array(W*H);
  for(let i=0,p=0;i<W*H;i++,p+=4){
    const r=bgra?buf[p+2]:buf[p],g=buf[p+1],b=bgra?buf[p]:buf[p+2];
    mask[i]=classify(r,g,b);
  }
  return analyzeMask(mask,W,H);
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
  if(candles.length<15||medW>14){
    candles=[];const step=Math.max(2,Math.round((X1-X0)/150));
    for(let x=X0;x<=X1;x+=step){let hi=1e9,lo=-1,g=0,r=0;
      for(let k=x;k<Math.min(X1+1,x+step);k++)if(hiC[k]>=0){hi=Math.min(hi,hiC[k]);lo=Math.max(lo,loC[k]);g+=colG[k];r+=colR[k]}
      if(lo>=0)candles.push({x0:x,x1:x+step-1,x:x+step/2,hi,lo,up:g>=r})}
  }
  if(candles.length<10)return none;
  const N=candles.length;
  // Kapanis: govdenin (en az 2 sutun dolu satirlar) ust/alt kenari.
  for(const c of candles){
    let bt=-1,bb=-1;
    if(c.x1-c.x0>=2)for(let y=c.hi;y<=c.lo;y++){let n=0;for(let x=c.x0;x<=c.x1;x++)if(mask[y*W+x])n++;if(n>=2){if(bt<0)bt=y;bb=y}}
    if(bt<0){bt=c.hi;bb=c.lo}
    c.open=c.up?bb:bt;c.close=c.up?bt:bb;
  }

  const span=Y1-Y0,tol=Math.max(3,span*0.012);
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
  const comment=[trend+' ('+N+' mum).',
    res.length?'En yakın direnç '+res[0].touches+' temaslı, grafik yüksekliğinin %'+Math.round((lastY-res[0].y)/span*100)+' kadar yukarısında.':'Yukarıda belirgin direnç yok.',
    sup.length?'En yakın destek '+sup[0].touches+' temaslı, %'+Math.round((sup[0].y-lastY)/span*100)+' aşağıda.':'Aşağıda belirgin destek yok.',
    tSup?'Yükselen destek trend çizgisi '+tSup.touch+' temasla çalışıyor.':null,
    tRes?'Alçalan direnç trend çizgisi '+tRes.touch+' temasla çalışıyor.':null].filter(Boolean).join(' ');
  return{chart_found:true,engine:'yerel',symbol:null,timeframe:null,bias,confidence,trend,
    resistances:L(res),supports:L(sup),breakout,patterns,comment,
    trendlines:[tSup&&{type:'destek',...tSup},tRes&&{type:'direnc',...tRes}].filter(Boolean).map(t=>({type:t.type,x1:nx(t.x1),y1:ny(t.y1),x2:nx(t.x2),y2:ny(t.y2)})),
    chart_box:{x1:nx(X0),y1:ny(Y0),x2:nx(X1),y2:ny(Y1)},last:{x:nx(last.x),y:ny(lastY)},candles:N};
}

const api={analyzeBitmap,analyzeMask,classify};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Engine=api;
})(this);
