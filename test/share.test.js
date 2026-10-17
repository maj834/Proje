'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const { tmpDir } = require('./helpers/util.js');
const { createShare, safeName, human } = require('../share.js');

function req(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((ok, no) => {
    const r = http.request(url, { method, headers }, res => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(ch) })); });
    r.on('error', no); if (body) r.write(body); r.end();
  });
}

async function setup(t, ask = async () => true) {
  const dir = tmpDir(), dl = path.join(dir, 'dl'); fs.mkdirSync(dl);
  const events = [];
  const S = createShare({ downloadsDir: dl, host: '127.0.0.1', ask, onEvent: e => events.push(e) });
  t.after(() => { S.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const info = await S.start();
  return { S, dir, dl, info, events };
}

test('safeName ve human', () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('..\\..\\x.txt'), 'x.txt');
  assert.equal(safeName('.ssh'), 'ssh');
  assert.equal(safeName('a<b>:c?.jpg'), 'a_b__c_.jpg');
  assert.equal(safeName(''), 'dosya');
  assert.ok(safeName('x'.repeat(300) + '.mp4').endsWith('.mp4'));
  assert.ok(safeName('x'.repeat(300) + '.mp4').length <= 180);
  assert.equal(human(1536), '2 KB'); assert.equal(human(5 * 1024 ** 3), '5.0 GB');
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
  const { info, dl, events, S } = await setup(t, async (x) => { asked++; assert.equal(x.count, 2); return true; });
  const noAsk = await req(info.url + 'up?name=a.txt', { method: 'POST', body: 'x' });
  assert.equal(noAsk.status, 403);
  const ask = await req(info.url + 'ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: [{ name: 'a.txt', size: 5 }, { name: 'b.jpg', size: 7 }] }) });
  assert.equal(ask.status, 200); assert.equal(asked, 1);
  const big = crypto.randomBytes(2 * 1024 * 1024);
  for (const [n, b] of [['../../a.txt', Buffer.from('hello')], ['a.txt', Buffer.from('ikinci')], ['video.mov', big]]) {
    const r = await req(info.url + 'up?name=' + encodeURIComponent(n), { method: 'POST', headers: { 'content-length': b.length }, body: b });
    assert.equal(r.status, 200, n);
  }
  assert.deepEqual(fs.readdirSync(dl).sort(), ['a (2).txt', 'a.txt', 'video.mov']);
  assert.equal(fs.readFileSync(path.join(dl, 'a.txt'), 'utf8'), 'hello');
  assert.ok(fs.readFileSync(path.join(dl, 'video.mov')).equals(big));
  assert.equal(S.info().received.length, 3);
  assert.ok(events.some(e => e.type === 'received' && e.name === 'video.mov'));
  // ayni istemci ikinci kez sorulmaz
  await req(info.url + 'ask', { method: 'POST', body: JSON.stringify({ files: [{ name: 'c', size: 1 }] }) });
  assert.equal(asked, 1);
});

test('reddedilen gonderim ve kapanis', async (t) => {
  const { info, S, dl } = await setup(t, async () => false);
  const ask = await req(info.url + 'ask', { method: 'POST', body: JSON.stringify({ files: [{ name: 'a', size: 1 }] }) });
  assert.equal(ask.status, 403);
  assert.equal((await req(info.url + 'up?name=a', { method: 'POST', body: 'x' })).status, 403);
  assert.deepEqual(fs.readdirSync(dl), []);
  S.stop();
  await assert.rejects(req(info.url));
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
