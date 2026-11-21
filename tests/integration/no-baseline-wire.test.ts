/**
 * The wire half of conv. 192, on the real adapter against the MSW keel:
 * - R5: every `/bulk` body carries `create_only: true` (keel's `create_only`): an id
 *   keel holds is its slot's 409, the single POST's answer, never replaced;
 *   keel refuses a body key it does not know with 422, nothing written.
 * - M6: Keep this copy's `If-Match`, and keel's 412 with the live element as
 *   `current`, adapted, its counter beside it.
 * - The counter rides beside a record, never in it (never on disk).
 * - F1: the server serves every field.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { changeSeqOf, preconditionCurrent } from '../../src/sync/change-seq';

const BASE = 'https://test-ow.local/api/v2';
const adapter = () => new OwV2ClientAdapter({ apiKey: 'test-key', apiPin: '1234', baseUrl: BASE });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let clock: MonotonicClock;

beforeEach(() => { clock = new MonotonicClock('2026-01-01T00:00:00.000Z'); });

describe('R5: every /bulk is create_only', () => {
  it('the body carries create_only: true beside items and atomic, and nothing else', async () => {
    const { handlers } = statefulV2Handlers({ baseUrl: BASE, clock: clock.next });
    const bodies: Array<Record<string, unknown>> = [];
    mswServer.use(...handlers);
    mswServer.events.on('request:start', async ({ request }) => {
      if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/bulk')) bodies.push(await request.clone().json());
    });
    const a = adapter();
    await a.bulkCreate([{ type: 'character', element: { id: id(1), name: 'C1' } }, { type: 'character', element: { id: id(2), name: 'C2' } }], { atomic: true, createOnly: true });
    mswServer.events.removeAllListeners();
    expect(bodies.length).toBe(1);
    expect(Object.keys(bodies[0]).sort()).toEqual(['atomic', 'create_only', 'items']);
    expect(bodies[0].create_only).toBe(true);
  });

  it('an id keel holds is its slot\'s 409, the POST\'s words, never replaced; atomic: nothing written; another type\'s id names it', async () => {
    const { handlers, state } = statefulV2Handlers({ baseUrl: BASE, clock: clock.next });
    mswServer.use(...handlers);
    const a = adapter();
    await a.createElement('character', { id: id(1), name: 'C1', background: 'member' });
    await a.createElement('location', { id: id(2), name: 'L2' });
    const r = await a.bulkCreate([
      { type: 'character', element: { id: id(1), name: 'C1 again' } },
      { type: 'character', element: { id: id(3), name: 'C3' } },
    ], { atomic: true, createOnly: true });
    expect(r.errors).toBe(true);
    expect(r.items.map(i => i.status)).toEqual([409, 201]);
    expect(r.items[0].error).toMatchObject({ code: 'id_conflict', param: 'id' });
    const single = await a.createElement('character', { id: id(1), name: 'C1 again' }).catch(e => e);
    expect(r.items[0].error!.message).toBe(String(single.message).replace(/^API Error 409: /, ''));
    expect(state.get('character')!.get(id(1))!.background).toBe('member');
    expect(state.get('character')!.has(id(3))).toBe(false);
    const clash = await a.bulkCreate([{ type: 'character', element: { id: id(2), name: 'X' } }, { type: 'character', element: { id: id(4), name: 'Y' } }], { atomic: true, createOnly: true });
    expect(clash.items[0].status).toBe(409);
    expect(clash.items[0].error!.message).toMatch(/already exists as a location in this world/);
  });

  it('keel refuses a body key it does not know: 422, nothing written (the played keel fails loudly)', async () => {
    const { handlers, state } = statefulV2Handlers({ baseUrl: BASE, clock: clock.next });
    mswServer.use(...handlers);
    const res = await fetch(`${BASE}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'API-Key': 'test-key', 'API-Pin': '1234' },
      body: JSON.stringify({ atomic: true, create_only: true, replace: false, items: [{ type: 'character', element: { id: id(5), name: 'Z' } }] }),
    });
    expect(res.status).toBe(422);
    expect(state.get('character')?.has(id(5)) ?? false).toBe(false);
    const bad = await fetch(`${BASE}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'API-Key': 'test-key', 'API-Pin': '1234' },
      body: JSON.stringify({ atomic: true, create_only: 'yes', items: [{ type: 'character', element: { id: id(5), name: 'Z' } }] }),
    });
    expect(bad.status).toBe(422);
  });
});

describe('M6: If-Match and keel\'s 412', () => {
  it('sends the counter, and a moved element answers 412 with the live element as current, adapted, nothing written', async () => {
    const { handlers, __mutate } = statefulV2Handlers({ baseUrl: BASE, clock: clock.next });
    let ifMatch: string | null = null;
    mswServer.use(...handlers);
    mswServer.events.on('request:start', ({ request }) => { if (request.method === 'PATCH') ifMatch = request.headers.get('If-Match'); });
    const a = adapter();
    await a.createElement('marker', { id: id(1), name: 'M' });
    const read = await a.getElement('marker', id(1));
    const seq = changeSeqOf(read)!;
    expect(seq).toEqual(expect.any(Number));
    const ok = await a.updateElement('marker', id(1), { name: 'M2' }, { ifMatch: seq });
    expect(ifMatch).toBe(`"${seq}"`);
    __mutate('marker', id(1), { name: 'moved on keel' });
    const err = await a.updateElement('marker', id(1), { name: 'M3' }, { ifMatch: changeSeqOf(ok)! }).catch(e => e);
    mswServer.events.removeAllListeners();
    const current = preconditionCurrent(err)!;
    expect(current.name).toBe('moved on keel');
    expect('map_id' in current).toBe(true); // adapted: the disk name
    expect('change_seq' in current).toBe(false);
    expect(changeSeqOf(current)).toBeGreaterThan(changeSeqOf(ok)!);
    expect((await a.getElement('marker', id(1)))!.name).toBe('moved on keel');
  });
});

describe('the counter rides beside a record, never in it', () => {
  it('no spread, entries or JSON of a read carries change_seq', async () => {
    const { handlers } = statefulV2Handlers({ baseUrl: BASE, clock: clock.next });
    mswServer.use(...handlers);
    const a = adapter();
    await a.createElement('character', { id: id(1), name: 'C1' });
    const r = (await a.getElement('character', id(1)))!;
    expect(changeSeqOf(r)).toEqual(expect.any(Number));
    expect(Object.keys(r)).not.toContain('change_seq');
    expect(JSON.stringify(r)).not.toContain('change_seq');
    expect(changeSeqOf({ ...r })).toBeNull();
  });
});

describe('F1: the server as keel serves', () => {
  it('every field on a read; a POST for another type\'s id is a 409 naming it', async () => {
    const { handlers } = statefulV2Handlers({ baseUrl: BASE, clock: clock.next });
    mswServer.use(...handlers);
    const a = adapter();
    await a.createElement('character', { id: id(1), name: 'C1' });
    await a.createElement('location', { id: id(2), name: 'L2' });
    expect((await a.getElement('character', id(1)))!.background).toBe('');
    const single = await a.createElement('character', { id: id(2), name: 'X' }).catch(e => e);
    expect(single.status).toBe(409);
    expect(single.code).toBe('id_conflict');
    expect(single.message).toMatch(/already exists as a location in this world/);
  });
});
