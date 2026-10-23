// Pano Gecmisi penceresi icin dar API: liste, arama, geri kopyalama, sabitleme, silme, duraklatma
const {contextBridge,ipcRenderer:i}=require('electron');
contextBridge.exposeInMainWorld('pano',{
  state:()=>i.invoke('pano:state'),find:q=>i.invoke('pano:find',q),copy:id=>i.invoke('pano:copy',id),
  del:id=>i.invoke('pano:del',id),pin:id=>i.invoke('pano:pin',id),pause:()=>i.invoke('pano:pause'),
  clear:()=>i.invoke('pano:clear'),hide:()=>i.invoke('pano:hide'),
  on:f=>i.on('pano:data',(_,d)=>f(d))
});
