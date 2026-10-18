// Dosya paylasim penceresi icin dar API: yalnizca paylasim islemleri.
const {contextBridge,ipcRenderer:i,webUtils}=require('electron');
contextBridge.exposeInMainWorld('share',{
  start:()=>i.invoke('shareStart'),stop:()=>i.invoke('shareStop'),pick:()=>i.invoke('sharePick'),
  add:paths=>i.invoke('shareAdd',paths),remove:id=>i.invoke('shareRemove',id),reveal:p=>i.invoke('shareReveal',p),
  copy:t=>i.invoke('copy',t),pathOf:f=>{try{return webUtils.getPathForFile(f)}catch(e){return null}},
  on:f=>i.on('shareEvt',(_,d)=>f(d))
});
