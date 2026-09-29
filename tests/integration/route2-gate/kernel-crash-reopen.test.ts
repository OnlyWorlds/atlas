/**
 * Promoted from the S367 composition gate (lens A).
 * Lens A attack 1 (kernel branch), the shapes the keeper's matrix does not
 * build: it THROWS inside five kernel methods and recovers IN-SESSION with the
 * same store instance. Here the tab DIES (a call that never settles, before or
 * after the real call) at every store call the kernel makes, including the
 * ones the matrix does not instrument: `writeRekeyJournal` (its first write and
 * any later one), step 5 `readCharts`/`writeCharts`, step 5b
 * `readWorldPrefs`/`writeWorldPrefs`, `updateSyncState`, `clearRekeyJournal`.
 * Then the folder is REOPENED with a new store (the activation path:
 * `recoverRekey` if a journal is on disk) and Route 2 is run again.
 *
 * All expected to HOLD: no server write while the journal exists, one Alice,
 * O gone, charts + world-prefs.json + media on N, the first round converges.
 */
import { describe, it, expect } from 'vitest';
import { mergeLocalIntoApi } from '../../../src/sync/make-online';
import { recoverRekey } from '../../../src/store/rekey';
import { SyncEngine } from '../../../src/sync/sync-engine';
import { OwV2ClientAdapter } from '../../../src/sync/ow-v2-client-adapter';
import { V2, freshServer, world, putEl, open, srv, allServerRecords, instrumentHang, runUntilHangOrDone, j, JOURNAL } from './harness';

console.debug = () => undefined;
console.info = () => undefined;

const O = '00000000-0000-4000-8000-0000000000a1';
const OLATE = '00000000-0000-4000-8000-0000000000f1';
const N = '00000000-0000-4000-8000-0000000000b1';
const R = '00000000-0000-4000-8000-0000000000c1';

const KERNEL = ['writeRekeyJournal', 'createElementVerbatim', 'copyMediaDir', 'updateElementWith', 'readCharts', 'writeCharts',
  'readWorldPrefs', 'writeWorldPrefs', 'deleteElement', 'removeMediaDir', 'updateSyncState', 'clearRekeyJournal'] as const;

async function scenario(oId: string) {
  const { server, adapter } = freshServer();
  await adapter.createElement('character', { id: N, name: 'Alice', description: 'server' });
  const root = world();
  putEl(root, { id: oId, type: 'character', name: 'Alice', description: 'local', image_media_id: 'm1' });
  root.put(`media/${oId}/default/pic.png`, 'PNG');
  root.put(`media/${oId}/default/m1.meta.json`, j({ id: 'm1', element_id: oId, folder: 'default', filename: 'pic.png', mime: 'image/png', size_bytes: 3, added_at: 'x' }));
  putEl(root, { id: R, type: 'narrative', name: 'Tale', characters: [oId], story: `[Alice](ow://character/${oId})` });
  root.put('.atlas/charts.json', j({ charts: [{ id: 'c1', name: 'Life', scope: { kind: 'focus', elementId: oId } }] }));
  root.put('.atlas/world-prefs.json', j({ favorites: { protagonist_id: oId }, active_calendar_id: oId }));
  return { server, adapter, root, seeded: server.opLog.length };
}

describe('lens A: the tab dies inside the kernel at every store call, then reopen, recover, rerun', () => {
  for (const [order, oId] of [['O sorts first', O], ['O sorts last', OLATE]] as const) {
    it(`${order}: converges from every kernel call, before and after`, async () => {
      const clean = await scenario(oId);
      const s0 = await open(clean.root);
      const counts: Record<string, number> = Object.fromEntries(KERNEL.map(k => [k, 0]));
      const rec = s0 as unknown as Record<string, (...a: unknown[]) => unknown>;
      for (const m of KERNEL) {
        const orig = rec[m].bind(s0);
        rec[m] = (...a: unknown[]) => {
          counts[m]++; // every call: a crash before the journal exists must converge too
          return orig(...a);
        };
      }
      await mergeLocalIntoApi(s0, clean.adapter, 'b', { worldId: 'w1' });
      for (const m of ['writeRekeyJournal', 'readCharts', 'writeCharts', 'readWorldPrefs', 'writeWorldPrefs', 'updateSyncState', 'clearRekeyJournal']) {
        expect(counts[m], `${m} called in the kernel window`).toBeGreaterThan(0);
      }

      let runs = 0;
      for (const method of KERNEL) {
        for (let k = 1; k <= counts[method]; k++) {
          for (const mode of ['before', 'after'] as const) {
            const label = `${order}/${method}#${k}/${mode}`;
            const { server, adapter, root, seeded } = await scenario(oId);
            const s1 = await open(root);
            const inner = instrumentHang(s1, KERNEL, { method, nth: k, mode });
            void inner;
            const out = await runUntilHangOrDone(mergeLocalIntoApi(s1, adapter, 'b', { worldId: 'w1' }), inner.whenCrashed);
            expect(inner.crashed(), label).toBe(true);
            // Any server write before the crash is only legal if the journal was already cleared.
            if (root.get(JOURNAL) !== null) expect(server.opLog.length, `${label}: no server write while the journal exists`).toBe(seeded);

            // Reload: activation finishes a journal if there is one.
            const s2 = await open(root);
            if (await s2.hasRekeyJournal()) await recoverRekey(s2);
            const a2 = new OwV2ClientAdapter({ apiKey: 'k', apiPin: '1234', baseUrl: V2 });
            const m = await mergeLocalIntoApi(s2, a2, 'b', { worldId: 'w1' });
            expect(m.failures, label).toEqual([]);
            expect([...srv(server, 'character').values()].filter(e => e.name === 'Alice').map(e => e.id), `${label}: one Alice`).toEqual([N]);
            expect(JSON.stringify(allServerRecords(server)), `${label}: no server record names O`).not.toContain(oId);
            expect(await s2.getElement(oId), `${label}: O gone`).toBeNull();
            expect((await s2.getElement(R))!.characters, `${label}: referrer on N`).toEqual([N]);
            expect(root.get('.atlas/charts.json'), `${label}: chart on N`).toContain(N);
            expect(root.get('.atlas/charts.json'), `${label}: chart not on O`).not.toContain(oId);
            expect(JSON.parse(root.get('.atlas/world-prefs.json')!), `${label}: prefs on N`).toEqual({ favorites: { protagonist_id: N }, active_calendar_id: N });
            await s2.awaitTidies();
            expect(root.get(`media/${N}/default/pic.png`), `${label}: media on N`).toBe('PNG');
            expect(root.list().filter(p => p.startsWith(`media/${oId}/`)), `${label}: no media on O`).toEqual([]);
            const engine = new SyncEngine({ folder: s2, client: a2 });
            const r = await engine.syncNow();
            expect(r.conflicts, label).toEqual([]);
            expect(r.pushed.creates, label).toBe(0);
            expect(await engine.listServerDeletes(), label).toEqual([]);
            expect((await engine.syncNow()).pushed, label).toEqual({ creates: 0, updates: 0, deletes: 0 });
            runs++;
          }
        }
      }
      expect(runs).toBeGreaterThan(15);
    }, 120_000);
  }
});
