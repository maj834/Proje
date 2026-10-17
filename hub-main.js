// Merkez: tum ozelliklerin listelendigi ana pencere. Her ozellik buradan acilir/kapatilir;
// kapali ozellik menu cubugunda gorunmez, kisayolu ve arka plan isi durur.
const MODULES=[
  {id:'borsa',name:'Borsa',desc:'Ekrandaki grafiği okur; derinlik, kurum dağılımı, işlem akışı, AL/SAT ve haberler.',ready:true,def:true},
  {id:'ses',name:'Ses',desc:'Her uygulamanın sesi ayrı; %200\'e kadar yükseltme, bas ve tiz, çıkış aygıtı.',ready:true,def:true},
  {id:'paylas',name:'Dosya Paylaşımı',desc:'QR ile telefona ve telefondan dosya. iPhone, Android, iPad; uygulama gerekmez.',ready:true,def:true},
  {id:'temizlik',name:'Temizlik',desc:'Birebir aynı dosyalar, önbellek ve gereksiz dosyalar. Her şey önce onayına gelir.',ready:true,def:true},
  {id:'kilit',name:'Dosya Kilidi',desc:'Dosyaları şifreler; Touch ID ya da şifre olmadan açılmaz.',ready:true,def:true},
  {id:'yazi',name:'Ekrandan Yazı',desc:'Ekranda seçtiğin alandaki yazıyı kopyalar; resim, PDF ve videoda da çalışır.',ready:false,def:true},
  {id:'ceviri',name:'Ekrandan Çeviri',desc:'Seçtiğin alanın çevirisini aynı yerin üstünde gösterir.',ready:false,def:true},
  {id:'goruntu',name:'Ekran Görüntüsü',desc:'Alan seç; ok, kutu, yazı ve bulanıklaştırma ekle, kopyala ya da gönder.',ready:false,def:true},
  {id:'pano',name:'Pano Geçmişi',desc:'Son kopyaladıkların aranabilir listede; şifreler kaydedilmez.',ready:false,def:true},
  {id:'qr',name:'QR Okuyucu',desc:'Ekrandaki QR kodu okur; bağlantıyı açar ya da kopyalar.',ready:false,def:true},
  {id:'renk',name:'Renk ve Cetvel',desc:'Ekrandan renk kodu al, iki nokta arasını piksel olarak ölç.',ready:false,def:true},
];

function registerHub({ipcMain,app,BrowserWindow,path,cfg,save,name,actions}){
  let win=null;const ready=new Set(MODULES.filter(m=>m.ready).map(m=>m.id));
  const enabled=id=>{const m=MODULES.find(x=>x.id===id);if(!m)return false;const v=(cfg().modules||{})[id];return v==null?m.def:!!v};
  const view=()=>({name,modules:MODULES.map(m=>({id:m.id,name:m.name,desc:m.desc,ready:ready.has(m.id),on:enabled(m.id),
    status:ready.has(m.id)&&enabled(m.id)&&actions.status?actions.status(m.id):null}))});
  const push=()=>{if(win&&!win.isDestroyed())win.webContents.send('hub:state',view())};
  function open(){
    if(win){if(win.isMinimized())win.restore();win.show();win.focus();return}
    win=new BrowserWindow({width:900,height:640,minWidth:640,minHeight:480,title:name,show:false,titleBarStyle:'hiddenInset',
      webPreferences:{preload:path.join(__dirname,'hub-preload.js'),sandbox:true}});
    win.loadFile(path.join(__dirname,'hub.html'));win.once('ready-to-show',()=>{win.show();win.focus()});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
    win.on('closed',()=>{win=null});
  }
  ipcMain.handle('hub:state',()=>view());
  ipcMain.handle('hub:toggle',(e,id,on)=>{
    const m=MODULES.find(x=>x.id===id);if(!m||!ready.has(id))return view();
    save({modules:{...(cfg().modules||{}),[id]:!!on}});
    try{actions.toggle&&actions.toggle(id,!!on)}catch(err){console.error('modul',id,err)}
    push();return view();
  });
  ipcMain.handle('hub:open',(e,id)=>{if(ready.has(id)&&enabled(id)&&actions.open)actions.open(id);return view()});
  // Ajanlarin yazdigi moduller hazir olunca kaydolur
  const setReady=id=>{ready.add(id);push()};
  return {open,enabled,setReady,push,MODULES};
}
module.exports={registerHub,MODULES};
