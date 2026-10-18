'use strict';
// sync.js'i yerel bir Supabase benzeri sunucuya (node:http) karsi dener.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('fs'), path = require('path');
const { fresh, tmpDir } = require('./helpers/util.js');

process.env.GRAFIK_SB_ALLOW_LOCAL = '1';

const ANON = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role: 'anon', iss: 'supabase' })).toString('base64url') + '.c2ln';
const SERVICE = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase' })).toString('base64url') + '.c2ln';
const EMAIL = 'kullanici@example.com', EMAIL2 = 'ikinci@example.com', PASSWORD = 'Gizli-Sifre-123';

// Sahte Supabase: /auth/v1/token (password, refresh_token) ve /rest/v1/<tablo>.
function startServer(port = 0) {
  const s = { requests: [], inserts: {}, tokenN: 0, valid: new Set(), fail401Once: false, failTable: {}, owner: {}, badRow: null, gate: null };
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body == null ? '' : JSON.stringify(body)); };
  const issue = (email = EMAIL) => { const n = ++s.tokenN, at = 'access-' + n; s.valid.add(at); s.owner[at] = s.owner['refresh-' + n] = email; return { access_token: at, refresh_token: 'refresh-' + n, expires_in: 3600, token_type: 'bearer', user: { email } }; };
  s.server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', async () => {
      const u = new URL(req.url, 'http://x'), body = raw ? JSON.parse(raw) : null;
      s.requests.push({ method: req.method, path: u.pathname, query: u.search, headers: req.headers, body });
      if (req.headers.apikey !== ANON) return send(res, 401, { message: 'Invalid API key' });
      if (u.pathname === '/auth/v1/token') {
        const g = u.searchParams.get('grant_type');
        if (g === 'password') return [EMAIL, EMAIL2].includes(body.email) && body.password === PASSWORD ? send(res, 200, issue(body.email)) : send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        if (g === 'refresh_token') return /^refresh-\d+$/.test(body.refresh_token) ? send(res, 200, issue(s.owner[body.refresh_token])) : send(res, 400, { error_description: 'Invalid Refresh Token' });
      }
      const m = /^\/rest\/v1\/(\w+)$/.exec(u.pathname);
      if (m && req.method === 'POST') {
        const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
        if (s.fail401Once) { s.fail401Once = false; s.valid.delete(tok); }
        if (!s.valid.has(tok)) return send(res, 401, { message: 'JWT expired' });
        if (s.gate) await s.gate(body, tok);
        if (s.failTable[m[1]]) return send(res, s.failTable[m[1]], { code: '42501', message: 'new row violates row-level security policy' });
        // PostgREST: tek bir satir kisiti ihlal ederse butun ifade (paket) reddedilir
        if (s.badRow && body.some(s.badRow)) return send(res, 400, { code: '23502', message: 'null value in column "score" violates not-null constraint' });
        (s.inserts[m[1]] = s.inserts[m[1]] || []).push(body);
        (s.byUser = s.byUser || []).push({ user: s.owner[tok], table: m[1], rows: body });
        res.writeHead(201); return res.end();
      }
      if (m && req.method === 'GET') {
        const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
        if (s.fail401Once) { s.fail401Once = false; s.valid.delete(tok); }
        if (!s.valid.has(tok)) return send(res, 401, { message: 'JWT expired' });
        return send(res, 200, (s.rows && s.rows[m[1]]) || []);
      }
      send(res, 404, { message: 'not found' });
    });
  });
  return new Promise(r => s.server.listen(port, '127.0.0.1', () => { s.url = 'http://127.0.0.1:' + s.server.address().port; r(s); }));
}

// sync.js arka plan gonderimini setTimeout(flush) ile planlar. Testlerde zamanlayici
// tetiklenmesin (flush'i elle cagiririz) ve surec bos zamanlayici yuzunden beklemesin.
function quietTimers(t, S) {
  const orig = global.setTimeout, scheduled = [];
  global.setTimeout = function (fn, ms, ...a) {
    if (fn === S.flush) { scheduled.push(ms); return { ref() { return this; }, unref() { return this; }, hasRef: () => false, [Symbol.toPrimitive]: () => 0 }; }
    return orig.call(this, fn, ms, ...a);
  };
  t.after(() => { global.setTimeout = orig; });
  return scheduled;
}

async function setup(t, { signIn = true } = {}) {
  const srv = await startServer();
  t.after(() => new Promise(r => { srv.server.closeAllConnections && srv.server.closeAllConnections(); srv.server.close(r); }));
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const S = fresh('sync.js');
  const scheduled = quietTimers(t, S);
  const tokens = [];
  S.init({ dir, onToken: x => tokens.push(x) });
  if (signIn) await S.signIn({ url: srv.url + '/', anon: ANON, email: EMAIL, password: PASSWORD });
  return { S, srv, dir, tokens, scheduled };
}

test('validUrl ve isServiceRole', () => {
  const S = fresh('sync.js');
  assert.equal(S.validUrl('https://abcdefghijklmnopqrst.supabase.co/'), 'https://abcdefghijklmnopqrst.supabase.co');
  for (const u of ['http://abcdefghijklmnopqrst.supabase.co', 'https://evil.com', 'https://abc.supabase.co', 'https://abcdefghijklmnopqrst.supabase.co.evil.com', 'javascript:alert(1)', '', null, 'http://localhost:54321', 'http://127.0.0.1'])
    assert.equal(S.validUrl(u), null, String(u));
  assert.equal(S.validUrl('http://127.0.0.1:54321'), 'http://127.0.0.1:54321');
  const prev = process.env.GRAFIK_SB_ALLOW_LOCAL;
  delete process.env.GRAFIK_SB_ALLOW_LOCAL;
  try { assert.equal(S.validUrl('http://127.0.0.1:54321'), null); } finally { process.env.GRAFIK_SB_ALLOW_LOCAL = prev; }
  assert.equal(S.isServiceRole(SERVICE), true);
  assert.equal(S.isServiceRole(ANON), false);
  assert.equal(S.isServiceRole('sb_secret_abc'), true);
  assert.equal(S.isServiceRole('sb_publishable_abc'), false);
});

test('signIn: basarili giris; sifre onToken\'a ve diske gitmez', async t => {
  const { S, srv, dir, tokens } = await setup(t);
  const st = S.state();
  assert.equal(st.configured, true);
  assert.equal(st.user, EMAIL);
  assert.equal(st.url, srv.url);
  assert.deepEqual(tokens, [{ refresh: 'refresh-1', user: EMAIL }]);
  assert.ok(!JSON.stringify(tokens).includes(PASSWORD));
  assert.deepEqual(S.tokens(), { refresh: 'refresh-1', user: EMAIL });
  const r = srv.requests[0];
  assert.equal(r.path, '/auth/v1/token');
  assert.equal(r.query, '?grant_type=password');
  assert.deepEqual(r.body, { email: EMAIL, password: PASSWORD });
  S.enqueue('signals', { symbol: 'THYAO' });
  for (const f of fs.readdirSync(dir)) assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes(PASSWORD), f);
});

test('signIn: hatali sifre, service_role, gecersiz URL ve anahtar reddedilir', async t => {
  const { S, srv, tokens } = await setup(t, { signIn: false });
  await assert.rejects(S.signIn({ url: srv.url, anon: ANON, email: EMAIL, password: 'yanlis' }), /E-posta ya da şifre hatalı/);
  assert.equal(S.state().configured, false);
  const n = srv.requests.length;
  await assert.rejects(S.signIn({ url: srv.url, anon: SERVICE, email: EMAIL, password: PASSWORD }), /service_role/);
  await assert.rejects(S.signIn({ url: srv.url, anon: 'sb_secret_abcdef', email: EMAIL, password: PASSWORD }), /service_role|Anon \(public\) anahtarı geçersiz/);
  await assert.rejects(S.signIn({ url: 'https://example.com', anon: ANON, email: EMAIL, password: PASSWORD }), /supabase\.co biçiminde/);
  await assert.rejects(S.signIn({ url: srv.url, anon: 'not a key', email: EMAIL, password: PASSWORD }), /Anon \(public\) anahtarı geçersiz/);
  assert.equal(srv.requests.length, n, 'reddedilen girislerde sunucuya istek gitmemeli');
  assert.deepEqual(tokens, []);
  assert.equal(S.state().configured, false);
});

test('flush: 50\'lik paketler, Prefer return=minimal, Bearer belirteci', async t => {
  const { S, srv, scheduled } = await setup(t);
  for (let i = 0; i < 120; i++) S.enqueue('signals', { symbol: 'S' + i, dir: 1, ts: '2026-10-20T09:00:00.000Z' });
  S.enqueue('alarms', { symbol: 'THYAO', price: 300 });
  S.enqueue('bilinmeyen_tablo', { x: 1 }); // izinli tablo degil -> yok sayilir
  assert.equal(S.state().pending, 121);
  assert.ok(scheduled.length > 0, 'arka plan gonderimi planlanmali');
  const st = await S.flush();
  assert.equal(st.pending, 0);
  assert.equal(st.sent, 121);
  assert.equal(st.error, null);
  assert.deepEqual(srv.inserts.signals.map(b => b.length), [50, 50, 20]);
  assert.equal(srv.inserts.signals[0][0].symbol, 'S0');
  assert.equal(srv.inserts.alarms[0][0].symbol, 'THYAO');
  assert.match(srv.inserts.alarms[0][0].ts, /^\d{4}-\d\d-\d\dT/);
  const posts = srv.requests.filter(r => r.path.startsWith('/rest/v1/'));
  assert.equal(posts.length, 4);
  for (const p of posts) {
    assert.equal(p.headers.prefer, 'return=minimal');
    assert.equal(p.headers.authorization, 'Bearer access-1');
    assert.equal(p.headers.apikey, ANON);
  }
});

test('flush: 401 -> zorla yenile -> tekrar dene', async t => {
  const { S, srv, tokens } = await setup(t);
  S.enqueue('pressure_log', { symbol: 'THYAO', score: 40 });
  srv.fail401Once = true;
  const st = await S.flush();
  assert.equal(st.pending, 0);
  assert.equal(st.sent, 1);
  const seq = srv.requests.map(r => r.path + (r.query || ''));
  assert.deepEqual(seq, ['/auth/v1/token?grant_type=password', '/rest/v1/pressure_log', '/auth/v1/token?grant_type=refresh_token', '/rest/v1/pressure_log']);
  assert.deepEqual(srv.requests[2].body, { refresh_token: 'refresh-1' });
  assert.equal(srv.requests[3].headers.authorization, 'Bearer access-2');
  assert.deepEqual(tokens.at(-1), { refresh: 'refresh-2', user: EMAIL });
});

test('flush: kalici 4xx paketi atilir ve sayilir, diger tablolar gider', async t => {
  const { S, srv } = await setup(t);
  srv.failTable.flow_log = 403;
  S.enqueue('signals', { symbol: 'A' });
  S.enqueue('flow_log', { symbol: 'B' });
  S.enqueue('flow_log', { symbol: 'C' });
  const st = await S.flush();
  assert.equal(st.pending, 0);
  assert.equal(st.sent, 1);
  assert.equal(st.dropped, 2); // satir sayisi (paket degil)
  assert.match(st.lastDrop, /^flow_log: new row violates row-level security policy/);
  assert.equal(srv.inserts.signals.length, 1);
  assert.equal(srv.inserts.flow_log, undefined);
});

test('flush: 5xx kuyrukta kalir', async t => {
  const { S, srv } = await setup(t);
  srv.failTable.signals = 503;
  S.enqueue('signals', { symbol: 'A' });
  const st = await S.flush();
  assert.equal(st.pending, 1);
  assert.equal(st.dropped, 0);
  assert.ok(st.error);
});

test('cevrimdisi: satirlar kuyrukta kalir, diske yazilir ve yeniden yuklenir', async t => {
  const { S, srv, dir } = await setup(t);
  await new Promise(r => { srv.server.closeAllConnections && srv.server.closeAllConnections(); srv.server.close(r); });
  S.enqueue('signals', { symbol: 'A', ts: '2026-10-20T09:00:00.000Z' });
  S.enqueue('alarms', { symbol: 'B', ts: '2026-10-20T09:00:00.000Z' });
  const st = await S.flush();
  assert.equal(st.pending, 2);
  assert.equal(st.error, 'Bağlantı yok; internet gelince gönderilecek.');
  const q = JSON.parse(fs.readFileSync(path.join(dir, 'sb-queue.json'), 'utf8'));
  const A = srv.url + '|' + EMAIL;
  assert.deepEqual(q, [{ t: 'signals', r: { symbol: 'A', ts: '2026-10-20T09:00:00.000Z' }, a: A }, { t: 'alarms', r: { symbol: 'B', ts: '2026-10-20T09:00:00.000Z' }, a: A }]);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'sb-queue.json')).mode & 0o777, 0o600);
  // Yeniden baslatma: kuyruk diskten gelir, restore + flush ile gonderilir.
  const srv2 = await startServer(+new URL(srv.url).port); // ayni proje adresi
  t.after(() => new Promise(r => srv2.server.close(r)));
  const S2 = fresh('sync.js');
  quietTimers(t, S2);
  S2.init({ dir, onToken: () => {} });
  S2.restore({ url: srv2.url, anon: ANON, refresh: 'refresh-9', user: EMAIL });
  assert.equal(S2.state().pending, 2);
  const st2 = await S2.flush();
  assert.equal(st2.pending, 0);
  assert.equal(st2.sent, 2);
  assert.equal(srv2.requests[0].query, '?grant_type=refresh_token');
});

test('restore: service_role ya da gecersiz URL ile yapilandirilmaz', async () => {
  const S = fresh('sync.js');
  S.restore({ url: 'http://127.0.0.1:1', anon: SERVICE, refresh: 'r' });
  assert.equal(S.state().configured, false);
  S.restore({ url: 'https://evil.com', anon: ANON, refresh: 'r' });
  assert.equal(S.state().configured, false);
});

test('signOut: kuyruk temizlenir, onToken(null), sonraki enqueue yok sayilir', async t => {
  const { S, dir, tokens } = await setup(t);
  S.enqueue('signals', { symbol: 'A' });
  assert.equal(S.state().pending, 1);
  S.signOut();
  assert.equal(S.state().pending, 0);
  assert.equal(S.state().configured, false);
  assert.equal(tokens.at(-1), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'sb-queue.json'), 'utf8')), []);
  S.enqueue('signals', { symbol: 'B' });
  assert.equal(S.state().pending, 0);
});

test('get ve upsert: haber okuma, takip listesi, 401 sonrasi yenileme', async (t) => {
  const { S, srv } = await setup(t);
  srv.rows = { news: [{ title: 'THYAO yeni ucak siparisi', score: 3 }] };
  srv.fail401Once = true;
  assert.deepEqual(await S.get('/rest/v1/news?select=title,score&symbols=cs.%7BTHYAO%7D'), [{ title: 'THYAO yeni ucak siparisi', score: 3 }]);
  const g = srv.requests.filter(r => r.method === 'GET');
  assert.equal(g.length, 2, '401 sonrasi bir kez tekrar');
  assert.match(g[1].query, /symbols=cs\.%7BTHYAO%7D/);
  await S.upsert('watchlist', [{ symbol: 'THYAO' }], 'user_id,symbol');
  const p = srv.requests.filter(r => r.path === '/rest/v1/watchlist').pop();
  assert.equal(p.method, 'POST'); assert.match(p.query, /on_conflict=user_id%2Csymbol/);
  assert.equal(p.headers.prefer, 'resolution=merge-duplicates,return=minimal');
  assert.deepEqual(srv.inserts.watchlist, [[{ symbol: 'THYAO' }]]);
});

test('get: oturum yoksa null', async (t) => {
  const { S } = await setup(t, { signIn: false });
  assert.equal(await S.get('/rest/v1/news'), null);
});

// --- Regresyon: hesap degisimi, satir-duzeyi hatalar, baska hesabin kuyrugu ---

test('flush: gonderim surerken hesap degisirse yeni hesabin satirlari eski belirtecle gitmez', async t => {
  const { S, srv } = await setup(t);
  for (let i = 0; i < 60; i++) S.enqueue('signals', { symbol: 'A' + i });
  let release, first = true;
  const inFlight = new Promise(r => {
    srv.gate = () => { if (!first) return; first = false; r(); return new Promise(g => { release = g; }); };
  });
  const f = S.flush();
  await inFlight; // A0..A49 sunucuda bekliyor
  S.signOut();
  await S.signIn({ url: srv.url, anon: ANON, email: EMAIL2, password: PASSWORD });
  S.enqueue('signals', { symbol: 'B-ozel' });
  release();
  const st = await f;
  assert.equal(st.error, null, 'eski oturumun durmasi hata sayilmaz');
  // Eski flush yalnizca ilk (A) paketini gonderdi ve durdu
  assert.deepEqual(srv.byUser.map(x => [x.user, x.rows.length]), [[EMAIL, 50]]);
  assert.equal(S.state().pending, 1);
  const st2 = await S.flush();
  assert.equal(st2.pending, 0);
  for (const x of srv.byUser) for (const r of x.rows) assert.equal(r.symbol.startsWith('B'), x.user === EMAIL2, JSON.stringify(x));
  assert.deepEqual(srv.byUser.at(-1), { user: EMAIL2, table: 'signals', rows: [srv.byUser.at(-1).rows[0]] });
  assert.equal(srv.byUser.at(-1).rows[0].symbol, 'B-ozel');
});

test('flush: belirtec yenileme surerken hesap degisirse yeni oturum ezilmez', async t => {
  const { S, srv } = await setup(t);
  S.enqueue('signals', { symbol: 'A' });
  srv.fail401Once = true; // ilk POST 401 -> yenileme
  let release;
  const orig = global.fetch;
  t.after(() => { global.fetch = orig; });
  let hit;
  const refreshing = new Promise(r => { hit = r; });
  global.fetch = async (url, init) => {
    if (String(url).includes('grant_type=refresh_token')) { hit(); await new Promise(g => { release = g; }); }
    return orig(url, init);
  };
  const f = S.flush();
  await refreshing;
  global.fetch = orig;
  await S.signIn({ url: srv.url, anon: ANON, email: EMAIL2, password: PASSWORD });
  release();
  await f;
  assert.equal(S.state().user, EMAIL2);
  assert.equal(S.tokens().user, EMAIL2);
  assert.equal(srv.owner[S.tokens().refresh], EMAIL2);
  assert.equal(S.state().pending, 0, 'A satirlari B hesabinda bekletilmez');
  assert.ok(!(srv.byUser || []).some(x => x.user === EMAIL2), 'A satiri B hesabina yazilmaz');
});

test('flush: 400 ile tek bozuk satir yalnizca kendisini dusurur (paketi degil)', async t => {
  const { S, srv } = await setup(t);
  srv.badRow = r => 'score' in r && r.score == null;
  for (let i = 0; i < 50; i++) S.enqueue('pressure_log', { symbol: 'S' + i, score: i === 7 ? null : i });
  S.enqueue('pressure_log', { symbol: 'X', score: null });
  for (let i = 0; i < 3; i++) S.enqueue('signals', { symbol: 'G' + i });
  const st = await S.flush();
  assert.equal(st.pending, 0);
  assert.equal(st.dropped, 2, 'yalnizca 2 hatali satir');
  assert.equal(st.sent, 52);
  const stored = srv.inserts.pressure_log.flat().map(r => r.symbol);
  assert.equal(stored.length, 49);
  assert.ok(!stored.includes('S7'));
  assert.match(st.lastDrop, /^pressure_log: null value/);
  assert.equal(srv.inserts.signals.flat().length, 3);
});

test('flush: 409/422 de bolunur; 429 ve 5xx kuyrukta kalir', async t => {
  const { S, srv } = await setup(t);
  srv.failTable.alarms = 429;
  S.enqueue('alarms', { symbol: 'A' });
  S.enqueue('alarms', { symbol: 'B' });
  let st = await S.flush();
  assert.equal(st.pending, 2);
  assert.equal(st.dropped, 0);
  assert.ok(st.error);
  delete srv.failTable.alarms;
  srv.failTable.flow_log = 422;
  st = await S.flush();
  assert.equal(st.pending, 0);
  S.enqueue('flow_log', { symbol: 'F1' }); S.enqueue('flow_log', { symbol: 'F2' }); S.enqueue('flow_log', { symbol: 'F3' });
  st = await S.flush();
  assert.equal(st.pending, 0);
  assert.equal(st.dropped, 3);
  // 3 satir -> [2,1] -> [1,1]: hepsi tek tek denendi
  assert.equal(srv.requests.filter(r => r.path === '/rest/v1/flow_log').length, 5);
});

test('kuyruk: restore atlanmissa eski (etiketsiz) ve baska hesabin satirlari girisle gonderilmez', async t => {
  const srv = await startServer();
  t.after(() => new Promise(r => srv.server.close(r)));
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const qf = path.join(dir, 'sb-queue.json');
  const ts = '2026-10-20T09:00:00.000Z';
  fs.writeFileSync(qf, JSON.stringify([
    { t: 'alarms', r: { symbol: 'eski-bicim', ts } },
    { t: 'alarms', r: { symbol: 'A-ozel', ts }, a: srv.url + '|' + EMAIL },
    { t: 'alarms', r: { symbol: 'B-kendi', ts }, a: srv.url + '|' + EMAIL2 },
  ]));
  const S = fresh('sync.js');
  quietTimers(t, S);
  S.init({ dir }); // uygulama acildi, restore() atlandi (or. sifre cozulemedi)
  await S.signIn({ url: srv.url, anon: ANON, email: EMAIL2, password: PASSWORD });
  assert.equal(S.state().pending, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(qf, 'utf8')).map(x => x.r.symbol), ['B-kendi']);
  await S.flush();
  assert.deepEqual(srv.byUser.map(x => [x.user, x.rows.map(r => r.symbol)]), [[EMAIL2, ['B-kendi']]]);
});

test('kuyruk: restore etiketsiz eski satirlari geri yuklenen hesaba baglar, baskasininkileri atar', async t => {
  const srv = await startServer();
  t.after(() => new Promise(r => srv.server.close(r)));
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const ts = '2026-10-20T09:00:00.000Z';
  fs.writeFileSync(path.join(dir, 'sb-queue.json'), JSON.stringify([
    { t: 'signals', r: { symbol: 'eski-bicim', ts } },
    { t: 'signals', r: { symbol: 'B-ozel', ts }, a: srv.url + '|' + EMAIL2 },
  ]));
  const S = fresh('sync.js');
  quietTimers(t, S);
  S.init({ dir });
  S.restore({ url: srv.url, anon: ANON, refresh: 'refresh-0', user: EMAIL });
  assert.equal(S.state().pending, 1);
  await S.flush();
  assert.deepEqual(srv.byUser.map(x => [x.user, x.rows.map(r => r.symbol)]), [[EMAIL, ['eski-bicim']]]);
});
