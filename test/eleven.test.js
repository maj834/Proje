'use strict';
// ElevenLabs istemcisi: istek bicimi, onbellek, kota, Turkce hatalar, zaman asimi, anahtar sizmamasi, ses listesi, calma/durdurma.
// Ag yok: fetch ve execFile sahte; anahtar uydurma bir test dizgisidir.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir } = require('./helpers/util.js');
const E = require('../eleven.js');

const KEY = 'sk_' + 'TESTANAHTARI0123456789abcdefSAHTE';           // uydurma, gercek degil
const MP3 = Buffer.from('ID3\u0003\u0000fake-mp3-data');
const audio = (h = {}) => new Response(MP3, { status: 200, headers: { 'content-type': 'audio/mpeg', ...h } });
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// routes: [[RegExp, (url, init) -> Response | Error | Promise]]
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined });
    for (const [re, h] of routes) if (re.test(String(url))) { const r = await h(String(url), init); if (r instanceof Error) throw r; return r; }
    throw new Error('beklenmeyen istek ' + url);
  };
  f.calls = calls;
  return f;
}
function mk(o = {}) {
  const dir = o.dir || tmpDir();
  let key = o.key === undefined ? KEY : o.key;
  const fetch = o.fetch || fakeFetch([[/text-to-speech/, () => audio()]]);
  const el = E.createEleven({ fetch, now: o.now || (() => Date.UTC(2026, 9, 20, 9)), key: () => key, dir, execFile: o.execFile, timeoutMs: o.timeoutMs });
  return { el, dir, fetch, setKey: k => { key = k; } };
}

test('speak: istek bicimi, mp3 onbellege yazilir, ayni metin tekrar istenmez, karakter sayilir', async (t) => {
  const { el, dir, fetch } = mk(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = await el.speak('Merhaba, ben Neo.', { voiceId: 'VoiceAbc12345' });
  assert.equal(r.ok, true); assert.equal(r.chars, 17); assert.ok(fs.readFileSync(r.file).equals(MP3));
  assert.equal(path.dirname(r.file), path.join(dir, 'eleven-cache')); assert.match(r.file, /\.mp3$/);
  const c = fetch.calls[0];
  assert.match(c.url, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/VoiceAbc12345(\?|$)/);
  assert.equal(c.init.method, 'POST'); assert.equal(c.init.headers['xi-api-key'], KEY); assert.equal(c.init.headers.accept, 'audio/mpeg');
  assert.equal(c.init.redirect, 'error', 'anahtar baska adrese yonlenmesin');
  assert.equal(c.body.text, 'Merhaba, ben Neo.'); assert.equal(c.body.model_id, 'eleven_multilingual_v2', 'varsayilan model');
  assert.equal(typeof c.body.voice_settings.stability, 'number');
  const again = await el.speak('Merhaba, ben Neo.', { voiceId: 'VoiceAbc12345' });
  assert.deepEqual([again.ok, again.cached, again.chars, again.file], [true, true, 0, r.file]); assert.equal(fetch.calls.length, 1, 'onbellekten');
  // hizli model ayri onbellek anahtari; bilinmeyen model varsayilana duser
  const fast = await el.speak('Merhaba, ben Neo.', { voiceId: 'VoiceAbc12345', model: 'eleven_flash_v2_5' });
  assert.notEqual(fast.file, r.file); assert.equal(fetch.calls[1].body.model_id, 'eleven_flash_v2_5');
  await el.speak('Başka', { model: 'gpt' }); assert.equal(fetch.calls[2].body.model_id, 'eleven_multilingual_v2');
  assert.match(fetch.calls[2].url, new RegExp('/text-to-speech/' + E.DEFAULT_VOICE), 'ses secilmediyse hazir ses');
  assert.equal(el.quota().used, 17 + 17 + 5);
  // sunucu karakter maliyeti basligi varsa o sayilir
  const { el: el2, dir: d2 } = mk({ fetch: fakeFetch([[/text-to-speech/, () => audio({ 'character-cost': '3' })]]) }); t.after(() => fs.rmSync(d2, { recursive: true, force: true }));
  assert.equal((await el2.speak('uzun bir cümle')).chars, 3);
  assert.equal(E.TIMEOUT_MS, 6000);
});

test('onbellek en fazla 30 dosya tutar; JSON ya da bos yanit dosyaya yazilmaz', async (t) => {
  const { el, dir } = mk(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (let i = 0; i < 35; i++) assert.equal((await el.speak('cümle ' + i)).ok, true);
  assert.equal(fs.readdirSync(path.join(dir, 'eleven-cache')).filter(f => f.endsWith('.mp3')).length, E.CACHE_MAX);
  const { el: b, dir: d2 } = mk({ fetch: fakeFetch([[/text-to-speech/, () => jres(200, { x: 1 })]]) }); t.after(() => fs.rmSync(d2, { recursive: true, force: true }));
  const r = await b.speak('json geldi'); assert.equal(r.ok, false); assert.equal(fs.existsSync(path.join(d2, 'eleven-cache')), false);
});

test('kota: 200 karakterin altina inecekse istek atilmaz; sayac diske yazilir, ay donunce ya da yenilenme aninda sifirlanir', async (t) => {
  let now = Date.UTC(2026, 9, 20, 9);
  const reset = Math.floor(Date.UTC(2026, 10, 3) / 1000);
  const fetch = fakeFetch([[/user\/subscription/, () => jres(200, { tier: 'free', character_count: 9700, character_limit: 10000, next_character_count_reset_unix: reset })],
    [/text-to-speech/, () => audio()]]);
  const { el, dir } = mk({ fetch, now: () => now }); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual([el.quota().left, el.quota().limit], [10000, 10000], 'ucretsiz plan varsayimi');
  const s = await el.sync(); assert.equal(s.ok, true); assert.equal(s.left, 300); assert.equal(s.resetAt, reset * 1000);
  assert.equal((await el.speak('a'.repeat(90))).ok, true, '300-90=210 >= 200');
  const no = await el.speak('b'.repeat(20));
  assert.equal(no.ok, false); assert.equal(no.code, 'quota'); assert.match(no.msg, /kota/i);
  assert.equal(fetch.calls.filter(c => /text-to-speech/.test(c.url)).length, 1, 'kota yetmezken istek yok');
  // yeni istemci ayni klasorden sayaci okur
  const again = E.createEleven({ fetch, now: () => now, key: () => KEY, dir });
  assert.equal(again.quota().used, 9790);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'eleven.json'), 'utf8'), /TESTANAHTARI/, 'diskte anahtar yok');
  now = reset * 1000 + 1;                                                // sunucunun yenilenme ani gecti
  assert.equal(again.quota().used, 0); assert.equal((await again.speak('b'.repeat(20))).ok, true);
  // sunucu esitlemesi yokken takvim ayi donunce sifirlanir; anahtar degisince sayac sifirlanir
  const { el: m, dir: d2 } = mk({ now: () => now }); t.after(() => fs.rmSync(d2, { recursive: true, force: true }));
  await m.speak('x'.repeat(50)); assert.equal(m.quota().used, 50);
  now = Date.UTC(2026, 12, 2); assert.equal(m.quota().used, 0);
});

test('hatalar Turkce: 401/402/429/404/kota dolu/zaman asimi/internet yok; anahtar hicbir metinde ve logda yok', async (t) => {
  const logs = []; const oe = console.error, ol = console.log, ow = console.warn;
  console.error = console.log = console.warn = (...a) => logs.push(a.join(' '));
  t.after(() => { console.error = oe; console.log = ol; console.warn = ow; });
  const out = [];
  const cases = [
    [() => jres(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key: ' + KEY } }), 'auth', /geçersiz/],
    [() => jres(402, { detail: { status: 'payment_required', message: 'paid ' + KEY } }), 'paid', /ücretli/],
    [() => jres(429, { detail: { status: 'too_many_concurrent_requests' } }), 'busy', /yoğun|429/],
    [() => jres(404, { detail: { status: 'voice_not_found' } }), 'voice', /ses/],
    [() => jres(401, { detail: { status: 'quota_exceeded', message: 'quota ' + KEY } }), 'quota', /kota/],
    [() => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }), 'offline', /İnternet/],
  ];
  for (const [h, code, re] of cases) {
    const { el, dir } = mk({ fetch: fakeFetch([[/./, h]]) }); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const r = await el.speak('Merhaba'); out.push(r);
    assert.equal(r.ok, false); assert.equal(r.code, code); assert.match(r.msg, re);
    out.push(await el.test(), await el.voices(true), await el.sync());
  }
  // zaman asimi: fetch hic donmuyor (sinyali de yok sayiyor) -> yaris zamanlayicisi keser
  const slow = fakeFetch([[/./, () => new Promise(() => {})]]);
  const { el: s, dir: ds } = mk({ fetch: slow, timeoutMs: 60 }); t.after(() => fs.rmSync(ds, { recursive: true, force: true }));
  const t0 = Date.now(); const r = await s.speak('yavaş'); out.push(r);
  assert.equal(r.code, 'timeout'); assert.match(r.msg, /6 saniye/); assert.ok(Date.now() - t0 < 2000);
  assert.ok(slow.calls[0].init.signal, 'AbortSignal gonderilir');
  // gecersiz anahtar sonrasi her cumlede yeniden istek atilmaz (6 sn bekleme olmasin)
  const f401 = fakeFetch([[/./, () => jres(401, { detail: { status: 'invalid_api_key' } })]]);
  const { el: a, dir: da } = mk({ fetch: f401 }); t.after(() => fs.rmSync(da, { recursive: true, force: true }));
  await a.speak('bir'); await a.speak('iki'); assert.equal(f401.calls.length, 1);
  // kota dolu dedikten sonra da istek yok
  const fq = fakeFetch([[/./, () => jres(401, { detail: { status: 'quota_exceeded' } })]]);
  const { el: q, dir: dq } = mk({ fetch: fq }); t.after(() => fs.rmSync(dq, { recursive: true, force: true }));
  await q.speak('bir'); assert.equal((await q.speak('iki')).code, 'quota'); assert.equal(fq.calls.length, 1);
  // anahtarsiz
  const { el: n, dir: dn, fetch: fn } = mk({ key: null }); t.after(() => fs.rmSync(dn, { recursive: true, force: true }));
  const nk = await n.speak('x'); out.push(nk, await n.test()); assert.equal(nk.code, 'nokey'); assert.equal(fn.calls.length, 0);
  const all = JSON.stringify(out) + logs.join('\n');
  assert.equal(all.includes(KEY), false, 'anahtar sizmadi'); assert.equal(all.includes('TESTANAHTARI'), false);
});

test('test(): kalan karakter Turkce; User okuma izni kapaliysa ses listesiyle dogrulanir', async (t) => {
  const fetch = fakeFetch([[/user\/subscription/, () => jres(200, { tier: 'free', character_count: 1250, character_limit: 10000, next_character_count_reset_unix: Math.floor(Date.UTC(2026, 10, 3) / 1000) })]]);
  const { el, dir } = mk({ fetch }); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = await el.test();
  assert.equal(r.ok, true); assert.match(r.msg, /8\.750 \/ 10\.000 karakter/); assert.equal(r.left, 8750);
  assert.equal(fetch.calls[0].init.headers['xi-api-key'], KEY); assert.equal(fetch.calls[0].init.method, 'GET');
  const f2 = fakeFetch([[/user\/subscription/, () => jres(401, { detail: { status: 'missing_permissions', message: 'missing user_read' } })],
    [/v1\/voices/, () => jres(200, { voices: [] })]]);
  const { el: p, dir: d2 } = mk({ fetch: f2 }); t.after(() => fs.rmSync(d2, { recursive: true, force: true }));
  const rp = await p.test(); assert.equal(rp.ok, true); assert.match(rp.msg, /izni kapalı/);
  const f3 = fakeFetch([[/./, () => jres(401, { detail: { status: 'invalid_api_key' } })]]);
  const { el: b, dir: d3 } = mk({ fetch: f3 }); t.after(() => fs.rmSync(d3, { recursive: true, force: true }));
  const rb = await b.test(); assert.equal(rb.ok, false); assert.match(rb.msg, /geçersiz/);
});

test('voices: Turkceye uygun sesler once, onbellekte; force yeniden ister; secim yoksa ilk ses kullanilir', async (t) => {
  const fetch = fakeFetch([[/v1\/voices/, () => jres(200, { voices: [
    { voice_id: 'EngOnly000001', name: 'Zed', category: 'cloned', labels: { accent: 'american' }, high_quality_base_model_ids: ['eleven_monolingual_v1'] },
    { voice_id: 'Premade000002', name: 'Sarah', category: 'premade', labels: { gender: 'female' } },
    { voice_id: 'Turkish000003', name: 'Ayşe', category: 'professional', labels: { gender: 'female', accent: 'istanbul' }, verified_languages: [{ language: 'tr', model_id: 'eleven_multilingual_v2' }] },
    { voice_id: 'bad id', name: 'x' }] })], [/text-to-speech/, () => audio()]]);
  const { el, dir } = mk({ fetch }); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = await el.voices();
  assert.equal(r.ok, true); assert.deepEqual(r.voices.map(v => v.id), ['Turkish000003', 'Premade000002', 'EngOnly000001']);
  assert.equal(r.voices[0].tr, 1); assert.equal(r.voices[0].desc, 'kadın, istanbul');
  assert.equal((await el.voices()).cached, true); assert.equal(fetch.calls.length, 1);
  await el.voices(true); assert.equal(fetch.calls.length, 2);
  assert.equal(el.cachedVoices()[0].id, 'Turkish000003');
  await el.speak('Merhaba'); assert.match(fetch.calls.at(-1).url, /text-to-speech\/Turkish000003/);
});

test('play/stop: afplay execFile ile calar, stop calani oldurur (stopped), hata ok:false', async (t) => {
  const runs = [];
  const execFile = (file, args, opts, cb) => {
    const p = { file, args, killed: false, kill(sig) { p.killed = sig; setImmediate(() => cb(Object.assign(new Error('killed'), { killed: true, signal: sig }))); },
      done: () => cb(null), fail: () => cb(Object.assign(new Error('bozuk'), { code: 1 })), on() {} };
    runs.push(p); return p;
  };
  const { el, dir } = mk({ execFile }); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p1 = el.play('/tmp/a.mp3'); assert.equal(runs[0].file, '/usr/bin/afplay'); assert.deepEqual(runs[0].args, ['/tmp/a.mp3']);
  assert.equal(el.playing(), true); runs[0].done(); assert.deepEqual(await p1, { ok: true }); assert.equal(el.playing(), false);
  const p2 = el.play('/tmp/b.mp3'); assert.equal(el.stop(), true); assert.equal(runs[1].killed, 'SIGTERM');
  assert.deepEqual(await p2, { ok: false, stopped: true }); assert.equal(el.stop(), false, 'calan yok');
  const p3 = el.play('/tmp/c.mp3'); runs[2].fail(); const r3 = await p3; assert.equal(r3.ok, false); assert.equal(r3.stopped, false);
  // yeni calma eskisini durdurur
  const p4 = el.play('/tmp/d.mp3'); const p5 = el.play('/tmp/e.mp3'); assert.equal((await p4).stopped, true); runs[4].done(); assert.equal((await p5).ok, true);
  const bad = E.createEleven({ dir, key: () => KEY, execFile: () => { throw new Error('ENOENT'); } });
  assert.equal((await bad.play('/tmp/x.mp3')).ok, false);
});
