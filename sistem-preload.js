// Sistem Durumu paneli icin dar API: yalniz okuma, menu cubugu secimi ve paneli gizleme
const {contextBridge,ipcRenderer:i}=require('electron');
contextBridge.exposeInMainWorld('sys',{
  state:()=>i.invoke('sys:state'),set:o=>i.invoke('sys:set',o),hide:()=>i.invoke('sys:hide'),
  on:f=>i.on('sys:data',(_,d)=>f(d))
});
