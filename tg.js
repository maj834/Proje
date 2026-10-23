// Telegram baglantisi: kullanicinin kendi hesabiyla derinlik botuna hisse kodu gonderir,
// botun cevaplarini (yazi, resim, butonlar) toplar. GramJS (MTProto) kullanir.
const {TelegramClient,Api,errors}=require('telegram');
const {StringSession}=require('telegram/sessions');
const {NewMessage}=require('telegram/events');
const {EditedMessage}=require('telegram/events/EditedMessage');

let client=null,me=null;

async function connect({apiId,apiHash,session,ask,onSession}){
  await disconnect();
  client=new TelegramClient(new StringSession(session||''),Number(apiId),String(apiHash),{connectionRetries:3,useWSS:false,floodSleepThreshold:0});
  client.setLogLevel&&client.setLogLevel('error');
  // Basarisiz girisde yari acik istemci baglantida kalmasin: kapat ve hatayi ilet.
  try{
    // ask(step,hint) arayuzden telefon / kod / 2FA sifresini ister.
    await client.start({
      phoneNumber:()=>ask('phone'),
      phoneCode:()=>ask('code'),
      password:hint=>ask('password',hint),
      onError:err=>{throw err}
    });
    onSession&&onSession(client.session.save());
    me=await client.getMe();
  }catch(e){await disconnect();throw e}
  return {name:[me.firstName,me.lastName].filter(Boolean).join(' '),username:me.username||null};
}

async function restore({apiId,apiHash,session}){
  if(!session)return null;
  await disconnect();
  client=new TelegramClient(new StringSession(session),Number(apiId),String(apiHash),{connectionRetries:3,floodSleepThreshold:0});
  client.setLogLevel&&client.setLogLevel('error');
  try{
    await client.connect();
    if(!(await client.checkAuthorization())){await disconnect();return null}
    me=await client.getMe();
  }catch(e){await disconnect();throw e}
  return {name:[me.firstName,me.lastName].filter(Boolean).join(' '),username:me.username||null};
}

async function disconnect(){if(client){try{await client.disconnect()}catch(e){}client=null}}
async function logout(){if(client){try{await client.invoke(new Api.auth.LogOut())}catch(e){}}await disconnect()}
const connected=()=>!!client&&client.connected!==false;

function buttonsOf(m){
  const rows=(m.replyMarkup&&m.replyMarkup.rows)||[];
  return rows.map(r=>r.buttons.map(b=>({text:b.text,
    type:b.className==='KeyboardButtonUrl'?'url':/WebView/.test(b.className)?'webapp':b.className==='KeyboardButtonCallback'?'callback':'text',
    url:b.url||null})));
}
// Bot kimligi bir kez cozulur: her sorguda kullanici adi cozmek Telegram'da "flood" beklemesine yol acar
const peers=new Map();let peersOf=null;
async function peer(bot){if(peersOf!==client){peers.clear();peersOf=client}const k=String(bot).toLowerCase();if(!peers.has(k))peers.set(k,await client.getEntity(bot));return peers.get(k)}
async function pack(m){
  const o={id:m.id,date:m.date,text:m.message||'',buttons:buttonsOf(m),photo:null};
  if(m.photo){try{const buf=await client.downloadMedia(m,{});if(buf)o.photo='data:image/jpeg;base64,'+Buffer.from(buf).toString('base64')}catch(e){}}
  return o;
}

// Bota mesaj gonder; bot susana kadar (quietMs) gelen ve duzenlenen mesajlari topla.
async function query(bot,text,{timeoutMs=20000,quietMs=2500}={}){
  if(!client)throw new Error('Telegram bağlı değil.');
  const entity=await peer(bot);
  const got=new Map(),pend=new Set();let last=Date.now(),done;
  const fin=new Promise(r=>done=r);
  const from=e=>{const m=e.message;return m&&String(m.senderId)===String(entity.id)};
  // Mesaj hemen sayilir; fotograf indirmesi bitmeden sonuc donmez (sessizlik suresi indirmeyle yarismasin)
  const onMsg=e=>{if(!from(e))return;last=Date.now();const m=e.message;
    if(!got.has(m.id))got.set(m.id,{id:m.id,date:m.date,text:m.message||'',buttons:buttonsOf(m),photo:null});
    const p=pack(m).then(o=>{got.set(m.id,o);last=Date.now()}).catch(()=>{}).finally(()=>pend.delete(p));pend.add(p)};
  const ev1=new NewMessage({chats:[entity]}),ev2=new EditedMessage({chats:[entity]});
  const c=client;let tick=null,sent;
  c.addEventHandler(onMsg,ev1);c.addEventHandler(onMsg,ev2);
  // Gonderim (ör. FLOOD_WAIT) ya da bekleme hata verirse dinleyiciler ve zamanlayici kalmasin.
  try{
    sent=await c.sendMessage(entity,{message:text});
    const start=Date.now();
    tick=setInterval(()=>{const now=Date.now();if((got.size&&now-last>quietMs)||now-start>timeoutMs)done()},300);
    await fin;
  }finally{
    clearInterval(tick);
    try{c.removeEventHandler(onMsg,ev1)}catch(e){}
    try{c.removeEventHandler(onMsg,ev2)}catch(e){}
  }
  let guard;
  await Promise.race([Promise.all([...pend]),new Promise(s=>{guard=setTimeout(s,15000)})]);
  clearTimeout(guard);
  // Olaylar kacmis olabilir: gonderilenden sonraki son mesajlari da oku.
  if(!got.size){const hist=await client.getMessages(entity,{limit:5,minId:sent.id});for(const m of hist)if(String(m.senderId)===String(entity.id))got.set(m.id,await pack(m))}
  return [...got.values()].sort((a,b)=>a.id-b.id);
}

async function click(bot,msgId,i,j){
  const entity=await peer(bot);
  const [m]=await client.getMessages(entity,{ids:[msgId]});
  if(!m)throw new Error('Mesaj bulunamadı.');
  const btn=m.replyMarkup&&m.replyMarkup.rows[i]&&m.replyMarkup.rows[i].buttons[j];
  if(btn&&/WebView/.test(btn.className))return {webapp:await webAppUrl(bot,btn.url)};
  const r=await m.click({i,j});
  await new Promise(s=>setTimeout(s,1500));
  const hist=await client.getMessages(entity,{limit:3});
  return {messages:await Promise.all(hist.reverse().filter(x=>String(x.senderId)===String(entity.id)).map(pack)),answer:r&&r.message||null};
}

// Botun web uygulamasini (mini app) kullanicinin oturumuyla acilabilir bir adrese cevir.
async function webAppUrl(bot,url){
  const entity=await peer(bot);
  const r=await client.invoke(new Api.messages.RequestWebView({peer:entity,bot:entity,url,platform:'macos',fromBotMenu:false}));
  return r.url;
}

// Botun sohbet menusundeki web uygulamasi (ör. BOPT "Canli Veri"). Yoksa alt klavyedeki web uygulamasi butonu.
async function menuApp(bot){
  const entity=await peer(bot);
  const full=await client.invoke(new Api.users.GetFullUser({id:entity}));
  const mb=full&&full.fullUser&&full.fullUser.botInfo&&full.fullUser.botInfo.menuButton;
  if(mb&&mb.url){
    const r=await client.invoke(new Api.messages.RequestWebView({peer:entity,bot:entity,url:mb.url,platform:'macos',fromBotMenu:true}));
    return {url:r.url,text:mb.text||null};
  }
  for(const m of await client.getMessages(entity,{limit:10}))
    for(const row of (m.replyMarkup&&m.replyMarkup.rows)||[])for(const b of row.buttons||[])
      if(/WebView/.test(b.className)&&b.url){
        const r=await client.invoke(/Simple/.test(b.className)?new Api.messages.RequestSimpleWebView({bot:entity,url:b.url,platform:'macos'})
          :new Api.messages.RequestWebView({peer:entity,bot:entity,url:b.url,platform:'macos',fromBotMenu:false}));
        return {url:r.url,text:b.text||null};
      }
  throw new Error('Botun menüsünde web uygulaması bulunamadı.');
}

// Telegram'in "bekle" hatasi: kac saniye beklenmesi gerektigini dondurur (yoksa 0).
const floodSeconds=e=>e instanceof errors.FloodWaitError||/FLOOD_WAIT/.test(String(e&&e.message))?(e.seconds||+((String(e.message).match(/(\d+)/)||[])[1])||60):0;

module.exports={floodSeconds,connect,restore,disconnect,logout,connected,query,click,webAppUrl,menuApp};
