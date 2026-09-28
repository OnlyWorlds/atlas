// PROBE (S361): how long does atlas's own store take to open and list a world
// of N elements? The forward critic asked because Sikelia grew to 12,306 files
// and atlas was last verified at 4,771. Seeds a world folder into OPFS in real
// Chromium on the running dev server's origin (it needs `__atlasTestApi`), then
// times FsFolderStore.open, the first listElements (the cold index + parse)
// and a second listElements (the warm cache).
//   node scripts/probe-open-scale.mjs <world-folder> <dev-server-url>
// Prints the configuration it ran and refuses unknown arguments.
// Caveat, stated: OPFS skips the File System Access permission layer a
// user-picked folder goes through, so real folders are slower; this is the
// floor, and the question is whether the floor is already too high.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('usage: node scripts/probe-open-scale.mjs <world-folder> <dev-server-url>');
  process.exit(2);
}
const [worldDir, devUrl] = args;
const elementsDir = join(worldDir, 'elements');
const files = [];
for (const type of readdirSync(elementsDir)) {
  const d = join(elementsDir, type);
  if (!statSync(d).isDirectory()) continue;
  for (const name of readdirSync(d)) {
    if (name.endsWith('.json')) files.push({ type, name, text: readFileSync(join(d, name), 'utf8') });
  }
}
const worldJson = readFileSync(join(worldDir, 'world.json'), 'utf8');
console.log(`config: world=${worldDir} files=${files.length} url=${devUrl}`);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(devUrl);
await page.waitForFunction(() => Boolean(window.__atlasTestApi), null, { timeout: 60_000 });
await page.evaluate(async (wj) => {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry('scale-world', { recursive: true }); } catch { /* absent */ }
  const w = await root.getDirectoryHandle('scale-world', { create: true });
  const h = await w.getFileHandle('world.json', { create: true });
  const wr = await h.createWritable(); await wr.write(wj); await wr.close();
}, worldJson);
const CHUNK = 1000;
for (let i = 0; i < files.length; i += CHUNK) {
  await page.evaluate(async (batch) => {
    const root = await navigator.storage.getDirectory();
    const w = await root.getDirectoryHandle('scale-world');
    const el = await w.getDirectoryHandle('elements', { create: true });
    for (const f of batch) {
      const d = await el.getDirectoryHandle(f.type, { create: true });
      const h = await d.getFileHandle(f.name, { create: true });
      const wr = await h.createWritable();
      await wr.write(f.text);
      await wr.close();
    }
  }, files.slice(i, i + CHUNK));
}
const result = await page.evaluate(async () => {
  const api = window.__atlasTestApi;
  const root = await navigator.storage.getDirectory();
  const w = await root.getDirectoryHandle('scale-world');
  const store = new api.FsFolderStore({ tabId: 'probe-tab', disableHeartbeat: true });
  const t0 = performance.now();
  await store.open(w);
  const tOpen = performance.now() - t0;
  const t1 = performance.now();
  const first = await store.listElements();
  const tList = performance.now() - t1;
  const t2 = performance.now();
  await store.listElements();
  const tWarm = performance.now() - t2;
  await store.close();
  return { n: first.length, tOpen, tList, tWarm };
});
await browser.close();
const f = (ms) => `${ms.toFixed(0)}ms`;
console.log(`elements listed ${result.n} of ${files.length} files · open ${f(result.tOpen)} · first list ${f(result.tList)} · warm list ${f(result.tWarm)}`);
