// Test yardimcisi: gercekci ekran sahnesi (RGBA). Mum grafigi + izgara, fiyat ekseni etiketi, son fiyat cizgisi,
// hacim paneli, ust arac cubugu (Al/Sat dugmeleri), sag izleme listesi gibi grafik disi renkli ogeler.
'use strict';
const R = require('./raster.js');
const hex = s => { const v = parseInt(s.replace('#', ''), 16); return [v >> 16, (v >> 8) & 255, v & 255]; };

// opts: W,H, plot {x0,y0,x1,y1}, body, step, up, down, bg, grid, priceLabel, priceLine, volume {h, gap, solid},
// toolbar, watchlist, hollowUp, scale (ekran goruntusunun kucultulmesi, 0-1: Retina -> dusuk cozunurluk benzetimi)
function scene(rows, opts = {}) {
  const W = opts.W || 1600, H = opts.H || 1000;
  const plot = opts.plot || { x0: 120, y0: 110, x1: 1240, y1: 760 };
  const body = opts.body || 8, step = opts.step || 12;
  const up = hex(opts.up || '#26a69a'), dn = hex(opts.down || '#ef5350'), bg = hex(opts.bg || '#131722');
  const grid = hex(opts.grid || (opts.bg === '#ffffff' ? '#e0e3eb' : '#2a2e39'));
  const buf = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { buf[i * 4] = bg[0]; buf[i * 4 + 1] = bg[1]; buf[i * 4 + 2] = bg[2]; buf[i * 4 + 3] = 255; }
  const set = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const p = (y * W + x) * 4; buf[p] = c[0]; buf[p + 1] = c[1]; buf[p + 2] = c[2]; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c); };
  const volH = opts.volume ? opts.volume.h || 110 : 0, volGap = opts.volume ? (opts.volume.gap ?? 10) : 0;
  const priceBot = plot.y1 - volH - volGap;
  // izgara
  if (opts.grid !== false) {
    for (let y = plot.y0; y <= plot.y1; y += 60) rect(plot.x0, y, plot.x1 + 70, y, grid);
    for (let x = plot.x0; x <= plot.x1; x += 90) rect(x, plot.y0, x, plot.y1, grid);
  }
  const pmax = Math.max(...rows.map(r => r.h)), pmin = Math.min(...rows.map(r => r.l));
  const py = p => Math.round(plot.y0 + (pmax - p) / (pmax - pmin) * (priceBot - plot.y0));
  const xEnd = plot.x1 - body - (opts.rightPad || 0);
  const truth = [];
  const vmax = Math.max(...rows.map(r => r.v || 1));
  rows.forEach((r, i) => {
    const x0 = xEnd - (rows.length - 1 - i) * step;
    if (x0 < plot.x0) return;
    const isUp = r.c >= r.o, col = isUp ? up : dn;
    const top = py(Math.max(r.o, r.c)), bot = py(Math.min(r.o, r.c)), hi = py(r.h), lo = py(r.l);
    const cx = x0 + (body >> 1), hollow = isUp && opts.hollowUp;
    for (let y = hi; y <= lo; y++) if (!hollow || y < top || y > bot) set(cx, y, col);
    for (let y = top; y <= bot; y++) for (let x = x0; x < x0 + body; x++) {
      if (hollow && y > top && y < bot && x > x0 && x < x0 + body - 1) continue;
      set(x, y, col);
    }
    if (opts.volume) {
      const vh = Math.max(2, Math.round((r.v || 1) / vmax * volH));
      const vc = opts.volume.solid === false ? col.map((v, k) => Math.round(v * 0.45 + bg[k] * 0.55)) : col;
      rect(x0, plot.y1 - vh, x0 + body - 1, plot.y1, vc);
    }
    truth.push({ i, x0, x1: x0 + body - 1, closeY: py(r.c), hi, lo, up: isUp });
  });
  const last = rows[rows.length - 1], lastCol = last.c >= last.o ? up : dn, ly = py(last.c);
  if (opts.priceLine) for (let x = plot.x0; x < plot.x1; x += 6) rect(x, ly, x + 2, ly, lastCol);
  if (opts.priceLabel) { // sag fiyat ekseninde son fiyat kutusu (icinde beyaz rakamlar)
    rect(plot.x1 + 4, ly - 9, plot.x1 + 66, ly + 9, lastCol);
    for (let k = 0; k < 5; k++) rect(plot.x1 + 10 + k * 11, ly - 5, plot.x1 + 16 + k * 11, ly + 5, [255, 255, 255]);
  }
  if (opts.toolbar) { // ust cubukta buyuk yesil AL ve kirmizi SAT dugmeleri
    rect(300, 20, 420, 60, up); rect(440, 20, 560, 60, dn);
  }
  if (opts.watchlist) { // sag tarafta izleme listesi: yesil/kirmizi yuzdeler (metin benzeri)
    for (let k = 0; k < 18; k++) { const c = k % 3 ? up : dn, y = 120 + k * 34;
      for (let j = 0; j < 4; j++) rect(1480 + j * 22, y, 1480 + j * 22 + 14, y + 12, c); }
  }
  return { buf, W, H, py, truth, pmin, pmax, plot };
}

// Kutu filtresiyle kucult (Retina ekrani dusuk cozunurlukte yakalamak gibi).
function downscale(im, f) {
  const W2 = Math.round(im.W * f), H2 = Math.round(im.H * f), o = new Uint8Array(W2 * H2 * 4);
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const sx0 = x / f, sx1 = (x + 1) / f, sy0 = y / f, sy1 = (y + 1) / f; let r = 0, g = 0, b = 0, n = 0;
    for (let yy = Math.floor(sy0); yy < Math.ceil(sy1); yy++) for (let xx = Math.floor(sx0); xx < Math.ceil(sx1); xx++) {
      const p = (Math.min(im.H - 1, yy) * im.W + Math.min(im.W - 1, xx)) * 4; r += im.buf[p]; g += im.buf[p + 1]; b += im.buf[p + 2]; n++; }
    const p = (y * W2 + x) * 4; o[p] = r / n; o[p + 1] = g / n; o[p + 2] = b / n; o[p + 3] = 255;
  }
  return { ...im, buf: o, W: W2, H: H2 };
}

module.exports = { scene, downscale, series: R.series };
