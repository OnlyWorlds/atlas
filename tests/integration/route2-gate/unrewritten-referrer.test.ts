/**
 * Promoted from the composition gate (lens A).
 * Lens A: a referrer the kernel could not rewrite (its file will not parse: a
 * git conflict landed after the app listed it) is skipped and named in
 * `unrewritten` (kernel lens 1 F7). The server phase then reads bodies with
 * `sendable` → `getElement`, which serves the CACHE, i.e. the body as it was
 * before the conflict, still naming O. So Route 2 uploads a record that names
 * an id the server will never have (invariant 2: "no server element carries an
 * O id"; invariant 4 for the server copy) and stamps it as synced.
 *
 * Asserts the FIXED behaviour: an unrewritten element is not sent (or not
 * stamped) by the server phase; no server record names O. RED today if the
 * cached body goes up.
 */
import { describe, it, expect } from 'vitest';
import { mergeLocalIntoApi } from '../../../src/sync/make-online';
import { freshServer, world, putEl, open, srv, allServerRecords, pathOf } from './harness';

console.debug = () => undefined;
console.info = () => undefined;

const O = '00000000-0000-4000-8000-0000000000a1';
const N = '00000000-0000-4000-8000-0000000000b1';
const R = '00000000-0000-4000-8000-0000000000c1';

describe('lens A: an unrewritten referrer in the server phase', () => {
  for (const policy of ['b', 'c'] as const) {
    it(`policy ${policy}: nothing that names O reaches the server, and nothing is stamped from a body the disk does not hold`, async () => {
      const { server, adapter } = freshServer();
      await adapter.createElement('character', { id: N, name: 'Alice' });
      const root = world();
      putEl(root, { id: O, type: 'character', name: 'Alice' });
      putEl(root, { id: R, type: 'narrative', name: 'Tale', story: `[Alice](ow://character/${O}) waits.` });
      const s = await open(root);
      await s.listElements(); // the app's list: R is cached

      // A git pull leaves conflict markers in R's file.
      const p = pathOf(root, R)!;
      root.put(p, '<<<<<<< HEAD\n{"id": "x"}\n=======\n{}\n>>>>>>> theirs\n');

      const m = await mergeLocalIntoApi(s, adapter, policy, { worldId: 'w1' });
      expect(m.unrewritten).toEqual([R]);
      expect(JSON.stringify(allServerRecords(server)), 'no server record names O').not.toContain(O);
    });
  }
});

describe('lens A: a stamp that throws inside the /bulk path', () => {
  it('a file that will not parse when its /bulk stamp lands is one failure row, not an abort of the whole server phase', async () => {
    const { server, adapter } = freshServer();
    await adapter.createElement('character', { id: N, name: 'Alice', description: 'server' });
    const C2 = '00000000-0000-4000-8000-0000000000d2';
    const root = world();
    putEl(root, { id: O, type: 'character', name: 'Alice', description: 'local' });
    putEl(root, { id: R, type: 'narrative', name: 'Tale', story: 'no links' });
    putEl(root, { id: C2, type: 'object', name: 'Cup' });
    const s = await open(root);
    await s.listElements();
    root.put(pathOf(root, R)!, '<<<<<<< HEAD\n{}\n>>>>>>> theirs\n'); // after listing, before the merge
    let threw: unknown = null;
    let m: Awaited<ReturnType<typeof mergeLocalIntoApi>> | null = null;
    try { m = await mergeLocalIntoApi(s, adapter, 'b', { worldId: 'w1' }); } catch (e) { threw = e; }
    expect(threw, 'the merge returns with a failure row').toBeNull();
    expect(srv(server, 'character').get(N)?.description, 'the matched update still ran').toBe('local');
  });
});

