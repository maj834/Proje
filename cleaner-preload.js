// Temizlik penceresi icin dar API: yalnizca 'cl:' kanallari. Silme onayi ana surecte gosterilir.
const {contextBridge,ipcRenderer:i}=require('electron');
contextBridge.exposeInMainWorld('cleaner',{
  roots:()=>i.invoke('cl:roots'),pickFolder:()=>i.invoke('cl:pick'),scanDuplicates:r=>i.invoke('cl:dups',r),cancel:()=>i.invoke('cl:cancel'),
  removeDuplicates:p=>i.invoke('cl:rmdups',p),scanJunk:()=>i.invoke('cl:junk'),clean:ids=>i.invoke('cl:clean',ids),reveal:p=>i.invoke('cl:reveal',p),
  confirm:(m,d)=>i.invoke('cl:confirm',m,d),openLog:()=>i.invoke('cl:log'),on:f=>{i.on('cl:evt',(_,d)=>f(d))}
});
