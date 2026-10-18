'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto'), net = require('net'), vm = require('vm');
const { tmpDir } = require('./helpers/util.js');
const { createShare, safeName, human, sweepParts, PART } = require('../share.js');

function req(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((ok, no) => {
    const r = http.request(url, { method, headers }, res => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(ch) })); });
    r.on('error', no); if (body) r.write(body); r.end();
  });
}

async function setup(t, ask = async () => true, o = {}) {
  const dir = tmpDir(), dl = path.join(dir, 'dl'); fs.mkdirSync(dl);
  const events = [];
  const S = createShare({ downloadsDir: dl, host: '127.0.0.1', ask, onEvent: e => events.push(e), ...o });
  t.after(() => { S.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const info = await S.start();
  return { S, dir, dl, info, events };
}

const ask = (info, files) => req(info.url + 'ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files }) });
const up = (info, t, name, b, size = b.length, headers = { 'content-length': b.length }) =>
  req(info.url + 'up?t=' + encodeURIComponent(t) + '&size=' + size + '&name=' + encodeURIComponent(name), { method: 'POST', headers, body: b });
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Ham HTTP: yaniti ilk satirina kadar oku
function raw(url, data, { wait = 0 } = {}) {
  const u = new URL(url);
  return new Promise((ok, no) => {
    const s = net.connect(u.port, u.hostname, () => s.write(data)); let b = '';
    s.on('data', d => { b += d; }); s.on('error', no); s.on('close', () => ok(b));
    if (wait) setTimeout(() => s.end(), wait);
  });
}

test('safeName ve human', () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('..\\..\\x.txt'), 'x.txt');
  assert.equal(safeName('.ssh'), 'ssh');
  assert.equal(safeName('a<b>:c?.jpg'), 'a_b__c_.jpg');
  assert.equal(safeName(''), 'dosya');
  assert.ok(safeName('x'.repeat(300) + '.mp4').endsWith('.mp4'));
  assert.ok(Buffer.byteLength(safeName('x'.repeat(300) + '.mp4')) <= 200);
  assert.equal(human(1536), '2 KB'); assert.equal(human(5 * 1024 ** 3), '5.0 GB');
});

test('safeName: yon/bicim karakterleri silinir, sinir bayt cinsinden (F11)', () => {
  assert.equal(safeName('Invoice‮gpj.command'), 'Invoicegpj.command');
  assert.equal(safeName('a​b⁦c﻿.txt'), 'abc.txt');
  assert.equal(safeName('a\u0085b.txt'), 'a_b.txt');
  const n = safeName('Ş'.repeat(170) + '.jpg');
  assert.ok(Buffer.byteLength(n) <= 200, Buffer.byteLength(n) + ' bayt'); assert.ok(n.endsWith('.jpg'));
  assert.ok(!/�/.test(n));
  assert.ok(Buffer.byteLength(safeName('😀'.repeat(100))) <= 200);
});

test('anahtarsiz ya da yanlis anahtarla erisim yok', async (t) => {
  const { info } = await setup(t);
  const base = info.url.replace(/s\/[^/]+\/$/, '');
  assert.equal((await req(base)).status, 404);
  assert.equal((await req(base + 's/yanlis/')).status, 404);
  assert.equal((await req(base + 's/' + 'A'.repeat(24) + '/')).status, 404);
  const ok = await req(info.url);
  assert.equal(ok.status, 200);
  assert.match(ok.headers['content-security-policy'], /default-src 'none'/);
});

test('Mac\'ten telefona: liste, tam indirme, Range ile kismi indirme, Turkce dosya adi', async (t) => {
  const { S, dir, info } = await setup(t);
  const p = path.join(dir, 'Çalışma ğüş.bin'), data = crypto.randomBytes(300000);
  fs.writeFileSync(p, data);
  const [f] = S.add([p, path.join(dir, 'yok.txt'), dir]);
  assert.equal(S.info().files.length, 1, 'olmayan dosya ve klasor eklenmez');
  const page = (await req(info.url)).body.toString();
  assert.match(page, /Çalışma ğüş\.bin/); assert.match(page, new RegExp('f/' + f.id));
  const full = await req(info.url + 'f/' + f.id);
  assert.equal(full.status, 200); assert.ok(full.body.equals(data));
  assert.match(full.headers['content-disposition'], /filename\*=UTF-8''%C3%87al%C4%B1%C5%9Fma/);
  const part = await req(info.url + 'f/' + f.id, { headers: { range: 'bytes=1000-1999' } });
  assert.equal(part.status, 206); assert.equal(part.body.length, 1000); assert.ok(part.body.equals(data.subarray(1000, 2000)));
  assert.equal(part.headers['content-range'], 'bytes 1000-1999/300000');
  assert.equal((await req(info.url + 'f/' + f.id, { headers: { range: 'bytes=999999-' } })).status, 416);
  assert.equal((await req(info.url + 'f/deadbeef')).status, 404);
  assert.deepEqual(JSON.parse((await req(info.url + 'list')).body), [{ id: f.id, name: 'Çalışma ğüş.bin', size: 300000 }]);
  S.remove(f.id); assert.equal((await req(info.url + 'f/' + f.id)).status, 404);
});

test('telefondan Mac\'e: onaysiz yuklenemez, onayla yuklenir, ad cakismasi ve yol saldirisi', async (t) => {
  let asked = 0;
  const { info, dl, events, S } = await setup(t, async (x) => { asked++; assert.equal(x.count, 3); assert.deepEqual(x.names, ['a.txt', 'a.txt', 'video.mov']); return true; });
  const noAsk = await req(info.url + 'up?name=a.txt&size=1', { method: 'POST', body: 'x' });
  assert.equal(noAsk.status, 403);
  const big = crypto.randomBytes(2 * 1024 * 1024);
  const a = await ask(info, [{ name: '../../a.txt', size: 5 }, { name: 'a.txt', size: 6 }, { name: 'video.mov', size: big.length }]);
  assert.equal(a.status, 200); assert.equal(asked, 1);
  const { ticket } = JSON.parse(a.body); assert.ok(ticket && ticket.length >= 20);
  for (const [n, b] of [['../../a.txt', Buffer.from('hello')], ['a.txt', Buffer.from('ikinci')], ['video.mov', big]]) {
    const r = await up(info, ticket, n, b);
    assert.equal(r.status, 200, n);
  }
  assert.deepEqual(fs.readdirSync(dl).sort(), ['a (2).txt', 'a.txt', 'video.mov']);
  assert.equal(fs.readFileSync(path.join(dl, 'a.txt'), 'utf8'), 'hello');
  assert.ok(fs.readFileSync(path.join(dl, 'video.mov')).equals(big));
  assert.equal(S.info().received.length, 3);
  assert.ok(events.some(e => e.type === 'received' && e.name === 'video.mov'));
  // bilet tukendi: ayni dosya bir daha yuklenemez
  assert.equal((await up(info, ticket, 'video.mov', big)).status, 403);
  // yeni toplu gonderim yeniden sorulur
  await ask(info, [{ name: 'c', size: 1 }]);
  assert.equal(asked, 2);
});

test('onay bileti: yalnizca beyan edilen ad/boyut, bir kez, Content-Length zorunlu (F4)', async (t) => {
  const asked = [];
  const { info, dl } = await setup(t, async (x) => { asked.push(x); return true; });
  // negatif / gecersiz boyut onaya gitmez
  assert.equal((await ask(info, [{ name: 'tatil.jpg', size: -1e15 }])).status, 400);
  assert.equal((await ask(info, [{ name: 'tatil.jpg', size: 'x' }])).status, 400);
  assert.equal((await ask(info, [{ name: 'tatil.jpg', size: 1.5 }])).status, 400);
  assert.equal((await ask(info, Array.from({ length: 501 }, (_, i) => ({ name: 'f' + i, size: 1 })))).status, 400);
  assert.equal(asked.length, 0);
  const { ticket } = JSON.parse((await ask(info, [{ name: 'tatil.jpg', size: 4 }])).body);
  assert.equal(asked.length, 1);
  assert.equal((await up(info, 'yanlis', 'tatil.jpg', Buffer.from('abcd'))).status, 403, 'gecersiz bilet');
  assert.equal((await up(info, ticket, 'Invoice.command', Buffer.from('abcd'))).status, 403, 'beyan edilmeyen ad');
  assert.equal((await up(info, ticket, 'tatil.jpg', Buffer.from('abcdef'))).status, 403, 'beyandan farkli boyut');
  assert.equal((await up(info, ticket, 'tatil.jpg', Buffer.from('abcdef'), 4)).status, 400, 'Content-Length beyanla uyusmuyor');
  assert.equal((await up(info, ticket, 'tatil.jpg', Buffer.from('abcd'), 4, { 'transfer-encoding': 'chunked' })).status, 400, 'chunked reddedilir');
  assert.deepEqual(fs.readdirSync(dl), [], 'reddedilen denemeler bileti tuketmez, dosya yazmaz');
  assert.equal((await up(info, ticket, 'tatil.jpg', Buffer.from('abcd'))).status, 200);
  assert.equal((await up(info, ticket, 'tatil.jpg', Buffer.from('abcd'))).status, 403, 'her giris bir kez');
  assert.deepEqual(fs.readdirSync(dl), ['tatil.jpg']);
});

test('ayni IP icin bekleyen onay varken ikinci soru acilmaz', async (t) => {
  let release; const { info } = await setup(t, () => new Promise(r => { release = r; }));
  const p1 = ask(info, [{ name: 'a', size: 1 }]);
  await sleep(100);
  assert.equal((await ask(info, [{ name: 'b', size: 1 }])).status, 429);
  release(true); assert.equal((await p1).status, 200);
});

test('bozuk istek adresi sureci cokertmez, 400 doner (F1)', async (t) => {
  const { info } = await setup(t);
  for (const line of ['GET http://[x HTTP/1.1', 'GET http://a:99999/ HTTP/1.1', 'GET http://%zz/ HTTP/1.1']) {
    const r = await raw(info.url, line + '\r\nHost: a\r\nConnection: close\r\n\r\n');
    assert.match(r, /^HTTP\/1\.1 400/, line);
  }
  assert.equal((await req(info.url)).status, 200, 'sunucu hala calisiyor');
});

test('yukleme bitince kullanicinin o arada olusturdugu ayni adli dosyanin ustune yazmaz (F2)', async (t) => {
  const { info, dl, S } = await setup(t);
  const { ticket } = JSON.parse((await ask(info, [{ name: 'rapor.pdf', size: 10 }])).body);
  const r = http.request(info.url + 'up?t=' + ticket + '&size=10&name=rapor.pdf', { method: 'POST', headers: { 'content-length': 10 } });
  const done = new Promise(ok => r.on('response', res => { res.resume(); res.on('end', () => ok(res.statusCode)); }));
  r.write('PHONE'); await sleep(150);
  fs.writeFileSync(path.join(dl, 'rapor.pdf'), 'USER-IMPORTANT-DATA');
  r.end('DATA!'); assert.equal(await done, 200);
  assert.equal(fs.readFileSync(path.join(dl, 'rapor.pdf'), 'utf8'), 'USER-IMPORTANT-DATA');
  assert.equal(fs.readFileSync(path.join(dl, 'rapor (2).pdf'), 'utf8'), 'PHONEDATA!');
  assert.equal(S.info().received[0].name, 'rapor (2).pdf');
  assert.deepEqual(fs.readdirSync(dl).sort(), ['rapor (2).pdf', 'rapor.pdf']);
});

test('ayni adli es zamanli yuklemeler birbirinin yarim dosyasini silmez (F3)', async (t) => {
  const { info, dl } = await setup(t);
  const N = 8;
  const { ticket } = JSON.parse((await ask(info, Array.from({ length: 2 * N }, (_, k) => ({ name: 'f' + (k >> 1) + '.bin', size: 4 })))).body);
  const u = new URL(info.url);
  for (let k = 0; k < N; k++) {
    const head = `POST ${u.pathname}up?t=${ticket}&size=4&name=f${k}.bin HTTP/1.1\r\nHost: a\r\nContent-Length: 4\r\nConnection: close\r\n\r\nAB`;
    const ss = await Promise.all([0, 1].map(() => new Promise(ok => { const s = net.connect(u.port, '127.0.0.1', () => ok(s)); })));
    const res = ss.map(s => new Promise(ok => { let b = ''; s.on('data', d => { b += d; }); s.on('close', () => ok(b.split('\r\n')[0])); }));
    ss.forEach(s => s.write(head));
    await sleep(30); ss.forEach(s => s.write('CD'));
    const r = await Promise.all(res);
    assert.ok(r.every(x => /200/.test(x)), 'tur ' + k + ': ' + r);
    assert.deepEqual(fs.readdirSync(dl).filter(f => f.startsWith('f' + k + ' ') || f.startsWith('f' + k + '.')).sort(), [`f${k} (2).bin`, `f${k}.bin`]);
  }
  assert.ok(!fs.readdirSync(dl).some(f => f.endsWith(PART)));
});

test('telefona yerel yol ya da sistem hatasi gitmez (F11)', async (t) => {
  const { info, dl, events } = await setup(t);
  const { ticket } = JSON.parse((await ask(info, [{ name: 'a.txt', size: 3 }])).body);
  fs.rmSync(dl, { recursive: true });
  const r = await up(info, ticket, 'a.txt', Buffer.from('abc'));
  assert.equal(r.status, 500);
  assert.equal(r.body.toString(), 'Dosya kaydedilemedi.');
  assert.ok(events.some(e => e.type === 'upload-fail'));
});

test('acilista yalnizca bu uygulamanin eski yarim dosyalari silinir (F11)', async (t) => {
  const dir = tmpDir(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const old = Date.now() / 1000 - 2 * 3600;
  for (const n of ['eski.mov' + PART, 'yeni.mov' + PART, 'safari.part', 'film.mov']) fs.writeFileSync(path.join(dir, n), 'x');
  for (const n of ['eski.mov' + PART, 'safari.part', 'film.mov']) fs.utimesSync(path.join(dir, n), old, old);
  fs.mkdirSync(path.join(dir, 'klasor' + PART)); fs.utimesSync(path.join(dir, 'klasor' + PART), old, old);
  const S = createShare({ downloadsDir: dir, host: '127.0.0.1' }); t.after(() => S.stop());
  await S.start();
  assert.deepEqual(fs.readdirSync(dir).sort(), ['film.mov', 'klasor' + PART, 'safari.part', 'yeni.mov' + PART].sort());
  assert.equal(sweepParts(dir), 0);
});

test('kapatinca suren yuklemenin yarim dosyasi hemen silinir', async (t) => {
  const { info, dl, S } = await setup(t);
  const { ticket } = JSON.parse((await ask(info, [{ name: 'movie.mp4', size: 1e9 }])).body);
  const r = http.request(info.url + 'up?t=' + ticket + '&size=1000000000&name=movie.mp4', { method: 'POST', headers: { 'content-length': 1e9 } }); r.on('error', () => {});
  r.write(Buffer.alloc(1 << 20)); await sleep(200);
  assert.deepEqual(fs.readdirSync(dl), ['movie.mp4' + PART]);
  S.stop('quit');
  assert.deepEqual(fs.readdirSync(dl), []);
});

test('takilan indirme oturumu sonsuza dek acik tutamaz: bosta kalan soket kapanir, mutlak sure siniri (F5)', async (t) => {
  const { S, dir, info, events } = await setup(t, undefined, { ttl: 200, idle: 300 });
  const src = path.join(dir, 'big'); fs.writeFileSync(src, Buffer.alloc(32 * 1024 * 1024));
  const [f] = S.add([src]); const u = new URL(info.url);
  const s = net.connect(u.port, '127.0.0.1', () => s.write(`GET ${u.pathname}f/${f.id} HTTP/1.1\r\nHost: a\r\n\r\n`)); s.pause(); s.on('error', () => {});
  t.after(() => s.destroy());
  await sleep(1500);
  assert.ok(events.some(e => e.type === 'stop' && e.reason === 'time'), 'bosta kalan baglanti kapandi, sure doldu');
  assert.equal(S.info().running, false);
  // mutlak sinir: surekli islem olsa da maxLife sonunda kapanir
  const { S: S2, events: ev2, info: i2 } = await setup(t, undefined, { maxLife: 400 });
  for (let k = 0; k < 6; k++) { await req(i2.url).catch(() => {}); await sleep(100); }
  assert.ok(ev2.some(e => e.type === 'stop' && e.reason === 'time')); assert.equal(S2.info().running, false);
});

test('share.html: baslatma hatasinda dugme "Yeniden başlat" olur ve hata gorunur (R6)', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'share.html'), 'utf8');
  const code = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const els = {};
  const mk = () => ({ style: {}, textContent: '', innerHTML: '', childElementCount: 0, classList: { toggle() {}, add() {}, remove() {} }, replaceChildren() {}, append() {}, querySelector: () => mk() });
  const document = { getElementById: id => (els[id] = els[id] || mk()), createElement: mk, addEventListener() {}, body: mk() };
  const share = { start: async () => ({ ok: false, msg: 'Mac bir Wi-Fi ağına bağlı değil.' }), on() {} };
  vm.runInNewContext(code, { document, share, setInterval: () => 0, clearInterval() {}, setTimeout, String });
  await sleep(20);
  assert.equal(els.stop.textContent, 'Yeniden başlat');
  assert.equal(els.err.style.display, 'block');
  assert.equal(els.err.textContent, 'Mac bir Wi-Fi ağına bağlı değil.');
});

test('sure dolunca kapanir', async (t) => {
  const dir = tmpDir(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ev = [];
  const S = createShare({ downloadsDir: dir, host: '127.0.0.1', ttl: 150, onEvent: e => ev.push(e) });
  const { url } = await S.start();
  await new Promise(r => setTimeout(r, 400));
  assert.ok(ev.some(e => e.type === 'stop' && e.reason === 'time'));
  await assert.rejects(req(url));
});
