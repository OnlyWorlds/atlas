// PROBE (S359): on reviving a parked world, is a stat pass over every file
// (getFile().lastModified) much cheaper than simply re-reading every body?
// Answers the revive question in Notes/2026-09-28-shared-surface-design.md §2.
// Seeds the folder's element files into OPFS in real Chromium, then times:
//   stat: getFile() per handle, read lastModified only
//   read: getFile().text() per handle (what a cold open's index pays)
//   node scripts/probe-revive-cost.mjs <world-folder>
// Prints the configuration it ran and refuses unknown arguments.
// Caveat, stated: OPFS is the browser's own storage; a user-picked folder
// goes through the File System Access permission layer and is slower. This
// gives the RATIO, which is the design question, not the absolute cost.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('usage: node scripts/probe-revive-cost.mjs <world-folder>');
  process.exit(2);
}
const elementsDir = join(args[0], 'elements');
const files = [];
for (const type of readdirSync(elementsDir)) {
  const dir = join(elementsDir, type);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) files.push({ type, name: f, text: readFileSync(join(dir, f), 'utf8') });
}
console.log(`config: folder=${args[0]} files=${files.length}`);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('https://probe.local/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>probe</title>' }));
await page.goto('https://probe.local/');
// Seed in chunks so one evaluate payload stays small.
await page.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true });
});
const CHUNK = 1000;
for (let i = 0; i < files.length; i += CHUNK) {
  await page.evaluate(async (batch) => {
    const root = await navigator.storage.getDirectory();
    const el = await root.getDirectoryHandle('elements', { create: true });
    for (const f of batch) {
      const d = await el.getDirectoryHandle(f.type, { create: true });
      const h = await d.getFileHandle(f.name, { create: true });
      const w = await h.createWritable();
      await w.write(f.text);
      await w.close();
    }
  }, files.slice(i, i + CHUNK));
}
const result = await page.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const el = await root.getDirectoryHandle('elements');
  const handles = [];
  const t0 = performance.now();
  for await (const d of el.values()) {
    if (d.kind !== 'directory') continue;
    for await (const f of d.values()) if (f.kind === 'file') handles.push(f);
  }
  const tWalk = performance.now() - t0;
  const t1 = performance.now();
  let newest = 0;
  for (const h of handles) newest = Math.max(newest, (await h.getFile()).lastModified);
  const tStat = performance.now() - t1;
  const t2 = performance.now();
  let chars = 0;
  for (const h of handles) chars += (await (await h.getFile()).text()).length;
  const tRead = performance.now() - t2;
  return { n: handles.length, tWalk, tStat, tRead, chars, newestOk: newest > 0 };
});
await browser.close();
const f = (ms) => `${ms.toFixed(0)}ms`;
console.log(`handles ${result.n} (seeded ${files.length}) · walk ${f(result.tWalk)} · stat pass ${f(result.tStat)} · read pass ${f(result.tRead)} · read/stat ${(result.tRead / result.tStat).toFixed(2)}x · lastModified sane ${result.newestOk}`);
