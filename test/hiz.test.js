'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const H = require('../hiz.js');
const { registerHiz } = require('../hiz-main.js');

// --- yerel sahte Cloudflare sunucusu ---------------------------------------------------------
// o.rate: akis basina bayt/sn (yok = sinirsiz), o.stall: indirme hic veri gondermez
function server(t, o = {}) {
  const st = { down: 0, up: 0, reqs: 0, pings: 0 };
  const srv = http.createServer((req, res) => {
    st.reqs++;
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/meta') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ colo: 'IST', city: 'Istanbul', country: 'TR', asOrganization: 'Ornek ISS', clientIp: '1.2.3.4' })); }
    if (u.pathname === '/__down') {
      let n = Math.max(0, +u.searchParams.get('bytes') || 0);
      if (!n) st.pings++;
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': n, 'cf-meta-colo': 'IST' });
      if (o.stall && n) return; // hic veri gelmez (iptal testi)
      const chunk = Buffer.alloc(64 * 1024);
      const step = () => {
        while (n > 0) {
          const c = Math.min(n, chunk.length); n -= c; st.down += c;
          const more = res.write(chunk.subarray(0, c));
          if (o.rate) return setTimeout(step, c / o.rate * 1000);
          if (!more) return res.once('drain', step);
        }
        res.end();
      };
      res.on('close', () => { n = 0; });
      return step();
    }
    if (u.pathname === '/__up' && req.method === 'POST') {
      req.on('data', c => { st.up += c.length; });
      req.on('end', () => { res.writeHead(200); res.end(); });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => {
    t.after(() => { srv.closeAllConnections(); srv.close(); });
    ok({ base: 'http://127.0.0.1:' + srv.address().port, st });
  }));
}

// --- olcu hesaplari ------------------------------------------------------------------------
test('mbps, yuzdelik, medyan ve jitter', () => {
  assert.equal(H.mbps(1e6, 1000), 8);                 // 1 MB/sn = 8 Mbit/sn
  assert.equal(H.mbps(12.5e6, 1000), 100);
  assert.equal(H.mbps(5, 0), 0);
  assert.equal(H.percentile([], 90), null);
  assert.equal(H.percentile([5], 90), 5);
  assert.equal(H.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9.1);
  assert.equal(H.percentile([10, 1, 5], 50), 5);
  assert.equal(H.median([4, 1, 3, 2]), 2.5);
  assert.equal(H.jitter([10, 12, 10, 16]), (2 + 2 + 6) / 3);
  assert.equal(H.jitter([5]), null);
});

test('windowRates / throughput: kayan 1 sn pencereler, 90. yuzdelik; kisa olcumde ortalama', () => {
  // 0-1 sn: 1 MB, 1-2 sn: 2 MB, 2-3 sn: 10 MB (yalnizca tam saniye ornekleri)
  const s = [{ t: 0, b: 0 }, { t: 1000, b: 1e6 }, { t: 2000, b: 3e6 }, { t: 3000, b: 13e6 }];
  assert.deepEqual(H.windowRates(s), [8, 16, 80]);
  assert.equal(H.throughput(s), H.percentile([8, 16, 80], 90));
  assert.equal(H.throughput([{ t: 0, b: 0 }, { t: 500, b: 1e6 }]), 16);
  assert.equal(H.throughput([{ t: 0, b: 0 }]), null);
});

test('verdict: esik degerleri ve notlar', () => {
  assert.equal(H.verdict({ down: 300, up: 50, ping: 10, jitter: 2 }).level, 'cok-iyi');
  assert.match(H.verdict({ down: 300, up: 50, ping: 10, jitter: 2 }).text, /4K video/);
  assert.equal(H.verdict({ down: 50, up: 10, ping: 30, jitter: 5 }).level, 'iyi');
  assert.equal(H.verdict({ down: 100, up: 9, ping: 30, jitter: 5 }).level, 'iyi');
  assert.equal(H.verdict({ down: 15, up: 3, ping: 80, jitter: 5 }).level, 'orta');
  assert.equal(H.verdict({ down: 5, up: 1, ping: 50, jitter: 5 }).level, 'zayif');
  assert.match(H.verdict({ down: 5, up: 1, ping: 50, jitter: 5 }).text, /Görüntülü görüşme takılabilir/);
  assert.equal(H.verdict({ down: 1, up: 0.5, ping: 50 }).level, 'cok-zayif');
  assert.equal(H.verdict({ down: 200, up: 50, ping: 150, jitter: 5 }).level, 'zayif');
  const v = H.verdict({ down: 200, up: 50, ping: 10, jitter: 40, loaded: 180 });
  assert.equal(v.notes.length, 2);
  assert.equal(H.verdict({ down: 50, up: null, ping: 20, jitter: 1 }).level, 'iyi'); // yukleme olculemediyse yalniz indirmeye bakilir
  assert.equal(H.fmtMbps(94.4), '94'); assert.equal(H.fmtMbps(9.44), '9,4'); assert.equal(H.fmtMbps(1234), '1.234');
});

test('historyItem / pushHistory: yalniz bilinen alanlar, IP yok, en fazla 50', () => {
  const it = H.historyItem({ at: 5, down: 94.44, up: 10.06, ping: 12.34, jitter: 1, loaded: 50, isp: 'X', city: 'Y', colo: 'IST', clientIp: '1.2.3.4', extra: 1 });
  assert.deepEqual(it, { at: 5, down: 94.4, up: 10.1, ping: 12.3, jitter: 1, loaded: 50, isp: 'X', city: 'Y', colo: 'IST', country: null, level: 'iyi' });
  let h = []; for (let i = 0; i < 60; i++) h = H.pushHistory(h, { at: i });
  assert.equal(h.length, 50); assert.equal(h[0].at, 10);
  assert.deepEqual(H.pushHistory('bozuk', { at: 1 }), [{ at: 1 }]);
});

// --- Wi-Fi ---------------------------------------------------------------------------------
test('WIFI metni: \\ ; , : " kacisi, sifresiz ve gizli ag', () => {
  assert.equal(H.escWifi('a\\b;c,d:e"f'), 'a\\\\b\\;c\\,d\\:e\\"f');
  assert.equal(H.wifiString({ ssid: 'Ev Ağı', pass: 'gizli;sifre' }), 'WIFI:T:WPA;S:Ev Ağı;P:gizli\\;sifre;;');
  assert.equal(H.wifiString({ ssid: 'Kafe:1', open: true, pass: 'yok' }), 'WIFI:T:nopass;S:Kafe\\:1;;');
  assert.equal(H.wifiString({ ssid: 'X', pass: '12345678', hidden: true }), 'WIFI:T:WPA;S:X;P:12345678;H:true;;');
  assert.throws(() => H.wifiString({ ssid: '' }));
  assert.equal(H.validSsid('a'.repeat(32)), true); assert.equal(H.validSsid('ğ'.repeat(17)), false);
  assert.equal(H.validSsid('a\nb'), false); assert.equal(H.validSsid(''), false);
});

const IPCONFIG = `<dictionary> {
  BSSID : 12:34:56:78:9a:bc
  IPv4 : <array> {
    0 : <dictionary> {
      Addresses : <array> {
        0 : 192.168.1.20
      }
    }
  }
  InterfaceType : WiFi
  SSID : Ev Ağı 5G
  Security : WPA2_PSK
}`;
test('SSID ayristirma: ipconfig, networksetup, gizlenmis (redacted), donanim portlari', () => {
  assert.deepEqual(H.parseIpconfig(IPCONFIG), { ssid: 'Ev Ağı 5G', redacted: false });
  assert.deepEqual(H.parseIpconfig(IPCONFIG.replace('Ev Ağı 5G', '<redacted>')), { ssid: null, redacted: true });
  assert.deepEqual(H.parseIpconfig('<dictionary> {\n  InterfaceType : WiFi\n}'), { ssid: null, redacted: false });
  assert.deepEqual(H.parseAirport('Current Wi-Fi Network: Kafe : Misafir\n'), { ssid: 'Kafe : Misafir', redacted: false });
  assert.deepEqual(H.parseAirport('You are not associated with an AirPort network.\n'), { ssid: null, redacted: false });
  assert.deepEqual(H.parseAirport('Current Wi-Fi Network: <redacted>\n'), { ssid: null, redacted: true });
  const ports = 'Hardware Port: Ethernet\nDevice: en0\nEthernet Address: aa\n\nHardware Port: Wi-Fi\nDevice: en1\nEthernet Address: bb\n\nHardware Port: Thunderbolt Bridge\nDevice: bridge0\n';
  assert.deepEqual(H.parsePorts(ports), ['en1']);
});

test('currentSsid: once en0 ipconfig, sonra networksetup, sonra diger Wi-Fi aygitlari', async () => {
  const calls = [];
  const exec = async (f, a) => { calls.push([f, ...a]);
    if (f.endsWith('ipconfig') && a[1] === 'en0') return IPCONFIG.replace('Ev Ağı 5G', '<redacted>');
    if (f.endsWith('networksetup') && a[0] === '-getairportnetwork') return 'You are not associated with an AirPort network.\n';
    if (a[0] === '-listallhardwareports') return 'Hardware Port: Wi-Fi\nDevice: en0\n\nHardware Port: Wi-Fi 2\nDevice: en7\n';
    if (f.endsWith('ipconfig') && a[1] === 'en7') return IPCONFIG;
    throw new Error('x'); };
  assert.deepEqual(await H.currentSsid(exec), { ssid: 'Ev Ağı 5G', redacted: false, device: 'en7' });
  assert.deepEqual(calls[0], ['/usr/sbin/ipconfig', 'getsummary', 'en0']);
  assert.deepEqual(calls[1], ['/usr/sbin/networksetup', '-getairportnetwork', 'en0']);
  // hepsi gizli -> redacted
  const r = await H.currentSsid(async (f, a) => (a[0] === '-listallhardwareports' ? '' : f.endsWith('ipconfig') ? '  SSID : <redacted>\n' : ''));
  assert.deepEqual(r, { ssid: null, redacted: true });
});

test('wifiPassword: kabuksuz arguman dizisi, 60 sn, hata esleme', async () => {
  let got;
  const pass = await H.wifiPassword(async (f, a, o) => { got = [f, a, o]; return 'p@ss; "x"\n'; }, 'Ev; rm -rf ~');
  assert.equal(pass, 'p@ss; "x"');
  assert.deepEqual(got, ['/usr/bin/security', ['find-generic-password', '-D', 'AirPort network password', '-a', 'Ev; rm -rf ~', '-w'], { timeout: 60000 }]);
  await assert.rejects(H.wifiPassword(async () => { throw Object.assign(new Error('x'), { code: 44 }); }, 'A'), { code: 'NOTFOUND' });
  await assert.rejects(H.wifiPassword(async () => { throw Object.assign(new Error('x'), { code: 128, stderr: 'User canceled the operation.' }); }, 'A'), { code: 'DENIED' });
  await assert.rejects(H.wifiPassword(async () => { throw Object.assign(new Error('x'), { killed: true, signal: 'SIGTERM' }); }, 'A'), { code: 'TIMEOUT' });
  await assert.rejects(H.wifiPassword(async () => 'x', 'a\u0000b'), { code: 'BAD' });
});

// --- hiz testi (yerel sunucu) --------------------------------------------------------------
test('runTest: yerel sunucuda indirme, yukleme, ping, konum; ilerleme en fazla 10/sn', async (t) => {
  const { base, st } = await server(t, { rate: 4e6 });   // akis basina 4 MB/sn
  const ev = [];
  const r = await H.runTest({ base, dlMs: 2500, ulMs: 1500, pingCount: 6, onProgress: p => ev.push({ ...p, at: performance.now() }) });
  assert.equal(r.ok, true);
  assert.ok(r.down > 30 && r.down < 1000, 'indirme ' + r.down);  // 5 akis x 32 Mbit/sn civari
  assert.ok(r.up > 0, 'yukleme ' + r.up);
  assert.ok(r.ping != null && r.ping >= 0 && r.jitter != null);
  assert.ok(r.loaded != null, 'yuklu gecikme olculur');
  assert.equal(r.isp, 'Ornek ISS'); assert.equal(r.city, 'Istanbul'); assert.equal(r.colo, 'IST');
  assert.equal(r.clientIp, undefined);
  assert.ok(st.pings >= 6);
  assert.ok(r.bytes > 0 && r.bytes <= st.down + st.up);
  assert.ok(r.verdict && r.verdict.text);
  assert.deepEqual([...new Set(ev.map(e => e.phase))], ['ping', 'down', 'up', 'done']);
  // zorunlu (asama) olaylari disinda 100 ms'den sik ilerleme yok
  const forced = new Set(['done']);
  for (let i = 1; i < ev.length; i++) if (ev[i].phase === ev[i - 1].phase && !forced.has(ev[i].phase)) assert.ok(ev[i].at - ev[i - 1].at >= 95, 'sik olay');
});

test('runTest: iptal tum istekleri hemen keser', async (t) => {
  const { base } = await server(t, { stall: true });
  const ac = new AbortController();
  const p = H.runTest({ base, signal: ac.signal, pingCount: 2, dlMs: 20000 });
  await new Promise(r => setTimeout(r, 400));
  const t0 = Date.now(); ac.abort();
  await assert.rejects(p, { code: 'CANCELLED' });
  assert.ok(Date.now() - t0 < 500, 'iptal ' + (Date.now() - t0) + ' ms');
  const pre = new AbortController(); pre.abort();
  await assert.rejects(H.runTest({ base, signal: pre.signal }), { code: 'CANCELLED' });
});

test('runTest: bayt siniri asilmaz, indirme en fazla %70', async (t) => {
  const { base, st } = await server(t);
  const r = await H.runTest({ base, maxBytes: 3e6, dlMs: 3000, ulMs: 2000, pingCount: 2, uploadBuffer: Buffer.alloc(1e7) });
  assert.ok(r.bytes <= 3e6, 'toplam ' + r.bytes);
  assert.ok(st.down <= 3e6 * 0.7, 'indirme ' + st.down);
  assert.ok(st.up <= 3e6, 'yukleme ' + st.up);
  assert.equal(r.capped, true); assert.equal(r.partial, true);
});

test('runTest: sure siniri (maxMs) asilmaz, olculen kadariyla sonuc', async (t) => {
  const { base } = await server(t, { rate: 2e5 });
  const t0 = Date.now();
  const r = await H.runTest({ base, maxMs: 1500, dlMs: 9000, ulMs: 8000, pingCount: 3 });
  assert.ok(Date.now() - t0 < 2300, 'sure ' + (Date.now() - t0));
  assert.equal(r.partial, true);
  assert.ok(r.ping != null);
  // ust sinir disaridan buyutulemez
  assert.equal(H.LIMITS.maxMs, 30000); assert.equal(H.LIMITS.maxBytes, 400e6);
});

test('runTest: sunucuya ulasilamazsa anlasilir hata', async () => {
  const srv = http.createServer(); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port; await new Promise(r => srv.close(r));
  await assert.rejects(H.runTest({ base: 'http://127.0.0.1:' + port, pingCount: 3 }), { code: 'NET' });
  // sahte fetch de verilebilir
  await assert.rejects(H.runTest({ fetch: async () => { throw new TypeError('fetch failed'); }, pingCount: 3 }), { code: 'NET' });
});

// --- registerHiz (sahte Electron) ----------------------------------------------------------
function fakeElectron(conf = {}) {
  const handlers = {}, sent = [], winEv = {}; let quit, closed = false;
  const wc = { send: (ch, d) => sent.push([ch, d]), setWindowOpenHandler() {}, on() {} };
  function Win(o) { this.opts = o; return { webContents: wc, loadFile() {}, once() {}, isDestroyed: () => closed, isMinimized: () => false, show() {}, focus() {},
    close() { closed = true; winEv.closed && winEv.closed(); }, on(e, f) { winEv[e] = f; } }; }
  const store = { c: conf };
  const deps = { ipcMain: { handle: (c, f) => { handlers[c] = f; } }, app: { on: (e, f) => { if (e === 'will-quit') quit = f; } },
    BrowserWindow: Win, path, cfg: () => store.c, save: o => { store.c = { ...store.c, ...o }; } };
  return { deps, handlers, sent, wc, store, quit: () => quit && quit() };
}

test('registerHiz: gonderen kontrolu, test + gecmis, durum yazisi, QR, SSID ve sifre', async (t) => {
  const { base } = await server(t, { rate: 4e6 });
  const fe = fakeElectron();
  const exec = async (f, a) => (f.endsWith('ipconfig') ? '  SSID : Ev\n' : f.endsWith('security') ? 'sifre123\n' : '');
  const ui = registerHiz({ ...fe.deps, isOn: () => true, base, exec, testOpts: { dlMs: 1200, ulMs: 1000, pingCount: 3 } });
  assert.deepEqual(Object.keys(ui).sort(), ['disable', 'enable', 'open', 'run', 'status']);
  assert.equal(ui.status(), null);
  const bad = { sender: {} }, ok = { sender: fe.wc };
  // pencere yokken / baska pencereden gelen istekler reddedilir
  for (const ch of ['hiz:state', 'hiz:start', 'hiz:clear', 'hiz:ssid', 'hiz:pass', 'hiz:qr']) assert.equal(await fe.handlers[ch](ok, 'x'), null, ch);
  ui.open();
  for (const ch of ['hiz:state', 'hiz:start', 'hiz:clear', 'hiz:ssid', 'hiz:pass', 'hiz:qr']) assert.equal(await fe.handlers[ch](bad, 'x'), null, ch);
  assert.deepEqual(await fe.handlers['hiz:state'](ok), { history: [], running: false, wifi: true });

  const p = fe.handlers['hiz:start'](ok);
  assert.equal(ui.status(), 'Test sürüyor…');
  assert.deepEqual(await fe.handlers['hiz:start'](ok), { ok: false, error: 'Test zaten sürüyor.' });
  const r = await p;
  assert.equal(r.ok, true); assert.equal(r.history.length, 1);
  assert.equal(fe.store.c.hiz.history.length, 1);
  assert.match(ui.status(), /^Son test: ↓ [\d.,]+ Mb\/sn$/);
  assert.ok(fe.sent.some(([ch, d]) => ch === 'hiz:evt' && d.phase === 'down'));

  assert.deepEqual(await fe.handlers['hiz:ssid'](ok), { ok: true, ssid: 'Ev' });
  assert.deepEqual(await fe.handlers['hiz:pass'](ok, 'Ev'), { ok: true, pass: 'sifre123' });
  const q = await fe.handlers['hiz:qr'](ok, { ssid: 'Ev', pass: 'sifre123' });
  assert.equal(q.ok, true); assert.match(q.url, /^data:image\/png;base64,/);
  assert.equal((await fe.handlers['hiz:qr'](ok, { ssid: 'Ev', pass: 'kisa' })).ok, false);
  assert.equal((await fe.handlers['hiz:qr'](ok, { ssid: 'Ev', open: true })).ok, true);
  assert.equal((await fe.handlers['hiz:qr'](ok, { ssid: '' , open: true })).ok, false);
  assert.equal((await fe.handlers['hiz:qr'](ok, null)).ok, false);
  // sifre hicbir yere kaydedilmez
  assert.ok(!JSON.stringify(fe.store.c).includes('sifre123'));

  assert.deepEqual((await fe.handlers['hiz:clear'](ok)).history, []);
  assert.equal(ui.status(), null);
  ui.disable();
  assert.equal(await fe.handlers['hiz:state'](ok), null);   // pencere kapandi
});

test('registerHiz: pencere kapaninca suren test iptal edilir; modul kapaliyken acilmaz', async (t) => {
  const { base } = await server(t, { stall: true });
  const fe = fakeElectron(); let on = false;
  const ui = registerHiz({ ...fe.deps, isOn: () => on, base, exec: async () => '', testOpts: { pingCount: 2, dlMs: 20000 } });
  ui.open(); assert.equal(await fe.handlers['hiz:state']({ sender: fe.wc }), null);   // kapali modul: pencere yok
  on = true; ui.open();
  const p = fe.handlers['hiz:start']({ sender: fe.wc });
  await new Promise(r => setTimeout(r, 300));
  const t0 = Date.now(); ui.disable();
  const r = await p;
  assert.equal(r.cancelled, true); assert.ok(Date.now() - t0 < 500);
  assert.equal(fe.store.c.hiz, undefined);   // iptal edilen test gecmise yazilmaz
  // Mac disinda (exec verilmemis) Wi-Fi otomatik bulunamaz
  if (process.platform !== 'darwin') {
    const fe2 = fakeElectron(); const ui2 = registerHiz({ ...fe2.deps });
    ui2.open(); const s = await fe2.handlers['hiz:ssid']({ sender: fe2.wc });
    assert.equal(s.ok, false); ui2.disable();
  }
});
