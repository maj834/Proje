// Supabase yedekleme: yerel kayıt ana kayıttır, satırlar kuyruğa alınır ve arka planda gönderilir.
// Yalnızca anon (public) anahtar kullanılır; yazma kullanıcı girişiyle (e-posta + şifre) ve RLS ile korunur.
// Şifre saklanmaz; yalnızca yenileme (refresh) belirteci tutulur.
const fs=require('fs'),path=require('path');

const TABLES=['signals','pressure_log','flow_log','alarms'];
const BATCH=50,MAX_QUEUE=5000;
let cfg={url:null,anon:null,refresh:null,access:null,exp:0,user:null};
let queue=[],file=null,flushing=false,timer=null,backoff=0,lastErr=null,sent=0,onTokens=null,dropped=0,lastDrop=null;

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
  if(tokens)cfg={...cfg,...tokens};
  schedule(2000);
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
  const prev=cfg;cfg={url:u,anon,refresh:null,access:null,exp:0,user:null};
  try{takeSession(await api('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}}))}
  catch(e){cfg=prev;throw new Error(e.status===400?'E-posta ya da şifre hatalı (ya da e-posta onaylanmamış).':e.message)}
  lastErr=null;backoff=0;schedule(500);
  return state();
}
async function ensure(){
  if(cfg.access&&cfg.exp-60000>Date.now())return cfg.access;
  takeSession(await api('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:cfg.refresh}}));
  return cfg.access;
}
// Çıkışta kuyruk temizlenir: eski hesabın satırları başka bir hesaba gönderilmesin.
function signOut(){cfg={url:null,anon:null,refresh:null,access:null,exp:0,user:null};lastErr=null;queue=[];persist();onTokens&&onTokens(null)}
const restore=t=>{const u=validUrl(t.url);if(!u||!validAnon(t.anon)||isServiceRole(t.anon))return;cfg={...cfg,...t,url:u,access:null,exp:0};schedule(2000)};

function enqueue(table,row){
  if(!TABLES.includes(table)||!ready())return;
  queue.push({t:table,r:{...row,ts:row.ts||new Date().toISOString()}});
  if(queue.length>MAX_QUEUE)queue.splice(0,queue.length-MAX_QUEUE);
  persist();schedule(1500);
}
function schedule(ms){clearTimeout(timer);if(!ready()||!queue.length)return;timer=setTimeout(flush,ms+backoff)}

async function flush(){
  if(flushing||!ready()||!queue.length)return state();
  flushing=true;
  try{
    let token=await ensure(),retried=false;
    for(const table of TABLES){
      for(;;){
        const batch=queue.filter(x=>x.t===table).slice(0,BATCH);if(!batch.length)break;
        try{await api('/rest/v1/'+table,{method:'POST',token,body:batch.map(x=>x.r),params:{prefer:'return=minimal'}})}
        catch(e){
          if(e.status===401&&!retried){retried=true;cfg.exp=0;token=await ensure();continue} // belirteç geçersiz: zorla yenile, bir kez tekrar dene
          if(e.status&&e.status<500&&e.status!==429){ // kalici hata: kuyrugu tikamamak icin bu paketi at
            dropped++;lastDrop=table+': '+e.message;queue=queue.filter(x=>!batch.includes(x));persist();continue}
          throw e;
        }
        queue=queue.filter(x=>!batch.includes(x));sent+=batch.length;persist();lastErr=null;
      }
    }
    backoff=0;
  }catch(e){
    lastErr=e.name==='TimeoutError'||/fetch failed/i.test(e.message)?'Bağlantı yok; internet gelince gönderilecek.':e.message;
    backoff=Math.min(300000,(backoff||5000)*2);
  }finally{flushing=false;if(queue.length)schedule(10000)}
  return state();
}

const tokens=()=>({refresh:cfg.refresh,user:cfg.user});
const state=()=>({configured:ready(),user:cfg.user,url:cfg.url,pending:queue.length,sent,error:lastErr,dropped,lastDrop});
module.exports={init,tokens,signIn,signOut,restore,enqueue,flush,state,validUrl,isServiceRole,TABLES};
