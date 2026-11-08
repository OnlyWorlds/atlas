/**
 * The store and `active` move together. A flow that opens a world calls
 * `setActiveStore(store)` and then patches the `active` slice to that world.
 * An `await` between the two leaves a gap where the store is the new world's
 * and `active` still names the old one: a write captured there (a label saved
 * on blur) pairs one world's store with another's entry, and a second open
 * landing in the gap leaves the screen naming one world over another's store.
 *
 * So, in every source file: after a `setActiveStore(<a store>)` call, the
 * code up to the next `patchSlice('active'` holds no `await`. Read anything
 * the patch needs (the world's meta) before the store moves.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '../../src');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.ts')) yield full;
  }
}

/** Each `setActiveStore(x)` call (x not null) whose stretch to the next active patch holds an await. */
export function gapsIn(text: string): string[] {
  const out: string[] = [];
  const call = /setActiveStore\(([^)]*)\)/g;
  for (let m = call.exec(text); m; m = call.exec(text)) {
    const arg = m[1].trim();
    if (arg === '' || arg === 'null' || /^[a-zA-Z]+:/.test(arg)) continue; // a clear, or the declaration itself
    const after = text.slice(m.index + m[0].length);
    const next = after.indexOf("patchSlice('active'");
    if (next < 0) continue;
    // Only the stretch inside this function: stop at the next function's start.
    if (/\bfunction\b|=>\s*\{/.test(after.slice(0, next))) continue;
    // Through the end of the patch statement: an await in its own arguments is the same gap.
    const end = after.indexOf(';', next);
    const stretch = after.slice(0, end < 0 ? after.length : end);
    if (/\bawait\b/.test(stretch)) out.push(text.slice(0, m.index).split('\n').length.toString());
  }
  return out;
}

describe('the store and active move together', () => {
  it('no source file awaits between setActiveStore and its active patch', () => {
    const found: string[] = [];
    for (const file of walk(SRC)) {
      for (const line of gapsIn(readFileSync(file, 'utf8'))) found.push(`${relative(SRC, file)}:${line}`);
    }
    expect(found).toEqual([]);
  });

  it('the scan sees a gap when there is one (the instrument, against a known positive)', () => {
    const gap = "setActiveStore(store);\n  patchSlice('active', { worldId, meta: await store.readWorldMeta(), opened: true });";
    const paired = "const meta = await store.readWorldMeta();\n  setActiveStore(store);\n  patchSlice('active', { worldId, meta, opened: true });";
    expect(gapsIn(gap)).toEqual(['1']);
    expect(gapsIn(paired)).toEqual([]);
    expect(gapsIn('setActiveStore(null);\n await x;\n patchSlice(\'active\', null);')).toEqual([]);
  });
});
