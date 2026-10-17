// Dosya Kilidi penceresi icin dar API: dosyalar yalnizca kayittaki id ile secilir; yol yalnizca surukle-birakta gider.
const {contextBridge,ipcRenderer:i,webUtils}=require('electron');
contextBridge.exposeInMainWorld('kilit',{
  state:()=>i.invoke('kl:state'),setup:(a,b)=>i.invoke('kl:setup',a,b),
  unlockPw:p=>i.invoke('kl:unlockPw',p),unlockBio:()=>i.invoke('kl:unlockBio'),lock:()=>i.invoke('kl:lock'),
  touch:()=>i.invoke('kl:touch'),changePw:(o,n,n2)=>i.invoke('kl:changePw',o,n,n2),
  pick:()=>i.invoke('kl:pick'),drop:paths=>i.invoke('kl:drop',paths),
  open:id=>i.invoke('kl:open',id),save:id=>i.invoke('kl:save',id),unlock:id=>i.invoke('kl:unlock',id),
  trash:id=>i.invoke('kl:trash',id),forget:id=>i.invoke('kl:forget',id),reveal:id=>i.invoke('kl:reveal',id),
  pathOf:f=>{try{return webUtils.getPathForFile(f)}catch(e){return null}},
  on:f=>i.on('kl:evt',(_,d)=>f(d))
});
