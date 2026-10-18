'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { tmpDir } = require('./helpers/util.js');
const U = require('../updater.js');
const { registerUpdater } = require('../updater-main.js');

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const url = (v, a) => `https://github.com/maj834/Proje/releases/download/v${v}/CemApp-${v}-${a}.zip`;
const entry = (v, a, body, o = {}) => ({ arch: a, name: `CemApp-${v}-${a}.zip`, url: url(v, a), sha256: sha(body), size: body.length, ...o });
const manifest = (v, body = Buffer.from('zip'), o = {}) => ({ version: v, date: '2026-10-18T00:00:00Z', notes: ['Yeni: guncelleme', 'Duzeltme'],
  files: [entry(v, 'arm64', body), entry(v, 'x64', body)], ...o });
const MURL = 'https://github.com/maj834/Proje/releases/latest/download/latest.json';

// Sahte fetch: routes {url: () => Response}
function fakeFetch(routes, calls = []) {
  return async (u, init) => {
    calls.push(String(u));
    const r = routes[String(u)];
    if (!r) throw new Error('beklenmeyen istek: ' + u);
    return r(init);
  };
}
const json = o => () => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
const redirect = loc => () => new Response(null, { status: 302, headers: { location: loc } });
const manifestRoutes = m => ({ [MURL]: redirect('https://github.com/maj834/Proje/releases/download/v' + m.version + '/latest.json'),
  ['https://github.com/maj834/Proje/releases/download/v' + m.version + '/latest.json']: redirect('https://release-assets.githubusercontent.com/m/latest.json'),
  'https://release-assets.githubusercontent.com/m/latest.json': json(m) });

test('compareVersions: sayisal karsilastirma, gecersiz surum hata', () => {
  assert.equal(U.compareVersions('2.0.10', '2.0.9'), 1);
  assert.equal(U.compareVersions('2.0.9', '2.0.10'), -1);
  assert.equal(U.compareVersions('2.1.0', '2.0.99'), 1);
  assert.equal(U.compareVersions('2.0.5', '2.0.5'), 0);
  assert.equal(U.compareVersions('10.0.0', '9.9.9'), 1);
  for (const bad of ['2.0', '2.0.x', '02.0.1', '2.0.1-beta', '', null]) assert.throws(() => U.compareVersions(bad, '2.0.0'));
});

test('allowedUrl: yalniz https ve GitHub alan adlari', () => {
  assert.equal(U.allowedUrl('https://github.com/a'), true);
  assert.equal(U.allowedUrl('https://objects.githubusercontent.com/a'), true);
  assert.equal(U.allowedUrl('https://release-assets.githubusercontent.com/a'), true);
  for (const u of ['http://github.com/a', 'https://evil.com/a', 'https://github.com.evil.com/a', 'https://user:pw@github.com/a',
    'https://github.com:8443/a', 'file:///etc/passwd', 'javascript:alert(1)', 'https://evilgithub.com/a', 'nonsense'])
    assert.equal(U.allowedUrl(u), false, u);
});

test('validateManifest: kati sema', () => {
  const ok = U.validateManifest(manifest('2.0.10'));
  assert.equal(ok.version, '2.0.10'); assert.equal(ok.files.length, 2); assert.deepEqual(ok.notes, ['Yeni: guncelleme', 'Duzeltme']);
  const bad = [
    m => { m.files[0].url = m.files[0].url.replace('https://github.com', 'https://evil.com'); },
    m => { m.files[0].url = m.files[0].url.replace('https:', 'http:'); },
    m => { m.files[0].url = 'https://github.com/baska/repo/releases/download/v2.0.10/CemApp-2.0.10-arm64.zip'; },
    m => { delete m.files[0].sha256; },
    m => { m.files[0].sha256 = 'ABC'; },
    m => { m.files[0].arch = 'ppc'; },
    m => { m.files[1].arch = 'arm64'; m.files[1].name = m.files[0].name; m.files[1].url = m.files[0].url; },
    m => { m.files[0].size = 0; },
    m => { m.files[0].size = 700 * 1024 * 1024; },
    m => { m.files[0].name = 'CemApp-2.0.9-arm64.zip'; },
    m => { m.files[0].name = '../../x.zip'; },
    m => { m.version = '2.0'; },
    m => { m.files = []; },
    m => { m.notes = [1, 2]; },
  ];
  for (const [i, f] of bad.entries()) { const m = manifest('2.0.10'); f(m); assert.throws(() => U.validateManifest(m), /Sürüm bilgisi bozuk/, 'durum ' + i); }
  assert.throws(() => U.validateManifest(null)); assert.throws(() => U.validateManifest([]));
  // notlar tek metin olabilir; kontrol karakterleri temizlenir
  assert.deepEqual(U.validateManifest(manifest('2.0.10', undefined, { notes: 'a\nb\u0007c\n' })).notes, ['a', 'b c']);
});

test('check: yonlendirmeleri izler, yeni surum, ayni/eski surum, mimari', async () => {
  const m = manifest('2.0.10'), calls = [];
  const r = await U.check({ current: '2.0.9', arch: 'arm64', fetch: fakeFetch(manifestRoutes(m), calls) });
  assert.equal(r.update, true); assert.equal(r.version, '2.0.10'); assert.equal(r.file.arch, 'arm64'); assert.equal(r.file.version, '2.0.10');
  assert.deepEqual(r.notes, m.notes); assert.equal(calls.length, 3);
  assert.equal((await U.check({ current: '2.0.10', arch: 'x64', fetch: fakeFetch(manifestRoutes(m)) })).update, false);
  assert.equal((await U.check({ current: '2.0.11', arch: 'x64', fetch: fakeFetch(manifestRoutes(m)) })).update, false, 'asla eski surume donmez');
  const onlyArm = manifest('2.0.10'); onlyArm.files = onlyArm.files.slice(0, 1);
  await assert.rejects(U.check({ current: '2.0.9', arch: 'x64', fetch: fakeFetch(manifestRoutes(onlyArm)) }), /x64/);
  await assert.rejects(U.check({ current: '2.0.9', arch: 'ia32', fetch: fakeFetch(manifestRoutes(m)) }), /mimari/);
});

test('check: kotu alan adina / http adresine yonlendirme reddedilir', async () => {
  for (const loc of ['https://evil.com/latest.json', 'http://github.com/x', 'http://objects.githubusercontent.com/x']) {
    const calls = [];
    await assert.rejects(U.check({ current: '2.0.0', arch: 'arm64', fetch: fakeFetch({ [MURL]: redirect(loc) }, calls) }), /İzin verilmeyen adres/);
    assert.equal(calls.length, 1, 'kotu adrese istek gitmemeli');
  }
  await assert.rejects(U.check({ current: '2.0.0', arch: 'arm64', url: 'http://github.com/x', fetch: fakeFetch({}) }), /İzin verilmeyen/);
  // sonsuz yonlendirme
  await assert.rejects(U.check({ current: '2.0.0', arch: 'arm64', fetch: fakeFetch({ [MURL]: redirect(MURL) }) }), /Çok fazla yönlendirme/);
  // 404 ve bozuk JSON
  await assert.rejects(U.check({ current: '2.0.0', arch: 'arm64', fetch: fakeFetch({ [MURL]: () => new Response('x', { status: 404 }) }) }), /404/);
  await assert.rejects(U.check({ current: '2.0.0', arch: 'arm64', fetch: fakeFetch({ [MURL]: () => new Response('{bozuk') }) }), /okunamadı/);
});

// --- yerel http sunucusu ile gercek akisli indirme ---
async function server(t, handler) {
  const s = http.createServer(handler);
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  t.after(() => { s.closeAllConnections && s.closeAllConnections(); s.close(); });
  const base = `http://127.0.0.1:${s.address().port}`;
  // https://<izinli alan>/yol -> http://127.0.0.1/<alan>/yol (politika gercek adres uzerinde calisir)
  const f = (u, init) => { const p = new URL(u); return fetch(base + '/' + p.hostname + p.pathname, init); };
  return f;
}

test('download: akisli indirme, SHA ve boyut dogru -> .zip; tekrar indirmez', async (t) => {
  const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const body = crypto.randomBytes(300 * 1024); let hits = 0;
  const f = await server(t, (req, res) => {
    if (req.url === '/github.com/maj834/Proje/releases/download/v2.0.10/CemApp-2.0.10-arm64.zip') { res.writeHead(302, { location: 'https://objects.githubusercontent.com/blob/1' }); return res.end(); }
    if (req.url === '/objects.githubusercontent.com/blob/1') { hits++; res.writeHead(200, { 'content-length': body.length }); return res.end(body); }
    res.writeHead(404); res.end();
  });
  const file = { ...entry('2.0.10', 'arm64', body), version: '2.0.10' }, prog = [];
  const p = await U.download(file, { dir: d, fetch: f, onProgress: x => prog.push(x) });
  assert.equal(p, path.join(d, 'CemApp-2.0.10.zip'));
  assert.ok(fs.readFileSync(p).equals(body)); assert.ok(!fs.existsSync(p + '.part'));
  assert.equal(prog.at(-1), 1); assert.ok(prog.length > 1);
  assert.equal(await U.download(file, { dir: d, fetch: f }), p); assert.equal(hits, 1, 'dogru dosya varsa yeniden indirilmez');
});

test('download: SHA uyusmazligi, boyut uyusmazligi, kotu yonlendirme -> silinir ve hata', async (t) => {
  const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const body = crypto.randomBytes(64 * 1024);
  const f = await server(t, (req, res) => {
    if (req.url.endsWith('/v2.0.10/CemApp-2.0.10-arm64.zip')) { res.writeHead(200, { 'content-length': body.length }); return res.end(body); }
    if (req.url.endsWith('/v2.0.11/CemApp-2.0.11-arm64.zip')) { res.writeHead(200); res.write(body); return res.end(body); } // uzunluk yok, fazla veri
    if (req.url.endsWith('/v2.0.12/CemApp-2.0.12-arm64.zip')) { res.writeHead(302, { location: 'https://evil.example/x' }); return res.end(); }
    if (req.url.endsWith('/v2.0.13/CemApp-2.0.13-arm64.zip')) { res.writeHead(200); return res.end(body.subarray(0, 100)); }
    res.writeHead(404); res.end();
  });
  const mk = (v, o = {}) => ({ ...entry(v, 'arm64', body), version: v, ...o });
  const none = () => fs.readdirSync(d).filter(n => n.includes('CemApp')).length === 0;
  await assert.rejects(U.download(mk('2.0.10', { sha256: sha(Buffer.from('baska')) }), { dir: d, fetch: f }), /SHA-256/); assert.ok(none());
  await assert.rejects(U.download(mk('2.0.10', { size: body.length + 1 }), { dir: d, fetch: f }), /boyutu uyuşmuyor/); assert.ok(none());
  await assert.rejects(U.download(mk('2.0.11'), { dir: d, fetch: f }), /büyük/); assert.ok(none());
  await assert.rejects(U.download(mk('2.0.12'), { dir: d, fetch: f }), /İzin verilmeyen adres/); assert.ok(none());
  await assert.rejects(U.download(mk('2.0.13'), { dir: d, fetch: f }), /eksik/); assert.ok(none());
  await assert.rejects(U.download(mk('2.0.10', { url: 'http://github.com/x' }), { dir: d, fetch: f }), /İzin verilmeyen/);
  await assert.rejects(U.download(mk('2.0.10', { size: 601 * 1024 * 1024 }), { dir: d, fetch: f }), /boyut/);
});

test('download: iptal (AbortSignal) -> .part silinir', async (t) => {
  const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const body = crypto.randomBytes(256 * 1024);
  const f = await server(t, (req, res) => {
    res.writeHead(200, { 'content-length': body.length }); res.write(body.subarray(0, 1024));
    const iv = setInterval(() => { if (!res.destroyed) res.write(body.subarray(0, 10)); }, 20); res.on('close', () => clearInterval(iv));
  });
  const ac = new AbortController();
  const file = { ...entry('2.0.10', 'arm64', body), version: '2.0.10' };
  const p = U.download(file, { dir: d, fetch: f, signal: ac.signal, onProgress: () => ac.abort() });
  await assert.rejects(p, /iptal/);
  assert.deepEqual(fs.readdirSync(d), []);
});

// --- prepare: sahte exec (ditto/plutil/xattr/codesign) ---
function fakeExec({ id = 'com.cem.app', version = '2.0.10', apps = ['Cem App.app'], plist = true, codesignOk = false, team = 'ABCDE12345' } = {}, log = []) {
  return async (cmd, args) => {
    log.push([cmd, ...args]);
    if (cmd === '/usr/bin/ditto') {
      assert.deepEqual(args.slice(0, 2), ['-x', '-k']);
      for (const a of apps) { fs.mkdirSync(path.join(args[3], a, 'Contents'), { recursive: true }); if (plist) fs.writeFileSync(path.join(args[3], a, 'Contents', 'Info.plist'), '<plist/>'); }
      return { stdout: '', stderr: '' };
    }
    if (cmd === '/usr/bin/plutil') {
      assert.deepEqual(args.slice(0, 1).concat(args.slice(2, 5)), ['-extract', 'raw', '-o', '-']);
      return { stdout: (args[1] === 'CFBundleIdentifier' ? id : version) + '\n', stderr: '' };
    }
    if (cmd === '/usr/bin/xattr') return { stdout: '', stderr: '' };
    if (cmd === '/usr/bin/codesign') {
      if (!codesignOk) throw Object.assign(new Error('code object is not signed at all'), { code: 1 });
      return { stdout: '', stderr: args[0] === '-dv' ? `Identifier=com.cem.app\nTeamIdentifier=${team}\n` : '' };
    }
    throw new Error('beklenmeyen komut ' + cmd);
  };
}

test('prepare: dogru paket -> .app yolu; karantina kaldirilir; imzasiz uygulamada codesign atlanir', async (t) => {
  const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const zip = path.join(d, 'CemApp-2.0.10.zip'); fs.writeFileSync(zip, 'x'); const log = [];
  const app = await U.prepare(zip, { exec: fakeExec({}, log), version: '2.0.10', signed: { signed: false } });
  assert.match(app, /hazirla-[^/]+\/Cem App\.app$/); assert.ok(fs.existsSync(app));
  assert.ok(log.some(c => c[0] === '/usr/bin/xattr' && c[1] === '-dr' && c[2] === 'com.apple.quarantine' && c[3] === app));
  assert.ok(!log.some(c => c[0] === '/usr/bin/codesign'));
  // mevcut uygulama imzaliysa yeni de ayni ekiple imzali olmali
  assert.ok(await U.prepare(zip, { exec: fakeExec({ codesignOk: true }), version: '2.0.10', signed: { signed: true, team: 'ABCDE12345' } }));
  await assert.rejects(U.prepare(zip, { exec: fakeExec({ codesignOk: false }), version: '2.0.10', signed: { signed: true, team: 'ABCDE12345' } }), /imzası/);
  await assert.rejects(U.prepare(zip, { exec: fakeExec({ codesignOk: true, team: 'ZZZZZ99999' }), version: '2.0.10', signed: { signed: true, team: 'ABCDE12345' } }), /farklı bir geliştirici/);
});

test('prepare: kimlik / surum uyusmazligi, uygulama yok, birden fazla -> red ve gecici klasor silinir', async (t) => {
  const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const zip = path.join(d, 'z.zip'); fs.writeFileSync(zip, 'x');
  const cases = [[{ id: 'com.evil.app' }, /başka bir uygulamaya/], [{ version: '2.0.9' }, /sürümü uyuşmuyor/], [{ apps: [] }, /bulunamadı/],
    [{ apps: ['A.app', 'B.app'] }, /birden fazla/], [{ plist: false }, /Info\.plist/]];
  for (const [o, re] of cases) await assert.rejects(U.prepare(zip, { exec: fakeExec(o), version: '2.0.10' }), re);
  assert.deepEqual(fs.readdirSync(d), ['z.zip']);
  await assert.rejects(U.prepare(zip, { exec: fakeExec(), version: 'x' }), /geçersiz/);
});

test('signInfo: imzasiz / ad-hoc -> signed:false; ekip kimligi okunur', async () => {
  assert.deepEqual(await U.signInfo('/A.app', { exec: fakeExec({ codesignOk: false }) }), { signed: false, team: null });
  assert.deepEqual(await U.signInfo('/A.app', { exec: fakeExec({ codesignOk: true }) }), { signed: true, team: 'ABCDE12345' });
  const adhoc = async (c, a) => ({ stdout: '', stderr: a[0] === '-dv' ? 'Signature=adhoc\nTeamIdentifier=not set\n' : '' });
  assert.deepEqual(await U.signInfo('/A.app', { exec: adhoc }), { signed: false, team: null });
});

test('canInstall: DMG, App Translocation, .app degil, yazma izni', (t) => {
  const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const app = path.join(d, 'Cem App.app'); fs.mkdirSync(app);
  assert.deepEqual(U.canInstall(app), { ok: true, reason: null });
  for (const [p, re] of [['/Volumes/Cem App/Cem App.app', /DMG/],
    ['/private/var/folders/ab/cd/T/AppTranslocation/1234-ABCD/d/Cem App.app', /Translocation/],
    ['/Applications/Cem App', /\.app/], ['Cem App.app', /konumu/], [null, /konumu/]]) {
    const r = U.canInstall(p); assert.equal(r.ok, false); assert.match(r.reason, re);
  }
  const ro = { constants: fs.constants, accessSync: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); } };
  const r = U.canInstall('/Applications/Cem App.app', { fs: ro }); assert.equal(r.ok, false); assert.match(r.reason, /yazma izni/);
  assert.equal(U.bundlePath('/Applications/Cem App.app/Contents/MacOS/Cem App'), '/Applications/Cem App.app');
  assert.equal(U.bundlePath('/usr/bin/node'), null);
});

// --- kurulum betigi: gercekten calistirilir (open/mv/ditto PATH ile taklit) ---
function scriptEnv(t, { failNew = false, failOpen = false } = {}) {
  const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const weird = path.join(d, `Uyg "tırnak" 'tek' $(touch PWNED) \`touch PWNED2\` ; x`);
  const bin = path.join(d, 'bin'), openLog = path.join(d, 'open.log');
  fs.mkdirSync(bin); fs.mkdirSync(weird);
  const sh = (n, s) => { fs.writeFileSync(path.join(bin, n), '#!/bin/sh\n' + s); fs.chmodSync(path.join(bin, n), 0o755); };
  sh('open', `printf '%s\\n' "$@" >> ${JSON.stringify(openLog)}\nexit ${failOpen ? 1 : 0}\n`);
  if (failNew) {
    sh('mv', 'for a; do case "$a" in *YENI*) exit 1;; esac; done\nexec /bin/mv "$@"\n');
    sh('ditto', 'exit 1\n');
  }
  const oldApp = path.join(weird, 'Cem App.app'), newDir = path.join(d, 'YENI $(touch PWNED3) "x"'), newApp = path.join(newDir, 'Cem App.app');
  const backupDir = path.join(weird, 'yedek $HOME');
  for (const [a, m] of [[oldApp, 'eski'], [newApp, 'yeni']]) { fs.mkdirSync(path.join(a, 'Contents'), { recursive: true }); fs.writeFileSync(path.join(a, 'Contents', 'surum'), m); }
  const script = path.join(d, 'kur.sh'); fs.writeFileSync(script, U.installScript({ oldApp, newApp, backupDir }), { mode: 0o700 });
  const run = (pid, relaunch = true) => new Promise(res => {
    const c = spawn('/bin/sh', [script, ...U.installArgs({ oldApp, newApp, pid, backupDir, relaunch, delay: 0 })],
      { cwd: d, env: { HOME: d, PATH: '/usr/bin:/bin', CEM_UPDATE_PATH: bin }, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; c.stderr.on('data', x => { err += x; });
    c.on('exit', code => res({ code, err }));
  });
  const opened = () => (fs.existsSync(openLog) ? fs.readFileSync(openLog, 'utf8').split('\n').filter(Boolean) : []);
  const pwned = () => ['PWNED', 'PWNED2', 'PWNED3'].some(n => fs.existsSync(path.join(d, n)) || fs.existsSync(path.join(weird, n)) || fs.existsSync(n));
  const ver = () => fs.readFileSync(path.join(oldApp, 'Contents', 'surum'), 'utf8');
  return { d, script, oldApp, newApp, backupDir, run, opened, pwned, ver, log: () => fs.readFileSync(path.join(backupDir, 'guncelleme.log'), 'utf8') };
}
const deadPid = () => { const r = spawnSync(process.execPath, ['-e', 'console.log(process.pid)']); return +String(r.stdout).trim(); };

test('installScript: sh -n gecer; yollar betige yazilmaz', () => {
  const s = U.installScript({ oldApp: '/x/$(rm -rf ~)/A.app', newApp: '/y/B.app', pid: 1, backupDir: '/z' });
  assert.ok(!s.includes('$(rm'), 'yol betik metnine girmemeli');
  const r = spawnSync('/bin/sh', ['-n'], { input: s }); assert.equal(r.status, 0, String(r.stderr));
  assert.throws(() => U.installArgs({ oldApp: 'rel.app', newApp: '/a.app', pid: 1, backupDir: '/b' }));
  assert.throws(() => U.installArgs({ oldApp: '/a.app', newApp: '/b.app', pid: 0, backupDir: '/b' }));
  assert.throws(() => U.installArgs({ oldApp: '/a', newApp: '/b.app', pid: 5, backupDir: '/b' }));
});

test('installScript: tuhaf yollarla tasir, yeniden acar, yedegi siler; komut enjeksiyonu yok', async (t) => {
  const e = scriptEnv(t);
  const r = await e.run(deadPid());
  assert.equal(r.code, 0, r.err + e.log());
  assert.equal(e.ver(), 'yeni'); assert.ok(!fs.existsSync(e.newApp)); assert.ok(!fs.existsSync(path.join(e.backupDir, 'onceki.app')));
  assert.deepEqual(e.opened(), ['-n', e.oldApp]);
  assert.equal(e.pwned(), false);
  assert.match(e.log(), /tamam/);
});

test('installScript: once surecin kapanmasini bekler', async (t) => {
  const e = scriptEnv(t);
  const live = spawn('/bin/sleep', ['1.5']); const t0 = Date.now();
  const r = await e.run(live.pid);
  assert.equal(r.code, 0, r.err); assert.ok(Date.now() - t0 >= 1200, 'beklemeden kurdu'); assert.equal(e.ver(), 'yeni');
});

test('installScript: yeni surum yerlestirilemezse eski geri yuklenir ve acilir', async (t) => {
  const e = scriptEnv(t, { failNew: true });
  const r = await e.run(deadPid());
  assert.equal(r.code, 1);
  assert.equal(e.ver(), 'eski'); assert.deepEqual(e.opened(), ['-n', e.oldApp]); assert.match(e.log(), /geri yuklendi/);
  assert.equal(e.pwned(), false);
});

test('installScript: yeni surum acilamazsa eskiye doner; relaunch=0 acmaz', async (t) => {
  const e = scriptEnv(t, { failOpen: true });
  assert.equal((await e.run(deadPid())).code, 1);
  assert.equal(e.ver(), 'eski'); assert.match(e.log(), /acilamadi/);
  const e2 = scriptEnv(t);
  assert.equal((await e2.run(deadPid(), false)).code, 0);
  assert.equal(e2.ver(), 'yeni'); assert.deepEqual(e2.opened(), []); assert.ok(!fs.existsSync(path.join(e2.backupDir, 'onceki.app')));
});

test('installScript: gecersiz argumanlarda hicbir sey tasinmaz', async (t) => {
  const e = scriptEnv(t);
  for (const args of [[e.oldApp, e.newApp, 'abc', e.backupDir], ['goreli.app', e.newApp, '1', e.backupDir], [e.oldApp, e.newApp, '1', 'goreli'],
    [e.oldApp, '/yok/X.app', '1', e.backupDir], [e.oldApp, e.newApp, '1', e.backupDir, '1', '1;touch PWNED']]) {
    const r = spawnSync('/bin/sh', [e.script, ...args], { cwd: e.d, env: { PATH: '/usr/bin:/bin' } });
    assert.notEqual(r.status, 0, args.join('|'));
  }
  assert.equal(e.ver(), 'eski'); assert.ok(fs.existsSync(e.newApp)); assert.equal(e.pwned(), false);
});

// --- registerUpdater: sahte Electron + sahte fetch/exec/spawn ---
function harness(t, { current = '2.0.5', m, body = Buffer.from('ZIPDATA'), conf = {}, testEnv = true, deps = {} } = {}) {
  const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const prev = process.env.CEM_UPDATE_TEST;
  if (testEnv) process.env.CEM_UPDATE_TEST = '1'; else delete process.env.CEM_UPDATE_TEST;
  t.after(() => { if (prev === undefined) delete process.env.CEM_UPDATE_TEST; else process.env.CEM_UPDATE_TEST = prev; });
  const appPath = path.join(d, 'Applications', 'Cem App.app'); fs.mkdirSync(appPath, { recursive: true });
  m = m || manifest('2.0.10', body);
  const fetchCalls = [];
  const routes = { ...manifestRoutes(m) };
  for (const f of m.files) routes[f.url] = () => new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
  const handlers = {}, appEv = {}, sent = [], notes = [], spawned = [], timers = [];
  let quits = 0, onReady, C = { update: conf };
  const app = { isPackaged: false, getVersion: () => current, getPath: k => path.join(d, k), whenReady: () => ({ then: f => { onReady = f; } }),
    on: (e, f) => { appEv[e] = f; }, quit: () => { quits++; } };
  const ui = registerUpdater({ ipcMain: { handle: (c, f) => { handlers[c] = f; } }, app, path,
    Notification: Object.assign(function (o) { return { show() { notes.push(o); } }; }, { isSupported: () => true }),
    shell: { openExternal() {} }, cfg: () => C, save: o => { C = { ...C, ...o }; }, send: (ch, s) => sent.push([ch, s]),
    deps: { fetch: fakeFetch(routes, fetchCalls), exec: fakeExec({ version: m.version }), arch: 'arm64', pid: 4242, dir: path.join(d, 'upd'), appPath,
      spawn: (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return { on() {}, unref() {} }; },
      setTimeout: (f, ms) => { timers.push({ f, ms }); return 1; }, setInterval: (f, ms) => { timers.push({ f, ms }); return 2; }, ...deps } });
  return { ui, d, appPath, handlers, appEv, sent, notes, spawned, timers, fetchCalls, quits: () => quits, ready: () => onReady(), conf: () => C };
}

test('registerUpdater: 30 sn + 6 saat; denetle -> indir -> hazir -> bildirim -> kur (betik + quit)', async (t) => {
  const h = harness(t);
  h.ready();
  assert.deepEqual(h.timers.map(x => x.ms), [30000, 6 * 3600 * 1000]);
  await h.timers[0].f();
  let s = h.ui.state();
  assert.equal(s.phase, 'ready'); assert.equal(s.latest, '2.0.10'); assert.equal(s.current, '2.0.5'); assert.equal(s.progress, 1);
  const phases = h.sent.filter(x => x[0] === 'update').map(x => x[1].phase);
  for (const p of ['checking', 'available', 'downloading', 'ready']) assert.ok(phases.includes(p), p + ' yok: ' + phases);
  assert.equal(h.notes.length, 1); assert.match(h.notes[0].title, /Cem App 2\.0\.10 hazır — yeniden başlatınca kurulur/); assert.match(h.notes[0].body, /guncelleme/);
  // ikinci denetim yeniden indirmez, bildirim tekrarlanmaz
  await h.ui.check(false); assert.equal(h.ui.state().phase, 'ready'); assert.equal(h.notes.length, 1);
  assert.equal(h.fetchCalls.filter(u => u.endsWith('.zip')).length, 1);
  // kur
  s = await h.handlers['upd:install']({});
  assert.equal(s.phase, 'installing');
  assert.equal(h.spawned.length, 1);
  const sp = h.spawned[0];
  assert.equal(sp.cmd, '/bin/sh'); assert.equal(sp.opts.detached, true); assert.equal(sp.opts.stdio, 'ignore');
  const [script, oldApp, newApp, pid, backupDir, relaunch, delay] = sp.args;
  assert.equal(oldApp, h.appPath); assert.match(newApp, /Cem App\.app$/); assert.ok(fs.existsSync(newApp));
  assert.equal(pid, '4242'); assert.equal(backupDir, path.join(h.d, 'upd', 'yedek')); assert.equal(relaunch, '1'); assert.equal(delay, '10');
  assert.equal(fs.statSync(script).mode & 0o777, 0o700); assert.equal(fs.readFileSync(script, 'utf8'), U.installScript({}));
  await new Promise(r => setImmediate(r));
  assert.equal(h.quits(), 1);
  // kapanis sirasinda ikinci kez kurmaz
  h.appEv['before-quit'](); assert.equal(h.spawned.length, 1);
});

test('registerUpdater: kapanirken hazir guncelleme yeniden acmadan kurulur; onQuit:false kurmaz', async (t) => {
  const h = harness(t);
  await h.ui.check(false);
  h.appEv['before-quit']();
  assert.equal(h.spawned.length, 1); assert.equal(h.spawned[0].args[5], '0');
  const h2 = harness(t, { conf: { onQuit: false } });
  await h2.ui.check(false);
  h2.appEv['before-quit'](); assert.equal(h2.spawned.length, 0);
});

test('registerUpdater: atlanan surum, auto:false, eski surum, gelistirme modu', async (t) => {
  // atlanan surum otomatik denetimde indirilmez; elle denetimde indirilir
  const h = harness(t, { conf: { skip: '2.0.10' } });
  await h.ui.check(false);
  assert.equal(h.ui.state().phase, 'idle'); assert.equal(h.ui.state().latest, '2.0.10'); assert.equal(h.fetchCalls.filter(u => u.endsWith('.zip')).length, 0);
  await h.handlers['upd:check']({}); assert.equal(h.ui.state().phase, 'ready');
  // auto:false -> yalniz "available"; install once indirir sonra kurar
  const h2 = harness(t, { conf: { auto: false } });
  await h2.ui.check(false);
  assert.equal(h2.ui.state().phase, 'available'); assert.equal(h2.notes.length, 0);
  await h2.ui.install(); assert.equal(h2.spawned.length, 1); assert.equal(h2.ui.state().phase, 'installing');
  // asla eski surume donmez
  const h3 = harness(t, { current: '2.0.11' });
  await h3.ui.check(true); assert.equal(h3.ui.state().phase, 'uptodate');
  await h3.ui.install(); assert.equal(h3.spawned.length, 0);
  // gelistirme modu (paketlenmemis, CEM_UPDATE_TEST yok): ag istegi yok, zamanlayici yok
  const h4 = harness(t, { testEnv: false });
  h4.ready(); assert.equal(h4.timers.length, 0);
  await h4.ui.check(true); assert.equal(h4.fetchCalls.length, 0); assert.match(h4.ui.state().error, /paketlenmiş/);
});

test('registerUpdater: hatali paket -> error; upd:set dogrulama', async (t) => {
  const body = Buffer.from('ZIPDATA');
  const m = manifest('2.0.10', body); m.files[0].sha256 = sha(Buffer.from('baska'));
  const h = harness(t, { m, body });
  await h.ui.check(false);
  assert.equal(h.ui.state().phase, 'error'); assert.match(h.ui.state().error, /SHA-256/);
  assert.equal(await h.ui.install().then(s => s.phase), 'error'); assert.equal(h.spawned.length, 0);
  // ayarlar
  assert.equal(h.handlers['upd:set']({}, null), null);
  assert.equal(h.handlers['upd:set']({}, { auto: 'evet' }), null);
  assert.equal(h.handlers['upd:set']({}, { skip: '../x' }), null);
  const s = h.handlers['upd:set']({}, { auto: false, onQuit: false, skip: '2.0.10' });
  assert.deepEqual(s.conf, { auto: false, onQuit: false, skip: '2.0.10' }); assert.deepEqual(h.conf().update, s.conf);
  assert.deepEqual(h.handlers['upd:set']({}, { skip: null }).conf.skip, '');
});

test('registerUpdater: uygulama klasorune yazilamiyorsa kurmaz, sebep Turkce', async (t) => {
  const ro = { constants: fs.constants, accessSync: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); } };
  const h = harness(t, { deps: { fs: ro } });
  await h.ui.check(false);
  assert.equal(h.ui.state().phase, 'ready');
  const s = await h.ui.install();
  assert.equal(s.phase, 'error'); assert.match(s.error, /yazma izni/); assert.equal(h.spawned.length, 0);
  await new Promise(r => setImmediate(r)); assert.equal(h.quits(), 0);
});
