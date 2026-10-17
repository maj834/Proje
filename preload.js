const {contextBridge,ipcRenderer:i}=require('electron');
const CH=['busy','err','result','skip','state','draw','drawings','mode'];
contextBridge.exposeInMainWorld('api',{
  analyze:eng=>i.invoke('analyze',eng),key:k=>i.invoke('key',k),live:o=>i.invoke('live',o),cfg:()=>i.invoke('cfg'),
  set:o=>i.invoke('set',o),clearHistory:()=>i.invoke('clearHistory'),hideOverlay:()=>i.invoke('hideOverlay'),
  draw:on=>i.invoke('draw',on),saveDrawings:l=>i.invoke('saveDrawings',l),resize:h=>i.invoke('resize',h),
  openPerm:()=>i.invoke('openPerm'),openBilling:()=>i.invoke('openBilling'),quit:()=>i.invoke('quit'),
  on:(c,f)=>{if(CH.includes(c))i.on(c,(_,d)=>f(d))}
});
