/**
 * The stamp ratchet (DESIGN_LAWS conv. 190, R1): an element time is ordered
 * only through `stampOrder` (`src/store/sync-stamp.ts`), as an instant. Anywhere
 * else in `src`, a line may not hold a `<`, `>`, `<=`, `>=`, `localeCompare` or
 * `Date.parse` on a value read from `local_updated_at`, `server_updated_at`,
 * `updated_at`, `deleted_at` or `created_at` (or the adapter's camelCase), a
 * name that holds one, or a name that says it is one
 * (`tests/fixtures/stamp-reading-scan.ts`). As text, an outside tool's edit at
 * `00:10:00-05:00` sorted before keel's `05:06:07+00:00` and was never uploaded.
 *
 * Equality is not read here: a stamp compared with `===` to one Atlas read or
 * sent before is an echo, not a time, and stays text (R2).
 *
 * The allowed lines, each named by its file and a piece of its text, are the
 * ones the contract leaves out of scope: Atlas's own registry stamps, written
 * by Atlas in one form. An allowed line that no longer reads a stamp fails too,
 * so the list never outlives its lines.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { stampReadings } from '../fixtures/stamp-reading-scan';

// It reads the source tree: on a busy machine a scan has run past the default 15 s.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(process.cwd());
const SRC = join(ROOT, 'src');
/** User copy, never code. */
const COPY = new Set(['src/changelog/changelog.data.ts']);

/** Out of scope: Atlas's own fixed-form stamps (the registry's, the home's keepsafe count). */
const ALLOWED: Array<{ file: string; text: string; why: string }> = [
  { file: 'src/core/browser-home.ts', text: "(prior.created_at ?? '') <= (w.created_at ?? '')", why: 'the registry entry Atlas wrote first, both in its own toISOString form' },
  { file: 'src/middle/home-keepsafe.ts', text: 'Date.parse(String((el as { local_updated_at?: unknown }).local_updated_at', why: 'the newest edit as a number for the keepsafe nudge, never a sync decision' },
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : /\.ts$/.test(name) ? [p] : [];
  });
}

const flagged = (src: string) => stampReadings(src).map(h => h.kind);

describe('the stamp ratchet', () => {
  it('no line in src orders a stamp outside stampOrder and the allowed lines', () => {
    const found: string[] = [];
    const used = new Set<number>();
    for (const file of sources(SRC)) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      if (COPY.has(rel) || rel === 'src/store/sync-stamp.ts') continue;
      for (const hit of stampReadings(readFileSync(file, 'utf8'))) {
        const allow = ALLOWED.findIndex(a => a.file === rel && hit.text.includes(a.text));
        if (allow >= 0) { used.add(allow); continue; }
        found.push(`${rel}:${hit.line} [${hit.kind}] ${hit.text}`);
      }
    }
    expect(found).toEqual([]);
    expect(ALLOWED.filter((_, i) => !used.has(i)).map(a => a.file)).toEqual([]);
  });

  it('sync-stamp.ts orders by stampOrder alone: no text order and no Date.parse there either', () => {
    const own = readFileSync(join(SRC, 'store/sync-stamp.ts'), 'utf8');
    expect(stampReadings(own).map(h => `${h.line} ${h.text}`)).toEqual([]);
  });

  // The census's sites as master held them (S603), each one a line the guard must flag.
  const MASTER: Record<string, string> = {
    liveFolderNotSynced: "if (el && el.server_updated_at && (el.local_updated_at ?? '') <= el.server_updated_at) count++;",
    liveFolderWillUpload: "const willUpload = !el.server_updated_at || (el.local_updated_at ?? '') > el.server_updated_at;",
    uploadSet: 'if (baseline === null) return elem.local_updated_at > elem.server_updated_at;',
    uploadSetSince: 'return elem.local_updated_at > baseline;',
    tombstonesSince: 'return all.filter(t => t.deleted_at > baseline);',
    inFlight: "if (typeof existing.local_updated_at === 'string' && existing.local_updated_at > serverUpdatedAt) return next;",
    inFlightParse: 'const serverMs = Date.parse(serverUpdatedAt);',
    editStamp: "if (typeof serverUpdatedAt !== 'string' || now > serverUpdatedAt) return now;",
    knownOf: "const unsent = !local.server_updated_at || (local.local_updated_at ?? '') > local.server_updated_at;",
    hideSweep: '&& !(e.local_updated_at > e.server_updated_at) && !skip.has(e.id) && !isKnownOf(e);',
    push: 'const serverMoved = remote.updated_at > baseline;',
    feedServer: "const baseline = local.server_updated_at ?? '';\nconst serverChanged = serverStamp > baseline;",
    feedLocal: 'const localChanged = !isKnownOf(local) && local.local_updated_at > baseline;',
    hiddenRow: "if (!local.server_updated_at || (local.local_updated_at ?? '') > local.server_updated_at) {",
    staleDelete: 'if (op.deletedAt && op.deletedAt <= local.server_updated_at) {',
    resync: "if (!drops || (el.local_updated_at ?? '') > el.server_updated_at) {",
    fullPullLocal: "const localBaseline = local.server_updated_at ?? '';\nconst localChanged = !isKnownOf(local) && local.local_updated_at > localBaseline;",
    fullPullServer: "const localBaseline = local.server_updated_at ?? '';\nconst serverChanged = remote.updated_at > localBaseline;",
    badge: "const localStamp = el.local_updated_at ?? '';\nconst serverStamp = el.server_updated_at ?? '';\nconst dirty = !serverStamp || localStamp > serverStamp;",
    authorAsServed: "const server = rec.server_updated_at;\nconst local = rec.local_updated_at;\nreturn typeof server === 'string' && !(typeof local === 'string' && local > server);",
    mentionItems: "const aT = a.local_updated_at ?? '';\nconst bT = b.local_updated_at ?? '';\nreturn aT < bT ? 1 : aT > bT ? -1 : 0;",
    contextTab: "const ts = String(rec.local_updated_at ?? rec.server_updated_at ?? '');\nif (!best || ts > bestTs) { best = e; bestTs = ts; }",
    nameMatch: "const aT = a.local_updated_at ?? '';\nconst bT = b.local_updated_at ?? '';\nreturn bT.localeCompare(aT);",
  };
  for (const [name, src] of Object.entries(MASTER)) {
    it(`flags master's ${name}`, () => {
      expect(flagged(src).length).toBeGreaterThanOrEqual(1);
    });
  }

  it('follows a name to the stamp it holds, and a destructured one', () => {
    expect(flagged('const { updated_at: ts } = remote;\nif (ts > held) go();')).toEqual(['compare']);
    expect(flagged('const when = el.created_at;\nconst later = when;\nlist.sort((a, b) => later < b);')).toEqual(['compare']);
    expect(flagged("const t = (el as { deleted_at?: string }).deleted_at ?? '';\nif (t >= cutoff) x();")).toEqual(['compare']);
    expect(flagged("x.sort((a, b) => a.created_at.localeCompare(b.created_at));")).toEqual(['localeCompare']);
    expect(flagged('const ms = Date.parse(op.updatedAt);')).toEqual(['Date.parse']);
    expect(flagged("const ms = Date.parse(el['server_updated_at'] as string);")).toEqual(['Date.parse']);
  });

  it('lets through what orders no stamp, equality, comments and types', () => {
    expect(flagged('if (list.length > 0 && n >= 2) go();')).toEqual([]);
    expect(flagged('const m = new Map<string, { updated_at: string }>();')).toEqual([]);
    expect(flagged('Promise<{ id: string; updated_at: string } & Record<string, unknown>>')).toEqual([]);
    expect(flagged('if (local.local_updated_at === entry.local_updated_at) keep();')).toEqual([]);
    expect(flagged('// if (a.updated_at > b.updated_at)')).toEqual([]);
    expect(flagged('/* a.updated_at > b.updated_at */ ok();')).toEqual([]);
    expect(flagged('const f = (e: Element) => stampOrder(e.local_updated_at, e.server_updated_at) === 1;')).toEqual([]);
  });
});
