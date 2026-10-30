/**
 * "Already up to date" only after a round that reached OnlyWorlds and moved,
 * clashed and failed nothing (#198's live walk: one press said "Sync
 * paused" and "Already up to date" together, on a refused key).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { upToDate } from '../../src/ui/sync-toasts';
import type { SyncResult } from '../../src/core/types';

function round(over: Partial<SyncResult> = {}): SyncResult {
  return {
    pushed: { creates: 0, updates: 0, deletes: 0 },
    pulled: { creates: 0, updates: 0, deletes: 0 },
    conflicts: [],
    failures: [],
    ...over,
  };
}

describe('upToDate', () => {
  it('a quiet round is up to date', () => {
    expect(upToDate(round())).toBe(true);
  });

  it('a refused key is not', () => {
    expect(upToDate(round({ auth_blocked: true, auth_reason: 'key_unknown' }))).toBe(false);
  });

  it('a busy or unreachable OnlyWorlds is not', () => {
    expect(upToDate(round({ transient_blocked: true, transient_reason: 'offline' }))).toBe(false);
  });

  it('a failed write is not', () => {
    expect(upToDate(round({ failures: [{ element_id: 'e1', type: 'character', op: 'create', error: 'x' } as never] }))).toBe(false);
  });

  it('a round that moved anything is not, pushes and meta included', () => {
    expect(upToDate(round({ pulled: { creates: 0, updates: 0, deletes: 1 } }))).toBe(false);
    expect(upToDate(round({ pushed: { creates: 1, updates: 0, deletes: 0 } }))).toBe(false);
    expect(upToDate(round({ meta_pulled: ['name'] } as never))).toBe(false);
    expect(upToDate(round({ meta_pushed: ['name'] } as never))).toBe(false);
  });
});

describe('every "Already up to date" asks upToDate', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith('.ts')) out.push(p);
    }
    return out;
  }

  it('no refresh site decides it by its own count', () => {
    const offenders: string[] = [];
    let sites = 0;
    for (const file of walk(join(__dirname, '../../src'))) {
      if (file.includes('changelog')) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i, lines) => {
        if (!line.includes("'Already up to date'")) return;
        sites++;
        const near = lines.slice(Math.max(0, i - 1), i + 1).join('\n');
        if (!near.includes('upToDate(')) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(sites).toBeGreaterThanOrEqual(4);
    expect(offenders).toEqual([]);
    // It reads every source file: on a machine another suite holds, that has run past the default 15 s.
  }, 60_000);
});
