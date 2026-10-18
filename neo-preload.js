// Neo penceresi ve kuresi icin dar API
const {contextBridge,ipcRenderer:i}=require('electron');
contextBridge.exposeInMainWorld('neo',{
  state:()=>i.invoke('neo:state'),talk:()=>i.invoke('neo:talk'),ask:t=>i.invoke('neo:ask',t),
  set:o=>i.invoke('neo:set',o),forget:()=>i.invoke('neo:forget'),
  on:f=>i.on('neo:state',(_,d)=>f(d)),onOrb:f=>i.on('neo:orb',(_,d)=>f(d)),onLevel:f=>i.on('neo:level',(_,d)=>f(d))
});
