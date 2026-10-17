'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const DI = require('../depthimg.js');
const D = require('../depth.js');

// Kucuk PNG cozucu (8 bit, paletli/RGB/RGBA, taramasiz): fixture'i RGBA'ya cevirir.
function decodePng(buf) {
  let p = 8, w, h, type, pal, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), t = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); type = d[9]; assert.equal(d[8], 8); assert.equal(d[12], 0); }
    else if (t === 'PLTE') pal = d;
    else if (t === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const bpp = { 3: 1, 2: 3, 6: 4, 0: 1 }[type], raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const out = Buffer.alloc(w * h * 4), cur = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], s = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      cur[i] = (s[i] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (type === 3) { const k = cur[x] * 3; out[o] = pal[k]; out[o + 1] = pal[k + 1]; out[o + 2] = pal[k + 2]; }
      else if (type === 0) out[o] = out[o + 1] = out[o + 2] = cur[x];
      else { out[o] = cur[x * bpp]; out[o + 1] = cur[x * bpp + 1]; out[o + 2] = cur[x * bpp + 2]; }
      out[o + 3] = 255;
    }
    cur.copy(prev);
  }
  return { width: w, height: h, data: out };
}

const img = decodePng(fs.readFileSync(path.join(__dirname, 'fixtures', 'bopt-depth.png')));
// BOPT ornegindeki alis tarafi (adet, fiyat); satis tarafi testte ayni satirlarin ters sirasidir.
const BIDS = [[4342512, 12.13], [3, 12.12], [1, 12.08], [501, 12.06], [500, 12.05], [1001, 12.04], [100, 12.03], [1000, 12.01], [525, 12], [100, 11.98],
  [200, 11.93], [1001, 11.9], [1, 11.89], [1250, 11.87], [2002, 11.86], [8790, 11.85], [201, 11.83], [1250, 11.82], [1, 11.81], [3501, 11.8],
  [1000, 11.74], [4200, 11.7], [1, 11.69], [4000, 11.6], [6500, 11.56]];

test('png: kodlayici cozucuyle geri okunur', () => {
  const g = Buffer.from([0, 64, 128, 255, 10, 20]), r = decodePng(DI.png(3, 2, g));
  assert.equal(r.width, 3); assert.equal(r.height, 2);
  assert.deepEqual([...g], [0, 1, 2, 3, 4, 5].map(i => r.data[i * 4]));
});

test('segment: yesil alis ve kirmizi satis bloklarini bulur', () => {
  const s = DI.segment(img);
  assert.ok(s);
  assert.ok(s.top > 250 && s.top < 290, 'top ' + s.top);
  assert.ok(s.bid[1] < s.ask[0], 'alis solda');
  assert.ok(Math.abs((s.bid[1] - s.bid[0]) - (s.ask[1] - s.ask[0])) < 20, 'bloklar esit genislikte');
  // BGRA (Electron toBitmap) ayni sonucu verir
  const bgra = Buffer.from(img.data); for (let i = 0; i < bgra.length; i += 4) { const t = bgra[i]; bgra[i] = bgra[i + 2]; bgra[i + 2] = t; }
  assert.deepEqual(DI.segment({ ...img, data: bgra, bgra: true }).bid, s.bid);
  assert.equal(DI.segment({ width: 20, height: 20, data: Buffer.alloc(1600) }), null);
});

test('priceOf / qtyOf / parseStats: OCR temizleme', () => {
  assert.equal(DI.priceOf('12.13'), 12.13); assert.equal(DI.priceOf('1213'), 12.13); assert.equal(DI.priceOf('12,13'), 12.13);
  assert.equal(DI.priceOf('11.08', 12.0), 11.08); assert.equal(DI.priceOf('1.98', 12.0), null);
  assert.equal(DI.qtyOf('4.342.512'), 4342512); assert.equal(DI.qtyOf(''), null);
  const st = DI.parseStats('TAdet Yuksek Tavan AOrt TleoFyz\n28.036.367 12.13 13.34 10.67 0.00\n\nG.Hacim Dusuk Taban OGunK GunFyz\n299.056.729 9.93 10.92 1213 9.97\n');
  assert.deepEqual(st, { totalQty: 28036367, high: 12.13, ceiling: 13.34, avg: 10.67, theoPrice: 0, volume: 299056729, low: 9.93, floor: 10.92, prevClose: 12.13, dayChange: 9.97 });
});

test('depth.parseText: BOPT resim alt yazisi alis kademesi sanilmaz', () => {
  const d = D.parseText('📈 PRZMA Piyasa Derinliği\n\n12.13 TL | 🟢+9.97%');
  assert.equal(d.symbol, 'PRZMA'); assert.equal(d.last, 12.13); assert.equal(d.change, 9.97);
  assert.equal(D.hasData(d), false);
});

test('read: sahte OCR ile hucre sirasi ve tutarlilik kontrolu', async () => {
  // Her hucre icin sirayla sabit metin donduren OCR: tablo -> 4 hucre/satir (bos hucre atlanir), sonra istatistik
  const calls = [];
  const ocr = async (buf, mode) => { calls.push(mode); assert.equal(buf.readUInt32BE(0), 0x89504e47); return { text: mode === 'num' ? '12.13' : '', conf: 90 }; };
  const d = await DI.read(img, { ocr, hint: { symbol: 'PRZMA' } });
  assert.equal(d.symbol, 'PRZMA');
  assert.equal(calls.filter(m => m === 'text').length, 1);
  assert.equal(calls.filter(m => m === 'num').length, 100);
  // Tum fiyatlar ayni -> sira bozuk, hepsi elenir
  assert.equal(d.bids.length + d.asks.length, 0);
});

test('read: gercek OCR (tesseract) ile BOPT tablosu', { timeout: 120000 }, async (t) => {
  try { require.resolve('tesseract.js'); } catch (e) { t.skip('tesseract.js kurulu degil'); return; }
  try {
    const d = await DI.read(img, { hint: { symbol: 'PRZMA' } });
    assert.deepEqual(d.bids.map(b => [b.qty, b.price]), BIDS);
    assert.deepEqual(d.asks.map(b => [b.qty, b.price]), [...BIDS].reverse());
    assert.equal(d.stats.ceiling, 13.34); assert.equal(d.stats.floor, 10.92); assert.equal(d.ceiling, 13.34);
    assert.equal(D.hasData(d), true);
    const pr = D.pressure(d); assert.ok(pr);
  } finally { await DI.close(); }
});

test('read: gercek BOPT HUBVC tablosu (alis + satis dolu)', { timeout: 120000 }, async (t) => {
  try { require.resolve('tesseract.js'); } catch (e) { t.skip('tesseract.js kurulu degil'); return; }
  const im = decodePng(fs.readFileSync(path.join(__dirname, 'fixtures', 'bopt-hubvc.png')));
  try {
    const d = await DI.read(im, { hint: { symbol: 'HUBVC' } });
    assert.deepEqual(d.asks.map(b => [b.qty, b.price]), [[250, 2.33], [511, 2.34], [83389, 2.35], [143975, 2.36], [421364, 2.37], [295822, 2.38]]);
    assert.equal(d.bids.length, 25);
    assert.deepEqual(d.bids.slice(0, 3).map(b => [b.qty, b.price]), [[82490, 2.32], [25, 2.31], [540690, 2.3]]);
    assert.deepEqual(d.bids.at(-1), { price: 2.03, qty: 200, orders: null });
    assert.deepEqual(d.stats, { totalQty: 10698532, high: 2.37, ceiling: 2.55, avg: 2.21, theoPrice: 0, volume: 23690471, low: 1.96, floor: 2.09, prevClose: 2.32, dayChange: 6.91 });
    const w = D.walls(d); assert.ok(w.some(x => x.side === 'bid' && x.price === 2.3), 'alis duvari 540.690 @ 2,30');
  } finally { await DI.close(); }
});
