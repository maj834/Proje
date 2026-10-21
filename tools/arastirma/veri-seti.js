#!/usr/bin/env node
'use strict';
// Arastirma veri seti: tools/veri/fiyat.json.br -> her hisse icin bp-model ozellikleri + ileri getiriler (5 gunde bir ortak tarihler).
// Istege bagli: engine.proAnalyze skoru ve bilesenleri (--motor). Parcalama: --parca k/n (paralel calistirmak icin).
// Cikti: CSV (stdout yerine --cikti dosyasi). Kullanim: node tools/arastirma/veri-seti.js --cikti ds.csv [--motor] [--parca 0/4] [--adim 5]
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const M=require('../../bp-model.js');
const arg=k=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:null},has=k=>process.argv.includes(k);
const OUT=arg('--cikti')||'ds.csv',STEP=+(arg('--adim')||5),[PK,PN]=(arg('--parca')||'0/1').split('/').map(Number),MOTOR=has('--motor');
const H=[5,10,20,40],WIN=400,DAY=864e5;
// Fiyat dosyalari: tools/veri/fiyat.json.br ya da parcalar fiyat-0..n.json.br (hepsi birlestirilir)
const VD=arg('--veri')||path.join(__dirname,'..','veri');
const data={};for(const f of fs.readdirSync(VD).filter(f=>/^fiyat(-\d+)?\.json\.br$/.test(f)).sort())
  Object.assign(data,JSON.parse(zlib.brotliDecompressSync(fs.readFileSync(path.join(VD,f)))).data);
// Yahoo'da duzeltilmemis bolunme/bedelsiz: BIST gunluk limiti ~%10; |degisim| > %30 ise kirilma kabul edilir ve gecmis geriye dogru duzeltilir.
function toRows(d){const n=d.t.length,rows=[];let fac=1;const f=[];
  for(let i=0;i<n;i++)rows.push({t:d.t[i]*DAY,o:d.o[i],h:d.h[i],l:d.l[i],c:d.c[i],v:d.v[i]||0});
  const brk=[];for(let i=n-1;i>=1;i--){const r=rows[i].c/rows[i-1].c;if(r<0.7||r>1.43){const k=rows[i].o/rows[i-1].c;const g=(r<0.7||r>1.43)?(Math.abs(Math.log(k))>Math.log(1.3)?k:r):1;
      brk.push(i);for(let j=0;j<i;j++){const x=rows[j];x.o*=g;x.h*=g;x.l*=g;x.c*=g;x.v=x.v/g}}}
  // temettu carpani (ac/c): ileri toplam getiri icin
  for(let i=0;i<n;i++)f.push(d.c[i]>0&&d.ac[i]>0?d.ac[i]/d.c[i]:1);
  return {rows,f,brk}}
const B=toRows(data['XU100.IS']);const bench=B.rows;
const bDay=new Map(bench.map((r,i)=>[Math.round(r.t/DAY),i]));
const sampleDays=new Set(bench.map((r,i)=>i%STEP===0?Math.round(r.t/DAY):null).filter(x=>x!=null));
const E=MOTOR?require('../../engine.js'):null,Dd=MOTOR?require('../../bp-data.js'):null;
const B100=new Set(require('../../bp-data.js').U.BIST100);
const syms=Object.keys(data).filter(s=>!/[.=^]/.test(s)&&!/=F$/.test(s)&&s!=='EEM').sort().filter((s,i)=>i%PN===PK);
const cols=['s','gun','tarih','b100','fiyat',...M.NAMES,...H.flatMap(h=>['ret'+h,'ex'+h]),'kirik',...(MOTOR?['skor','etiket','guven','c_trend','c_mtf','c_momentum','c_hacim','c_yapi']:[])];
const ws=fs.createWriteStream(OUT);ws.write(cols.join(',')+'\n');
const fmt=v=>v==null||!Number.isFinite(v)?'':Math.abs(v)>=1000?v.toFixed(1):+v.toPrecision(5);
let nrow=0,nb=0;
for(const s of syms){const {rows,f,brk}=toRows(data[s]);nb+=brk.length;const N=rows.length;if(N<300)continue;
  const S=M.series(rows,bench);
  for(let i=260;i<N;i++){const day=Math.round(rows[i].t/DAY);if(!sampleDays.has(day))continue;const bi=bDay.get(day);if(bi==null)continue;
    const fw=[];for(const h of H){const j=i+h;if(j>=N||bi+h>=bench.length){fw.push(NaN,NaN);continue}
      // ayni takvim: hisse j. gunu ile endeksin o gunu
      const dj=Math.round(rows[j].t/DAY),bj=bDay.get(dj);const r=rows[j].c/rows[i].c*(f[j]/f[i])-1;
      fw.push(r,bj!=null?r-(bench[bj].c/bench[bi].c-1):NaN)}
    const kirik=brk.some(k=>k>i-260&&k<=i+40)?1:0;
    const line=[s,day,new Date(day*DAY).toISOString().slice(0,10),B100.has(s)?1:0,fmt(rows[i].c),...M.NAMES.map(k=>fmt(S.col[k][i])),...fw.map(fmt),kirik];
    if(MOTOR){let a=null;try{const win=rows.slice(Math.max(0,i+1-WIN),i+1),lastT=win[win.length-1].t,bw=bench.slice(Math.max(0,bi+1-WIN),bi+1);
        a=E.proAnalyze({'1g':win,'1h':Dd.resampleWeekly(win)},{bench:bw})}catch(e){}
      if(a&&a.ok){const cm={};for(const c of a.verdict.components)cm[c.key]=c.v;line.push(a.verdict.score,a.verdict.label,a.verdict.confidence,...['trend','mtf','momentum','hacim','yapi'].map(k=>fmt(cm[k])))}
      else line.push('','','','','','','','')}
    ws.write(line.join(',')+'\n');nrow++}
  process.stderr.write('.')}
ws.end();process.stderr.write(`\nsatir ${nrow} hisse ${syms.length} kirilma ${nb} endeks kirilma ${B.brk.length}\n`);
