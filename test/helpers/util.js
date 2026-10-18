'use strict';
const fs = require('fs'), os = require('os'), path = require('path');

// Modul durumunu (onbellek, sayaclar) testler arasinda sifirlamak icin taze yukle.
function fresh(rel) {
  const p = require.resolve(path.join(__dirname, '..', '..', rel));
  delete require.cache[p];
  return require(p);
}

// macOS'ta /var -> /private/var kisayolu: gercek yol kullanilir ki kodun dondurdugu yollarla esit olsun
const tmpDir = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'grafik-test-'));

// global.fetch yerine yonlendirici: routes = [[RegExp|fn, handler(url, init) -> {status, body} | Error]].
// Her cagri calls'a eklenir. Eslesme yoksa test hatasi.
function mockFetch(t, routes) {
  const orig = global.fetch, calls = [];
  global.fetch = async (url, init = {}) => {
    url = String(url);
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    for (const [m, h] of routes) {
      if (typeof m === 'function' ? m(url, init) : m.test(url)) {
        const r = await h(url, init);
        if (r instanceof Error) throw r;
        const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
        return new Response(text, { status: r.status || 200, headers: { 'content-type': 'application/json' } });
      }
    }
    throw new Error('beklenmeyen istek: ' + url);
  };
  t.after(() => { global.fetch = orig; });
  return calls;
}

// Cevrimdisi fetch hatasi (undici gibi).
const offline = () => Object.assign(new TypeError('fetch failed'), { cause: new Error('ECONNREFUSED') });

module.exports = { fresh, tmpDir, mockFetch, offline };
