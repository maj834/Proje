// Gorsel kontroller icin sentetik, tekrarlanabilir OHLCV (tohumlu rastgele yuruyus + trend evreleri). Tarayici: window.BPDemo
(function(root){
function rng(seed){let s=seed>>>0||1;return ()=>{s^=s<<13;s>>>=0;s^=s>>17;s^=s<<5;s>>>=0;return s/4294967296}}
// n mum, adim ms, baslangic fiyati. Gun ici adimlarda yalniz seans saatleri (10:00-18:00 TR) uretilir.
function rows({n=500,step=86400000,start=Date.UTC(2024,9,1,7),p0=280,seed=7,vol=0.018}={}){
  const r=rng(seed),out=[];let p=p0,t=start;
  const phase=i=>Math.sin(i/55)*0.0018+(i>n*0.7?0.0016:0)-(i>n*0.45&&i<n*0.6?0.0022:0);
  for(let i=0;out.length<n;i++){
    if(step>=86400000){const d=new Date(t+3*3600000).getUTCDay();if(d===0||d===6){t+=86400000;continue}}
    else{const h=new Date(t+3*3600000).getUTCHours();if(h<10||h>=18){t+=step;continue}}
    const o=p,g=(r()-0.5)*2*vol+phase(out.length);p=Math.max(1,o*(1+g));
    const h=Math.max(o,p)*(1+r()*vol*0.6),l=Math.min(o,p)*(1-r()*vol*0.6);
    out.push({t,o:+o.toFixed(2),h:+h.toFixed(2),l:+l.toFixed(2),c:+p.toFixed(2),v:Math.round(2e6*(0.5+r()*1.5)*(1+Math.abs(g)*25))});t+=step}
  return out}
const api={rng,rows};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BPDemo=api;
})(this);
