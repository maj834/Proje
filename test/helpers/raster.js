// Test yardimcisi: bilinen bir OHLC serisinden sentetik mum grafigi (RGBA) cizer.
// Tarayici gerekmez; fiyat -> piksel donusumu bilinir, boylece motorun ciktisi dogrulanabilir.
'use strict';

// Deterministik sozde rastgele (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rastgele yuruyus OHLC serisi: [{t,o,h,l,c,v}] eskiden yeniye.
function series(n, { seed = 1, start = 100, drift = 0.15, vol = 1.6 } = {}) {
  const r = rng(seed), rows = [];
  let c = start;
  for (let i = 0; i < n; i++) {
    const o = c;
    c = Math.max(5, o + drift + (r() - 0.5) * 2 * vol);
    // Govde en az ~0.5 birim olsun (cok kucuk govdeler piksel olarak 1 satira duser).
    if (Math.abs(c - o) < 0.5) c = o + (c >= o ? 0.5 : -0.5);
    const h = Math.max(o, c) + r() * vol * 0.8 + 0.1;
    const l = Math.min(o, c) - r() * vol * 0.8 - 0.1;
    rows.push({ t: 1700000000000 + i * 86400000, o, h, l, c, v: 1000 + Math.round(r() * 1000) });
  }
  return rows;
}

const hex = s => { const v = parseInt(s.replace('#', ''), 16); return [v >> 16, (v >> 8) & 255, v & 255]; };

// opts: W,H, plot {x0,y0,x1,y1}, body (px), step (px), up/down renkleri, bg, hollowUp.
function render(rows, opts = {}) {
  const W = opts.W || 800, H = opts.H || 500;
  const plot = opts.plot || { x0: 40, y0: 40, x1: 760, y1: 460 };
  const body = opts.body || 8, step = opts.step || 12;
  const up = hex(opts.up || '#26a69a'), dn = hex(opts.down || '#ef5350'), bg = hex(opts.bg || '#131722');
  const pmax = Math.max(...rows.map(r => r.h)), pmin = Math.min(...rows.map(r => r.l));
  const py = p => Math.round(plot.y0 + (pmax - p) / (pmax - pmin) * (plot.y1 - plot.y0));
  const buf = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { buf[i * 4] = bg[0]; buf[i * 4 + 1] = bg[1]; buf[i * 4 + 2] = bg[2]; buf[i * 4 + 3] = 255; }
  const set = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const p = (y * W + x) * 4; buf[p] = c[0]; buf[p + 1] = c[1]; buf[p + 2] = c[2]; };
  // Seri sag kenara hizali cizilir (TradingView gibi).
  const xEnd = plot.x1 - body;
  const truth = [];
  rows.forEach((r, i) => {
    const x0 = xEnd - (rows.length - 1 - i) * step;
    if (x0 < plot.x0) return;
    const isUp = r.c >= r.o, col = isUp ? up : dn;
    const top = py(Math.max(r.o, r.c)), bot = py(Math.min(r.o, r.c)), hi = py(r.h), lo = py(r.l);
    const cx = x0 + (body >> 1);
    const hollow = isUp && opts.hollowUp;
    // Fitil: icini bos govdede yalniz govde disinda.
    for (let y = hi; y <= lo; y++) if (!hollow || y < top || y > bot) set(cx, y, col);
    for (let y = top; y <= bot; y++) for (let x = x0; x < x0 + body; x++) {
      if (hollow && y > top && y < bot && x > x0 && x < x0 + body - 1) continue;
      set(x, y, col);
    }
    truth.push({ i, x0, x1: x0 + body - 1, closeY: py(r.c), hi, lo, up: isUp });
  });
  return { buf, W, H, py, truth, pmin, pmax };
}

// RGBA -> BGRA (Electron'un toBitmap cikti bicimi).
function toBGRA(buf) {
  const o = Buffer.from(buf);
  for (let p = 0; p < o.length; p += 4) { const r = o[p]; o[p] = o[p + 2]; o[p + 2] = r; }
  return o;
}

module.exports = { rng, series, render, toBGRA };
