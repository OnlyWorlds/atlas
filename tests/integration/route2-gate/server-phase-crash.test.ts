/**
 * Promoted from the S367 composition gate (lens A).
 * Lens A attack 1: invariants 1-2 under crashes the keeper's matrix does NOT
 * inject. The keeper's matrix throws inside the KERNEL window only (journal on
 * disk). Here the tab dies in the SERVER phase, after the journal is cleared:
 * at every adapter write/read and every store stamp/apply, before or after the
 * real call. Then the folder is reopened with a new store (a reload), the user
 * edits one element, and Route 2 is run again with the same key.
 *
 * Asserted after the rerun (all expected to HOLD; a red row is a finding):
 *   - exactly one server record per name (no duplicate), none names O
 *   - O gone locally, N present
 *   - every element that reads CLEAN (stamped, local <= server) holds on disk
 *     the wire content the server holds (no false "synced")
 *   - policy b: the post-crash edit reached the server
 *   - then the first /changes round: no conflicts, no creates, no server-delete
 *     review; the second round pushes nothing
 */
import { describe, it, expect } from 'vitest';
import { mergeLocalIntoApi } from '../../../src/sync/make-online';
import { SyncEngine } from '../../../src/sync/sync-engine';
import { V2, freshServer, world, putEl, open, srv, allServerRecords, instrumentHang, runUntilHangOrDone, type Server } from './harness';
import type { FakeDirHandle } from '../../fixtures/fake-fs';
import { OwV2ClientAdapter } from '../../../src/sync/ow-v2-client-adapter';

const O = '00000000-0000-4000-8000-0000000000a1';   // local Alice, name-matches N
const N = '00000000-0000-4000-8000-0000000000b1';   // server Alice
const S = '00000000-0000-4000-8000-0000000000e1';   // server-only location
const R = '00000000-0000-4000-8000-0000000000c1';   // local narrative naming O
const C1 = '00000000-0000-4000-8000-0000000000d1';  // local-only object
const C2 = '00000000-0000-4000-8000-0000000000d2';  // local-only object
const T2 = '00000000-0000-4000-8000-0000000000d3';  // same id both sides

const ADAPTER_METHODS = ['createElement', 'bulkCreate', 'updateElement', 'getElement'] as const;
const STORE_METHODS = ['applyServerRecord', 'stampServerUpdatedAt'] as const;
const WIRE = ['name', 'description', 'story', 'characters'] as const;

async function scenario(): Promise<{ server: Server; adapter: OwV2ClientAdapter; root: FakeDirHandle }> {
  const { server, adapter } = freshServer();
  await adapter.createElement('character', { id: N, name: 'Alice', description: 'server alice' });
  await adapter.createElement('location', { id: S, name: 'Server Only' });
  await adapter.createElement('narrative', { id: T2, name: 'Chapter Two', story: 'server two' });
  const root = world();
  putEl(root, { id: O, type: 'character', name: 'Alice', description: 'local alice' });
  putEl(root, { id: R, type: 'narrative', name: 'Tale', characters: [O], story: `[Alice](ow://character/${O}) waits.` });
  putEl(root, { id: C1, type: 'object', name: 'Cup', description: 'cup' });
  putEl(root, { id: C2, type: 'object', name: 'Plate', description: 'plate' });
  putEl(root, { id: T2, type: 'narrative', name: 'Chapter Two', story: 'local two' });
  return { server, adapter, root };
}

async function checkConverged(server: Server, adapter: OwV2ClientAdapter, root: FakeDirHandle, policy: 'b' | 'c', label: string) {
  const s = await open(root);
  const byName = (type: string, name: string) => [...srv(server, type).values()].filter(e => e.name === name).map(e => e.id);
  expect(byName('character', 'Alice'), `${label}: one Alice`).toEqual([N]);
  expect(byName('object', 'Cup'), `${label}: one Cup`).toEqual([C1]);
  expect(byName('object', 'Plate'), `${label}: one Plate`).toEqual([C2]);
  expect(byName('narrative', 'Tale'), `${label}: one Tale`).toEqual([R]);
  expect(byName('narrative', 'Chapter Two'), `${label}: one Chapter Two`).toEqual([T2]);
  expect(JSON.stringify(allServerRecords(server)), `${label}: no server record names O`).not.toContain(O);
  expect(await s.getElement(O), `${label}: O gone`).toBeNull();
  expect(await s.getElement(N), `${label}: N local`).not.toBeNull();

  // No false "synced": a clean element holds what the server holds.
  for (const el of await s.listElements()) {
    const stamped = !!el.server_updated_at && !(el.local_updated_at > el.server_updated_at!);
    if (!stamped) continue;
    const remote = srv(server, el.type).get(el.id);
    expect(remote, `${label}: ${el.name} reads clean but the server does not have it`).toBeTruthy();
    for (const k of WIRE) {
      const a = (el as Record<string, unknown>)[k];
      const b = remote![k];
      if (a === undefined && (b === undefined || b === null || b === '' || (Array.isArray(b) && b.length === 0))) continue;
      expect(a, `${label}: ${el.name}.${k} reads clean but differs from the server`).toEqual(b);
    }
  }

  const engine = new SyncEngine({ folder: s, client: adapter });
  const r = await engine.syncNow();
  expect(r.conflicts, `${label}: first round conflicts`).toEqual([]);
  expect(await engine.listServerDeletes(), `${label}: server-delete review`).toEqual([]);
  expect(r.pushed.creates, `${label}: first round creates`).toBe(0);
  const r2 = await engine.syncNow();
  expect(r2.pushed, `${label}: second round quiet`).toEqual({ creates: 0, updates: 0, deletes: 0 });
  return s;
}

console.debug = () => undefined;
console.info = () => undefined;

describe('lens A attack 1: a tab closed in the SERVER phase, then reopen and rerun', () => {
  for (const policy of ['b', 'c'] as const) {
    it(`policy ${policy}: every server-phase call, before and after, converges with no duplicate and no false stamp`, async () => {
      // Clean run: count the server-phase calls.
      const clean = await scenario();
      const s0 = await open(clean.root);
      const ca = instrumentHang(clean.adapter, ADAPTER_METHODS);
      const cs = instrumentHang(s0, STORE_METHODS);
      await mergeLocalIntoApi(s0, clean.adapter, policy, { worldId: 'w1' });
      const counts = { ...ca.counts, ...cs.counts };
      expect(counts.bulkCreate).toBe(1);

      let runs = 0;
      for (const method of [...ADAPTER_METHODS, ...STORE_METHODS]) {
        for (let k = 1; k <= counts[method]; k++) {
          for (const mode of ['before', 'after'] as const) {
            const label = `${policy}/${method}#${k}/${mode}`;
            const { server, adapter, root } = await scenario();
            const s1 = await open(root);
            const isAdapter = (ADAPTER_METHODS as readonly string[]).includes(method);
            const inst = instrumentHang(isAdapter ? adapter : s1, isAdapter ? ADAPTER_METHODS : STORE_METHODS, { method, nth: k, mode });
            const out = await runUntilHangOrDone(mergeLocalIntoApi(s1, adapter, policy, { worldId: 'w1' }), inst.whenCrashed);
            expect(inst.crashed(), `${label}: crash fired`).toBe(true);
            expect(out.done, `${label}: merge abandoned`).toBe(false);
            expect(await s1.hasRekeyJournal(), `${label}: server phase runs after the journal cleared`).toBe(false);

            // Reload, the user edits the narrative, then Make Online again.
            const a2 = new OwV2ClientAdapter({ apiKey: 'k', apiPin: '1234', baseUrl: V2 });
            const s2 = await open(root);
            if (policy === 'b') await s2.updateElement(R, { description: 'edited after the crash' });
            const again = await mergeLocalIntoApi(s2, a2, policy, { worldId: 'w1' });
            expect(again.failures, label).toEqual([]);
            if (policy === 'b') expect(srv(server, 'narrative').get(R)?.description, `${label}: post-crash edit reached the server`).toBe('edited after the crash');
            await checkConverged(server, a2, root, policy, label);
            runs++;
          }
        }
      }
      expect(runs).toBeGreaterThan(8);
    }, 120_000);
  }
});
