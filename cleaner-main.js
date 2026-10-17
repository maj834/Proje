// Temizlik penceresi: IPC kopru, son tarama durumu ve onaylar. Silme kurallari ve korumalar cleaner.js'te.
// Arayuz asla ham yol gondererek temizlik yaptiramaz: sistem temizliginde kategori kimligi, kopyalarda yalnizca
// son taramada bulunan yollar kabul edilir. Her kaldirma oncesi onay diyalogu ana surecte gosterilir.
const fs=require('fs'),{execFile}=require('child_process');
const C=require('./cleaner');

const OWN_IDS=['com.grafik.okuyucu','com.github.Electron'];   // kendi onbellegimize dokunma

// Calisan uygulamalarin paket kimlikleri: ps ciktisindaki .app yollarindan Info.plist okunur (en iyi caba)
function runningBundleIds(){
  return new Promise(ok=>{
    if(process.platform!=='darwin')return ok([]);
    execFile('/bin/ps',['-axo','comm'],{maxBuffer:16*1024*1024,timeout:5000},(err,out)=>{
      if(err)return ok([]);
      try{
        const apps=new Set();
        for(const line of String(out).split('\n')){const s=line.trim();let i=-1;while((i=s.indexOf('.app/',i+1))>=0)apps.add(s.slice(0,i+4))}
        const ids=new Set();
        for(const a of apps){try{const t=fs.readFileSync(a+'/Contents/Info.plist','utf8');
          const m=/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(t);if(m)ids.add(m[1].trim())}catch(e){}}
        ok([...ids]);
      }catch(e){ok([])}
    });
  });
}
const emptyTrash=()=>new Promise((ok,no)=>execFile('/usr/bin/osascript',['-e','tell application "Finder" to empty trash'],{timeout:120000},e=>e?no(e):ok()));

function registerCleaner({ipcMain,dialog,shell,app,BrowserWindow,path}){
  let win=null,ctl=null,dups=null,junk=null,busy=false;
  const home=()=>app.getPath('home');
  const logFile=()=>path.join(app.getPath('userData'),'temizlik-kaydi.jsonl');
  const send=e=>{if(win&&!win.isDestroyed())win.webContents.send('cl:evt',e)};
  const trash=p=>shell.trashItem(p);
  const ask=(message,detail,okLabel)=>dialog.showMessageBox(win||undefined,{type:'warning',buttons:[okLabel||'Devam et','Vazgeç'],
    defaultId:1,cancelId:1,message:String(message||'').slice(0,300),detail:String(detail||'').slice(0,2000)}).then(r=>r.response===0).catch(()=>false);
  // Yalnizca temizlik penceresinden gelen istekler; hatalar {ok:false,msg} olarak doner
  const h=(ch,fn)=>ipcMain.handle(ch,async(e,...a)=>{
    if(!win||win.isDestroyed()||e.sender!==win.webContents)return {ok:false,msg:'Yetkisiz istek.'};
    try{return await fn(...a)}catch(err){return {ok:false,msg:err&&err.message||String(err)}}});
  const lock=async fn=>{if(busy)return {ok:false,msg:'Başka bir işlem sürüyor.'};busy=true;try{return await fn()}finally{busy=false}};

  function open(){
    if(win){win.show();win.focus();return}
    win=new BrowserWindow({width:760,height:720,minWidth:600,minHeight:480,title:'Temizlik',show:false,
      webPreferences:{preload:path.join(__dirname,'cleaner-preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
    win.loadFile(path.join(__dirname,'cleaner.html'));win.once('ready-to-show',()=>{win.show();win.focus()});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',e=>e.preventDefault());
    win.on('closed',()=>{win=null;if(ctl)ctl.abort();ctl=null;dups=null;junk=null});
  }

  h('cl:roots',()=>{
    const L=[['downloads','İndirilenler'],['desktop','Masaüstü'],['documents','Belgeler'],['pictures','Resimler']];
    return {ok:true,home:home(),roots:L.map(([k,name])=>{try{return {path:app.getPath(k),name}}catch(e){return null}})
      .filter(r=>r&&fs.existsSync(r.path))};
  });
  h('cl:pick',async()=>{
    const r=await dialog.showOpenDialog(win,{title:'Taranacak klasörü seç',properties:['openDirectory','multiSelections']});
    return r.canceled?[]:r.filePaths;
  });
  h('cl:dups',roots=>lock(async()=>{
    roots=[...new Set((Array.isArray(roots)?roots:[]).filter(p=>typeof p==='string'&&path.isAbsolute(p)))].slice(0,50);
    if(!roots.length)return {ok:false,msg:'Taranacak klasör seçilmedi.'};
    ctl=new AbortController();dups=null;
    try{
      const groups=await C.findDuplicates(roots,{signal:ctl.signal,home:home(),onProgress:p=>send({type:'progress',...p})});
      dups=groups;return {ok:true,home:home(),groups};
    }catch(e){if(e.name==='AbortError')return {ok:false,cancelled:true,msg:'Tarama iptal edildi.'};throw e}
    finally{ctl=null}
  }));
  h('cl:cancel',()=>{if(ctl)ctl.abort();return {ok:true}});
  h('cl:rmdups',paths=>lock(async()=>{
    if(!dups)return {ok:false,msg:'Önce tarama yap.'};
    const byPath=new Map();for(const g of dups)for(const f of g.files)byPath.set(f.path,g);
    // Yalnizca son taramadaki ve "Kalacak" olmayan kopyalar
    const sel=[...new Set((Array.isArray(paths)?paths:[]).filter(p=>typeof p==='string'&&byPath.has(p)&&byPath.get(p).keep!==p))];
    if(!sel.length)return {ok:false,msg:'Seçili dosya yok.'};
    const size=sel.reduce((s,p)=>s+byPath.get(p).size,0);
    if(!await ask(sel.length+' dosya Çöp Sepeti’ne taşınsın mı?','Toplam '+C.human(size)+'. Her gruptan en az bir kopya kalır. Taşımadan hemen önce her dosyanın içeriği yeniden doğrulanır. Dosyaları Finder’da Çöp Sepeti’nden geri alabilirsin.','Çöp Sepeti’ne taşı'))
      return {ok:false,cancelled:true};
    const r=await C.removeDuplicates(dups,sel,{trash,home:home(),logFile:logFile()});
    const gone=new Set(r.removed);
    dups=dups.map(g=>{const files=g.files.filter(f=>!gone.has(f.path));return {...g,files,keep:files.some(f=>f.path===g.keep)?g.keep:(files.length?C.pickKeep(files):null)}}).filter(g=>g.files.length>1);
    return {ok:true,...r,freedText:C.human(r.freed)};
  }));
  h('cl:junk',()=>lock(async()=>{
    junk=null;
    const ids=[...await runningBundleIds(),...OWN_IDS];
    junk=await C.scanJunk(home(),{runningBundleIds:ids,onProgress:p=>send({type:'progress',...p})});
    return {ok:true,home:home(),total:junk.total,skipped:junk.skipped,
      categories:junk.categories.map(c=>({id:c.id,title:c.title,desc:c.desc,size:c.size,mode:c.mode,default:c.default,note:c.note||'',count:c.items.length,items:c.items.slice(0,20)}))};
  }));
  h('cl:clean',ids=>lock(async()=>{
    if(!junk)return {ok:false,msg:'Önce tarama yap.'};
    ids=Array.isArray(ids)?ids.filter(x=>typeof x==='string'):[];
    // Cop Sepeti once bosaltilir ki bu temizlikte Cop'e tasinan yukleyiciler geri alinabilir kalsin
    const cats=junk.categories.filter(c=>ids.includes(c.id)&&c.items.length).sort((a,b)=>(b.mode==='trash-empty')-(a.mode==='trash-empty'));
    if(!cats.length)return {ok:false,msg:'Seçili kategori yok.'};
    const total=cats.reduce((s,c)=>s+c.size,0),notes=[];
    if(cats.some(c=>c.mode==='delete'))notes.push('Önbellekler, günlükler ve boş klasörler kalıcı olarak silinir; uygulamalar gerektiğinde yeniden oluşturur.');
    if(cats.some(c=>c.mode==='trash'))notes.push('Eski yükleyiciler Çöp Sepeti’ne taşınır.');
    if(cats.some(c=>c.mode==='trash-empty'))notes.push('Çöp Sepeti boşaltılır; içindekiler geri alınamaz.');
    if(!await ask('Seçilenler temizlensin mi? ('+C.human(total)+')',cats.map(c=>'• '+c.title+' — '+C.human(c.size)).join('\n')+'\n\n'+notes.join(' '),'Temizle'))
      return {ok:false,cancelled:true};
    // Tarama ile temizlik arasinda acilan uygulamalarin onbelleklerine dokunma
    const running=[...await runningBundleIds(),...OWN_IDS].map(s=>s.toLowerCase());
    let freed=0,count=0;const failed=[];
    for(const c of cats){
      send({type:'progress',phase:'temizle',id:c.id,title:c.title});
      if(c.mode==='trash-empty'){
        try{await emptyTrash();freed+=c.size;count+=c.items.length;C.appendLog(logFile(),{path:path.join(home(),'.Trash'),size:c.size,mode:'trash-empty'})}
        catch(e){failed.push({path:'Çöp Sepeti',error:'Çöp Sepeti boşaltılamadı: '+(e.message||e)})}
        continue;
      }
      let items=c.items;
      if(c.id==='cache')items=items.filter(it=>!C.runningMatch(path.basename(it.path),running));
      if(c.id==='browser')items=items.filter(it=>{const b=C.browserOf(it.path,home());return !b||!running.includes(b.toLowerCase())});
      const r=await C.removeItems(items,{mode:c.mode,trash,home:home(),logFile:logFile()});
      freed+=r.freed;count+=r.removed.length;failed.push(...r.failed);
    }
    junk=null;   // durum degisti: yeni temizlik icin yeniden taranmali
    return {ok:true,freed,freedText:C.human(freed),count,failed:failed.slice(0,50),failedCount:failed.length};
  }));
  h('cl:reveal',p=>{
    if(typeof p!=='string')return {ok:false};
    const known=(dups||[]).some(g=>g.files.some(f=>f.path===p))||(junk&&junk.categories.some(c=>c.items.some(i=>i.path===p)));
    if(known)shell.showItemInFolder(p);
    return {ok:known};
  });
  h('cl:confirm',(message,detail)=>ask(message,detail));
  h('cl:log',async()=>{
    const f=logFile();if(!fs.existsSync(f))return {ok:false,msg:'Henüz temizlik kaydı yok.'};
    const err=await shell.openPath(f);if(err)shell.showItemInFolder(f);
    return {ok:true};
  });
  return {open};
}

module.exports={registerCleaner,runningBundleIds};
