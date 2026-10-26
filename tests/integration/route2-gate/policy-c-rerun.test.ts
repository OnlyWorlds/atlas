/**
 * Promoted from the composition gate (lens A).
 * Lens A attack 1 (policy c branch): the design's crash story for the server
 * phase is "a rerun matches everything by id (a created-but-unstamped element
 * is in the server list), so nothing duplicates". True. But under policy c a
 * same-id match means "the server's record wins": the rerun applies the server
 * copy over the local file, with `dropLocal: ['atlas_richtext_json']`.
 *
 * An element that was LOCAL-ONLY before the first run (a create, never a
 * match) and that the first run uploaded before the tab closed is, on the
 * rerun, a same-id match. So:
 *   - an edit the user made to it between the crash and the rerun is reverted
 *     to the uploaded copy and stamped clean (never reaches the server);
 *   - its rich-text sidecar is dropped although nothing on the server differs.
 *
 * These rows assert the FIXED behaviour (the user's own new elements are never
 * treated as "the server's version"). RED today.
 */
import { describe, it, expect } from 'vitest';
import { mergeLocalIntoApi } from '../../../src/sync/make-online';
import { SyncEngine } from '../../../src/sync/sync-engine';
import { OwV2ClientAdapter } from '../../../src/sync/ow-v2-client-adapter';
import { V2, freshServer, world, putEl, open, srv, instrumentHang, runUntilHangOrDone } from './harness';

console.debug = () => undefined;
console.info = () => undefined;

const C1 = '00000000-0000-4000-8000-0000000000d1';
const C2 = '00000000-0000-4000-8000-0000000000d2';
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] }] });

describe('lens A: policy c rerun after a crash in the create window', () => {
  for (const mode of ['after /bulk committed, before any stamp', 'after the stamps landed'] as const) {
    it(`${mode}: the user's post-crash edit to their own new element survives, and its sidecar stays`, async () => {
      const { server, adapter } = freshServer();
      const root = world();
      putEl(root, { id: C1, type: 'narrative', name: 'Scene', story: '**hello**', atlas_richtext_json: doc('hello') });
      putEl(root, { id: C2, type: 'object', name: 'Cup', description: 'cup' });
      const s1 = await open(root);
      const inst = mode.startsWith('after /bulk')
        ? instrumentHang(adapter, ['bulkCreate'], { method: 'bulkCreate', nth: 1, mode: 'after' })
        : instrumentHang(s1, ['stampServerUpdatedAt'], { method: 'stampServerUpdatedAt', nth: 2, mode: 'after' });
      const out = await runUntilHangOrDone(mergeLocalIntoApi(s1, adapter, 'c', { worldId: 'w1' }), inst.whenCrashed);
      expect(out.done).toBe(false);
      expect(srv(server, 'object').has(C2)).toBe(true); // the first run uploaded them

      // Reload. The user fixes a typo in their Cup, then runs Make online again.
      const s2 = await open(root);
      await s2.updateElement(C2, { description: 'a chipped cup' });
      const a2 = new OwV2ClientAdapter({ apiKey: 'k', apiPin: '1234', baseUrl: V2 });
      const m = await mergeLocalIntoApi(s2, a2, 'c', { worldId: 'w1' });
      expect(m.failures).toEqual([]);

      const cup = (await s2.getElement(C2))!;
      const scene = (await s2.getElement(C1))! as unknown as Record<string, unknown>;
      await new SyncEngine({ folder: s2, client: a2 }).syncNow();
      expect.soft(cup.description, 'the edit survives the rerun').toBe('a chipped cup');
      expect.soft(srv(server, 'object').get(C2)?.description, 'and reaches the server').toBe('a chipped cup');
      expect.soft(scene.atlas_richtext_json, 'the sidecar of a scene the user wrote stays').toEqual(doc('hello'));
    });
  }
});
