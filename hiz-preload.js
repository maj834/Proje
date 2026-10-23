// Hiz testi penceresi icin dar API: yalnizca 'hiz:' kanallari
const {contextBridge,ipcRenderer:i}=require('electron');
contextBridge.exposeInMainWorld('hiz',{
  state:()=>i.invoke('hiz:state'),start:()=>i.invoke('hiz:start'),cancel:()=>i.invoke('hiz:cancel'),clear:()=>i.invoke('hiz:clear'),
  ssid:()=>i.invoke('hiz:ssid'),pass:s=>i.invoke('hiz:pass',s),qr:o=>i.invoke('hiz:qr',o),
  on:f=>{i.on('hiz:evt',(_,d)=>f(d))}
});
