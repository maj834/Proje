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
 await page.goto('file://'+ROOT+'/borsa-pro.html');await page.waitForSelector('#dm-qty');
 const until=async(fn,label)=>{for(let i=0;i<80;i++){if(fn())return;await new Promise(r=>setTimeout(r,50))}assert.ok(fn(),label)};
 const ticket=()=>page.locator('.dm-t:visible');
 const side=async v=>ticket().locator('[aria-label="Demo yön"] button[data-v="'+v+'"]').click();
 const type=async v=>ticket().locator('[aria-label="Demo emir türü"] button[data-v="'+v+'"]').click();
 const qty=async v=>ticket().getByLabel('Demo miktar',{exact:true}).fill(v);
 const limit=async v=>ticket().getByLabel('Demo emir fiyatı',{exact:true}).fill(v);
 const submit=async()=>{const b=ticket().locator('.dm-go');await b.waitFor({state:'visible'});assert.equal(await b.isEnabled(),true);await b.click()};
 await qty('10');await page.waitForFunction(()=>!document.querySelector('#dm-submit').disabled);
 await page.screenshot({path:path.join(OUT,'ticket.png')});await submit();
 await until(()=>B.summary().accounts.BIST.pos[0]?.qty===10,'buy filled');
 await side('sell');await type('limit');await limit('110');await qty('4');await submit();
 await until(()=>B.summary().orders.length===1,'limit sell pending');
 await type('market');await qty('10');assert.equal(await ticket().locator('.dm-go').isDisabled(),true);
 assert.match(await ticket().locator('.dm-msg').textContent(),/Satılabilir/);assert.equal(B.summary().accounts.BIST.pos[0].qty,10);
 await page.click('[data-v="demo"]');await page.waitForSelector('#v-demo table');await page.screenshot({path:path.join(OUT,'account.png')});
 await page.getByRole('button',{name:'İptal',exact:true}).click();await until(()=>B.summary().orders.length===0,'cancel');
 await page.getByRole('button',{name:'Sat',exact:true}).click();await page.waitForSelector('#dt-qty');
 assert.equal(await ticket().locator('[aria-label="Demo yön"] [data-v="sell"]').getAttribute('class'),'on s');
 await qty('5');await submit();await until(()=>B.summary().accounts.BIST.pos[0]?.qty===5,'sell via account');
 await side('buy');await type('limit');await limit('90');await qty('2');await submit();await until(()=>B.summary().orders.length===1,'limit buy pending');
 price=89;clock+=60000;await page.getByRole('button',{name:'Fiyatları yenile',exact:true}).click();
 await until(()=>B.summary().orders.length===0&&B.summary().accounts.BIST.pos[0]?.qty===7,'pending limit fill');
 const settings=async()=>{if(await page.locator('#v-demo .dm-set').getAttribute('open')===null)await page.locator('#v-demo .dm-set summary').click()};
 await settings();await page.fill('[aria-label="Komisyon yüzdesi"]','0.1');await page.getByRole('button',{name:'Ayarları kaydet'}).click();await until(()=>B.summary().set.commission===.001,'settings');
 await page.getByRole('button',{name:'ABD · USD',exact:true}).click();assert.match(await page.locator('#v-demo').textContent(),/10.000,00/);
 await page.getByRole('button',{name:'BIST · TRY',exact:true}).click();await settings();await page.fill('[aria-label="Başlangıç demo bakiyesi"]','75000');
 await page.getByRole('button',{name:'Hesabı sıfırla'}).click();await until(()=>B.summary().accounts.BIST.cash===75000,'reset');assert.equal(B.summary().trades.length,0);
 for(const width of [1024,1360]){await page.setViewportSize({width,height:860});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(OUT,'demo-'+width+'.png')})}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,screenshots:OUT,checks:['buy','limit sell','oversell blocked','cancel','sell via account','pending limit fill','settings','US account','reset','1024/1360 layout'],errors}));
 await page.close();await browser.close();fs.rmSync(dir,{recursive:true});process.exit(0);
})().catch(async e=>{console.error(e);if(page)await page.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});process.exit(1)});
