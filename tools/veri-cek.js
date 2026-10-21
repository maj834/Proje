#!/usr/bin/env node
'use strict';
// Motor arastirma verisi (GitHub Actions'ta calisir; uygulamaya girmez): BIST500 + endeksler 10 yillik gunluk mum (Yahoo),
// ceyreklik bilanco ozetleri (Is Yatirim MaliTablo), sermaye artirimi/temettu gecmisi (Is Yatirim) ve KAP erisim denemesi.
// Cikti: tools/veri/*.json.br (brotli). Yerel deneyler bu dosyalari okur; ag gerekmez.
// Kullanim: node tools/veri-cek.js [fiyat,temel,sermaye,kap]
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const D=require('../bp-data.js');
const OUT=path.join(__dirname,'veri');
const PARTS=(process.argv[2]||'fiyat,temel,sermaye,kap').split(',');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
fs.mkdirSync(OUT,{recursive:true});
function save(name,obj){const buf=zlib.brotliCompressSync(Buffer.from(JSON.stringify(obj)),{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:11}});
  fs.writeFileSync(path.join(OUT,name+'.json.br'),buf);console.log('yazildi',name,(buf.length/1e6).toFixed(2)+' MB')}
const p6=v=>v==null||!Number.isFinite(v)?null:+v.toPrecision(6);

async function yahoo(y,range='10y'){
  for(let k=0;k<5;k++){try{
    const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?range=${range}&interval=1d&events=div%2Csplits`,{headers:{'user-agent':UA}});
    if(r.status===429){await sleep(5000*(k+1));continue}
    if(r.status===404)return null;
    const j=await r.json(),q=j.chart&&j.chart.result&&j.chart.result[0];if(!q||!q.timestamp)return null;
    const o=q.indicators.quote[0],ac=q.indicators.adjclose&&q.indicators.adjclose[0]&&q.indicators.adjclose[0].adjclose||[];
    const out={t:[],o:[],h:[],l:[],c:[],ac:[],v:[]};
    q.timestamp.forEach((t,i)=>{if(![o.open[i],o.high[i],o.low[i],o.close[i]].every(Number.isFinite)||!(o.close[i]>0))return;
      out.t.push(Math.round((t*1000+3*3600e3)/864e5));out.o.push(p6(o.open[i]));out.h.push(p6(o.high[i]));out.l.push(p6(o.low[i]));
      out.c.push(p6(o.close[i]));out.ac.push(p6(Number.isFinite(ac[i])?ac[i]:o.close[i]));out.v.push(Math.round(o.volume[i]||0))});
    const ev=q.events||{};
    out.splits=Object.values(ev.splits||{}).map(s=>[Math.round(s.date*1000/864e5),s.numerator,s.denominator]);
    out.div=Object.values(ev.dividends||{}).map(d=>[Math.round(d.date*1000/864e5),p6(d.amount)]);
    return out}
  catch(e){await sleep(2000*(k+1))}}
  return null}

async function fiyat(){
  const syms=D.U.BIST500,idx=['XU100.IS','XU030.IS','XBANK.IS','XUSIN.IS','XUMAL.IS','XUHIZ.IS','XUTEK.IS','XHOLD.IS','USDTRY=X','EURTRY=X','GC=F','BZ=F','^GSPC','^VIX','EEM'];
  const data={},miss=[];
  for(const y of idx){const r=await yahoo(y);if(r)data[y]=r;else miss.push(y);await sleep(300)}
  for(const s of syms){const r=await yahoo(s+'.IS');if(r&&r.t.length>60)data[s]=r;else miss.push(s);await sleep(250);process.stdout.write('.')}
  console.log('\nfiyat',Object.keys(data).length,'eksik',miss.length,miss.join(' '));
  save('fiyat',{alindi:new Date().toISOString(),kaynak:'Yahoo chart 10y 1d; t=UTC+3 gun no (gun*864e5 ms); ac=temettu/bolunme duzeltilmis kapanis',eksik:miss,data})}

// Is Yatirim MaliTablo: 4 donem/istek. Yalniz ozet kalemler (aciklamaya gore). Bankalar UFRS grubunda.
const IS_URL='https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/MaliTablo';
const IS_H={accept:'*/*','accept-language':'tr-TR,tr;q=0.9','x-requested-with':'XMLHttpRequest','user-agent':UA,referer:'https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/sirket-karti.aspx'};
const KALEM=[/^Satış Gelirleri$/,/^BRÜT KAR \(ZARAR\)$/,/^FAALİYET KARI \(ZARARI\)$/,/^DÖNEM KARI \(ZARARI\)$/,/^Ana Ortaklık Payları$/,/^TOPLAM VARLIKLAR$/,
  /^Özkaynaklar$/,/^Ana Ortaklığa Ait Özkaynaklar$/,/^Ödenmiş Sermaye$/,/^Nakit ve Nakit Benzerleri$/,/^Finansal Borçlar$/,/^Dönen Varlıklar$/,/^Kısa Vadeli Yükümlülükler$/,
  /İşletme Faaliyetlerinden Kaynaklanan Net Nakit/,/^Serbest Nakit Akım$/,/^Amortisman/,/^Finansman Giderleri/,/^Net Faaliyet Kar/,/^FAVÖK/,
  /^AKTİF TOPLAMI$/,/^XVI\. ÖZKAYNAKLAR$/,/^16\.1 Ödenmiş Sermaye$/,/^XXIII\. NET DÖNEM KARI/,/^III\. NET FAİZ GELİRİ/,/^I\. FAİZ GELİRLERİ$/,/^VI\. KREDİLER$/,/^XVII\. SÜRDÜRÜLEN FAALİYETLER DÖNEM NET/];
async function isGet(params){
  for(let k=0;k<3;k++){try{const u=IS_URL+'?'+new URLSearchParams(params).toString();
    const r=await fetch(u,{headers:IS_H});if(r.status!==200){await sleep(1500*(k+1));continue}
    const j=await r.json();return j}catch(e){await sleep(1500*(k+1))}}
  return null}
async function temel(){
  const syms=D.U.BIST500,out={},hata=[];let ilk=null;
  const qs=[];for(let y=2017;y<=2026;y++)for(const m of [3,6,9,12])if(y<2026||m<=6)qs.push([y,m]);
  for(const s of syms){let grp=null,rec={};
    for(const g of ['XI_29','UFRS']){
      for(let i=0;i<qs.length;i+=4){const ch=qs.slice(i,i+4).reverse();const prm={companyCode:s,exchange:'TRY',financialGroup:g};
        ch.forEach(([y,m],k)=>{prm['year'+(k+1)]=y;prm['period'+(k+1)]=m});
        const j=await isGet(prm);await sleep(120);
        if(!ilk&&j)ilk={s,g,ok:j.ok,n:(j.value||[]).length,ornek:(j.value||[]).slice(0,3)};
        const items=j&&j.ok&&Array.isArray(j.value)?j.value:[];
        if(!items.length){if(i===0)break;continue}
        grp=g;
        for(const it of items){const d=String(it.itemDescTr||'').trim();if(!KALEM.some(re=>re.test(d)))continue;
          const key=(it.itemCode||'')+'|'+d;rec[key]=rec[key]||{};
          ch.forEach(([y,m],k)=>{const v=it['value'+(k+1)];if(v!=null&&v!==''&&Number.isFinite(+v))rec[key][y*100+m]=+v})}}
      if(grp)break}
    if(grp)out[s]={g:grp,k:rec};else hata.push(s);process.stdout.write(grp?'.':'x')}
  console.log('\ntemel',Object.keys(out).length,'hata',hata.length,hata.slice(0,40).join(' '));console.log('ilk yanit',JSON.stringify(ilk).slice(0,600));
  save('temel',{alindi:new Date().toISOString(),kaynak:'Is Yatirim MaliTablo; anahtar itemCode|aciklama; donem yyyymm; tutarlar TL',hata,data:out})}

// Sermaye artirimlari (bedelsiz/bedelli) ve temettu gecmisi
const CI='https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/StockInfo/CompanyInfoAjax.aspx';
async function ciPost(fn,body){for(let k=0;k<3;k++){try{const r=await fetch(CI+'/'+fn,{method:'POST',headers:{...IS_H,'content-type':'application/json; charset=UTF-8'},body:JSON.stringify(body)});
  if(r.status!==200){await sleep(1500*(k+1));continue}const j=await r.json();const d=j&&j.d;return typeof d==='string'?JSON.parse(d):d}catch(e){await sleep(1500*(k+1))}}return null}
async function sermaye(){
  const syms=D.U.BIST500,sa={},tm={};let ilk=null,ilkT=null;
  for(const s of syms){
    const a=await ciPost('GetSermayeArttirimlari',{hisseKodu:s,hisseTanimKodu:'',yil:0,zaman:'HEPSI',endeksKodu:'09',sektorKodu:''});await sleep(120);
    if(a&&a.length){sa[s]=a;if(!ilk)ilk=a.slice(0,2)}
    const t=await ciPost('GetTemettuDagitimlari',{hisseKodu:s,hisseTanimKodu:'',yil:0,zaman:'HEPSI',endeksKodu:'09',sektorKodu:''});await sleep(120);
    if(t&&t.length){tm[s]=t;if(!ilkT)ilkT=t.slice(0,2)}
    process.stdout.write('.')}
  console.log('\nsermaye',Object.keys(sa).length,'temettu',Object.keys(tm).length);console.log('ornek SA',JSON.stringify(ilk).slice(0,700));console.log('ornek T',JSON.stringify(ilkT).slice(0,500));
  save('sermaye',{alindi:new Date().toISOString(),kaynak:'Is Yatirim CompanyInfoAjax GetSermayeArttirimlari/GetTemettuDagitimlari',sermaye:sa,temettu:tm})}

// KAP: hangi uc acik? Yanit basini yazdir (sonraki adimda gecmis bildirim cekmek icin).
async function kap(){
  const tries=[
    ['GET','https://www.kap.org.tr/tr/api/company/generic/excel/IGS/A'],
    ['GET','https://www.kap.org.tr/tr/bildirim-sorgu'],
    ['POST','https://www.kap.org.tr/tr/api/memberDisclosureQuery',{fromDate:'2025-01-02',toDate:'2025-01-03',year:'',prd:'',term:'',ruleType:'',bdkReview:'',disclosureClass:'',index:'',market:'',isLate:'',subjectList:[],mkkMemberOidList:[],inactiveMkkMemberOidList:[],bdkMemberOidList:[],mainSector:'',sector:'',subSector:'',memberType:'IGS',fromSrc:'N',srcCategory:'',discIndex:[]}],
    ['POST','https://www.kap.org.tr/tr/api/disclosure/members/byCriteria',{fromDate:'02.01.2025',toDate:'03.01.2025',memberType:'IGS',mkkMemberOidList:[],disclosureClass:'',subjectList:[],isLate:'',mainSector:'',sector:'',subSector:'',marketOidList:[],index:'',bdkReview:'',bdkMemberOidList:[],year:'',term:'',ruleType:'',period:'',fromSrc:false,srcCategory:'',disclosureIndexList:[]}],
    ['GET','https://www.kap.org.tr/tr/api/disclosure/list/main?fromDate=2025-01-02&toDate=2025-01-03'],
    ['GET','https://www.kap.org.tr/tr/api/disclosures?fromDate=2025-01-02&toDate=2025-01-03'],
    ['GET','https://www.kap.org.tr/tr/api/company/info/THYAO'],
    ['GET','https://www.kap.org.tr/tr/sirket-bilgileri/ozet/1218-turk-hava-yollari-a-o'],
  ];
  const rep=[];
  for(const [m,u,b] of tries){try{const r=await fetch(u,{method:m,headers:{'user-agent':UA,accept:'application/json, text/plain, */*','accept-language':'tr','content-type':'application/json',referer:'https://www.kap.org.tr/tr/bildirim-sorgu'},body:b?JSON.stringify(b):undefined});
      const t=await r.text();rep.push({u,m,s:r.status,ct:r.headers.get('content-type'),n:t.length,bas:t.slice(0,300)})}
    catch(e){rep.push({u,m,hata:String(e&&e.message||e)})}await sleep(500)}
  for(const x of rep)console.log('KAP',JSON.stringify(x));
  fs.writeFileSync(path.join(OUT,'kap-deneme.json'),JSON.stringify(rep,null,1))}

(async()=>{
  for(const p of PARTS){const t0=Date.now();try{await ({fiyat,temel,sermaye,kap})[p]()}catch(e){console.log('HATA',p,e&&e.stack||e)}
    console.log('bitti',p,Math.round((Date.now()-t0)/1000)+' sn')}
})();
