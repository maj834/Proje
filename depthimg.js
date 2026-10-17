// Derinlik tablosu resmi okuyucu (BOPT benzeri botlar). Yerelde, ucretsiz ve internetsiz calisir.
// Tablo: yesil alis blogu (ADET | ALIS) ve kirmizi satis blogu (SATIS | ADET); ustunde istatistik satirlari.
// Akis: renk bloklarini bul -> beyaz yazi maskesiyle satirlari ayir -> her hucreyi kirp, buyut -> OCR (tesseract.js).
// OCR fonksiyonu disaridan verilebilir (test icin); verilmezse tesseract.js + paketteki ingilizce veri kullanilir.
const zlib=require('zlib');
const depth=require('./depth');

// --- Kucuk PNG kodlayici (8 bit gri) ------------------------------------------
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crc32(b){let c=0xffffffff;for(let i=0;i<b.length;i++)c=CRC[(c^b[i])&255]^(c>>>8);return (c^0xffffffff)>>>0}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(td));return Buffer.concat([len,td,c])}
function png(w,h,gray){
  const raw=Buffer.alloc((w+1)*h);for(let y=0;y<h;y++){raw[y*(w+1)]=0;gray.copy?gray.copy(raw,y*(w+1)+1,y*w,y*w+w):raw.set(gray.subarray(y*w,y*w+w),y*(w+1)+1)}
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}

// --- Bolutleme ------------------------------------------------------------------
// img: {width,height,data} RGBA (bgra:true ise BGRA, Electron nativeImage.toBitmap()).
function segment(img){
  const {width:W,height:H,data:D}=img,R=img.bgra?2:0,B=img.bgra?0:2;
  const px=(x,y)=>{const i=(y*W+x)*4;return [D[i+R],D[i+1],D[i+B]]};
  const green=([r,g,b])=>g>=35&&g>r+25&&g>b+25,red=([r,g,b])=>r>=35&&r>g+25&&r>b+25;
  // Tablo satirlari: genisligin yarisindan fazlasi yesil/kirmizi zemin
  const rowCol=new Int32Array(H);
  for(let y=0;y<H;y++){let n=0;for(let x=0;x<W;x+=2){const p=px(x,y);if(green(p)||red(p))n++}rowCol[y]=n*2}
  const tab=[];for(let y=0;y<H;y++)if(rowCol[y]>W*0.5)tab.push(y);
  if(tab.length<H*0.15)return null;
  const top=tab[0],bot=tab[tab.length-1];
  // Sutun: yesil biter, kirmizi baslar
  const gx=new Int32Array(W),rx=new Int32Array(W);
  for(let y=top;y<=bot;y+=3)for(let x=0;x<W;x++){const p=px(x,y);if(green(p))gx[x]++;else if(red(p))rx[x]++}
  const half=Math.ceil((bot-top+1)/3)*0.5;
  let gl=-1,gr=-1,rl=-1,rr=-1;
  for(let x=0;x<W;x++){if(gx[x]>half){if(gl<0)gl=x;gr=x}if(rx[x]>half){if(rl<0)rl=x;rr=x}}
  if(gl<0&&rl<0)return null;
  if(gl<0){gl=Math.max(0,2*rl-rr);gr=rl-1}if(rl<0){rl=gr+1;rr=Math.min(W-1,2*gr-gl)}
  return {W,H,px,top,bot,bid:[gl,gr],ask:[rl,rr]};
}

// Parlak yazi: en guclu kanal. Zemin (koyu yesil/kirmizi/gri) ve filigran ~80'in altinda kalir.
const ink=p=>Math.max(p[0],p[1],p[2]);
const INK=130;

// Yatay izdusumle yazi satirlari [y0,y1]
function bands(s,x0,x1,y0,y1){
  const out=[];let st=-1,gap=0;
  for(let y=y0;y<=y1;y++){
    let n=0;for(let x=x0;x<=x1;x++)if(ink(s.px(x,y))>INK)n++;
    if(n>0){if(st<0)st=y;gap=0}
    else if(st>=0&&++gap>2){const e=y-gap;if(e-st>=5)out.push([st,e]);st=-1;gap=0}
  }
  if(st>=0&&y1-gap-st>=5)out.push([st,y1-gap]);
  return out;
}

// Hucreyi kirp: yazinin sinir kutusu + bosluk, buyut, beyaz zemin / siyah yazi
function cell(s,x0,x1,y0,y1,pad=8){
  let a=1e9,b=-1,c=1e9,d=-1;
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(ink(s.px(x,y))>INK){if(x<a)a=x;if(x>b)b=x;if(y<c)c=y;if(y>d)d=y}
  if(b<0||b-a<2)return null;
  const scale=Math.max(2,Math.min(6,Math.round(48/(d-c+1))));           // yazi ~48 px olsun
  const w=(b-a+1)*scale+pad*2,h=(d-c+1)*scale+pad*2,g=Buffer.alloc(w*h,255);
  // Cift dogrusal buyutme: kucuk resimlerde rakam kenarlari kirilmasin
  const v=(x,y)=>ink(s.px(Math.max(a,Math.min(b,x)),Math.max(c,Math.min(d,y))));
  for(let y=pad;y<h-pad;y++)for(let x=pad;x<w-pad;x++){
    const fx=a+(x-pad+0.5)/scale-0.5,fy=c+(y-pad+0.5)/scale-0.5,ix=Math.floor(fx),iy=Math.floor(fy),tx=fx-ix,ty=fy-iy;
    const q=(v(ix,iy)*(1-tx)+v(ix+1,iy)*tx)*(1-ty)+(v(ix,iy+1)*(1-tx)+v(ix+1,iy+1)*tx)*ty;
    g[y*w+x]=255-Math.max(0,Math.min(255,Math.round((q-70)*255/130)));
  }
  return {png:png(w,h,g),w,h};
}

// --- OCR sonucu temizleme -------------------------------------------------------
const digits=t=>String(t||'').replace(/[^\d.,]/g,'');
function qtyOf(t){const s=digits(t).replace(/[.,]/g,'');return s?+s:null}
function priceOf(t,ref){
  let s=digits(t).replace(/,/g,'.');if(!s)return null;
  if(!/\./.test(s)&&s.length>=3)s=s.slice(0,-2)+'.'+s.slice(-2);   // nokta okunmadiysa 2 ondalik varsay
  s=s.replace(/\.(?=.*\.)/g,'');const v=+s;if(!Number.isFinite(v))return null;
  if(ref&&v>0&&(v>ref*1.5||v<ref/1.5))return null;                  // komsulardan cok sapan okuma
  return v;
}

// Ust istatistik alani: "TAdet Yuksek Tavan A.Ort TeoFyz" / degerler / "G.Hacim Dusuk Taban OGunK GunFyz" / degerler
const LABELS={tadet:'totalQty',yuksek:'high',tavan:'ceiling',aort:'avg',teofyz:'theoPrice',ghacim:'volume',dusuk:'low',taban:'floor',ogunk:'prevClose',gunfyz:'dayChange'};
const ROWS=[['totalQty','high','ceiling','avg','theoPrice'],['volume','low','floor','prevClose','dayChange']];
const norm=w=>String(w).toLocaleLowerCase('tr-TR').replace(/[ı]/g,'i').replace(/[ü]/g,'u').replace(/[ş]/g,'s').replace(/[ğ]/g,'g').replace(/[ö]/g,'o').replace(/[ç]/g,'c').replace(/[^a-z]/g,'');
// OCR tek harf karistirabilir (TeoFyz -> TleoFyz): en yakin etiket, en fazla 1-2 duzenleme
function lev(a,b){const d=[...Array(b.length+1).keys()];for(let i=1;i<=a.length;i++){let p=d[0];d[0]=i;for(let j=1;j<=b.length;j++){const t=d[j];d[j]=Math.min(d[j]+1,d[j-1]+1,p+(a[i-1]===b[j-1]?0:1));p=t}}return d[b.length]}
function label(w){const n=norm(w);if(n.length<3)return null;if(LABELS[n])return LABELS[n];const k=Object.keys(LABELS).find(k=>lev(k,n)<=(k.length>=5?2:1));return k?LABELS[k]:null}
function parseStats(text){
  const lines=String(text||'').split(/\n/).map(l=>l.trim()).filter(Boolean),st={};
  for(let i=0;i<lines.length-1;i++){
    let keys=lines[i].split(/\s+/).map(label);
    if(keys.filter(Boolean).length<2)continue;
    // Bir etiket okunamadiysa (Dusuk -> Diisiik) bilinen satir duzeninden tamamla
    const row=ROWS.find(r=>r.length===keys.length&&keys.every((k,j)=>!k||k===r[j]));if(row)keys=row;
    const vals=(lines[i+1].match(/\d[\d.,]*/g)||[]);
    if(vals.length!==keys.length)continue;
    // Fiyat alanlarinda nokta okunmadiysa (1213) iki ondalik varsay; adet/hacim tamsayidir.
    keys.forEach((k,j)=>{if(k)st[k]=k==='totalQty'||k==='volume'?qtyOf(vals[j]):priceOf(vals[j])});i++;
  }
  return st;
}

let worker=null,workerP=null;
async function tesseract(){
  if(worker)return worker;
  if(!workerP)workerP=(async()=>{
    const T=require('tesseract.js'),path=require('path');
    // Paketlenmis uygulamada bu dosyalar app.asar.unpacked altindadir (package.json asarUnpack).
    const un=p=>p.replace(/app\.asar(?!\.unpacked)/,'app.asar.unpacked');
    const langPath=un(path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')),'4.0.0_best_int'));
    const workerPath=un(path.join(path.dirname(require.resolve('tesseract.js/package.json')),'src','worker-script','node','index.js'));
    const w=await T.createWorker('eng',1,{langPath,workerPath,cacheMethod:'none',gzip:true});
    worker=w;return w;
  })();
  try{return await workerP}catch(e){workerP=null;throw e}
}
// Varsayilan OCR: mode 'num' tek satir rakam, 'text' blok metin
async function defaultOcr(buf,mode){
  const w=await tesseract();
  await w.setParameters(mode==='num'?{tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789.,'}:{tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
  const {data}=await w.recognize(buf);
  return {text:data.text||'',conf:data.confidence||0};
}
async function close(){const w=worker;worker=null;workerP=null;if(w)try{await w.terminate()}catch(e){}}

// Ana giris. Donus: depth modeli (depth.parseText ile ayni bicim) + stats + ocr bilgisi. Tablo bulunamazsa null.
async function read(img,{ocr=defaultOcr,hint={}}={}){
  const s=segment(img);if(!s)return null;
  const t0=Date.now();
  const d={symbol:hint.symbol||null,last:hint.last??null,change:hint.change??null,ceiling:null,floor:null,buyRatio:null,bids:[],asks:[],trades:[],buyers:[],sellers:[],source:'ocr'};
  const [gl,gr]=s.bid,[rl,rr]=s.ask,gm=Math.round((gl+gr)/2),rm=Math.round((rl+rr)/2);
  const cols={bq:[gl+2,gm-1],bp:[gm+1,gr-2],ap:[rl+2,rm-1],aq:[rm+1,rr-2]};
  const rows=bands(s,Math.min(gl,rl)+2,Math.max(gr,rr)-2,s.top,s.bot);
  let confs=[],n=0;
  const read1=async([x0,x1],[y0,y1])=>{const c=cell(s,x0,x1,y0,y1);if(!c)return null;n++;const r=await ocr(c.png,'num');confs.push(r.conf);return r.text};
  let lastBid=null,lastAsk=null;
  for(const b of rows){
    const [bq,bp,ap,aq]=[await read1(cols.bq,b),await read1(cols.bp,b),await read1(cols.ap,b),await read1(cols.aq,b)];
    const p1=priceOf(bp,lastBid),q1=qtyOf(bq);
    if(p1&&q1){d.bids.push({price:p1,qty:q1,orders:null});lastBid=p1}
    const p2=priceOf(ap,lastAsk),q2=qtyOf(aq);
    if(p2&&q2){d.asks.push({price:p2,qty:q2,orders:null});lastAsk=p2}
  }
  // Istatistikler: tablo basligindan (ADET ALIS ...) onceki gri alan
  if(s.top>40){
    const hb=bands(s,0,s.W-1,0,s.top-1);
    // Ilk yazi satiri baslik (sembol + fiyat), son satir sutun basliklari (ADET ALIS ...); istatistik aradadir
    if(hb.length>=4){
      const c=cellBlock(s,0,s.W-1,Math.max(0,hb[1][0]-4),hb[hb.length-1][0]-2);
      const r=await ocr(c.png,'text');d.stats=parseStats(r.text);n++;
    }
  }
  const st=d.stats||{};
  d.ceiling=st.ceiling??null;d.floor=st.floor??null;
  if(d.last==null&&d.bids.length&&st.high!=null)d.last=st.high===d.bids[0].price?d.bids[0].price:null;
  // Satir sirasinda alis fiyati azalir, satis artar; komsulariyla celisen okuma yanlistir, at.
  // En uzun kesin tekduze alt dizi kalir (birden fazla hatali okumaya da dayanir).
  const mono=(arr,dir)=>{
    const L=arr.map(()=>1),P=arr.map(()=>-1);let best=-1;
    arr.forEach((x,i)=>{for(let j=0;j<i;j++)if(dir*(x.price-arr[j].price)>0&&L[j]+1>L[i]){L[i]=L[j]+1;P[i]=j}if(best<0||L[i]>L[best])best=i});
    const out=[];for(let i=best;i>=0;i=P[i])out.unshift(arr[i]);
    return out.length>=Math.ceil(arr.length/2)?out:[];                   // cogu celisiyorsa tabloya guvenme
  };
  const nb=d.bids.length+d.asks.length;d.bids=mono(d.bids,-1);d.asks=mono(d.asks,1);
  d.ocr={dropped:nb-d.bids.length-d.asks.length,cells:n,ms:Date.now()-t0,conf:confs.length?Math.round(confs.reduce((a,b)=>a+b,0)/confs.length):null};
  return d;
}
// Blok metin icin: buyutme 2x, kirpma yok
function cellBlock(s,x0,x1,y0,y1,scale=2){
  const w=(x1-x0+1)*scale,h=(y1-y0+1)*scale,g=Buffer.alloc(w*h,255);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=ink(s.px(x0+Math.floor(x/scale),y0+Math.floor(y/scale)));g[y*w+x]=255-Math.max(0,Math.min(255,Math.round((v-70)*255/130)))}
  return {png:png(w,h,g),w,h};
}

module.exports={read,segment,parseStats,priceOf,qtyOf,png,close};
