/**
 * The cast is retired from the UI (1.113): a world's protagonist and home,
 * `favorites.protagonist_id` and `favorites.nexus_id`, are kept as they were
 * (the registry entry, `.atlas/world-prefs.json`) and no longer shown or
 * written. Only the type, the registry (its re-key remap), the world-prefs
 * mirror and the re-key's world-prefs remap read them; nothing else in `src/`
 * may, and the UI that showed or set them stays gone.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '../../src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|css|html|json)$/.test(p)) out.push(p);
  }
  return out;
}

const rel = (file: string): string => relative(SRC, file).split(sep).join('/');

/** The files that may read the stored cast: the type, the registry, the mirror, the re-key. */
const READERS = (path: string): boolean =>
  path === 'core/types.ts' || path.startsWith('registry/') || path === 'core/world-prefs.ts' || path === 'store/rekey.ts';

/** What only the cast's UI used: its state, its writer, its classes, its icons, its words. */
const UI_REMNANTS = [
  'castAssign',
  'setWorldFavoriteElement',
  'atlas-home-cast',
  'atlas-cast-assign',
  'atlas-timeline-rail-cast',
  'atlas-header-favorite',
  'set-cast-favorite',
  'person_pin',
  'home_pin',
  'protagonistId',
  'nexusId',
  'Choose a protagonist',
  'Choose a home',
];

describe('the cast is retired', () => {
  const files = walk(SRC).filter(f => !rel(f).startsWith('changelog/'));

  it('protagonist_id and nexus_id are read only by the type, the registry, the mirror and the re-key', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (READERS(rel(file))) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/protagonist_id|nexus_id/.test(line)) offenders.push(`${rel(file)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  }, 60_000);

  it('favorites is reached only there too', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (READERS(rel(file))) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/\.favorites\b|\bfavorites\?\./.test(line)) offenders.push(`${rel(file)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  }, 60_000);

  it('nothing of the cast UI is left', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const word of UI_REMNANTS) if (text.includes(word)) offenders.push(`${rel(file)}: ${word}`);
    }
    expect(offenders).toEqual([]);
  }, 60_000);

  it('the stored cast is still a world pref, so a copied folder carries it', async () => {
    const { WORLD_PREF_KEYS } = await import('../../src/core/world-prefs');
    expect(WORLD_PREF_KEYS).toContain('favorites');
  });
});
