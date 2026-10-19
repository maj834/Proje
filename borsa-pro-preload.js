// Borsa Pro penceresi icin dar API: yalnizca 'bp:' kanallari. on(fn) yalniz 'bp:evt' dinler, aboneligi birakan fonksiyon doner.
const {contextBridge,ipcRenderer:i}=require('electron');
const call=ch=>a=>i.invoke(ch,a);
contextBridge.exposeInMainWorld('bp',{
  state:()=>i.invoke('bp:state'),load:call('bp:load'),quotes:call('bp:quotes'),watch:call('bp:watch'),
  scan:call('bp:scan'),scanCancel:()=>i.invoke('bp:scanCancel'),overview:()=>i.invoke('bp:overview'),search:call('bp:search'),
  lab:call('bp:lab'),ai:call('bp:ai'),report:call('bp:report'),ask:call('bp:ask'),alarm:call('bp:alarm'),portfolio:call('bp:portfolio'),
  capital:call('bp:capital'),prefs:call('bp:prefs'),open:u=>i.invoke('bp:open',typeof u==='string'?{url:u}:u),
  on:f=>{if(typeof f!=='function')return ()=>{};const h=(_,d)=>{try{f(d)}catch(e){console.error('bp:evt',e)}};
    i.on('bp:evt',h);return ()=>{i.removeListener('bp:evt',h)}}
});
