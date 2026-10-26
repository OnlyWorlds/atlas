/**
 * Route 2 (link a local world to an existing api world) hands off to the
 * FIRST production sync round: the /changes cold walk, v2 adapter over the
 * keel-v2 MSW. After a name-match swap, a download and a local-only create
 * the round must converge: no conflicts, no server-delete prompts, no second
 * create, and a quiet second round. (Promoted from a probe.
 * A GUARD: green with and without the fixes around it, so not revert-checkable against
 * them; it pins today's hand-off before the Route 2 rebuild, which adds the
 * prose-id assertion here.)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { mergeLocalIntoApi } from '../../src/sync/make-online';
import { SyncEngine } from '../../src/sync/sync-engine';
import { elementFilename } from '../../src/store/fs-utils';

const V2 = 'https://test-ow.local/api/v2';
const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const clock = () => new Date(Date.UTC(2026, 1, 1, 0, 0, t++)).toISOString();
const O = '00000000-0000-4000-8000-0000000000a1';
const N = '00000000-0000-4000-8000-0000000000b1';
const S = '00000000-0000-4000-8000-0000000000e1';
const R = '00000000-0000-4000-8000-0000000000c1';

let server: ReturnType<typeof statefulV2Handlers>;
let adapter: OwV2ClientAdapter;
beforeEach(() => {
  server = statefulV2Handlers({ baseUrl: V2, clock });
  mswServer.use(...server.handlers);
  adapter = new OwV2ClientAdapter({ apiKey: 'k', apiPin: '1234', baseUrl: V2 });
});

describe('Route 2 then the first /changes round', () => {
  for (const policy of ['b', 'c'] as const) {
    it(`policy ${policy}: converges, no conflicts, no server-delete review, no second create`, async () => {
      await adapter.createElement('character', { id: N, name: 'Alice', description: 'server' });
      await adapter.createElement('location', { id: S, name: 'Server Only' });
      const root = new FakeDirHandle('w');
      root.put('world.json', j({ id: 'w1', name: 'W' }));
      const put = (el: Record<string, unknown>) => root.put(`elements/${el.type}/${elementFilename(el.id as string, el.name as string)}`, j({ local_updated_at: '2026-01-01T00:00:00.000Z', ...el }));
      put({ id: O, type: 'character', name: 'Alice', description: 'local' });
      put({ id: R, type: 'narrative', name: 'Tale', characters: [O], story: `[Alice](ow://character/${O})` });
      const s = new FsFolderStore({ clock, tabId: 't', disableHeartbeat: true, forceTakeLock: true });
      await s.open(root as unknown as FileSystemDirectoryHandle);
      const m = await mergeLocalIntoApi(s, adapter, policy);
      expect(m.failures).toEqual([]);
      const engine = new SyncEngine({ folder: s, client: adapter });
      const r = await engine.syncNow();
      expect(r.conflicts).toEqual([]);
      expect(await engine.listServerDeletes()).toEqual([]);
      expect(r.pushed.creates).toBe(0);
      const creates = [...(server.state.get('character')?.values() ?? [])].filter(e => e.name === 'Alice');
      expect(creates.length).toBe(1);
      const r2 = await engine.syncNow();
      expect(r2.pushed).toEqual({ creates: 0, updates: 0, deletes: 0 });
    });
  }
});
