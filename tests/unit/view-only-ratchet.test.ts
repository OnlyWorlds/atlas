/**
 * The view-only ratchet (conv. 149): a UI module that starts a write to
 * the world asks `worldIsViewOnly()` and offers nothing the store would refuse.
 * A census found 78 such paths unguarded beside 10 guarded; the sweep
 * closed them, and this keeps a new one from opening quietly.
 *
 * A UI file that calls a world-writing store method (the ones behind the
 * store's view-only guard, plus the spatial helpers over them) must either
 * read `worldIsViewOnly` or say why it need not, with a `// view-only-ok: <why>`
 * comment (its writes sit behind a door that is already guarded elsewhere, or
 * are not reachable on a view-only world). The rest are the baseline, which
 * may only shrink: a new file may not join it, and a file that leaves must be
 * taken out in the same change.
 *
 * To shrink the baseline: run this file with UPDATE_VIEW_ONLY_BASELINE=1, then
 * read the diff of the JSON.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// It reads the source tree: on a machine another suite holds, a scan has run past the default 15 s.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(process.cwd());
const SCAN_DIRS = ['ui', 'middle', 'sidebar', 'tabs', 'visualization'].map(d => join(ROOT, 'src', d));
const BASELINE_PATH = join(ROOT, 'tests', 'unit', 'view-only-baseline.json');

const WRITES = /(?<!document)\.(?:createElement|createElementVerbatim|updateElement|updateElementWith|deleteElement|addMedia|deleteMedia|writeCharts|writeStyles|writeWorldMeta|createPin|updatePin|deletePin|updateMap|updateZone|createMarker|updateMarker|deleteMarker)\(/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (s.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts')) yield full;
  }
}

function unguardedWriters(): string[] {
  const out: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      const src = readFileSync(file, 'utf8');
      const writes = src.split('\n').some(l => !/^\s*(\/\/|\*)/.test(l) && WRITES.test(l));
      if (!writes) continue;
      if (src.includes('worldIsViewOnly') || /\/\/ view-only-ok: \S/.test(src)) continue;
      out.push(relative(ROOT, file).replace(/\\/g, '/'));
    }
  }
  return out.sort();
}

describe('the view-only ratchet (conv. 149)', () => {
  it('no UI file that writes the world skips the view-only read, beyond the shrinking baseline', () => {
    const now = unguardedWriters();
    if (process.env.UPDATE_VIEW_ONLY_BASELINE) {
      writeFileSync(BASELINE_PATH, JSON.stringify(now, null, 2) + '\n');
      return;
    }
    const baseline: string[] = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    const added = now.filter(f => !baseline.includes(f));
    const gone = baseline.filter(f => !now.includes(f));
    expect(added, 'a UI file writes the world without asking worldIsViewOnly (or a // view-only-ok: <why>)').toEqual([]);
    expect(gone, 'these files left the baseline: take them out of view-only-baseline.json').toEqual([]);
  });

  it('the scan finds a known writer (the instrument can see)', () => {
    const src = readFileSync(join(ROOT, 'src', 'middle', 'element-detail-fields.ts'), 'utf8');
    expect(src.split('\n').some(l => WRITES.test(l))).toBe(true);
    expect(WRITES.test('document.createElement(\'div\')')).toBe(false);
  });
});
