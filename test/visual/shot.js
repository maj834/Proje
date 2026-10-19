// Gorsel kontrol araci (CI'da calismaz): bir HTML sayfasini gizli pencerede acip ekran goruntusu alir.
// Kullanim: xvfb-run -a node_modules/.bin/electron --no-sandbox test/visual/shot.js <sayfa.html> <cikti.png> [genislik] [yukseklik] [preload.js] [koyu|acik]
// Taklit preload verilirse pencere korumali alansiz (sandbox:false) acilir: taklit Node modullerini (engine.js vb.) yukleyebilsin.
// Sayfa hazir olunca window.__ready=true yapmali (yoksa 5 sn sonra cekilir). Sayfa konsol mesajlari ve hatalari stdout'a yazilir.
const {app,BrowserWindow,nativeTheme}=require('electron');
const fs=require('fs'),path=require('path');
// Electron bayraklari (--no-sandbox) betikten once ya da sonra gelebilir: betigin kendisinden sonraki konumsal argumanlar alinir
const me=process.argv.findIndex(a=>/shot\.js$/.test(a));
const [page,out,w='1360',h='860',pre='',theme='koyu']=process.argv.slice(me+1).filter(a=>!a.startsWith('--'));
if(!page||!out){console.error('kullanim: shot.js <sayfa.html> <cikti.png> [w] [h] [preload] [koyu|acik]');process.exit(2)}
app.whenReady().then(async()=>{
  nativeTheme.themeSource=theme==='acik'?'light':'dark';
  const win=new BrowserWindow({width:+w,height:+h,show:false,webPreferences:{sandbox:!pre,offscreen:false,preload:pre?path.resolve(pre):undefined}});
  win.webContents.on('console-message',(e,level,msg,line,src)=>console.log('[sayfa]',msg,src?('('+path.basename(src)+':'+line+')'):''));
  win.webContents.on('render-process-gone',(e,d)=>{console.log('[sayfa] COKTU',d.reason);process.exit(1)});
  await win.loadFile(path.resolve(page));
  const t0=Date.now();
  while(Date.now()-t0<5000){if(await win.webContents.executeJavaScript('!!window.__ready').catch(()=>false))break;await new Promise(r=>setTimeout(r,100))}
  // SHOT_JS: hazir olduktan sonra sayfada calistirilacak kod (ornek: bir dugmeye tiklamak); sonra 1,5 sn beklenir
  if(process.env.SHOT_JS){await win.webContents.executeJavaScript(process.env.SHOT_JS).catch(e=>console.log('[SHOT_JS]',e.message));await new Promise(r=>setTimeout(r,1500))}
  await new Promise(r=>setTimeout(r,400));
  const img=await win.webContents.capturePage();
  fs.writeFileSync(path.resolve(out),img.toPNG());
  console.log('SHOT_OK',out,img.getSize().width+'x'+img.getSize().height);
  app.exit(0);
});
