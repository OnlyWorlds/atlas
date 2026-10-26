// PROBE: what does a content hash per element file cost when a world
// opens? Answers Skeld's design question for the sync-manifest bout
// (Notes/2026-09-28-shared-surface-design.md). Atlas already reads every
// element body at open (the index is built from bodies), so the hash's
// marginal cost is the digest, not the read. This measures both, in real
// Chromium, over the real bytes of a folder:
//   node scripts/probe-hash-cost.mjs <world-folder>
// Prints the configuration it ran and refuses unknown arguments.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('usage: node scripts/probe-hash-cost.mjs <world-folder>');
  process.exit(2);
}
const root = args[0];
const elementsDir = join(root, 'elements');
const texts = [];
for (const type of readdirSync(elementsDir)) {
  const dir = join(elementsDir, type);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.json')) texts.push(readFileSync(join(dir, f), 'utf8'));
  }
}
const bytes = texts.reduce((n, t) => n + Buffer.byteLength(t), 0);
console.log(`config: folder=${root} files=${texts.length} bytes=${bytes} (mean ${Math.round(bytes / texts.length)})`);

const browser = await chromium.launch();
const page = await browser.newPage();
// crypto.subtle needs a secure context; about:blank is not one.
await page.route('https://probe.local/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>probe</title>' }));
await page.goto('https://probe.local/');
const result = await page.evaluate(async (texts) => {
  const enc = new TextEncoder();
  const t0 = performance.now();
  const bufs = texts.map((t) => enc.encode(t));
  const tEncode = performance.now() - t0;
  // Parse: what atlas already pays at open, for scale.
  const t1 = performance.now();
  for (const t of texts) JSON.parse(t);
  const tParse = performance.now() - t1;
  // SHA-256, sequential (the simple implementation).
  const t2 = performance.now();
  for (const b of bufs) await crypto.subtle.digest('SHA-256', b);
  const tSeq = performance.now() - t2;
  // SHA-256, all in flight (what a batched implementation could do).
  const t3 = performance.now();
  await Promise.all(bufs.map((b) => crypto.subtle.digest('SHA-256', b)));
  const tPar = performance.now() - t3;
  // FNV-1a 32 in JS: a non-crypto hash is enough to detect change.
  const t4 = performance.now();
  for (const b of bufs) { let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); } }
  const tFnv = performance.now() - t4;
  // Known-answer check: the digest really ran (compared with node below).
  const kat = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bufs[0]))).map((x) => x.toString(16).padStart(2, '0')).join('');
  return { tEncode, tParse, tSeq, tPar, tFnv, kat };
}, texts);
await browser.close();
const { createHash } = await import('node:crypto');
const nodeKat = createHash('sha256').update(texts[0], 'utf8').digest('hex');
console.log(`known-answer: browser ${result.kat.slice(0, 16)} node ${nodeKat.slice(0, 16)} ${result.kat === nodeKat ? 'MATCH' : 'MISMATCH'}`);
const f = (ms) => `${ms.toFixed(0)}ms`;
console.log(`encode ${f(result.tEncode)} · JSON.parse (already paid) ${f(result.tParse)} · sha256 sequential ${f(result.tSeq)} · sha256 batched ${f(result.tPar)} · fnv1a ${f(result.tFnv)}`);
