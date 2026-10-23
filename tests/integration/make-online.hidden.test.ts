/**
 * Make online's merge and the hidden mark (folder spec §4.8, conv. 170; the
 * S461 gate's F2). A hidden element goes up hidden or not at all:
 * - a key that cannot hide (a contributor, a guest) is told before anything is
 *   sent, and nothing is;
 * - a hidden element is never matched by name: matched, policy b would put its
 *   content onto a shown one; it goes up as its own, hidden;
 * - a hidden element whose id OnlyWorlds shows is left as it is: neither sent
 *   nor downloaded over;
 * - one hidden on both sides is the same element, as before.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { mergeLocalIntoApi, MergeRefusedError, hiddenRouteRefusal } from '../../src/sync/make-online';
import { planMerge, type ServerRec } from '../../src/sync/plan-merge';
import type { Element, ElementType } from '../../src/core/types';

let folder: MockFolderStore;
let client: FakeOwApiClient;

const WREN = '00000000-0000-4000-8000-0000000000c1';
const ADA = '00000000-0000-4000-8000-0000000000c2';
const SRV_WREN = '00000000-0000-4000-8000-0000000000c3';

beforeEach(async () => {
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
});

describe('the merge', () => {
  it('a key that cannot hide is told first, and nothing is sent', async () => {
    client.keyRole = 'contributor';
    client.__as_member_seat('contributor');
    await folder.createElement('character', { id: WREN, name: 'Wren', hidden: true } as never);
    await folder.createElement('character', { id: ADA, name: 'Ada' } as never);
    const run = mergeLocalIntoApi(folder, client, 'b');
    await expect(run).rejects.toBeInstanceOf(MergeRefusedError);
    await expect(mergeLocalIntoApi(folder, client, 'b')).rejects.toThrow(hiddenRouteRefusal(1));
    expect(client.calls.filter(c => c.method === 'create' || c.method === 'update')).toEqual([]);
  });

  it('the owner\'s merge sends a hidden element as its own, hidden, never onto a shown one of the same name', async () => {
    await client.createElement('character', { id: SRV_WREN, name: 'Wren', description: 'A sailor.' });
    await folder.createElement('character', { id: WREN, name: 'Wren', description: 'The traitor.', hidden: true } as never);
    const r = await mergeLocalIntoApi(folder, client, 'b');
    expect(r.failures).toEqual([]);
    const chars = await client.listElements('character') as Array<Record<string, unknown>>;
    expect(chars.find(c => c.id === SRV_WREN)!.description).toBe('A sailor.');
    expect(chars.find(c => c.id === WREN)!.hidden).toBe(true);
  });

  it('a hidden element whose id is shown online is left as it is, and said', async () => {
    await client.createElement('character', { id: WREN, name: 'Wren', description: 'A sailor.' });
    await folder.createElement('character', { id: WREN, name: 'Wren', description: 'The traitor.', hidden: true } as never);
    const r = await mergeLocalIntoApi(folder, client, 'b');
    expect(r.hiddenOnline).toEqual([{ id: WREN, type: 'character', name: 'Wren' }]);
    expect(client.calls.filter(c => c.method === 'update')).toEqual([]);
    expect(((await folder.getElement(WREN)) as unknown as Record<string, unknown>).description).toBe('The traitor.');
    const server = (await client.listElements('character')).find(c => c.id === WREN) as Record<string, unknown>;
    expect(server.description).toBe('A sailor.');
  });
});

describe('planMerge', () => {
  const el = (id: string, name: string, extra: Record<string, unknown> = {}): Element =>
    ({ id, type: 'character', name, local_updated_at: 't', ...extra }) as unknown as Element;
  const srv = (id: string, name: string, extra: Record<string, unknown> = {}): ServerRec => ({ id, name, updated_at: 't', ...extra });
  const server = (recs: ServerRec[]) => new Map<ElementType, ServerRec[]>([['character', recs]]);

  it('hidden on both sides is the same element, as before', () => {
    const p = planMerge([el(WREN, 'Wren', { hidden: true })], server([srv(WREN, 'Wren', { hidden: true })]), { matchByName: true });
    expect(p.sameId.map(x => x.local.id)).toEqual([WREN]);
    expect(p.hiddenOnline).toEqual([]);
  });

  it('hidden here, shown online under the id: out of every list, never downloaded', () => {
    const p = planMerge([el(WREN, 'Wren', { hidden: true })], server([srv(WREN, 'Wren')]), { matchByName: true });
    expect(p.hiddenOnline.map(h => h.id)).toEqual([WREN]);
    expect([...p.sameId, ...p.renamed, ...p.creates].map(x => x.local.id)).toEqual([]);
    expect(p.downloads).toEqual([]);
  });

  it('a hidden element is never a name match; a shown one still is', () => {
    const p = planMerge([el(WREN, 'Wren', { hidden: true }), el(ADA, 'Ada')], server([srv(SRV_WREN, 'Wren'), srv('s-ada', 'Ada')]), { matchByName: true });
    expect(p.creates.map(x => x.local.id)).toEqual([WREN]);
    expect(p.renamed.map(x => x.local.id)).toEqual([ADA]);
    expect(p.downloads.map(d => d.server.id)).toEqual([SRV_WREN]);
  });
});
