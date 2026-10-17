const {contextBridge,ipcRenderer:i}=require('electron');
const CH=['botNews','busy','err','result','skip','state','draw','drawings','mode','tgAsk','depth','depthBusy','depthErr','depthWait'];
contextBridge.exposeInMainWorld('api',{
  analyze:eng=>i.invoke('analyze',eng),key:k=>i.invoke('key',k),live:o=>i.invoke('live',o),cfg:()=>i.invoke('cfg'),
  set:o=>i.invoke('set',o),clearHistory:()=>i.invoke('clearHistory'),hideOverlay:()=>i.invoke('hideOverlay'),
  draw:on=>i.invoke('draw',on),copy:t=>i.invoke('copy',t),saveDrawings:l=>i.invoke('saveDrawings',l),resize:h=>i.invoke('resize',h),
  tgConnect:p=>i.invoke('tgConnect',p),tgAnswer:v=>i.invoke('tgAnswer',v),tgLogout:()=>i.invoke('tgLogout'),tgSet:o=>i.invoke('tgSet',o),tgClick:o=>i.invoke('tgClick',o),tgMenu:()=>i.invoke('tgMenu'),
  depth:o=>i.invoke('depth',o),depthSet:o=>i.invoke('depthSet',o),openUrl:u=>i.invoke('openUrl',u),openExternal:u=>i.invoke('openExternal',u),
  sbConnect:p=>i.invoke('sbConnect',p),sbLogout:()=>i.invoke('sbLogout'),sbToggle:o=>i.invoke('sbToggle',o),sbFlush:()=>i.invoke('sbFlush'),
  scCapture:on=>i.invoke('scCapture',on),scSet:o=>i.invoke('scSet',o),diag:()=>i.invoke('diag'),karne:()=>i.invoke('karne'),testNotify:()=>i.invoke('testNotify'),parseTest:t=>i.invoke('parseTest',t),
  grokTest:()=>i.invoke('grokTest'),openPerm:()=>i.invoke('openPerm'),openBilling:()=>i.invoke('openBilling'),quit:()=>i.invoke('quit'),
  on:(c,f)=>{if(CH.includes(c))i.on(c,(_,d)=>f(d))}
});
