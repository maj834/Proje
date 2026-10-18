// Ses penceresi icin dar API
const {contextBridge,ipcRenderer:i}=require('electron');
contextBridge.exposeInMainWorld('ses',{
  state:()=>i.invoke('ses:state'),app:(bundle,s)=>i.invoke('ses:app',bundle,s),global:s=>i.invoke('ses:global',s),
  preset:n=>i.invoke('ses:preset',n),reset:()=>i.invoke('ses:reset'),volume:v=>i.invoke('ses:volume',v),
  mute:on=>i.invoke('ses:mute',on),device:uid=>i.invoke('ses:device',uid),on:f=>i.on('ses:state',(_,d)=>f(d))
});
