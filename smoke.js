// Acilis duman testi (CI): CEM_SMOKE=1 ile baslatilan paketlenmis uygulama 'ready' olur, main.js'in whenReady islemleri biter,
// birkac saniye hatasiz calisirsa "CEM_SMOKE_OK ..." yazip 0 ile cikar. Yakalanmamis hata / promise reddi / cizici cokmesi -> 1.
// main.js'in EN BASINDA cagrilmali (modul yukleme hatalari da yakalansin). CEM_SMOKE yoksa hicbir sey yapmaz.
'use strict';

function smoke(app, { env = process.env, proc = process, delay = 3000, getWindows = null, exit = c => app.exit(c),
  out = s => process.stdout.write(s + '\n'), err = s => process.stderr.write(s + '\n') } = {}) {
  if (env.CEM_SMOKE !== '1') return false;
  let done = false;
  const finish = (code, msg) => { if (done) return; done = true; try { (code ? err : out)(msg); } catch (e) {} exit(code); };
  const bad = kind => e => finish(1, `CEM_SMOKE_FAIL ${kind}: ${(e && e.stack) || e}`);
  proc.on('uncaughtException', bad('uncaughtException'));
  proc.on('unhandledRejection', bad('unhandledRejection'));
  app.on('render-process-gone', (e, wc, d) => finish(1, `CEM_SMOKE_FAIL render-process-gone: ${d && d.reason}`));
  app.on('child-process-gone', (e, d) => { if (d && d.type === 'GPU' && d.reason !== 'clean-exit') finish(1, `CEM_SMOKE_FAIL gpu-process-gone: ${d.reason}`); });
  app.whenReady().then(() => setTimeout(() => {
    let wins = -1;
    try { wins = (getWindows || (() => require('electron').BrowserWindow.getAllWindows()))().length; } catch (e) {}
    finish(0, `CEM_SMOKE_OK version=${app.getVersion()} windows=${wins}`);
  }, delay), bad('whenReady'));
  return true;
}

module.exports = smoke;
