// Borsa Okulu arayuzu (Borsa Pro gorunum parcasi; tarayici). window.BPOkul.render(container, api, helpers)
//   api.okul(op,args) -> Promise<{ok,...}> : okul-client.js call() koprusu (list|get|today|quiz|answer|progress|markRead|sozluk|ask|open)
//   helpers: {el, toast, go(sembol)?, sembol()?|string, baglam(sembol)?}  (Borsa Pro'nun el()/toast() yardimcilari)
// Alt sekmeler: Bugun (sabah/aksam analizi, gunun dersi, gunun 3 sorusu, ilerleme), Dersler (mufredat, seviye/konu filtresi, ilerleme
// cubugu, ders okuyucu, video rozeti, alistirmalar), Sorular (quiz, aninda geri bildirim, seri, konu bazli basari), Ogretmene sor, Sozluk.
// Icerik yapay zeka uretimidir ve guvenilmez kabul edilir: yalniz textContent ile yazilir (innerHTML yalniz sabit SVG ikonlarda).
// Borsa Pro siniflari (.card .ph .seg .btn .chip .mu .disc .warn .empty .kv .cards .mc .prog .spin .inp) kullanilir; okula ozel
// stiller .okul altinda tek <style id="bp-okul-css"> ile eklenir. Yatirim tavsiyesi degildir.
(function(){
'use strict';
const SEV={baslangic:'Başlangıç',orta:'Orta',ileri:'İleri'};
const KONU={'temel-kavramlar':'Temel kavramlar',teknik:'Teknik analiz',temel:'Temel analiz',risk:'Risk yönetimi',psikoloji:'Yatırımcı psikolojisi',
  makro:'Makro ekonomi','bist-kurallari':'BIST kuralları',strateji:'Strateji','vergi-maliyet':'Vergi ve maliyet',genel:'Genel'};
const TABS=[['bugun','Bugün'],['dersler','Dersler'],['sorular','Sorular'],['sor','Öğretmene sor'],['sozluk','Sözlük']];
const PIYASA={xu100:'BIST 100',xu030:'BIST 30',xbank:'Bankacılık',xusin:'Sanayi',usdtry:'USD/TRY',eurtry:'EUR/TRY',altin:'Gram altın',ons:'Ons altın',brent:'Brent',spx:'S&P 500',faiz:'Gösterge faiz'};
const YON={yukari:['Yükseliş','up'],asagi:['Düşüş','dn'],izle:['İzle','']};
const ONERI=['T+2 takas tam olarak ne demek?','Devre kesici devreye girince ne olur?','Stop-loss seviyesini nasıl belirlerim?','F/K oranı düşük diye hisse ucuz mu demektir?',
  'Bedelsiz sermaye artırımı hisseyi değerli yapar mı?','Enflasyon yüksekken getirimi nasıl ölçmeliyim?'];
const IC={
  play:'<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1.2v7.6L8.6 5z" fill="currentColor"/></svg>',
  check:'<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  srch:'<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9.2 9.2L12.5 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  off:'<svg width="13" height="13" viewBox="0 0 14 14"><path d="M1.5 5.2a8 8 0 0 1 11 0M3.6 7.4a5 5 0 0 1 6.8 0M5.8 9.6a2 2 0 0 1 2.4 0M2 2l10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  ext:'<svg width="10" height="10" viewBox="0 0 10 10"><path d="M4 2H2v6h6V6M6 1.5h2.5V4M8.5 1.5L4.5 5.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
};
const CSS=`
.okul{min-width:0}
.okul .ph{margin-bottom:14px}
.okul .ph .seg button{font:500 12px var(--font);height:28px;padding:0 12px}
.okul .card{margin:0;background:var(--surface)}
.okul p{margin:0 0 8px}
.ok-hs{display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap}
.ok-hs .prog{width:120px;flex:none}
.ok-grid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(300px,1fr);gap:14px;align-items:start}
.ok-col{display:flex;flex-direction:column;gap:12px;min-width:0}
.ok-title{font:600 18px/1.3 var(--font);margin:2px 0 6px;letter-spacing:-.005em}
.ok-lead{color:var(--fg-2);font-size:13px;line-height:1.55;margin:0 0 10px}
.ok-meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap;color:var(--fg-3);font-size:11px}
.ok-lvl{font:600 10px var(--font);padding:2px 7px;border-radius:9px;white-space:nowrap;background:var(--sunk);color:var(--fg-2)}
.ok-lvl.lv-baslangic{color:var(--up);background:var(--up-soft)}.ok-lvl.lv-orta{color:var(--warn);background:var(--acc-soft)}.ok-lvl.lv-ileri{color:var(--dn);background:var(--dn-soft)}
.ok-vid{display:inline-flex;align-items:center;gap:4px;height:19px;padding:0 7px;border-radius:10px;border:1px solid color-mix(in oklch,var(--info) 45%,transparent);color:var(--info);background:color-mix(in oklch,var(--info) 10%,transparent);font:600 10px var(--font);white-space:nowrap;cursor:pointer}
.ok-vid:hover{background:color-mix(in oklch,var(--info) 18%,transparent)}
.ok-mkt{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px;margin:12px 0 4px}
.ok-mkt div{border:1px solid var(--line);border-radius:5px;padding:7px 9px;background:var(--bg)}
.ok-mkt span{display:block;font-size:10.5px;color:var(--fg-3)}.ok-mkt b{font:600 14px var(--mono)}.ok-mkt i{font:500 11px var(--mono);font-style:normal;margin-left:6px}
.ok-txt{font-size:13px;line-height:1.62;color:var(--fg)}.ok-txt p{margin:0 0 9px}.ok-txt ul{margin:0 0 9px;padding-left:18px}.ok-txt li{margin:3px 0}
.ok-h{margin:16px 0 6px;font:600 11px var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--fg-3)}
.ok-h4{margin:14px 0 4px;font:600 13.5px var(--font)}
.ok-mov{display:grid;grid-template-columns:68px 76px 1fr;gap:6px 10px;align-items:baseline;font-size:12.5px}
.ok-sym{font:600 12px var(--mono);border:0;background:none;color:var(--fg);padding:0;cursor:pointer;text-align:left}.ok-sym:hover{color:var(--acc)}
.ok-tag{font:600 10.5px var(--font);padding:1px 7px;border-radius:9px;text-align:center;background:var(--sunk);color:var(--fg-2)}
.ok-tag.up{background:var(--up-soft);color:var(--up)}.ok-tag.dn{background:var(--dn-soft);color:var(--dn)}
.ok-note{border-left:3px solid var(--acc);background:var(--acc-soft);padding:10px 12px;border-radius:0 6px 6px 0;margin:14px 0 4px}
.ok-note>b{display:block;font:600 10.5px var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--fg-2);margin-bottom:3px}
.ok-note>strong{display:block;font:600 13px var(--font);margin-bottom:3px}
.ok-ul{margin:0;padding-left:18px;font-size:12.5px;line-height:1.55}.ok-ul li{margin:3px 0}
.ok-termrow{display:flex;flex-wrap:wrap;gap:6px}
.ok-termrow span{font-size:11.5px;border:1px solid var(--line);border-radius:5px;padding:4px 8px;background:var(--bg)}.ok-termrow b{font-weight:600;margin-right:4px}
.ok-src{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.ok-src button{display:inline-flex;gap:5px;align-items:center;border:1px solid var(--line);border-radius:5px;background:none;color:var(--fg-2);font-size:11px;padding:3px 8px;cursor:pointer}.ok-src button:hover{color:var(--acc);border-color:var(--acc)}
.ok-q+.ok-q{margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
.ok-qt{font:500 13px/1.5 var(--font);margin:0 0 9px}
.ok-opts{display:grid;gap:6px}
.ok-opt{display:flex;gap:10px;align-items:center;text-align:left;padding:8px 10px;border:1px solid var(--line-2);border-radius:6px;background:var(--bg);cursor:pointer;font:400 12.5px/1.4 var(--font);color:var(--fg);transition:border-color .15s,background .15s}
.ok-opt i{font:600 10.5px var(--mono);font-style:normal;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;border:1px solid var(--line-2);color:var(--fg-2);flex:none}
.ok-opt:hover:not(:disabled){border-color:var(--acc)}.ok-opt:disabled{cursor:default}
.ok-opt.ok{border-color:var(--up);background:var(--up-soft)}.ok-opt.ok i{background:var(--up);border-color:var(--up);color:var(--bg)}
.ok-opt.bad{border-color:var(--dn);background:var(--dn-soft)}.ok-opt.bad i{background:var(--dn);border-color:var(--dn);color:var(--bg)}
.ok-opt.dim{opacity:.55}
.ok-fb{margin-top:9px;padding:9px 11px;border-radius:6px;font-size:12.5px;line-height:1.55}
.ok-fb.ok{background:var(--up-soft)}.ok-fb.bad{background:var(--dn-soft)}.ok-fb>b{display:block;margin-bottom:2px}
.ok-fb.ok>b{color:var(--up)}.ok-fb.bad>b{color:var(--dn)}
.ok-fb a{color:var(--acc);cursor:pointer;font-weight:500}
.ok-zor{display:inline-flex;gap:2px;vertical-align:1px}.ok-zor i{width:5px;height:5px;border-radius:50%;background:var(--line-2)}.ok-zor i.on{background:var(--acc)}
.ok-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ok-stat{border:1px solid var(--line);border-radius:6px;padding:8px 10px;background:var(--bg)}
.ok-stat span{display:block;font-size:10.5px;color:var(--fg-3)}.ok-stat b{font:600 17px var(--mono)}.ok-stat small{color:var(--fg-3);font-size:10.5px;margin-left:4px}
.ok-stat .prog{max-width:none;margin-top:6px}
.ok-split{display:grid;grid-template-columns:330px minmax(0,1fr);gap:14px;align-items:start}
.ok-list{border:1px solid var(--line);border-radius:var(--r2);background:var(--surface);padding:10px 8px 8px}
.ok-filt{display:flex;flex-direction:column;gap:8px;padding:0 4px 10px;border-bottom:1px solid var(--line);margin-bottom:6px}
.ok-filt .seg{align-self:flex-start}.ok-filt .seg button{font:500 11px var(--font)}
.ok-filt select{width:100%}
.ok-pl{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--fg-2)}.ok-pl .prog{max-width:none}
.ok-lr{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:9px;align-items:center;padding:7px 6px;border-radius:5px;cursor:pointer}
.ok-lr:hover{background:var(--sunk)}.ok-lr.on{background:var(--acc-soft)}
.ok-num{width:24px;height:24px;border-radius:50%;border:1px solid var(--line-2);display:grid;place-items:center;font:600 10px var(--mono);color:var(--fg-2)}
.ok-lr.done .ok-num{background:var(--up);border-color:var(--up);color:var(--bg)}
.ok-lr .t{font-size:12.5px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ok-lr small{display:block;color:var(--fg-3);font-size:10.5px;margin-top:1px}
.ok-reader{padding:20px 24px 18px}
.ok-reader .ok-txt{max-width:74ch;font-size:13.5px}
.ok-goal{list-style:none;margin:0;padding:0;display:grid;gap:4px}.ok-goal li{display:flex;gap:7px;align-items:flex-start;font-size:12.5px}.ok-goal li span{color:var(--up);margin-top:2px;flex:none}
.ok-box{border:1px solid var(--line);border-radius:6px;padding:10px 12px;background:var(--bg);margin:10px 0}
.ok-box.ex{border-style:dashed}
.ok-box>b{display:block;font:600 10.5px var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--fg-3);margin-bottom:4px}
.ok-sum{background:var(--sunk);border:0}
.ok-alt{border:1px solid var(--line);border-radius:6px;padding:9px 11px;margin-bottom:6px;font-size:12.5px}
.ok-alt .row{justify-content:space-between;align-items:flex-start;gap:10px}
.ok-ans{margin-top:7px;padding-top:7px;border-top:1px dashed var(--line);color:var(--fg-2)}
.ok-nav{display:flex;gap:8px;align-items:center;margin-top:18px;padding-top:12px;border-top:1px solid var(--line);flex-wrap:wrap}
.ok-kb{display:grid;grid-template-columns:minmax(0,1fr) 120px 42px;gap:7px 10px;align-items:center;font-size:12px}
.ok-kb .bar{height:7px;border-radius:4px;background:var(--sunk);overflow:hidden}.ok-kb .bar i{display:block;height:100%;border-radius:4px}
.ok-kb b{font:500 11.5px var(--mono);text-align:right}.ok-kb small{color:var(--fg-3);font-size:10.5px;margin-left:4px}
.ok-qh{display:flex;align-items:center;gap:10px;margin-bottom:12px}.ok-qh .prog{max-width:none}
.ok-big{font:600 40px var(--mono);letter-spacing:-.02em;line-height:1}
.ok-chat{display:flex;flex-direction:column;gap:10px;min-height:260px;max-height:calc(100vh - 330px);overflow:auto;padding:2px 2px 6px}
.ok-msg{max-width:88%;padding:10px 13px;border-radius:10px;font-size:13px;line-height:1.6}
.ok-msg.u{align-self:flex-end;background:var(--acc-soft);border-bottom-right-radius:3px;white-space:pre-wrap}
.ok-msg.a{align-self:flex-start;background:var(--sunk);border-bottom-left-radius:3px}
.ok-msg.e{align-self:flex-start;background:var(--dn-soft)}
.ok-msg .ok-txt{font-size:13px}.ok-msg .ok-txt p:last-child,.ok-msg .ok-txt ul:last-child{margin-bottom:0}
.ok-who{font:600 10px var(--font);color:var(--fg-3);margin-bottom:3px;letter-spacing:.06em;text-transform:uppercase}
.ok-typing{display:inline-flex;gap:4px}.ok-typing i{width:6px;height:6px;border-radius:50%;background:var(--fg-3);animation:okb 1s infinite ease-in-out}.ok-typing i:nth-child(2){animation-delay:.15s}.ok-typing i:nth-child(3){animation-delay:.3s}
@keyframes okb{0%,80%,100%{opacity:.3}40%{opacity:1}}
.ok-ta{width:100%;min-height:68px;resize:vertical;padding:9px 11px;border:1px solid var(--line-2);border-radius:6px;background:var(--bg);outline:none;font:inherit;font-size:13px;color:inherit;display:block}
.ok-ta:focus{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft)}
.ok-compose{border-top:1px solid var(--line);margin-top:10px;padding-top:10px}
.ok-sugg{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.ok-ctx{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--fg-2);cursor:pointer}
.ok-srch{position:relative;flex:1;max-width:440px}.ok-srch span{position:absolute;left:10px;top:8px;color:var(--fg-3)}
.ok-srch input{width:100%;height:32px;padding:0 10px 0 32px;border:1px solid var(--line-2);border-radius:var(--r2);background:var(--surface);outline:none;font-size:13px}
.ok-srch input:focus{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft)}
.ok-terms{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
.ok-letter{grid-column:1/-1;font:600 12px var(--mono);color:var(--acc);margin:8px 0 -2px;padding-bottom:4px;border-bottom:1px solid var(--line)}
.ok-term{border:1px solid var(--line);border-radius:var(--r2);padding:11px 13px;background:var(--surface)}
.ok-term>b{display:block;font:600 13.5px var(--font);margin-bottom:4px}.ok-term p{margin:0;color:var(--fg-2);font-size:12.5px;line-height:1.55}
.ok-term small{display:block;margin-top:7px;color:var(--fg-3);font-size:11.5px;line-height:1.5}.ok-term small b{color:var(--fg-2);font-weight:600}
.ok-load{padding:60px 20px;text-align:center;color:var(--fg-3)}
.ok-off{display:flex;align-items:center;gap:8px;margin:0 0 12px}
.okul .empty .btn{margin-top:12px}
@media(max-width:1180px){.ok-grid{grid-template-columns:minmax(0,1fr)}.ok-split{grid-template-columns:280px minmax(0,1fr)}.ok-hs .prog{display:none}}
`;
function injectCss(doc){if(doc.getElementById('bp-okul-css'))return;const s=doc.createElement('style');s.id='bp-okul-css';s.textContent=CSS;doc.head.appendChild(s)}
function mkEl(doc){return function el(tag,attrs,...kids){const e=doc.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){if(v==null||v===false)continue;if(k==='class')e.className=v;else if(k==='style')e.style.cssText=v;
    else if(k.startsWith('on'))e[k]=v;else if(k==='html')e.innerHTML=v;else e.setAttribute(k,v===true?'':v)}
  for(const c of kids.flat(9))if(c!=null&&c!==false)e.append(c&&c.nodeType?c:doc.createTextNode(String(c)));
  return e}}
const fin=v=>typeof v==='number'&&Number.isFinite(v);
const nf=(v,d=2)=>fin(v)?v.toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const pct=v=>fin(v)?(v>0?'+':v<0?'−':'')+'%'+nf(Math.abs(v),2):'—';
const cls=v=>fin(v)?(v>0?'up':v<0?'dn':''):'';
const gun=d=>{if(!d)return '';const x=new Date(String(d).slice(0,10)+'T12:00:00+03:00');return isNaN(x)?'':x.toLocaleDateString('tr-TR',{timeZone:'Europe/Istanbul',day:'numeric',month:'long',weekday:'long'})};
const saat=t=>fin(t)?new Date(t).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
const s=(v,n=4000)=>typeof v==='string'?v.slice(0,n):typeof v==='number'?String(v):'';
const A=v=>Array.isArray(v)?v:[];
const fold=t=>String(t||'').replace(/İ/g,'i').replace(/I/g,'ı').toLocaleLowerCase('tr-TR').replace(/̇/g,'').replace(/ı/g,'i').replace(/ş/g,'s').replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ö/g,'o').replace(/ç/g,'c');
// kosullu (null/false) cocuklar "null" yazisi olarak eklenmesin (Borsa Pro'nun yamasina guvenmeden)
const R=(n,...k)=>n.replaceChildren(...k.flat(9).filter(x=>x!=null&&x!==false));
const rateColor=o=>o==null?'var(--line-2)':o>=75?'var(--up)':o>=50?'var(--acc)':'var(--dn)';

const STATE=new WeakMap();
function render(container,api,helpers){
  const doc=container.ownerDocument||document;
  const H=helpers||{};
  const el=H.el||mkEl(doc);
  const toast=typeof H.toast==='function'?H.toast:()=>{};
  const go=typeof H.go==='function'?H.go:null;
  injectCss(doc);
  const call=async(op,a)=>{try{const r=await api.okul(op,a||{});return r&&typeof r==='object'?r:{ok:false,error:'Borsa Okulu boş yanıt döndürdü.'}}
    catch(e){return {ok:false,error:'Borsa Okulu hatası: '+(e&&e.message||'bilinmeyen')}}};
  let saved='bugun';try{const v=localStorage.getItem('bp.okul.tab');if(TABS.some(t=>t[0]===v))saved=v}catch{}
  // durum ayni kapsayici icin saklanir: Borsa Pro sekmeye her donuste render() cagirir; sohbet, test ve filtreler kaybolmasin
  const st=STATE.get(container)||{tab:saved,tok:0,prog:null,dersler:null,dersStale:false,filt:{seviye:'',konu:''},ders:null,quiz:null,quizKonu:'',quizN:10,chat:[],draft:'',ctxOn:true,soz:null,sozQ:'',analiz:null};
  STATE.set(container,st);st.busy=false;

  // ---- ortak parcalar ----
  const ic=(k,c)=>el('span',{class:c||null,html:IC[k],style:'display:inline-flex'});
  const loading=t=>el('div',{class:'ok-load'},el('div',{class:'spin'}),t||'Yükleniyor…');
  const errBox=(msg,retry)=>el('div',{class:'empty'},el('b',{},'İçerik alınamadı'),el('div',{},msg||'Bilinmeyen hata.'),retry?el('button',{class:'btn',onclick:retry},'Tekrar dene'):null);
  const emptyBox=(t,m,btn)=>el('div',{class:'empty'},el('b',{},t),el('div',{},m),btn||null);
  const offBar=r=>r&&r.stale?el('div',{class:'warn ok-off'},ic('off'),el('span',{},'Çevrimdışı görünüyorsun: son kaydedilen içerik gösteriliyor'+(fin(r.at)?' ('+saat(r.at)+')':'')+'.')):null;
  const lvl=v=>v&&SEV[v]?el('span',{class:'ok-lvl lv-'+v},SEV[v]):null;
  const konuChip=v=>v&&KONU[v]?el('span',{class:'ok-lvl'},KONU[v]):null;
  const openUrl=async u=>{const r=await call('open',{url:u});if(!r.ok)toast(r.error||'Bağlantı açılamadı.')};
  const vidBadge=u=>u?el('button',{class:'ok-vid',title:'Videoyu aç',onclick:e=>{e.stopPropagation();openUrl(u)}},ic('play'),'Video'):null;
  const symBtn=c=>el('button',{class:'ok-sym',title:go?c+' grafiğini aç':null,onclick:go?()=>go(c):null},c);
  // hafif bicim: paragraf (bos satir), "- " maddeleri, **kalin**; hep textContent
  function inline(t){const out=[];const parts=String(t).split(/(\*\*[^*]+\*\*)/g);for(const p of parts){if(!p)continue;const m=/^\*\*([^*]+)\*\*$/.exec(p);out.push(m?el('b',{},m[1]):p)}return out}
  function md(t){
    const box=el('div',{class:'ok-txt'});
    for(const blk of String(t||'').replace(/\r/g,'').split(/\n{2,}/)){
      const lines=blk.split('\n').map(x=>x.trimEnd()).filter(x=>x.trim());if(!lines.length)continue;
      if(lines.every(x=>/^\s*([-*•]|\d+[.)])\s+/.test(x)))box.append(el('ul',{},lines.map(x=>el('li',{},inline(x.replace(/^\s*([-*•]|\d+[.)])\s+/,''))))));
      else{const p=el('p',{});lines.forEach((x,i)=>{if(i)p.append(el('br'));p.append(...inline(x))});box.append(p)}
    }
    return box;
  }
  const zor=z=>fin(z)?el('span',{class:'ok-zor',title:'Zorluk '+z+'/3'},[1,2,3].map(i=>el('i',{class:i<=z?'on':null}))):null;

  // ---- iskelet ----
  const tabsSeg=el('div',{class:'seg'});
  const hs=el('div',{class:'ok-hs'});
  const body=el('div',{class:'ok-body'});
  const root=el('div',{class:'okul'},el('div',{class:'ph'},el('h2',{},'Borsa Okulu'),tabsSeg,hs),body);
  R(container,root);

  function drawTabs(){R(tabsSeg,...TABS.map(([k,t])=>el('button',{class:st.tab===k?'on':null,onclick:()=>show(k)},t)))}
  async function refreshHead(){
    const p=await call('progress');if(p.ok)st.prog=p;
    const P=st.prog;if(!P){R(hs);return}
    if(!st.dersler&&!fin(st.dersToplam)&&!st.totReq){st.totReq=1;const l=await call('list',{tur:'ders',limit:500});if(l.ok){st.dersToplam=l.items.length;st.dersSlugs=l.items.map(x=>x.slug)}}
    const tot=st.dersler?st.dersler.length:st.dersToplam;
    const done=st.dersler?st.dersler.filter(d=>P.okunan.includes(d.slug)).length:st.dersSlugs?st.dersSlugs.filter(x=>P.okunan.includes(x)).length:P.okunan.filter(x=>/^ders-/.test(x)).length;
    R(hs,
      el('span',{class:'chip sm',title:'Arka arkaya öğrenme yaptığın gün sayısı'},'Gün serisi ',el('b',{class:'mono'},String(P.gun.seri))),
      P.quiz.toplam?el('span',{class:'chip sm',title:'Tüm cevapların doğru oranı'},el('b',{class:'mono'},'%'+P.quiz.oran),' doğru'):null,
      tot?el('span',{class:'chip sm'},el('b',{class:'mono'},done+'/'+tot),' ders'):null,
      tot?el('div',{class:'prog',title:'Müfredat ilerlemesi'},el('i',{style:'width:'+Math.round(done/tot*100)+'%'})):null);
  }
  function show(tab){
    st.tab=tab;try{localStorage.setItem('bp.okul.tab',tab)}catch{}
    drawTabs();const tok=++st.tok;
    R(body,loading());
    const fn={bugun:vBugun,dersler:vDersler,sorular:vSorular,sor:vSor,sozluk:vSozluk}[tab]||vBugun;
    return Promise.resolve(fn(tok)).catch(e=>{if(tok===st.tok)R(body,errBox(e&&e.message,()=>show(tab)))});
  }
  const live=tok=>tok===st.tok;

  // ---- soru bileseni (Bugun ve Sorular ortak) ----
  function qItem(q,{onAnswer,compact}={}){
    const fb=el('div');
    const opts=q.secenekler.map((t,i)=>el('button',{class:'ok-opt',onclick:()=>pick(i)},el('i',{},'ABCDEF'[i]),el('span',{},t)));
    async function pick(i){
      opts.forEach(b=>b.disabled=true);opts[i].classList.add('dim');
      const r=await call('answer',{slug:q.slug,secim:i});
      if(!r.ok){opts.forEach(b=>{b.disabled=false;b.classList.remove('dim')});toast(r.error||'Cevap kaydedilemedi.');return}
      opts.forEach((b,j)=>{b.classList.remove('dim');if(j===r.cevap)b.classList.add('ok');else if(j===i)b.classList.add('bad');else b.classList.add('dim')});
      const S=r.istatistik||{};
      R(fb,el('div',{class:'ok-fb '+(r.dogru?'ok':'bad')},
        el('b',{},r.dogru?(S.seri>=3?'Doğru! '+S.seri+' soruluk seri':'Doğru!'):'Yanlış. Doğru cevap: '+'ABCDEF'[r.cevap]),
        r.aciklama?el('div',{},r.aciklama):null,
        r.ders_slug?el('div',{style:'margin-top:5px'},el('a',{onclick:()=>openDers(r.ders_slug)},'İlgili dersi aç →')):null));
      if(S&&fin(S.toplam))st.prog=st.prog?{...st.prog,quiz:S}:st.prog;
      refreshHead();
      if(onAnswer)onAnswer(r);
    }
    return el('div',{class:'ok-q'},
      el('div',{class:'ok-meta',style:'margin-bottom:5px'},konuChip(q.konu),zor(q.zorluk),compact&&q.tarih?el('span',{},gun(q.tarih)):null),
      el('div',{class:'ok-qt'},q.soru),el('div',{class:'ok-opts'},opts),fb);
  }

  // ---- BUGUN ----
  async function vBugun(tok){
    const r=await call('today');if(!live(tok))return;
    if(!r.ok){R(body,errBox(r.error,()=>show('bugun')));return}
    if(fin(r.dersToplam))st.dersToplam=r.dersToplam;
    const has=r.sabah||r.aksam;
    if(!st.analiz||!r[st.analiz])st.analiz=r.aksam?'aksam':'sabah';
    const anCard=el('div',{class:'card'});
    function drawAn(){
      const a=r[st.analiz];
      const seg=r.sabah&&r.aksam?el('div',{class:'seg'},[['sabah','Sabah bülteni'],['aksam','Akşam analizi']].map(([k,t])=>el('button',{class:st.analiz===k?'on':null,style:'font:500 11px var(--font)',onclick:()=>{st.analiz=k;drawAn()}},t))):null;
      R(anCard,el('h3',{},st.analiz==='sabah'?'Sabah bülteni':'Akşam analizi',el('span',{class:'sp'}),seg),analizBody(a));
    }
    if(has)drawAn();else R(anCard,el('h3',{},'Günün analizi'),emptyBox('Henüz analiz yok','Sabah bülteni 09:20, akşam analizi 18:50 civarında yayınlanır.'));
    const right=el('div',{class:'ok-col'},dersCard(r.ders,r),sorCard(r.sorular),progCard());
    R(body,offBar(r),el('div',{class:'ok-grid'},el('div',{class:'ok-col'},anCard),right));
    refreshHead();
  }
  function analizBody(a){
    const g=a.govde||{};
    const mk=Object.entries(g.piyasa&&typeof g.piyasa==='object'?g.piyasa:{}).filter(([,v])=>v&&fin(v.son)).slice(0,8);
    const oc=A(g.one_cikanlar).filter(x=>x&&x.sembol);
    return el('div',{},
      el('div',{class:'ok-meta'},el('span',{},gun(a.tarih)),a.model?el('span',{},'· '+a.model):null),
      el('div',{class:'ok-title'},a.baslik),
      a.ozet?el('p',{class:'ok-lead'},a.ozet):null,
      mk.length?el('div',{class:'ok-mkt'},mk.map(([k,v])=>el('div',{},el('span',{},PIYASA[k]||k.toUpperCase()),el('b',{},nf(v.son,v.son>=1000?0:2)),el('i',{class:cls(v.degisim)},pct(v.degisim))))):null,
      A(g.bolumler).filter(b=>b&&(b.metin||b.baslik)).map(b=>el('div',{},b.baslik?el('div',{class:'ok-h4'},b.baslik):null,md(b.metin))),
      oc.length?[el('div',{class:'ok-h'},'Öne çıkanlar'),el('div',{class:'ok-mov'},oc.slice(0,10).map(x=>{const y=YON[x.yon]||YON.izle;
        return [symBtn(s(x.sembol,12)),el('span',{class:'ok-tag '+y[1]},y[0]),el('span',{class:'m2'},s(x.neden,400))]}))]:null,
      A(g.yarin_izle).length?[el('div',{class:'ok-h'},a.slug&&/sabah/.test(a.slug)?'Bugün izlenecekler':'Yarın izlenecekler'),el('ul',{class:'ok-ul'},A(g.yarin_izle).slice(0,8).map(t=>el('li',{},s(t,400))))]:null,
      g.ders_notu&&g.ders_notu.metin?el('div',{class:'ok-note'},el('b',{},'Bugünün ders notu'),g.ders_notu.baslik?el('strong',{},g.ders_notu.baslik):null,md(g.ders_notu.metin)):null,
      A(g.terimler).length?[el('div',{class:'ok-h'},'Geçen terimler'),el('div',{class:'ok-termrow'},A(g.terimler).slice(0,10).map(t=>el('span',{title:s(t.aciklama,400)},el('b',{},s(t.terim,60)),s(t.aciklama,140))))]:null,
      kaynak(a.kaynaklar),
      el('div',{class:'disc'},s(g.uyari,300)||'Yatırım tavsiyesi değildir. Bilgilendirme ve eğitim amaçlıdır.'));
  }
  function kaynak(k){k=A(k).filter(x=>x&&x.url);if(!k.length)return null;
    return [el('div',{class:'ok-h'},'Kaynaklar'),el('div',{class:'ok-src'},k.slice(0,8).map(x=>el('button',{onclick:()=>openUrl(x.url),title:x.url},s(x.ad,60),ic('ext'))))]}
  function dersCard(d,r){
    if(!d)return el('div',{class:'card'},el('h3',{},'Günün dersi'),emptyBox('Ders yok','Müfredat yayınlandığında burada görünecek.'));
    const okundu=st.prog&&st.prog.okunan.includes(d.slug);
    return el('div',{class:'card'},el('h3',{},'Günün dersi',el('span',{class:'sp'}),fin(d.sira)?el('span',{class:'mono'},'Ders '+d.sira):null),
      el('div',{class:'ok-meta',style:'margin-bottom:4px'},lvl(d.seviye),konuChip(d.konu),vidBadge(d.video_url)),
      el('div',{class:'ok-title',style:'font-size:15.5px'},d.baslik),
      d.ozet?el('p',{class:'ok-lead',style:'font-size:12.5px'},d.ozet):null,
      el('div',{class:'row'},el('button',{class:'btn pri',onclick:()=>openDers(d.slug)},okundu?'Tekrar oku':'Derse başla'),
        fin(r.dersToplam)?el('span',{class:'mu',style:'font-size:11px'},r.dersOkunan+' / '+r.dersToplam+' ders tamamlandı'):null));
  }
  function sorCard(list){
    list=A(list);
    return el('div',{class:'card'},el('h3',{},'Günün soruları',el('span',{class:'sp'}),el('a',{onclick:()=>show('sorular')},'Teste geç →')),
      list.length?list.map(q=>qItem(q,{})):emptyBox('Bugün soru yok','Yeni sorular her iş günü yayınlanır.'));
  }
  function progCard(){
    const P=st.prog;const box=el('div',{class:'card'},el('h3',{},'İlerlemen'));
    if(!P){box.append(el('div',{class:'mu'},'Henüz ilerleme yok.'));return box}
    const tot=st.dersToplam||0,done=P.okunan.filter(x=>/^ders-/.test(x)).length;
    box.append(el('div',{class:'ok-stats'},
      el('div',{class:'ok-stat'},el('span',{},'Okunan ders'),el('b',{},String(done)),tot?el('small',{},'/ '+tot):null,tot?el('div',{class:'prog'},el('i',{style:'width:'+Math.round(done/tot*100)+'%'})):null),
      el('div',{class:'ok-stat'},el('span',{},'Doğru oranı'),el('b',{},P.quiz.toplam?'%'+P.quiz.oran:'—'),el('small',{},P.quiz.toplam+' cevap')),
      el('div',{class:'ok-stat'},el('span',{},'Soru serisi'),el('b',{},String(P.quiz.seri)),el('small',{},'en iyi '+P.quiz.enIyi)),
      el('div',{class:'ok-stat'},el('span',{},'Gün serisi'),el('b',{},String(P.gun.seri)),el('small',{},'gün'))));
    return box;
  }

  // ---- DERSLER ----
  function openDers(slug){st.ders=slug;if(st.tab!=='dersler')show('dersler');else drawReader()}
  let listBox=null,readerBox=null;
  async function vDersler(tok){
    if(!st.prog){const p=await call('progress');if(p.ok)st.prog=p}
    const r=await call('list',{tur:'ders',limit:500});if(!live(tok))return;
    if(!r.ok){R(body,errBox(r.error,()=>show('dersler')));return}
    st.dersler=r.items;st.dersStale=!!r.stale;
    if(!r.items.length){R(body,emptyBox('Henüz ders yok','Müfredat yayınlandığında dersler burada sırayla listelenecek.'));return}
    if(!st.ders){const ok=new Set(st.prog?st.prog.okunan:[]);st.ders=(r.items.find(x=>!ok.has(x.slug))||r.items[0]).slug}
    listBox=el('div',{class:'ok-list'});readerBox=el('div',{});
    R(body,offBar(r),el('div',{class:'ok-split'},listBox,readerBox));
    drawList();drawReader();refreshHead();
  }
  function drawList(){
    if(!listBox)return;
    const ok=new Set(st.prog?st.prog.okunan:[]),all=st.dersler||[];
    const f=all.filter(d=>(!st.filt.seviye||d.seviye===st.filt.seviye)&&(!st.filt.konu||d.konu===st.filt.konu));
    const done=all.filter(d=>ok.has(d.slug)).length;
    const konular=[...new Set(all.map(d=>d.konu).filter(Boolean))];
    const sel=el('select',{class:'inp',onchange:e=>{st.filt.konu=e.target.value;drawList()}},el('option',{value:''},'Tüm konular'),
      konular.map(k=>el('option',{value:k,selected:st.filt.konu===k},KONU[k]||k)));
    R(listBox,
      el('div',{class:'ok-filt'},
        el('div',{class:'seg'},[['','Tümü'],['baslangic','Başlangıç'],['orta','Orta'],['ileri','İleri']].map(([k,t])=>el('button',{class:st.filt.seviye===k?'on':null,onclick:()=>{st.filt.seviye=k;drawList()}},t))),
        sel,
        el('div',{class:'ok-pl'},el('span',{},done+' / '+all.length+' ders'),el('div',{class:'prog'},el('i',{style:'width:'+(all.length?Math.round(done/all.length*100):0)+'%'})),el('span',{class:'mono'},'%'+(all.length?Math.round(done/all.length*100):0)))),
      f.length?f.map(d=>el('div',{class:'ok-lr'+(d.slug===st.ders?' on':'')+(ok.has(d.slug)?' done':''),onclick:()=>{st.ders=d.slug;drawList();drawReader()}},
        el('div',{class:'ok-num'},ok.has(d.slug)?ic('check'):fin(d.sira)?String(d.sira):'•'),
        el('div',{style:'min-width:0'},el('div',{class:'t',title:d.baslik},d.baslik),el('small',{},[SEV[d.seviye],KONU[d.konu]].filter(Boolean).join(' · '))),
        vidBadge(d.video_url))):el('div',{class:'empty',style:'padding:24px 10px'},'Bu filtreyle ders yok.'));
  }
  async function drawReader(){
    if(!readerBox)return;const slug=st.ders,tok=st.tok;
    R(readerBox,el('div',{class:'card'},loading('Ders açılıyor…')));
    const r=await call('get',{slug});if(!live(tok)||slug!==st.ders)return;
    if(!r.ok){R(readerBox,el('div',{class:'card'},errBox(r.error,drawReader)));return}
    R(readerBox,reader(r.item));
    const sc=readerBox.closest('.pg')||container;if(sc&&sc.scrollTop>200)sc.scrollTop=0;
  }
  function reader(d){
    const g=d.govde||{};const ok=st.prog&&st.prog.okunan.includes(d.slug);
    const idx=(st.dersler||[]).findIndex(x=>x.slug===d.slug);
    const prev=g.onceki||(idx>0?st.dersler[idx-1].slug:null),next=g.sonraki||(idx>=0&&idx<st.dersler.length-1?st.dersler[idx+1].slug:null);
    const vm=d.video_meta||{};
    const doneBtn=el('button',{class:'btn'+(ok?'':' pri'),disabled:ok,onclick:async()=>{
      const r=await call('markRead',{slug:d.slug});if(!r.ok){toast(r.error||'Kaydedilemedi.');return}
      st.prog=st.prog?{...st.prog,okunan:r.okunan}:{okunan:r.okunan,quiz:{toplam:0,dogru:0,seri:0,enIyi:0,oran:null,konular:{}},gun:{seri:1}};
      toast('Ders tamamlandı. Harika gidiyorsun!');drawList();refreshHead();
      doneBtn.disabled=true;doneBtn.className='btn';R(doneBtn,ic('check'),' Tamamlandı');
    }},ok?[ic('check'),' Tamamlandı']:'Okudum, tamamla');
    const ex=g.ornek&&(g.ornek.aciklama||g.ornek.sembol)?el('div',{class:'ok-box ex'},el('b',{},'BIST’ten örnek'),g.ornek.sembol?el('div',{style:'margin-bottom:4px'},symBtn(s(g.ornek.sembol,12))):null,md(g.ornek.aciklama)):null;
    return el('div',{class:'card ok-reader'},
      el('div',{class:'ok-meta'},fin(d.sira)?el('span',{class:'mono'},'Ders '+d.sira):null,lvl(d.seviye),konuChip(d.konu),fin(g.sure_dk)?el('span',{},g.sure_dk+' dk okuma'):null,ok?el('span',{class:'ok-lvl lv-baslangic'},'Okundu'):null),
      el('h1',{class:'ok-title',style:'font-size:21px;margin-top:8px'},d.baslik),
      d.ozet?el('p',{class:'ok-lead',style:'font-size:13.5px;max-width:74ch'},d.ozet):null,
      d.video_url?el('div',{class:'ok-box',style:'display:flex;align-items:center;gap:10px'},vidBadge(d.video_url),el('span',{class:'m2',style:'font-size:12px'},'Bu dersin videosu var'+(fin(vm.sure_sn)?' · '+Math.round(vm.sure_sn/60)+' dk':'')+(vm.platform?' · '+s(vm.platform,30):''))):null,
      A(g.hedefler).length?[el('div',{class:'ok-h'},'Bu derste öğreneceklerin'),el('ul',{class:'ok-goal'},A(g.hedefler).map(t=>el('li',{},ic('check'),el('div',{},s(t,300)))))]:null,
      A(g.bolumler).map(b=>el('div',{},b.baslik?el('div',{class:'ok-h4',style:'font-size:15px;margin-top:20px'},b.baslik):null,md(b.metin),b.ornek?el('div',{class:'ok-box ex'},el('b',{},'Örnek'),md(b.ornek)):null)),
      ex,
      A(g.ozet_maddeler).length?el('div',{class:'ok-box ok-sum'},el('b',{},'Özetle'),el('ul',{class:'ok-ul'},A(g.ozet_maddeler).map(t=>el('li',{},s(t,400))))):null,
      A(g.terimler).length?[el('div',{class:'ok-h'},'Terimler'),el('div',{class:'kv',style:'grid-template-columns:max-content 1fr;gap:5px 14px'},A(g.terimler).map(t=>[el('b',{style:'text-align:left;font:600 12px var(--font)'},s(t.terim,60)),el('span',{},s(t.aciklama,400))]))]:null,
      A(g.alistirmalar).length?[el('div',{class:'ok-h'},'Alıştırmalar'),A(g.alistirmalar).map((a,i)=>{const ans=el('div',{class:'ok-ans',style:'display:none'},md(a.cevap));
        const b=el('button',{class:'btn',style:'height:24px;font-size:11px',onclick:()=>{const o=ans.style.display==='none';ans.style.display=o?'':'none';b.textContent=o?'Gizle':'Cevabı göster'}},'Cevabı göster');
        return el('div',{class:'ok-alt'},el('div',{class:'row'},el('div',{},el('b',{class:'mono',style:'margin-right:6px;color:var(--acc)'},(i+1)+'.'),s(a.soru,600)),b),ans)})]:null,
      kaynak(d.kaynaklar),
      el('div',{class:'ok-nav'},
        el('button',{class:'btn',disabled:!prev,onclick:()=>{st.ders=prev;drawList();drawReader()}},'← Önceki'),
        doneBtn,
        el('button',{class:'btn',disabled:!next,onclick:()=>{st.ders=next;drawList();drawReader()}},'Sonraki →'),
        el('span',{class:'sp',style:'flex:1'}),
        el('button',{class:'btn',onclick:()=>{st.askCtx={ders:d.baslik,slug:d.slug};st.draft='“'+d.baslik+'” dersinde anlamadığım nokta: ';show('sor')}},'Öğretmene sor')),
      el('div',{class:'disc'},'Eğitim amaçlıdır; yatırım tavsiyesi değildir. Örneklerdeki hisseler yalnız açıklama içindir.'));
  }

  // ---- SORULAR ----
  async function vSorular(tok){
    const p=await call('progress');if(!live(tok))return;if(p.ok)st.prog=p;
    const left=el('div',{class:'ok-col'}),right=el('div',{class:'ok-col'});
    R(body,el('div',{class:'ok-grid'},left,right));
    drawQuiz(left);drawStats(right);refreshHead();
    st.quizRight=right;
  }
  function drawStats(box){
    box=box||st.quizRight;if(!box)return;
    const P=st.prog,Q=P&&P.quiz;
    const k=Q?Object.entries(Q.konular||{}).sort((a,b)=>b[1].n-a[1].n):[];
    R(box,
      el('div',{class:'cards',style:'grid-template-columns:1fr 1fr'},
        el('div',{class:'mc'},el('span',{},'Doğru oranı'),el('b',{},Q&&Q.toplam?'%'+Q.oran:'—'),el('span',{class:'mu',style:'font-size:11px'},Q?Q.dogru+' / '+Q.toplam+' doğru':'Henüz cevap yok')),
        el('div',{class:'mc'},el('span',{},'Seri'),el('b',{},Q?String(Q.seri):'0'),el('span',{class:'mu',style:'font-size:11px'},'En iyi seri: '+(Q?Q.enIyi:0)))),
      el('div',{class:'card'},el('h3',{},'Konu bazlı başarı'),
        k.length?el('div',{class:'ok-kb'},k.map(([kn,v])=>[el('span',{},KONU[kn]||kn,el('small',{},v.n+' soru')),el('div',{class:'bar'},el('i',{style:'width:'+(v.oran||0)+'%;background:'+rateColor(v.oran)})),el('b',{},v.oran==null?'—':'%'+v.oran)]))
          :el('div',{class:'mu'},'Soru çözdükçe hangi konularda güçlü olduğunu burada göreceksin.'),
        k.length?(()=>{const z=k.filter(([,v])=>v.n>=3).sort((a,b)=>a[1].oran-b[1].oran)[0];return z&&z[1].oran<70?el('div',{class:'warn'},'Tekrar önerisi: ',el('b',{},KONU[z[0]]||z[0]),' konusunda başarın %'+z[1].oran+'. Bu konudaki dersleri yeniden gözden geçirebilirsin.'):null})():null));
  }
  function drawQuiz(box){
    box=box||st.quizLeft;st.quizLeft=box;const Z=st.quiz;
    if(!Z){
      const konular=Object.keys(KONU);
      R(box,el('div',{class:'card'},el('h3',{},'Kendini sına'),
        el('div',{class:'ok-title',style:'font-size:16px'},'Bilgini 5 dakikada ölç'),
        el('p',{class:'ok-lead'},'Sorular önce hiç görmediklerinden, sonra yanlış yaptıklarından seçilir. Her cevaptan sonra kısa bir açıklama ve ilgili ders gelir.'),
        el('div',{class:'row',style:'flex-wrap:wrap;gap:8px'},
          el('select',{class:'inp',onchange:e=>{st.quizKonu=e.target.value}},el('option',{value:''},'Tüm konular'),konular.map(k=>el('option',{value:k,selected:st.quizKonu===k},KONU[k]))),
          el('div',{class:'seg'},[5,10,20].map(n=>el('button',{class:st.quizN===n?'on':null,onclick:()=>{st.quizN=n;drawQuiz()}},n+' soru'))),
          el('button',{class:'btn pri',onclick:startQuiz},'Teste başla'))));
      return;
    }
    if(Z.loading){R(box,el('div',{class:'card'},loading('Sorular hazırlanıyor…')));return}
    if(Z.i>=Z.sorular.length){
      const n=Z.sorular.length,d=Z.dogru,o=n?Math.round(d/n*100):0;
      const msg=o>=90?'Muhteşem! Bu konulara gerçekten hâkimsin.':o>=70?'Çok iyi. Birkaç noktayı tekrar edersen tam olacak.':o>=50?'Fena değil. Yanlış yaptığın soruların açıklamalarını yeniden oku.':'Henüz başlangıç: ilgili dersleri okuyup tekrar dene; her deneme seni güçlendirir.';
      R(box,el('div',{class:'card'},el('h3',{},'Test bitti'),
        el('div',{class:'row',style:'gap:16px;align-items:center;margin:6px 0 10px'},el('div',{class:'ok-big',style:'color:'+rateColor(o)},d+'/'+n),el('div',{},el('b',{style:'font-size:14px'},'%'+o+' başarı'),el('div',{class:'m2'},msg))),
        el('div',{class:'row'},el('button',{class:'btn pri',onclick:startQuiz},'Yeni test'),el('button',{class:'btn',onclick:()=>{st.quiz=null;drawQuiz()}},'Ayarlar'))));
      return;
    }
    const q=Z.sorular[Z.i];const cnt=el('span',{class:'mu mono'},Z.dogru+' doğru');const nextBtn=el('button',{class:'btn pri',style:'display:none;margin-top:12px',onclick:()=>{Z.i++;drawQuiz()}},Z.i+1<Z.sorular.length?'Sonraki soru →':'Sonucu gör');
    R(box,el('div',{class:'card'},
      el('div',{class:'ok-qh'},el('b',{class:'mono'},'Soru '+(Z.i+1)+' / '+Z.sorular.length),el('div',{class:'prog'},el('i',{style:'width:'+Math.round(Z.i/Z.sorular.length*100)+'%'})),cnt),
      qItem(q,{compact:true,onAnswer:r=>{if(r.dogru)Z.dogru++;cnt.textContent=Z.dogru+' doğru';nextBtn.style.display='';if(st.prog&&r.istatistik)st.prog={...st.prog,quiz:r.istatistik};drawStats()}}),
      nextBtn));
  }
  async function startQuiz(){
    st.quiz={loading:true};drawQuiz();
    const r=await call('quiz',{n:st.quizN,konu:st.quizKonu||undefined});
    if(!r.ok){st.quiz=null;drawQuiz();toast(r.error||'Sorular alınamadı.');return}
    if(!r.sorular.length){st.quiz=null;drawQuiz();toast('Bu konuda henüz soru yok.');return}
    st.quiz={sorular:r.sorular,i:0,dogru:0,stale:r.stale};drawQuiz();
  }

  // ---- OGRETMENE SOR ----
  function curSym(){try{return typeof H.sembol==='function'?H.sembol():typeof H.sembol==='string'?H.sembol:null}catch{return null}}
  async function vSor(){
    const sym=curSym();
    const chat=el('div',{class:'ok-chat'});
    const ta=el('textarea',{class:'ok-ta',placeholder:'Örnek: Tavan serisi yapan bir hissede neden alım yapmak zor olur?',maxlength:'2000',
      oninput:e=>{st.draft=e.target.value},onkeydown:e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();send()}}});
    ta.value=st.draft||'';
    const btn=el('button',{class:'btn pri',onclick:()=>send()},'Sor');
    const ctxCb=sym?el('input',{type:'checkbox',checked:st.ctxOn,onchange:e=>{st.ctxOn=e.target.checked}}):null;
    function drawChat(){
      R(chat,
        el('div',{class:'ok-msg a'},el('div',{class:'ok-who'},'Öğretmen'),md('Merhaba! Ben Borsa Okulu öğretmeninim. Borsa İstanbul’la ilgili aklına takılan her şeyi sorabilirsin: kavramlar, kurallar, grafik okuma, risk yönetimi...\n\nSana hazır cevap ezberletmek yerine **mantığını** kavratmaya çalışacağım. Al/sat tavsiyesi vermem ama o kararı kendi başına verebilmen için ne bilmen gerektiğini öğretirim.')),
        st.chat.map(m=>m.rol==='u'?el('div',{class:'ok-msg u'},m.metin):m.rol==='e'?el('div',{class:'ok-msg e'},m.metin):el('div',{class:'ok-msg a'},el('div',{class:'ok-who'},'Öğretmen'),md(m.metin))),
        st.busy?el('div',{class:'ok-msg a'},el('div',{class:'ok-who'},'Öğretmen düşünüyor'),el('span',{class:'ok-typing'},el('i'),el('i'),el('i'))):null);
      chat.scrollTop=chat.scrollHeight;
    }
    async function send(text){
      const q=String(text!=null?text:ta.value).trim();if(!q||st.busy)return;
      const gecmis=st.chat.filter(m=>m.rol!=='e').slice(-6);
      st.chat.push({rol:'u',metin:q});ta.value='';st.draft='';st.busy=true;btn.disabled=true;drawChat();
      let baglam=st.askCtx?{...st.askCtx}:null;
      if(sym&&st.ctxOn){let b={sembol:sym};try{if(typeof H.baglam==='function')b=(await H.baglam(sym))||b}catch{}baglam={...(baglam||{}),hisse:b}}
      const r=await call('ask',{soru:q,baglam,gecmis});
      st.busy=false;btn.disabled=false;
      st.chat.push(r.ok?{rol:'a',metin:r.cevap}:{rol:'e',metin:r.error||'Öğretmen şu an cevap veremedi.'});
      if(st.chat.length>40)st.chat=st.chat.slice(-40);
      if(st.tab==='sor'&&st.drawChat)st.drawChat();
    }
    st.drawChat=drawChat;drawChat();
    const left=el('div',{class:'card'},el('h3',{},'Öğretmene sor',el('span',{class:'sp'}),st.chat.length?el('a',{onclick:()=>{st.chat=[];st.askCtx=null;drawChat()}},'Sohbeti temizle'):null),chat,
      el('div',{class:'ok-compose'},ta,
        el('div',{class:'row',style:'margin-top:8px;justify-content:space-between;flex-wrap:wrap'},
          el('div',{class:'row',style:'gap:12px'},
            ctxCb?el('label',{class:'ok-ctx'},ctxCb,el('span',{},'Seçili hisseyi bağlama ekle (',el('b',{class:'mono'},sym),')')):null,
            st.askCtx&&st.askCtx.ders?el('span',{class:'chip sm',title:'Bu dersle ilgili soruyorsun'},'Ders: '+st.askCtx.ders):null),
          el('div',{class:'row'},el('span',{class:'mu',style:'font-size:10.5px'},'⌘/Ctrl + Enter'),btn))));
    const right=el('div',{class:'ok-col'},
      el('div',{class:'card'},el('h3',{},'Soru önerileri'),el('div',{class:'ok-sugg',style:'margin:0'},ONERI.map(t=>el('button',{class:'chip',style:'height:auto;min-height:24px;padding:4px 10px;white-space:normal;text-align:left',onclick:()=>send(t)},t)))),
      el('div',{class:'card'},el('h3',{},'İyi soru nasıl sorulur?'),el('ul',{class:'ok-ul'},
        el('li',{},'Neyi bildiğini ve nerede takıldığını söyle.'),el('li',{},'Bir örnek ver: “ASELS’te gördüğüm şu durum…”'),
        el('li',{},'“Neden?” diye sormaktan çekinme; amaç mantığı kavramak.')),
        el('div',{class:'disc'},'Öğretmen yapay zekâdır; hata yapabilir. Kesin al/sat tavsiyesi vermez. Mevzuat ve oranları resmi kaynaklardan (Borsa İstanbul, SPK, KAP) teyit et.')));
    R(body,el('div',{class:'ok-grid'},left,right));
    setTimeout(()=>{try{ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length)}catch{}},0);
  }

  // ---- SOZLUK ----
  async function vSozluk(tok){
    if(!st.soz){const r=await call('sozluk',{});if(!live(tok))return;
      if(!r.ok){R(body,errBox(r.error,()=>show('sozluk')));return}st.soz=r}
    const r=st.soz;
    const grid=el('div',{class:'ok-terms'}),cnt=el('span',{class:'mu'});
    const inp=el('input',{type:'search',placeholder:'Terim ara: takas, F/K, devre kesici…',value:st.sozQ,oninput:e=>{st.sozQ=e.target.value;clearTimeout(st.sozT);st.sozT=setTimeout(draw,120)}});
    function draw(){
      const q=fold(st.sozQ.trim());
      let items=r.items;
      if(q){const sc=x=>{const t=fold(x.terim);return t===q?0:t.startsWith(q)?1:t.includes(q)?2:fold(x.tanim).includes(q)?3:9};
        items=items.map(x=>[sc(x),x]).filter(a=>a[0]<9).sort((a,b)=>a[0]-b[0]||a[1].terim.localeCompare(b[1].terim,'tr')).map(a=>a[1])}
      cnt.textContent=items.length+' terim';
      if(!r.items.length){R(grid,el('div',{style:'grid-column:1/-1'},emptyBox('Sözlük henüz boş','Dersler yayınlandıkça terimler burada birikecek.')));return}
      if(!items.length){R(grid,el('div',{style:'grid-column:1/-1'},emptyBox('“'+st.sozQ.trim()+'” bulunamadı','Bu terimi öğretmene sorabilirsin.',
        el('button',{class:'btn pri',onclick:()=>{st.draft=st.sozQ.trim()+' nedir? Basit bir BIST örneğiyle anlatır mısın?';st.askCtx=null;show('sor')}},'Öğretmene sor'))));return}
      const out=[];let last='';
      for(const x of items){const L=q||items.length<40?'':x.terim.charAt(0).toLocaleUpperCase('tr-TR');if(L&&L!==last){out.push(el('div',{class:'ok-letter'},L));last=L}
        out.push(el('div',{class:'ok-term'},el('b',{},x.terim),el('p',{},x.tanim),x.ornek?el('small',{},el('b',{},'Örnek: '),x.ornek):null,konuChip(x.konu)?el('div',{style:'margin-top:7px'},konuChip(x.konu)):null))}
      R(grid,...out);
    }
    draw();
    R(body,offBar(r),el('div',{class:'ph',style:'margin-bottom:12px'},el('div',{class:'ok-srch'},ic('srch'),inp),cnt),grid);
    setTimeout(()=>{try{inp.focus()}catch{}},0);
  }

  show(st.tab);refreshHead();
  return {show,refresh:()=>{st.soz=null;st.dersler=null;return show(st.tab)},openDers};
}

const BPOkul={render,_util:{fold,gun}};
if(typeof window!=='undefined')window.BPOkul=BPOkul;
if(typeof module!=='undefined'&&module.exports)module.exports=BPOkul;
})();
