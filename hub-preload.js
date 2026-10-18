// Merkez penceresi icin dar API
const {contextBridge,ipcRenderer:i}=require('electron');
contextBridge.exposeInMainWorld('hub',{
  state:()=>i.invoke('hub:state'),toggle:(id,on)=>i.invoke('hub:toggle',id,on),open:id=>i.invoke('hub:open',id),
  on:f=>i.on('hub:state',(_,d)=>f(d)),
  // Guncelleme
  upd:{state:()=>i.invoke('upd:state'),check:()=>i.invoke('upd:check'),install:()=>i.invoke('upd:install'),set:o=>i.invoke('upd:set',o),open:()=>i.invoke('upd:open'),
    on:f=>i.on('update',(_,d)=>f(d))}
});
