const {contextBridge,ipcRenderer:i}=require('electron');
const CH=['busy','err','result','skip','draw'];
contextBridge.exposeInMainWorld('api',{
  analyze:()=>i.invoke('analyze'),key:k=>i.invoke('key',k),live:o=>i.invoke('live',o),cfg:()=>i.invoke('cfg'),
  model:m=>i.invoke('model',m),interval:s=>i.invoke('interval',s),clearHistory:()=>i.invoke('clearHistory'),
  hideOverlay:()=>i.invoke('hideOverlay'),openPerm:()=>i.invoke('openPerm'),quit:()=>i.invoke('quit'),
  on:(c,f)=>{if(CH.includes(c))i.on(c,(_,d)=>f(d))}
});
