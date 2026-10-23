// Demo hesaplari icin sembol tablolari (tek yer): kripto (Yahoo '-USD' ciftleri) ve populer ABD hisse/ETF listesi.
// Hem ana surec (require) hem Borsa Pro penceresi (<script src>, window.BPSymbols) kullanir; ag istegi yok.
// Kripto: piyasa degerine gore ilk ~50 coin (stabil coinler haric). Yahoo bazi kodlari CoinMarketCap kimligiyle ayirir
// (ornek TON11419-USD, SUI20947-USD); bu kodlar 2026 itibariyla bilinen Yahoo kodlaridir, kapali agda yeniden dogrulanamadi.
// Tabloda olmayan her gecerli 'XXX-USD' kodu da yazilabilir (Yahoo bulamazsa "bulunamadi" hatasi doner).
// ABD listesi yalniz arama/oneri icindir; listede olmayan gecerli ABD kodlari da islem gorur.
(function(){
'use strict';
// [kod, Yahoo sembolu, ad]
const CRYPTO=[
  ['BTC','BTC-USD','Bitcoin'],['ETH','ETH-USD','Ethereum'],['XRP','XRP-USD','XRP'],['BNB','BNB-USD','BNB'],['SOL','SOL-USD','Solana'],
  ['DOGE','DOGE-USD','Dogecoin'],['TRX','TRX-USD','TRON'],['ADA','ADA-USD','Cardano'],['HYPE','HYPE32196-USD','Hyperliquid'],['LINK','LINK-USD','Chainlink'],
  ['AVAX','AVAX-USD','Avalanche'],['SUI','SUI20947-USD','Sui'],['XLM','XLM-USD','Stellar'],['BCH','BCH-USD','Bitcoin Cash'],['TON','TON11419-USD','Toncoin'],
  ['HBAR','HBAR-USD','Hedera'],['LTC','LTC-USD','Litecoin'],['SHIB','SHIB-USD','Shiba Inu'],['DOT','DOT-USD','Polkadot'],['XMR','XMR-USD','Monero'],
  ['UNI','UNI7083-USD','Uniswap'],['PEPE','PEPE24478-USD','Pepe'],['AAVE','AAVE-USD','Aave'],['APT','APT21794-USD','Aptos'],['NEAR','NEAR-USD','NEAR Protocol'],
  ['TAO','TAO22974-USD','Bittensor'],['ICP','ICP-USD','Internet Computer'],['ETC','ETC-USD','Ethereum Classic'],['POL','POL28321-USD','Polygon (POL)'],['MATIC','MATIC-USD','Polygon (eski MATIC)'],
  ['ONDO','ONDO-USD','Ondo'],['KAS','KAS-USD','Kaspa'],['ARB','ARB11841-USD','Arbitrum'],['VET','VET-USD','VeChain'],['RENDER','RENDER-USD','Render'],
  ['ATOM','ATOM-USD','Cosmos'],['FIL','FIL-USD','Filecoin'],['ALGO','ALGO-USD','Algorand'],['FET','FET-USD','Artificial Superintelligence (FET)'],['OP','OP-USD','Optimism'],
  ['INJ','INJ-USD','Injective'],['STX','STX4847-USD','Stacks'],['TIA','TIA22861-USD','Celestia'],['IMX','IMX10603-USD','Immutable'],['WLD','WLD-USD','Worldcoin'],
  ['SEI','SEI-USD','Sei'],['GRT','GRT6719-USD','The Graph'],['JUP','JUP29210-USD','Jupiter'],['BONK','BONK-USD','Bonk'],['FLOKI','FLOKI-USD','Floki'],
  ['MKR','MKR-USD','Maker'],['SAND','SAND-USD','The Sandbox'],['MANA','MANA-USD','Decentraland'],['AXS','AXS-USD','Axie Infinity'],['ENA','ENA-USD','Ethena'],['WIF','WIF-USD','dogwifhat']
].map(([c,y,n])=>({code:c,symbol:y,name:n}));
// Populer ABD hisseleri ve ETF'ler (Yahoo kodu = borsa kodu; Berkshire B icin 'BRK-B')
const US=[
  ['AAPL','Apple'],['MSFT','Microsoft'],['NVDA','NVIDIA'],['AMZN','Amazon'],['GOOGL','Alphabet A'],['GOOG','Alphabet C'],['META','Meta Platforms'],['TSLA','Tesla'],
  ['BRK-B','Berkshire Hathaway B'],['AVGO','Broadcom'],['JPM','JPMorgan Chase'],['V','Visa'],['MA','Mastercard'],['UNH','UnitedHealth'],['XOM','Exxon Mobil'],
  ['LLY','Eli Lilly'],['JNJ','Johnson & Johnson'],['PG','Procter & Gamble'],['HD','Home Depot'],['COST','Costco'],['ORCL','Oracle'],['NFLX','Netflix'],
  ['AMD','Advanced Micro Devices'],['INTC','Intel'],['CRM','Salesforce'],['ADBE','Adobe'],['PEP','PepsiCo'],['KO','Coca-Cola'],['WMT','Walmart'],['DIS','Walt Disney'],
  ['BAC','Bank of America'],['WFC','Wells Fargo'],['C','Citigroup'],['GS','Goldman Sachs'],['MS','Morgan Stanley'],['BLK','BlackRock'],['SCHW','Charles Schwab'],['AXP','American Express'],
  ['CSCO','Cisco'],['QCOM','Qualcomm'],['TXN','Texas Instruments'],['IBM','IBM'],['MU','Micron'],['AMAT','Applied Materials'],['LRCX','Lam Research'],['ARM','Arm Holdings'],
  ['TSM','TSMC (ADR)'],['ASML','ASML (ADR)'],['SMCI','Super Micro Computer'],['DELL','Dell'],['PLTR','Palantir'],['SNOW','Snowflake'],['NOW','ServiceNow'],['PANW','Palo Alto Networks'],
  ['CRWD','CrowdStrike'],['SHOP','Shopify'],['UBER','Uber'],['ABNB','Airbnb'],['PYPL','PayPal'],['COIN','Coinbase'],['MSTR','Strategy (MicroStrategy)'],['HOOD','Robinhood'],
  ['SOFI','SoFi'],['RBLX','Roblox'],['SPOT','Spotify'],['NKE','Nike'],['MCD','McDonald\'s'],['SBUX','Starbucks'],['TGT','Target'],['LOW','Lowe\'s'],
  ['T','AT&T'],['VZ','Verizon'],['PFE','Pfizer'],['MRK','Merck'],['ABBV','AbbVie'],['BMY','Bristol-Myers Squibb'],['MRNA','Moderna'],['TMO','Thermo Fisher'],['ABT','Abbott'],
  ['CVX','Chevron'],['BA','Boeing'],['CAT','Caterpillar'],['GE','GE Aerospace'],['LMT','Lockheed Martin'],['RTX','RTX'],['DE','Deere'],['HON','Honeywell'],['UPS','UPS'],['FDX','FedEx'],
  ['F','Ford'],['GM','General Motors'],['RIVN','Rivian'],['BABA','Alibaba (ADR)'],['NIO','NIO (ADR)'],['PM','Philip Morris'],
  ['SPY','SPDR S&P 500 ETF'],['VOO','Vanguard S&P 500 ETF'],['QQQ','Invesco QQQ (Nasdaq 100)'],['DIA','SPDR Dow Jones ETF'],['IWM','iShares Russell 2000 ETF'],['VTI','Vanguard Total Market ETF'],
  ['ARKK','ARK Innovation ETF'],['SMH','VanEck Yarı İletken ETF'],['XLK','Teknoloji Sektör ETF'],['XLF','Finans Sektör ETF'],['XLE','Enerji Sektör ETF'],['SCHD','Schwab Temettü ETF'],
  ['GLD','SPDR Altın ETF'],['SLV','iShares Gümüş ETF'],['TLT','iShares 20+ Yıl Tahvil ETF'],['EEM','iShares Gelişen Piyasalar ETF'],['TUR','iShares MSCI Türkiye ETF'],['IBIT','iShares Bitcoin ETF']
].map(([s,n])=>({code:s,symbol:s,name:n}));

// Yahoo vadeli kontratlari spot fiyat degildir; adlarda acikca belirtilir.
const GLOBAL=[
 ['GC=F','Ons altın (vadeli referans; spot değil)'],['SI=F','Ons gümüş (vadeli)'],['PL=F','Platin (vadeli)'],['HG=F','Bakır (vadeli)'],
 ['CL=F','WTI petrol (vadeli)'],['BZ=F','Brent petrol (vadeli)'],['NG=F','Doğal gaz (vadeli)'],
 ['USDTRY=X','Dolar / TL'],['EURTRY=X','Euro / TL'],['EURUSD=X','Euro / Dolar'],['GBPUSD=X','Sterlin / Dolar'],['JPY=X','Dolar / Japon yeni']
].map(([s,n])=>({code:s,symbol:s,name:n}));
const GLOBAL_BY=new Map(GLOBAL.map(x=>[x.symbol,x]));
const BY_CODE=new Map(CRYPTO.map(x=>[x.code,x])),BY_SYM=new Map(CRYPTO.map(x=>[x.symbol,x])),US_BY=new Map(US.map(x=>[x.symbol,x]));
const up=s=>String(s==null?'':s).trim().toLocaleUpperCase('tr-TR').replace(/İ/g,'I').replace(/\s+/g,'');
// Kullanici yazisi -> Yahoo kripto kodu: "btc", "BTC-USD", "btc/usdt", "BTCUSD" -> "BTC-USD"; tablodaki ozel kodlar ("ton" -> "TON11419-USD").
function cryptoSymbol(s){
  let x=up(s).replace(/[/_]/g,'-');if(!x)return null;
  if(BY_SYM.has(x))return x;
  x=x.replace(/-?USDT$|-?USDC$/,'-USD');
  let code=x.endsWith('-USD')?x.slice(0,-4):/^[A-Z0-9]{2,10}USD$/.test(x)&&!BY_CODE.has(x)?x.slice(0,-3):x;
  if(BY_CODE.has(code))return BY_CODE.get(code).symbol;
  if(BY_SYM.has(code+'-USD'))return code+'-USD';
  return /^[A-Z0-9]{2,15}$/.test(code)&&/[A-Z]/.test(code)?code+'-USD':null;
}
const isCrypto=s=>/^[A-Z0-9]{2,15}-USD$/.test(up(s));
// Gosterim kodu: "TON11419-USD" -> "TON", "XYZ-USD" -> "XYZ", "THYAO.IS" -> "THYAO"
function display(sym){const s=up(sym);if(BY_SYM.has(s))return BY_SYM.get(s).code;if(isCrypto(s))return s.slice(0,-4);return s.replace(/\.IS$/,'')}
function nameOf(sym){const s=up(sym);return (BY_SYM.get(s)||US_BY.get(s)||GLOBAL_BY.get(s)||{}).name||null}
// Basit siralamali arama (kod tam > kod basi > ad basi > ad icinde). market: 'CRYPTO' | 'US'
function search(market,q,limit=8){
  const list=market==='CRYPTO'?CRYPTO:market==='US'?US:market==='GLOBAL'?GLOBAL:[];const s=up(q).replace(/-USD$/,'');
  if(!s)return list.slice(0,limit);
  const low=v=>String(v).trim().toLocaleLowerCase('tr-TR').replace(/ı/g,'i'),n=low(q); // NVIDIA -> nvidia (tr: I -> ı)
  return list.map(x=>{const nm=low(x.name);
    return [x.code===s?0:x.code.startsWith(s)?1:nm.startsWith(n)?2:x.code.includes(s)?3:nm.includes(n)?4:9,x]}).filter(a=>a[0]<9)
    .sort((a,b)=>a[0]-b[0]||list.indexOf(a[1])-list.indexOf(b[1])).slice(0,limit).map(a=>a[1]);
}
// Hesap tahmini: Okul/arama yazisindan hangi demo hesabi
function marketOf(s){const x=up(s);if(!x)return null;if(/\.IS$/.test(x))return 'BIST';if(isCrypto(x)||BY_CODE.has(x))return 'CRYPTO';if(US_BY.has(x)||GLOBAL_BY.has(x))return 'US';return null}

const api={CRYPTO,US,GLOBAL,cryptoSymbol,isCrypto,display,nameOf,search,marketOf};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(typeof window!=='undefined')window.BPSymbols=api;
})();
