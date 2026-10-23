'use strict';
// USD gorunumu: her mum icin o anda mevcut son USDTRY kapanisi kullanilir (gelecek kur kullanilmaz).
// OHLC ayni kura bolunur; gercek USD gun ici tepe/dipleri degil, karsilastirma amacli yaklasik seridir.
const fin=Number.isFinite;
function toUSD(rows,rates,{maxAge=7*86400000}={}){
 const fx=(Array.isArray(rates)?rates:[]).filter(x=>x&&fin(x.t)&&fin(x.c)&&x.c>0).sort((a,b)=>a.t-b.t);
 const out=[];let j=-1;
 for(const r of (Array.isArray(rows)?rows:[]).slice().sort((a,b)=>a.t-b.t)){
  if(!r||!fin(r.t)||![r.o,r.h,r.l,r.c].every(fin))continue;
  while(j+1<fx.length&&fx[j+1].t<=r.t)j++;
  if(j<0||r.t-fx[j].t>maxAge)continue;
  out.push({...r,o:r.o/fx[j].c,h:r.h/fx[j].c,l:r.l/fx[j].c,c:r.c/fx[j].c});
 }
 return {rows:out,dropped:(rows||[]).length-out.length,rateTime:fx.length?fx[fx.length-1].t:null};
}
module.exports={toUSD};
