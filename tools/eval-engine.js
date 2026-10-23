#!/usr/bin/env node
'use strict';
// Analiz motoru dogruluk olcumu (yuruyen test): BIST hisselerinin gercek gunluk verisinde engine.proAnalyze yalniz o gune kadarki
// mumlarla calistirilir; karar, skor ve bilesen degerleri sonraki 5/10/20 gunluk getiriyle (XU100'e gore fazla getiri) karsilastirilir.
// Ag: yalniz Yahoo chart (GitHub Actions'ta calisir). Cikti: eval-out/sonuc.json + ozet (stdout ve GITHUB_STEP_SUMMARY).
// Kullanim: node tools/eval-engine.js [BIST30|BIST50|BIST100] [adim=5]
const fs=require('fs'),path=require('path');
const E=require('../engine.js'),D=require('../bp-data.js');
const UNI=process.argv[2]||'BIST100',STEP=Math.max(1,+process.argv[3]||5),WIN=400,H=[5,10,20];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function yahoo(y){
  for(let k=0;k<4;k++){try{
    const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?range=5y&interval=1d`,{headers:{'user-agent':'Mozilla/5.0'}});
    if(r.status===429){await sleep(4000*(k+1));continue}
    const j=await r.json(),q=j.chart.result[0],ts=q.timestamp||[],o=q.indicators.quote[0];
    return ts.map((t,i)=>({t:t*1000,o:o.open[i],h:o.high[i],l:o.low[i],c:o.close[i],v:o.volume[i]||0})).filter(r=>[r.o,r.h,r.l,r.c].every(Number.isFinite)&&r.c>0)}
  catch(e){await sleep(1500)}}
  return null}
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
function corr(x,y){const n=x.length;if(n<30)return null;const mx=mean(x),my=mean(y);let a=0,b=0,c=0;for(let i=0;i<n;i++){a+=(x[i]-mx)*(y[i]-my);b+=(x[i]-mx)**2;c+=(y[i]-my)**2}return b&&c?a/Math.sqrt(b*c):null}
const r3=v=>v==null?null:+v.toFixed(3);
(async()=>{
  const syms=D.U[UNI]||D.U.BIST100,bench=await yahoo('XU100.IS');if(!bench)throw new Error('XU100 alinamadi');
  const bIdx=new Map(bench.map((r,i)=>[new Date(r.t).toISOString().slice(0,10),i]));
  const recs=[];let ok=0;
  for(const s of syms){const rows=await yahoo(s+'.IS');await sleep(250);if(!rows||rows.length<WIN+60){console.log('atlandi',s,rows&&rows.length);continue}ok++;
    for(let t=WIN;t<rows.length-H[H.length-1];t+=STEP){const win=rows.slice(t-WIN,t);
      const lastT=win[win.length-1].t,bw=bench.filter(b=>b.t<=lastT+864e5/2).slice(-WIN);
      let a;try{a=E.proAnalyze({'1g':win,'1h':D.resampleWeekly(win)},{bench:bw})}catch(e){continue}
      if(!a||!a.ok)continue;const c0=win[win.length-1].c,day=new Date(win[win.length-1].t).toISOString().slice(0,10),bi=bIdx.get(day);
      const fw={};for(const h of H){const c1=rows[t-1+h].c,ret=c1/c0-1;let ex=null;
        if(bi!=null){const d1=new Date(rows[t-1+h].t).toISOString().slice(0,10),bj=bIdx.get(d1);if(bj!=null)ex=ret-(bench[bj].c/bench[bi].c-1)}
        fw[h]={ret,ex}}
      const comp={};for(const c of a.verdict.components)comp[c.key]=c.v;
      // Ek ozellikler (yalniz gecmis veri): goreli guc 63/126 gun (XU100'e gore), piyasa rejimi, hisse EMA200 ustu
      const ft={};const back=k=>t-1-k>=0?rows[t-1-k]:null;
      if(bi!=null)for(const k of [63,126]){const p0=back(k);if(!p0)continue;const d0=new Date(p0.t).toISOString().slice(0,10),b0=bIdx.get(d0);
        if(b0!=null)ft['rs'+k]=(c0/p0.c)-(bench[bi].c/bench[b0].c)}
      if(bi!=null&&bi>=200){const bc=bench.slice(bi-199,bi+1).map(r=>r.c);const e=(arr,n)=>{const k=2/(n+1);let v=arr[0];for(const x of arr)v=x*k+v*(1-k);return v};
        ft.reg=bench[bi].c>e(bc,200)?1:-1;ft.reg50=e(bc.slice(-50),50)>e(bc,200)?1:-1}
      {const cs=win.map(r=>r.c),k=2/201;let v=cs[0];for(const x of cs)v=x*k+v*(1-k);ft.ema200=c0>v?1:-1}
      ft.wk=(a.trend&&a.trend.frames&&a.trend.frames['1h']&&a.trend.frames['1h'].dir)||0;
      // Haber izi (fiyat/hacim soku): son 5 mumda gunluk getirisi >= 2.5 x (20 gunluk ort. mutlak getiri) ve hacmi >= 2 x 20g ortalama olan en buyuk mum
      {const W=win,n=W.length,ar=[],vv=[];for(let i=n-25;i<n-5;i++){ar.push(Math.abs(W[i].c/W[i-1].c-1));vv.push(W[i].v||0)}
        const ma=mean(ar)||0.01,mv=mean(vv)||1;let best=null;
        for(let i=n-5;i<n;i++){const r=W[i].c/W[i-1].c-1,vr=(W[i].v||0)/mv;if(Math.abs(r)>=2.5*ma&&vr>=2&&(!best||Math.abs(r)>Math.abs(best.r)))best={r,vr,ago:n-1-i,gap:W[i].o/W[i-1].c-1}}
        ft.sok=best?Math.sign(best.r):0;ft.sokMag=best?best.r:0;ft.sokGap=best?Math.sign(best.gap)===Math.sign(best.r)&&Math.abs(best.gap)>=ma:false}
      recs.push({s,day,score:a.verdict.score,label:a.verdict.label,conf:a.verdict.confidence,comp,ft,fw})}
    process.stdout.write('.')}
  console.log('\nhisse',ok,'ornek',recs.length);
  const days=[...new Set(recs.map(r=>r.day))].sort(),cut=days[Math.floor(days.length*0.6)];
  const part={egitim:recs.filter(r=>r.day<cut),test:recs.filter(r=>r.day>=cut)};
  const out={evren:UNI,hisse:ok,ornek:recs.length,adim:STEP,ayrim:cut,donem:[days[0],days[days.length-1]],sonuc:{}};
  const keys=[...new Set(recs.flatMap(r=>Object.keys(r.comp)))];
  for(const [nm,R] of Object.entries(part)){const o={n:R.length,etiket:{},skor:[],ic:{},ic_skor:{}};
    for(const L of ['AL','BEKLE','SAT']){const X=R.filter(r=>r.label===L);o.etiket[L]={n:X.length};
      for(const h of H){const ex=X.map(r=>r.fw[h].ex).filter(Number.isFinite);o.etiket[L]['h'+h]={ortFazla:r3(mean(ex)),yukselme:r3(mean(X.map(r=>r.fw[h].ret>0?1:0))),fazlaPozitif:r3(mean(ex.map(v=>v>0?1:0)))}}}
    for(const [lo,hi] of [[-100,-40],[-40,-20],[-20,0],[0,20],[20,40],[40,101]]){const X=R.filter(r=>r.score>=lo&&r.score<hi);
      o.skor.push({aralik:[lo,hi],n:X.length,yukselme10:r3(mean(X.map(r=>r.fw[10].ret>0?1:0))),ortFazla10:r3(mean(X.map(r=>r.fw[10].ex).filter(Number.isFinite))),ortGetiri10:r3(mean(X.map(r=>r.fw[10].ret))),yukselme20:r3(mean(X.map(r=>r.fw[20].ret>0?1:0)))})}
    for(const h of H){const Y=R.filter(r=>Number.isFinite(r.fw[h].ex));o.ic_skor['h'+h]=r3(corr(Y.map(r=>r.score),Y.map(r=>r.fw[h].ex)));
      o.ic['h'+h]={};for(const k of keys){const Z=Y.filter(r=>Number.isFinite(r.comp[k]));o.ic['h'+h][k]=r3(corr(Z.map(r=>r.comp[k]),Z.map(r=>r.fw[h].ex)))}}
    out.sonuc[nm]=o}
  // Agirlik karsilastirmasi: mevcut motor agirliklari vs egitim donemi IC'sine (10 gun) gore agirliklar; test doneminde olculur.
  const CUR={trend:0.23,mtf:0.24,momentum:0.12,hacim:0.21,yapi:0.10},ICW={};
  for(const k of Object.keys(CUR)){const v=out.sonuc.egitim.ic.h10[k];ICW[k]=Math.max(0,v||0)}
  const ESKI={trend:0.23,mtf:0.24,momentum:0.12,hacim:0.21,yapi:0.10};
  const sc=(r,W)=>{let s=0,w=0;for(const k in W)if(Number.isFinite(r.comp[k])){s+=W[k]*r.comp[k];w+=W[k]}return w?s/w*100:0};
  const BK=[[-101,-40],[-40,-20],[-20,0],[0,20],[20,40],[40,101]];
  function judge(R,W){const o={};for(const h of H){const Y=R.filter(r=>Number.isFinite(r.fw[h].ex)),xs=Y.map(r=>sc(r,W));
      o['ic'+h]=r3(corr(xs,Y.map(r=>r.fw[h].ex)));const ord=Y.map((r,i)=>[xs[i],r.fw[h].ex]).sort((a,b)=>a[0]-b[0]),q=Math.floor(ord.length/5);
      o['ustAlt'+h]=q?r3(mean(ord.slice(-q).map(x=>x[1]))-mean(ord.slice(0,q).map(x=>x[1]))):null}
    o.kova=BK.map(([lo,hi])=>{const X=R.filter(r=>{const v=sc(r,W);return v>=lo&&v<hi});const ex=X.map(r=>r.fw[10].ex).filter(Number.isFinite);
      return {aralik:[lo,hi],n:X.length,fazlaPozitif10:r3(mean(ex.map(v=>v>0?1:0))),ortFazla10:r3(mean(ex)),yukselme10:r3(mean(X.map(r=>r.fw[10].ret>0?1:0))),
        fazlaPozitif20:r3(mean(X.map(r=>r.fw[20].ex).filter(Number.isFinite).map(v=>v>0?1:0))),ortFazla20:r3(mean(X.map(r=>r.fw[20].ex).filter(Number.isFinite)))}});
    return o}
  out.agirlik={mevcut:CUR,ic:ICW,eskiTest:judge(part.test,ESKI),eskiEgitim:judge(part.egitim,ESKI),egitim:{mevcut:judge(part.egitim,CUR),ic:judge(part.egitim,ICW)},test:{mevcut:judge(part.test,CUR),ic:judge(part.test,ICW)},
    tum:{mevcut:judge(recs,CUR),ic:judge(recs,ICW)}};
  // Deneyler: ozelliklerin bilgi katsayisi ve secici AL filtreleri (egitim/test). Taban: tum ornekler ve mevcut AL.
  const stat=(X,h)=>{const ex=X.map(r=>r.fw[h].ex).filter(Number.isFinite);return {n:X.length,yukselme:r3(mean(X.map(r=>r.fw[h].ret>0?1:0))),fazlaPozitif:r3(mean(ex.map(v=>v>0?1:0))),ortFazla:r3(mean(ex)),ortGetiri:r3(mean(X.map(r=>r.fw[h].ret)))}};
  const FIL={
    taban:r=>true, AL:r=>r.label==='AL',
    rs126:r=>r.ft.rs126>0.10, rs63:r=>r.ft.rs63>0.05,
    rejim:r=>r.ft.reg===1, AL_rejim:r=>r.label==='AL'&&r.ft.reg===1,
    AL_rs:r=>r.label==='AL'&&r.ft.rs126>0, AL_rs_rejim:r=>r.label==='AL'&&r.ft.rs126>0&&r.ft.reg===1,
    guclu:r=>r.score>=40&&r.ft.wk>0&&r.ft.ema200>0, guclu_rs:r=>r.score>=40&&r.ft.wk>0&&r.ft.ema200>0&&r.ft.rs126>0,
    guclu_rs_rejim:r=>r.score>=40&&r.ft.wk>0&&r.ft.ema200>0&&r.ft.rs126>0&&r.ft.reg===1,
    SAT:r=>r.label==='SAT', SAT_zayif:r=>r.label==='SAT'&&r.ft.rs126<0&&r.ft.ema200<0,
    sok_yukari:r=>r.ft.sok>0, sok_asagi:r=>r.ft.sok<0, sok_yukari_bosluk:r=>r.ft.sok>0&&r.ft.sokGap, sok_asagi_bosluk:r=>r.ft.sok<0&&r.ft.sokGap,
    AL_sok_yukari:r=>r.label==='AL'&&r.ft.sok>0, AL_sok_asagi:r=>r.label==='AL'&&r.ft.sok<0, SAT_sok_asagi:r=>r.label==='SAT'&&r.ft.sok<0, sok_yok:r=>r.ft.sok===0};
  out.deney={ic:{},filtre:{}};
  for(const [nm,R] of Object.entries(part)){out.deney.ic[nm]={};for(const f of ['rs63','rs126','reg','reg50','ema200','wk','sok','sokMag'])for(const h of [10,20]){
      const Y=R.filter(r=>Number.isFinite(r.ft[f])&&Number.isFinite(r.fw[h].ex));out.deney.ic[nm][f+'_'+h]=r3(corr(Y.map(r=>r.ft[f]),Y.map(r=>r.fw[h].ex)))}
    out.deney.filtre[nm]={};for(const [k,f] of Object.entries(FIL)){const X=R.filter(f);out.deney.filtre[nm][k]={h10:stat(X,10),h20:stat(X,20)}}}
  fs.mkdirSync('eval-out',{recursive:true});fs.writeFileSync('eval-out/sonuc.json',JSON.stringify(out,null,1));
  fs.writeFileSync('eval-out/ornekler.json',JSON.stringify(recs));
  const txt='EVAL_JSON_BEGIN\n'+JSON.stringify(out)+'\nEVAL_JSON_END';console.log(txt);
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Motor dogruluk olcumu\n\n```json\n'+JSON.stringify(out,null,1)+'\n```\n');
})().catch(e=>{console.error(e);process.exit(1)});
