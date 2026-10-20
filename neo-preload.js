// Neo penceresi ve kuresi icin dar API
const {contextBridge,ipcRenderer:i}=require('electron');
contextBridge.exposeInMainWorld('neo',{
  state:()=>i.invoke('neo:state'),talk:()=>i.invoke('neo:talk'),ask:t=>i.invoke('neo:ask',t),
  set:o=>i.invoke('neo:set',o),forget:()=>i.invoke('neo:forget'),key:(p,k)=>i.invoke('neo:key',p,k),link:w=>i.invoke('neo:link',w),
  // Ses kaynagi (Sistem / ElevenLabs): ayar, anahtar denemesi, ses listesi
  tts:o=>i.invoke('neo:tts',o),ttsTest:()=>i.invoke('neo:ttsTest'),ttsVoices:f=>i.invoke('neo:ttsVoices',!!f),
  on:f=>i.on('neo:state',(_,d)=>f(d)),onOrb:f=>i.on('neo:orb',(_,d)=>f(d)),onLevel:f=>i.on('neo:level',(_,d)=>f(d))
});
