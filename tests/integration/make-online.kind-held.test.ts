/**
 * Conv. 200 on Make online's merge: a file's elements go up as the file holds them, so an integer field
 * holding what keel would store cut (2.5) or refuse (a word) is that element's failure, named by field
 * and value, and never sent; the others go.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { mergeLocalIntoApi } from '../../src/sync/make-online';
import { classifyFailure } from '../../src/sync/sync-failure-copy';

let folder: MockFolderStore;
let client: FakeOwApiClient;

const WREN = '00000000-0000-4000-8000-0000000000d1';
const ADA = '00000000-0000-4000-8000-0000000000d2';
const DOCK = '00000000-0000-4000-8000-0000000000d3';

beforeEach(async () => {
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
});

const sent = () => client.calls.flatMap(c => c.method === 'create' ? [(c.body as { id?: string }).id]
  : c.method === 'update' ? [c.id] : []);

for (const bulk of [false, true]) {
  it(`${bulk ? 'through /bulk' : 'one at a time'}: a create holding 2.5 is named and not sent; the rest goes`, async () => {
    if (bulk) client.__enable_bulk(true);
    await folder.createElement('character', { id: WREN, name: 'Wren', birth_date: 2.5 } as never);
    await folder.createElement('character', { id: ADA, name: 'Ada' } as never);
    await folder.createElement('location', { id: DOCK, name: 'The dock' } as never);
    const r = await mergeLocalIntoApi(folder, client, 'b');
    expect(sent()).not.toContain(WREN);
    expect((await client.listElements('character')).map(e => e.id)).toEqual([ADA]);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toEqual(expect.objectContaining({ element_id: WREN, operation: 'create', kind_fault: { field: 'birth_date', value: '2.5' } }));
    expect(classifyFailure(r.failures[0])).toBe('wrong_kind');
  });
}

for (const bulk of [false, true]) {
  it(`${bulk ? 'through /bulk' : 'one at a time'}: a new element linking a held one waits, and so does a matched one`, async () => {
    if (bulk) client.__enable_bulk(true);
    await client.createElement('location', { id: DOCK, name: 'The dock' });
    await folder.createElement('character', { id: WREN, name: 'Wren', birth_date: 2.5 } as never);
    await folder.createElement('character', { id: ADA, name: 'Ada', friends: [WREN] } as never);
    await folder.createElement('location', { id: DOCK, name: 'The dock', description: 'Mine.', characters: [WREN] } as never);
    client.calls.length = 0;
    const r = await mergeLocalIntoApi(folder, client, 'b');
    expect(sent()).toEqual([]);
    expect(r.failures.map(f => [f.element_id, f.operation, classifyFailure(f)]).sort()).toEqual([
      [WREN, 'create', 'wrong_kind'], [ADA, 'create', 'wrong_kind'], [DOCK, 'update', 'wrong_kind'],
    ].sort());
  });
}

it('a matched element holding a word in an integer field is not sent over the online one', async () => {
  await client.createElement('character', { id: WREN, name: 'Wren', height: 170 });
  await folder.createElement('character', { id: WREN, name: 'Wren', height: 'tall' } as never);
  const r = await mergeLocalIntoApi(folder, client, 'b');
  expect(client.calls.filter(c => c.method === 'update')).toEqual([]);
  expect(r.failures).toEqual([expect.objectContaining({ element_id: WREN, operation: 'update', kind_fault: { field: 'height', value: '"tall"' } })]);
  expect(((await client.listElements('character'))[0] as Record<string, unknown>).height).toBe(170);
});
