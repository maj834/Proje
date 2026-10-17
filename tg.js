// Telegram baglantisi: kullanicinin kendi hesabiyla derinlik botuna hisse kodu gonderir,
// botun cevaplarini (yazi, resim, butonlar) toplar. GramJS (MTProto) kullanir.
const {TelegramClient,Api}=require('telegram');
const {StringSession}=require('telegram/sessions');
const {NewMessage}=require('telegram/events');
const {EditedMessage}=require('telegram/events/EditedMessage');

let client=null,me=null;

async function connect({apiId,apiHash,session,ask,onSession}){
  await disconnect();
  client=new TelegramClient(new StringSession(session||''),Number(apiId),String(apiHash),{connectionRetries:3,useWSS:false});
  client.setLogLevel&&client.setLogLevel('error');
  // ask(step,hint) arayuzden telefon / kod / 2FA sifresini ister.
  await client.start({
    phoneNumber:()=>ask('phone'),
    phoneCode:()=>ask('code'),
    password:hint=>ask('password',hint),
    onError:err=>{throw err}
  });
  onSession&&onSession(client.session.save());
  me=await client.getMe();
  return {name:[me.firstName,me.lastName].filter(Boolean).join(' '),username:me.username||null};
}

async function restore({apiId,apiHash,session}){
  if(!session)return null;
  await disconnect();
  client=new TelegramClient(new StringSession(session),Number(apiId),String(apiHash),{connectionRetries:3});
  client.setLogLevel&&client.setLogLevel('error');
  await client.connect();
  if(!(await client.checkAuthorization())){await disconnect();return null}
  me=await client.getMe();
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
async function pack(m){
  const o={id:m.id,date:m.date,text:m.message||'',buttons:buttonsOf(m),photo:null};
  if(m.photo){try{const buf=await client.downloadMedia(m,{});if(buf)o.photo='data:image/jpeg;base64,'+Buffer.from(buf).toString('base64')}catch(e){}}
  return o;
}

// Bota mesaj gonder; bot susana kadar (quietMs) gelen ve duzenlenen mesajlari topla.
async function query(bot,text,{timeoutMs=20000,quietMs=2500}={}){
  if(!client)throw new Error('Telegram bağlı değil.');
  const entity=await client.getEntity(bot);
  const got=new Map();let last=Date.now(),done;
  const fin=new Promise(r=>done=r);
  const from=e=>{const m=e.message;return m&&String(m.senderId)===String(entity.id)};
  const onMsg=async e=>{if(!from(e))return;last=Date.now();got.set(e.message.id,await pack(e.message))};
  const ev1=new NewMessage({chats:[entity]}),ev2=new EditedMessage({chats:[entity]});
  client.addEventHandler(onMsg,ev1);client.addEventHandler(onMsg,ev2);
  const sent=await client.sendMessage(entity,{message:text});
  const start=Date.now();
  const tick=setInterval(()=>{const now=Date.now();if((got.size&&now-last>quietMs)||now-start>timeoutMs)done()},300);
  await fin;clearInterval(tick);
  client.removeEventHandler(onMsg,ev1);client.removeEventHandler(onMsg,ev2);
  // Olaylar kacmis olabilir: gonderilenden sonraki son mesajlari da oku.
  if(!got.size){const hist=await client.getMessages(entity,{limit:5,minId:sent.id});for(const m of hist)if(String(m.senderId)===String(entity.id))got.set(m.id,await pack(m))}
  return [...got.values()].sort((a,b)=>a.id-b.id);
}

async function click(bot,msgId,i,j){
  const entity=await client.getEntity(bot);
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
  const entity=await client.getEntity(bot);
  const r=await client.invoke(new Api.messages.RequestWebView({peer:entity,bot:entity,url,platform:'macos',fromBotMenu:false}));
  return r.url;
}

module.exports={connect,restore,disconnect,logout,connected,query,click,webAppUrl};
