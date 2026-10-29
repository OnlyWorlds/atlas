// The update banner against a real service worker, on a production build.
//
// The e2e suite runs on the dev server, where no worker registers, so nothing
// there can see whether a returning visitor is offered a new version. This
// check serves a build (A), waits for its worker, then serves the same build
// with sw.js changed by one line (B) on the same port, asks the registration
// to update, and expects Atlas's own banner. Reload must then take the page
// onto the new worker. Under Vite 8 an import marked `@vite-ignore` once left
// the plugin's own registerSW.js to register the worker: no banner, no save
// before reload, and the e2e suite stayed green.
//
//   npm run build && node scripts/check-update-banner.mjs [dist] [chromium|firefox]
//
// Exit code 0 when every check holds, 1 when one fails, 2 on a timeout.
import { chromium, firefox } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIST_A = path.resolve(process.argv[2] ?? 'dist');
const ENGINE = process.argv[3] ?? 'chromium';
const PORT = 3061;
const BASE = `http://localhost:${PORT}/`;
const BANNER = 'A new version of Atlas is ready';

if (!['chromium', 'firefox'].includes(ENGINE)) throw new Error(`unknown engine: ${ENGINE}`);
if (!fs.existsSync(path.join(DIST_A, 'sw.js'))) throw new Error(`no sw.js in ${DIST_A}: build first`);
console.log(`check-update-banner: ${DIST_A} in ${ENGINE}`);

const DIST_B = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-build-b-'));
fs.cpSync(DIST_A, DIST_B, { recursive: true });
fs.appendFileSync(path.join(DIST_B, 'sw.js'), '\n// build B\n');

function serve(dir) {
  return spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', dir, '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
}
async function up() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE, { signal: AbortSignal.timeout(2000) })).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('the preview server did not come up');
}
function stop(p) {
  if (p.exitCode !== null) return Promise.resolve();
  return new Promise((r) => { p.once('exit', r); p.kill(); });
}

const results = [];
const check = (ok, what) => { results.push(ok); console.log(`[${ENGINE}] ${ok ? 'ok  ' : 'FAIL'} ${what}`); };

let server = serve(DIST_A);
const browser = await (ENGINE === 'firefox' ? firefox : chromium).launch();
const watchdog = setTimeout(() => {
  console.log(`[${ENGINE}] FAIL watchdog: no verdict in 150 s`);
  server.kill();
  process.exit(2);
}, 150_000);
try {
  await up();
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE);
  await page.waitForSelector('.atlas-shell', { timeout: 30_000 });
  const active = await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).active));
  check(active, 'build A: a worker is active');
  // A returning visitor: the page loads under A's worker. (On the visit that
  // installed the first worker, the plugin offers the update but its Reload
  // waits for a control change that page never gets.)
  await page.reload();
  await page.waitForSelector('.atlas-shell', { timeout: 30_000 });
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  check(controlled, "build A, visited again: the page runs under A's worker");

  await stop(server);
  server = serve(DIST_B);
  await up();
  await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg?.update(); });
  const banner = page.locator('.atlas-update-banner', { hasText: BANNER });
  const shown = await banner.waitFor({ timeout: 20_000 }).then(() => true, () => false);
  check(shown, `build B: Atlas's own banner says "${BANNER}"`);

  if (shown) {
    await page.evaluate(() => { window.__beforeReload = true; });
    const navigated = page.waitForEvent('load', { timeout: 20_000 }).then(() => true, () => false);
    await banner.getByRole('button', { name: 'Reload' }).click();
    let reloaded = await navigated;
    if (reloaded) {
      await page.waitForSelector('.atlas-shell', { timeout: 30_000 });
      reloaded = await page.evaluate(() => !window.__beforeReload);
    }
    check(reloaded, 'Reload loads the page again');
    const waiting = await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting));
    check(reloaded && !waiting, 'after Reload no new worker is left waiting');
  }

  const csp = errors.filter((e) => /Content Security Policy|Content-Security-Policy/i.test(e));
  check(csp.length === 0, `no CSP refusal${csp.length ? `: ${csp[0]}` : ''}`);
  const injected = fs.readFileSync(path.join(DIST_A, 'index.html'), 'utf8').includes('registerSW.js');
  check(!injected, "the page registers its worker through Atlas's own code, not the plugin's registerSW.js");
} finally {
  clearTimeout(watchdog);
  await browser.close();
  await stop(server);
  fs.rmSync(DIST_B, { recursive: true, force: true });
}
const ok = results.length > 0 && results.every(Boolean);
console.log(ok ? `[${ENGINE}] all ok` : `[${ENGINE}] RED`);
process.exit(ok ? 0 : 1);
