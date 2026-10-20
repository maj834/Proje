const {chromium}=require('playwright');
// Istege bagli: Playwright/Chromium; npm test ag/tarayici gerektirmez.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'../..'),E=require(ROOT+'/engine'),L=require(ROOT+'/bp-demo'),C=require(ROOT+'/bp-demo-main');
const make=require(ROOT+'/test/visual/bp-demo-data').rows;
let browser,page;
(async()=>{
 const OUT=fs.mkdtempSync(path.join(os.tmpdir(),'bp-demo-smoke-')),dir=path.join(OUT,'account');fs.mkdirSync(dir);let price=100,clock=Date.UTC(2026,9,19,8),B;
 const market={yahooSymbol:(s,m)=>m==='BIST'?s.replace(/\.IS$/,'')+'.IS':s,
 candles:async(s)=>({rows:[],quote:{price,currency:s.endsWith('.IS')?'TRY':'USD',time:clock,name:'Test AŞ'}})};
 const ctl=C.create({lib:{...L,create:o=>(B=L.create(o))},app:{getPath:()=>dir},path,market,calendar:{status:()=>({open:true,reason:null})},now:()=>clock,active:()=>false,isOn:()=>true,timers:{setTimeout,clearTimeout},send:()=>{},Notification:null,open:()=>{},timeout:p=>p});
 const rows=make({n:400,step:86400000,start:clock-570*86400000,p0:100,seed:7,vol:.02});
 const pro=E.proAnalyze({'1g':rows,'1h':rows},{primary:'1g'});
 const st={watch:['THYAO','ASELS'],tf:'1g',symbol:'THYAO',market:'BIST',alarms:[],portfolio:{positions:[],summary:null},marketStatus:{open:true},prefs:{},providers:[],universes:{},tags:{},strategies:[],presets:[]};
 async function api(k,o){switch(k){case 'demo':return ctl.op(o).catch(e=>({ok:false,error:e.message}));case 'state':return st;case 'load':{const m=o.market||'BIST',s=o.symbol;return {ok:true,symbol:s,yahoo:market.yahooSymbol(s,m),market:m,name:'Test AŞ',tf:o.tf,rows,pro,quote:{price,currency:m==='US'?'USD':'TRY',time:clock},signals:[],frames:{},errors:[]}}case 'quotes':return st.watch.map(symbol=>({symbol,price,chgPct:1}));case 'search':return [];case 'depth':return {ok:true};case 'prefs':return {};default:return {ok:true}}}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1360,height:860}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('__testBp',api);await page.addInitScript(()=>{window.bp=new Proxy({on:()=>()=>{}},{get:(t,k)=>k in t?t[k]:o=>window.__testBp(k,o)})});
 page.on('dialog',d=>d.accept());
 await page.goto('file://'+ROOT+'/borsa-pro.html');await page.waitForSelector('#dm-submit:not([disabled])');
 await page.screenshot({path:path.join(OUT,'ticket.png')});
 await page.fill('#dm-qty','10');await page.click('#dm-submit');await page.waitForFunction(()=>document.querySelector('#dm-submit')?.disabled===false);assert.equal(B.summary().accounts.BIST.pos[0].qty,10);
 await page.selectOption('[aria-label="Demo yön"]','sell');await page.selectOption('[aria-label="Demo emir türü"]','limit');await page.fill('#dm-price','110');await page.fill('#dm-qty','4');await page.click('#dm-submit');await page.waitForTimeout(250);assert.equal(B.summary().orders.length,1);
 await page.selectOption('[aria-label="Demo emir türü"]','market');await page.fill('#dm-qty','10');await page.click('#dm-submit');await page.waitForTimeout(250);assert.equal(B.summary().accounts.BIST.pos[0].qty,10);assert.match(await page.locator('#toast').textContent(),/Satılabilir/);
 await page.click('[data-v="demo"]');await page.waitForSelector('#v-demo table');await page.screenshot({path:path.join(OUT,'account.png')});
 await page.getByRole('button',{name:'İptal',exact:true}).click();await page.waitForTimeout(200);assert.equal(B.summary().orders.length,0);
 await page.getByRole('button',{name:'Sat',exact:true}).click();await page.waitForTimeout(300);assert.equal(await page.locator('[aria-label="Demo yön"]').inputValue(),'sell');await page.fill('#dm-qty','5');await page.click('#dm-submit');await page.waitForTimeout(250);assert.equal(B.summary().accounts.BIST.pos[0].qty,5);
 // New limit buy, then quote touches it; fills independently of chart display.
 await page.selectOption('[aria-label="Demo yön"]','buy');await page.selectOption('[aria-label="Demo emir türü"]','limit');await page.fill('#dm-price','90');await page.fill('#dm-qty','2');await page.click('#dm-submit');await page.waitForTimeout(200);price=89;clock+=60000;
 await page.getByRole('button',{name:'Fiyat ↻',exact:true}).click();await page.waitForTimeout(250);assert.equal(B.summary().orders.length,0);assert.equal(B.summary().accounts.BIST.pos[0].qty,7);
 await page.click('[data-v="demo"]');await page.waitForTimeout(200);await page.locator('#v-demo summary').click();await page.fill('[aria-label="Komisyon yüzdesi"]','0.1');await page.getByRole('button',{name:'Ayarları kaydet'}).click();await page.waitForTimeout(250);assert.equal(B.summary().set.commission,.001);
 await page.getByRole('button',{name:'ABD · USD',exact:true}).click();assert.match(await page.locator('#v-demo').textContent(),/10.000,00/);
 await page.getByRole('button',{name:'BIST · TRY',exact:true}).click();await page.locator('#v-demo summary').click();await page.fill('[aria-label="Başlangıç demo bakiyesi"]','75000');await page.getByRole('button',{name:'Hesabı sıfırla'}).click();await page.waitForTimeout(250);assert.equal(B.summary().accounts.BIST.cash,75000);assert.equal(B.summary().trades.length,0);
 for(const width of [1024,1360]){await page.setViewportSize({width,height:860});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(OUT,'demo-'+width+'.png')})}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,screenshots:OUT,checks:['buy','limit sell','oversell blocked','cancel','sell via account','pending limit fill','settings','US account','reset','1024/1360 layout'],errors}));
 await page.close();await browser.close();fs.rmSync(dir,{recursive:true});process.exit(0);
})().catch(async e=>{console.error(e);if(page)await page.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});process.exit(1)});
