// Merkez penceresi icin dar API
const {contextBridge,ipcRenderer:i}=require('electron');
contextBridge.exposeInMainWorld('hub',{
  state:()=>i.invoke('hub:state'),toggle:(id,on)=>i.invoke('hub:toggle',id,on),open:id=>i.invoke('hub:open',id),
  on:f=>i.on('hub:state',(_,d)=>f(d))
});
