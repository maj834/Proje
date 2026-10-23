'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {toUSD}=require('../bp-currency'),S=require('../bp-symbols'),terms=require('../bp-glossary'),AI=require('../bp-analyst'),E=require('../engine');
const row=(t,c=100)=>({t,o:c,h:c+10,l:c-10,c,v:1000});
test('USD conversion: uses last available historical rate, never future rate; preserves volume',()=>{
 const r=toUSD([row(10),row(20),row(30)],[{t:10,c:10},{t:25,c:20},{t:40,c:40}]);
 assert.deepEqual(r.rows.map(x=>x.c),[10,10,5]);assert.equal(r.rows[2].h,5.5);assert.equal(r.rows[2].v,1000);
});
test('USD conversion: missing, invalid and stale rates excluded, inputs untouched',()=>{
 const rows=[row(0),row(10),row(30)],rates=[{t:5,c:10},{t:9,c:0},{t:11,c:NaN}];const copy=JSON.stringify(rows);
 const r=toUSD(rows,rates,{maxAge:10});assert.equal(r.rows.length,1);assert.equal(r.dropped,2);assert.equal(JSON.stringify(rows),copy);
 assert.deepEqual(toUSD(rows,[]).rows,[]);assert.deepEqual(toUSD([],rates).rows,[]);
});
test('Global instruments: gold labelled futures not spot, searchable and market detected',()=>{
 assert.ok(S.GLOBAL.length>=10);assert.match(S.search('GLOBAL','altın')[0].symbol,/GC=F/);assert.match(S.nameOf('GC=F'),/spot değil/);
 for(const x of S.GLOBAL){assert.equal(S.marketOf(x.symbol),'US');assert.equal(require('../market').yahooSymbol(x.symbol,'US'),x.symbol)}
 assert.equal(S.search('GLOBAL','Dolar / TL')[0].symbol,'USDTRY=X');
});
test('Local glossary: unique Turkish terms available without backend',()=>{
 assert.ok(terms.length>=45);assert.equal(new Set(terms.map(x=>x.terim.toLowerCase())).size,terms.length);
 for(const x of terms)assert.ok(x.tanim.length>20);assert.ok(terms.some(x=>x.terim==='Bileşen uyumu'));
});
test('Brief guard removes unsupported sentences and list items, keeps grounded data',()=>{
 const d=AI.normalizeBrief({ozet:'Fiyat 123,45 seviyesinde. Hedef 987,65 olacak.',boga:'123,45 üzerinde kapanış.',ayi:'77,77 altı risk.',tetikler:['123,45 üzerinde','876,54 hedef'],sonuc:'Hedef 987,65.'},1);
 const r=AI.guardBrief(d,[123.45]);assert.equal(r.data.ozet,'Fiyat 123,45 seviyesinde.');assert.equal(r.data.ayi,'');assert.equal(r.data.tetikler.length,1);
 assert.ok(r.unverified.includes('987,65'));assert.ok(r.removed>=3);assert.match(r.data.sonuc,/Yatırım tavsiyesi değildir/);
 assert.ok(!JSON.stringify(r.data).includes('987,65'));
});
test('Negative SAT score and high component agreement are not contradictory',()=>{
 const v=E.verdictOf([{key:'a',name:'a',w:1,v:-1,why:['Düşüş']}]);
 assert.equal(v.label,'SAT');assert.equal(v.score,-100);assert.equal(v.confidence,100);assert.deepEqual(v.reasons,['Düşüş']);
});
test('Depth freshness rejects wrong symbol, old, invalid and future timestamps',()=>{
 const {freshFor}=require('../depth'),d={symbol:'THYAO',at:1000000};
 assert.equal(freshFor(d,'THYAO',1000000),d);assert.equal(freshFor(d,'GARAN',1000000),null);
 assert.equal(freshFor(d,'THYAO',1300001),null);assert.equal(freshFor(d,'THYAO',900000),null);
 assert.equal(freshFor({...d,at:NaN},'THYAO',1000000),null);
});
test('AI compact labels futures and forex instead of assuming every instrument is a BIST stock',()=>{
 assert.equal(AI.compact({symbol:'GC=F',market:'US',quote:{price:2000,currency:'USD'}}).enstruman,'Vadeli kontrat (spot değil)');
 assert.equal(AI.compact({symbol:'USDTRY=X',market:'US',quote:{price:40,currency:'TRY'}}).enstruman,'Döviz çifti');
});
