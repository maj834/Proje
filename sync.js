// Supabase yedekleme: yerel kayıt ana kayıttır, satırlar kuyruğa alınır ve arka planda gönderilir.
// Yalnızca anon (public) anahtar kullanılır; yazma kullanıcı girişiyle (e-posta + şifre) ve RLS ile korunur.
// Şifre saklanmaz; yalnızca yenileme (refresh) belirteci tutulur.
const fs=require('fs'),path=require('path');

const TABLES=['signals','pressure_log','flow_log','alarms'];
const BATCH=50,MAX_QUEUE=5000;
let cfg={url:null,anon:null,refresh:null,access:null,exp:0,user:null};
let queue=[],file=null,flushing=false,timer=null,backoff=0,lastErr=null,sent=0,onTokens=null,dropped=0,lastDrop=null;
// Oturum kusagi: signIn/signOut/restore her seferinde artirir. Suren bir flush kusak degisince durur,
// boylece bir hesabin satirlari baska hesabin belirteciyle gonderilmez.
let gen=0;
// Bolunerek yeniden denenecek satir-duzeyi hatalar (tek bozuk satir tum paketi dusurmesin)
const SPLIT=new Set([400,409,422]);
// Kuyruktaki her satir yazildigi hesabin anahtarini (a) tasir: proje adresi + kullanici
const acct=()=>cfg.url?cfg.url+'|'+String(cfg.user||'').toLowerCase():null;
const mine=()=>{const k=acct();return k?queue.filter(x=>x.a===k):[]};
const staleErr=()=>Object.assign(new Error('oturum degisti'),{stale:true});

const allowLocal=()=>process.env.GRAFIK_SB_ALLOW_LOCAL==='1';
function validUrl(u){
  u=String(u||'').trim().replace(/\/+$/,'');
  if(/^https:\/\/[a-z0-9]{15,30}\.supabase\.co$/i.test(u))return u;
  if(allowLocal()&&/^http:\/\/127\.0\.0\.1:\d+$/.test(u))return u;
  return null;
}
const validAnon=k=>/^[\w-]+\.[\w-]+\.[\w-]+$/.test(String(k||'').trim())||/^sb_publishable_[\w-]+$/.test(String(k||'').trim());
// service_role anahtari yanlislikla girilirse reddet: JWT govdesindeki role alanina bak.
function isServiceRole(k){try{const p=JSON.parse(Buffer.from(String(k).split('.')[1],'base64url').toString());return p.role==='service_role'}catch(e){return /^sb_secret_/.test(String(k))}}

function init({dir,tokens,onToken}){
  file=path.join(dir,'sb-queue.json');onTokens=onToken||null;
  try{queue=JSON.parse(fs.readFileSync(file,'utf8')).slice(-MAX_QUEUE)}catch(e){queue=[]}
  if(tokens)restore(tokens);else schedule(2000);
}
const persist=()=>{try{fs.writeFileSync(file,JSON.stringify(queue.slice(-MAX_QUEUE)),{mode:0o600})}catch(e){}};
const ready=()=>!!(cfg.url&&cfg.anon&&cfg.refresh);

async function api(pathname,{method='GET',body,token,params}={}){
  const r=await fetch(cfg.url+pathname,{method,headers:{apikey:cfg.anon,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...(params&&params.prefer?{prefer:params.prefer}:{})},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  const text=await r.text();let j=null;try{j=text?JSON.parse(text):null}catch(e){}
  if(!r.ok){const e=new Error((j&&(j.error_description||j.msg||j.message||j.hint))||('HTTP '+r.status));e.status=r.status;throw e}
  return j;
}
function takeSession(j){cfg.access=j.access_token;cfg.refresh=j.refresh_token;cfg.exp=Date.now()+(j.expires_in||3600)*1000;cfg.user=(j.user&&j.user.email)||cfg.user;onTokens&&onTokens({refresh:cfg.refresh,user:cfg.user})}

async function signIn({url,anon,email,password}){
  const u=validUrl(url);if(!u)throw new Error('Proje adresi https://xxxxxxxxxxxxxxx.supabase.co biçiminde olmalı.');
  anon=String(anon||'').trim();if(!validAnon(anon))throw new Error('Anon (public) anahtarı geçersiz.');
  if(isServiceRole(anon))throw new Error('Bu bir service_role anahtarı. Uygulamaya yalnızca anon (public) anahtarı gir; service_role gizli kalmalı.');
  const prev=cfg;gen++;const g=gen;cfg={url:u,anon,refresh:null,access:null,exp:0,user:null};
  let j;
  try{j=await api('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}})}
  catch(e){if(g===gen){cfg=prev;schedule(500)}throw new Error(e.status===400?'E-posta ya da şifre hatalı (ya da e-posta onaylanmamış).':e.message)}
  if(g!==gen)throw new Error('Giriş iptal edildi.'); // bu arada baska bir giris/cikis yapildi
  takeSession(j);
  // Yalnizca bu hesaba ait bekleyen kayitlar kalir: baska hesabin/projenin (ya da sahibi
  // bilinmeyen eski bicimli) satirlari bu hesaba asla yazilmasin.
  const k=acct(),n=queue.length;queue=queue.filter(x=>x.a===k);if(queue.length!==n)persist();
  lastErr=null;backoff=0;schedule(500);
  return state();
}
async function ensure(g=gen){
  if(g!==gen)throw staleErr();
  if(cfg.access&&cfg.exp-60000>Date.now())return cfg.access;
  const j=await api('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:cfg.refresh}});
  if(g!==gen)throw staleErr(); // yenileme surerken hesap degisti: yeni oturumu eskisiyle ezme
  const before=acct();takeSession(j);
  // Kullanici adi bilinmeden geri yuklenen oturum: o oturumda yazilan satirlari gercek hesaba tasi
  const after=acct();if(before!==after&&before===cfg.url+'|'){queue.forEach(x=>{if(x.a===before)x.a=after});persist()}
  return cfg.access;
}
// Çıkışta kuyruk temizlenir: eski hesabın satırları başka bir hesaba gönderilmesin.
function signOut(){gen++;cfg={url:null,anon:null,refresh:null,access:null,exp:0,user:null};lastErr=null;queue=[];persist();onTokens&&onTokens(null)}
function restore(t){const u=validUrl(t.url);if(!u||!validAnon(t.anon)||isServiceRole(t.anon))return;gen++;cfg={...cfg,...t,url:u,access:null,exp:0};
  // Eski bicimde (hesap etiketi olmayan) satirlar geri yuklenen hesaba aittir; baska hesabin satirlari atilir.
  const k=acct();queue=queue.filter(x=>{if(!x.a)x.a=k;return x.a===k});persist();
  schedule(2000)}

function enqueue(table,row){
  if(!TABLES.includes(table)||!ready())return;
  queue.push({t:table,r:{...row,ts:row.ts||new Date().toISOString()},a:acct()});
  if(queue.length>MAX_QUEUE)queue.splice(0,queue.length-MAX_QUEUE);
  persist();schedule(1500);
}
function schedule(ms){clearTimeout(timer);if(!ready()||!mine().length)return;timer=setTimeout(flush,ms+backoff)}

async function flush(){
  if(flushing||!ready()||!mine().length)return state();
  flushing=true;
  const g=gen,key=acct();let retried=false,stale=false;
  const check=()=>{if(g!==gen)throw staleErr()};
  const remove=rows=>{queue=queue.filter(x=>!rows.includes(x));persist()};
  // Bir paketi gonder; satir-duzeyi hatada (400/409/422) ikiye bol ve tekrar dene, en sonda yalnizca
  // tek tek hatali satirlari at. 429/5xx/ag hatasi yukari firlatilir (satirlar kuyrukta kalir).
  const post=async(table,rows)=>{
    for(;;){
      const token=await ensure(g);check(); // belirtec her pakette yeniden alinir
      try{await api('/rest/v1/'+table,{method:'POST',token,body:rows.map(x=>x.r),params:{prefer:'return=minimal'}})}
      catch(e){
        if(e.stale)throw e;
        check();
        if(e.status===401&&!retried){retried=true;cfg.exp=0;continue} // belirtec gecersiz: zorla yenile, bir kez tekrar dene
        if(SPLIT.has(e.status)&&rows.length>1){const h=Math.ceil(rows.length/2);await post(table,rows.slice(0,h));await post(table,rows.slice(h));return}
        if(e.status&&e.status<500&&e.status!==429){ // kalici hata: kuyrugu tikamamak icin bu satirlari at
          dropped+=rows.length;lastDrop=table+': '+e.message;remove(rows);return}
        throw e;
      }
      remove(rows);sent+=rows.length;lastErr=null;
      check();return;
    }
  };
  try{
    for(const table of TABLES){
      for(;;){
        check();
        const batch=queue.filter(x=>x.t===table&&x.a===key).slice(0,BATCH);if(!batch.length)break;
        await post(table,batch);
      }
    }
    backoff=0;
  }catch(e){
    if(e.stale)stale=true; // hesap degisti: eski oturumun hatasi yeni oturuma yansimasin
    else{
      lastErr=e.name==='TimeoutError'||/fetch failed/i.test(e.message)?'Bağlantı yok; internet gelince gönderilecek.':e.message;
      backoff=Math.min(300000,(backoff||5000)*2);
    }
  }finally{flushing=false;if(mine().length)schedule(stale?500:10000)}
  return state();
}

// Okuma ve upsert (haber botu tablolari): kuyruk yok, cevap hemen doner. Oturum yoksa null.
async function call(pathname,opt){if(!ready())return null;let token=await ensure();
  try{return await api(pathname,{...opt,token})}catch(e){if(e.status!==401)throw e;cfg.exp=0;token=await ensure();return api(pathname,{...opt,token})}}
const get=pathname=>call(pathname,{});
const upsert=(table,rows,onConflict)=>call('/rest/v1/'+table+'?on_conflict='+encodeURIComponent(onConflict),{method:'POST',body:rows,params:{prefer:'resolution=merge-duplicates,return=minimal'}});

const tokens=()=>({refresh:cfg.refresh,user:cfg.user});
const state=()=>({configured:ready(),user:cfg.user,url:cfg.url,pending:mine().length,sent,error:lastErr,dropped,lastDrop});
module.exports={init,tokens,signIn,signOut,restore,enqueue,flush,state,get,upsert,validUrl,isServiceRole,TABLES};
