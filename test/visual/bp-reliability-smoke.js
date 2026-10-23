// Offline UI regression: npm test does not require a browser. Run with CHROMIUM_PATH=chromium.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..'),E=require(ROOT+'/engine'),make=require('./bp-demo-data').rows;
const rows=make({n:400}),pro=E.proAnalyze({'1g':rows},{primary:'1g'}),USD=require(ROOT+'/bp-currency').toUSD(rows,[{t:rows[0].t,c:35}],{maxAge:Infinity});
const st={watch:['THYAO'],tf:'1g',symbol:'THYAO',market:'BIST',alarms:[],portfolio:{positions:[],summary:null},marketStatus:{open:true},prefs:{},providers:[],universes:{},tags:{},strategies:[],presets:[]};
let browser,page;const errors=[];
(async()=>{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',headless:true,args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1360,height:900}});page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('__bp',async(k,o)=>{
  if(k==='state')return st;if(k==='load')return {ok:true,symbol:o.symbol,market:o.market,name:'Sentetik test',tf:o.tf,rows,pro,signals:[],frames:{},news:{yahoo:[]},quote:{price:rows.at(-1).c,currency:'TRY'},chartUSD:o.chartCurrency==='USD'?{...USD,approximate:true}:null};
  if(k==='quotes')return [{symbol:'THYAO',price:100}];if(k==='search')return [];if(k==='okul')return {ok:false,error:'Çevrimdışı'};if(k==='demo')return {ok:false,error:'Testte kapalı'};return {ok:true};
 });
 await page.addInitScript(()=>{window.bp=new Proxy({on:()=>()=>{}},{get:(t,k)=>k in t?t[k]:o=>window.__bp(k,o)})});
 await page.goto('file://'+ROOT+'/borsa-pro.html');await page.waitForFunction(()=>window.__ready===true);
 assert.equal(await page.locator('#tb button:not([title])').count(),0,'all chart toolbar buttons explained');
 await page.getByRole('button',{name:'Trend',exact:true}).click();const chart=await page.locator('#chart').boundingBox();
 const x=chart.x+chart.width*.55,y=chart.y+chart.height*.35;
 await page.mouse.click(x,y);await page.waitForTimeout(200);await page.mouse.click(x,y+40);await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>ch.getDrawings().length),0,'same-bar second point rejected, not shifted to next bar');
 await page.mouse.click(x+90,y+20);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>ch.getDrawings().length),1);
 await page.getByRole('button',{name:'Grafik: TL → USD',exact:true}).click();await page.waitForFunction(()=>usdActive());
 assert.equal(await page.evaluate(()=>ch.getDrawings().length),0,'TRY drawings hidden in USD');
 const overlays=await page.evaluate(()=>{
  const saved=demoSummary,original=ch.setOverlays;let seen=null;
  ch.setOverlays=o=>{seen=o;return original(o)};
  demoSummary={accounts:{BIST:{pos:[{sym:'THYAO.IS',avg:400}]}},orders:[{sym:'THYAO.IS',price:410,type:'limit',side:'sell'}]};
  try{demoOverlays();return seen}finally{demoSummary=saved;ch.setOverlays=original}
 });
 assert.deepEqual(overlays.positions,[],'TRY demo costs must stay hidden after async USD updates');
 assert.deepEqual(overlays.alarms,[],'TRY demo orders must stay hidden after async USD updates');

 assert.match(await page.locator('#ap').innerText(),/Analiz, fiyat başlığı ve emirler TL/);
 await page.getByRole('button',{name:'Grafik: USD ≈',exact:true}).click();await page.waitForFunction(()=>!usdActive());
 assert.equal(await page.evaluate(()=>ch.getDrawings().length),1,'TRY drawing restored');
 // Exercise every drawing tool and layer via the UI, then undo/clear, not only the helper API.
 for(const [tool,two] of [['Işın',true],['Yatay',false],['Fib',true],['Kutu',true]]){
  const before=await page.evaluate(()=>ch.getDrawings().length);
  await page.getByRole('button',{name:tool,exact:true}).click();
  const click=async(a,b)=>{await page.mouse.move(a,b);await page.waitForTimeout(150);await page.mouse.down();await page.waitForTimeout(60);await page.mouse.up();await page.waitForTimeout(250)};
  await click(x-80,y+10);if(two)await click(x+60,y+35);
  assert.equal(await page.evaluate(()=>ch.getDrawings().length),before+1,tool+' creates a drawing');
 }
 await page.getByRole('button',{name:'Geri al',exact:true}).click();
 assert.equal(await page.evaluate(()=>ch.getDrawings().length),4,'undo removes last drawing');
 page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'Temizle',exact:true}).click();
 assert.equal(await page.evaluate(()=>ch.getDrawings().length),0,'clear drawings');
 for(const name of ['EMA 20/50','EMA 200','Bollinger','VWAP','Hacim','RSI','MACD','Seviyeler','Plan','AL/SAT','Trend çizgileri','Hacim profili']){
  const button=page.locator('#tb').getByRole('button',{name,exact:true});await button.click();await button.click();
 }
 await page.getByTitle('Yakınlaştır',{exact:true}).click();await page.getByTitle('Uzaklaştır',{exact:true}).click();
 await page.getByRole('button',{name:'1h',exact:true}).click();await page.waitForFunction(()=>S.data.tf==='1h');
 await page.getByRole('button',{name:'1g',exact:true}).click();await page.waitForFunction(()=>S.data.tf==='1g');

 for(const width of [1360,1024,820]){await page.setViewportSize({width,height:900});await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal page overflow at '+width);
  const box=await page.locator('#chart').boundingBox();assert.ok(box.width>250&&box.height>100,'chart remains usable at '+width);
  await page.screenshot({path:'/data/borsa-ui-'+width+'.png'});
 }
 await page.setViewportSize({width:1360,height:900});await page.locator('#q').fill('altın');await page.waitForTimeout(400);assert.match(await page.locator('#dd').innerText(),/vadeli referans/);
 await page.locator('[data-v="tarama"]').click();assert.equal(await page.getByRole('button',{name:'Emtia / Döviz',exact:true}).count(),1);
 await page.locator('[data-v="okul"]').click();await page.waitForTimeout(200);await page.getByRole('button',{name:'Sözlük',exact:true}).click();await page.waitForTimeout(250);
 assert.match(await page.locator('#v-okul').innerText(),/Bileşen uyumu/);assert.ok(await page.locator('.ok-term').count()>=45);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['toolbar descriptions','same-bar drawing','all five drawing tools','undo and clear','12 layer toggles','zoom','daily/weekly switching','USD/TRY drawing isolation','async demo overlay currency isolation','1360/1024/820 layout','gold search','global scanner','offline glossary'],errors}));
 await page.close();await browser.close();process.exit(0);
})().catch(async e=>{console.error(e);if(page)await page.screenshot({path:'/data/borsa-ui-error.png'}).catch(()=>{});if(browser)await browser.close();process.exit(1)});
