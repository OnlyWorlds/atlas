/**
 * OwV2ClientAdapter — integration tests against the stateful keel v2 MSW server.
 *
 * Every case drives a REAL OwV2ClientAdapter (thin fetch, no SDK) against
 * statefulV2Handlers, so the frozen v2 wire contract
 * (Notes/2026-07-12-v2-probed-facts.md) is exercised end to end:
 *
 * - toV2WireShape: disk map_id/zone_id → bare map/zone on the wire; pin
 *   element_id/element_type + content bare names untouched.
 * - adaptV2Record: bare map/zone → disk map_id/zone_id on read; type stamped.
 * - Extension policy: LOCAL_ONLY stripped, WIRE extensions + x_ customs round-trip.
 * - Cursor walk: multi-page LIST completes; a non-advancing cursor marks the
 *   type incomplete (server-delete suppression, gate 10.5).
 * - Error mapping: 404/401/400 envelopes → OwV2Error status/code/param.
 * - /bulk: reference cycles resolve; atomic failure persists nothing; no item updated_at.
 * - /changes: seq-ordered cursor pull, disk-shape upsert elements, delete ops, terminal page.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { isOwV2Error } from '../../src/sync/ow-v2-client-adapter';
import type { ChangesPage } from '../../src/sync/sync-engine';

const TEST_BASE = 'https://test-ow.local/api/v2';
const uuid = (): string => crypto.randomUUID();

let clock: MonotonicClock;

function makeAdapter(): OwV2ClientAdapter {
  return new OwV2ClientAdapter({ apiKey: 'test-key', apiPin: '1234', baseUrl: TEST_BASE });
}

beforeEach(() => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
});

describe('OwV2ClientAdapter — toV2WireShape on the wire', () => {
  it('marker map_id/zone_id land as bare map/zone; pin element_* + content names unchanged', async () => {
    const { handlers, state } = statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);
    const adapter = makeAdapter();

    const mapId = uuid();
    const zoneId = uuid();
    const locId = uuid();
    await adapter.createElement('map', { id: mapId, name: 'Overworld' });
    await adapter.createElement('zone', { id: zoneId, name: 'North March' });
    await adapter.createElement('location', { id: locId, name: 'Rivendell' });

    // marker: disk map_id/zone_id → wire map/zone
    const markerId = uuid();
    await adapter.createElement('marker', { id: markerId, name: '', map_id: mapId, zone_id: zoneId, x: 1, y: 2, order: 0 });
    const storedMarker = state.get('marker')!.get(markerId)!;
    expect(storedMarker.map).toBe(mapId);
    expect(storedMarker.zone).toBe(zoneId);
    expect(storedMarker.map_id).toBeUndefined();
    expect(storedMarker.zone_id).toBeUndefined();

    // content type: bare relation name (birthplace) unchanged on the wire
    const charId = uuid();
    await adapter.createElement('character', { id: charId, name: 'Frodo', birthplace: locId });
    const storedChar = state.get('character')!.get(charId)!;
    expect(storedChar.birthplace).toBe(locId);

    // pin: map_id → map, but element_id/element_type are the schema names → unchanged
    const pinId = uuid();
    await adapter.createElement('pin', { id: pinId, name: '', map_id: mapId, element_id: charId, element_type: 'character', x: 5, y: 6 });
    const storedPin = state.get('pin')!.get(pinId)!;
    expect(storedPin.map).toBe(mapId);
    expect(storedPin.map_id).toBeUndefined();
    expect(storedPin.element_id).toBe(charId);
    expect(storedPin.element_type).toBe('character');
  });
});

describe('OwV2ClientAdapter — adaptV2Record on read', () => {
  it('bare map/zone come back as disk map_id/zone_id, type stamped (get + list)', async () => {
    const { handlers } = statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);
    const adapter = makeAdapter();

    const mapId = uuid();
    const zoneId = uuid();
    const charId = uuid();
    await adapter.createElement('map', { id: mapId, name: 'Overworld' });
    await adapter.createElement('zone', { id: zoneId, name: 'North March' });
    await adapter.createElement('character', { id: charId, name: 'Frodo' });

    const markerId = uuid();
    await adapter.createElement('marker', { id: markerId, name: '', map_id: mapId, zone_id: zoneId, x: 1, y: 2, order: 0 });
    const pinId = uuid();
    await adapter.createElement('pin', { id: pinId, name: '', map_id: mapId, element_id: charId, element_type: 'character', x: 5, y: 6 });

    const gotMarker = await adapter.getElement('marker', markerId);
    expect(gotMarker).not.toBeNull();
    expect(gotMarker!.type).toBe('marker');
    expect(gotMarker!.map_id).toBe(mapId);
    expect(gotMarker!.zone_id).toBe(zoneId);
    expect(gotMarker!.map).toBeUndefined();
    expect(gotMarker!.zone).toBeUndefined();

    const gotPin = await adapter.getElement('pin', pinId);
    expect(gotPin!.map_id).toBe(mapId);
    expect(gotPin!.element_id).toBe(charId);
    expect(gotPin!.element_type).toBe('character');

    const listed = await adapter.listElements('marker');
    expect(listed).toHaveLength(1);
    expect(listed[0].type).toBe('marker');
    expect(listed[0].map_id).toBe(mapId);
    expect(listed[0].map).toBeUndefined();
  });
});

describe('OwV2ClientAdapter — extension field policy', () => {
  it('LOCAL_ONLY stripped from writes; WIRE extensions + x_ customs round-trip', async () => {
    const { handlers, state } = statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);
    const adapter = makeAdapter();

    const zoneId = uuid();
    await adapter.createElement('zone', {
      id: zoneId,
      name: 'Styled Zone',
      // WIRE extensions — must survive the wire:
      atlas_shape: 'polygon',
      atlas_color: '#22d3ee',
      // custom namespaced field — accepted + round-tripped:
      x_mood: 'grim',
      // LOCAL_ONLY — must be stripped BEFORE the wire (never stored server-side):
      atlas_page_blocks: [{ id: 'blk1', kind: 'text' }],
      image_media_id: 'local-media-ref',
    });

    // Server never saw the local-only fields.
    const stored = state.get('zone')!.get(zoneId)!;
    expect(stored.atlas_shape).toBe('polygon');
    expect(stored.atlas_color).toBe('#22d3ee');
    expect(stored.x_mood).toBe('grim');
    expect(stored.atlas_page_blocks).toBeUndefined();
    expect(stored.image_media_id).toBeUndefined();

    // Read comes back with the wire extensions + custom, still no local-only.
    const got = await adapter.getElement('zone', zoneId);
    expect(got!.atlas_shape).toBe('polygon');
    expect(got!.atlas_color).toBe('#22d3ee');
    expect(got!.x_mood).toBe('grim');
    expect(got!.atlas_page_blocks).toBeUndefined();
    expect(got!.image_media_id).toBeUndefined();
  });
});

describe('OwV2ClientAdapter — LIST cursor walk', () => {
  it('walks >2 pages to completion; incomplete set stays empty', async () => {
    const { handlers } = statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next, pageSize: 3 });
    mswServer.use(...handlers);
    const adapter = makeAdapter();

    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = uuid();
      ids.push(id);
      await adapter.createElement('event', { id, name: `Event ${i}` });
    }

    const list = await adapter.listElements('event'); // 8 items / pageSize 3 → 3 pages
    expect(list).toHaveLength(8);
    expect(list.map(r => r.id).sort()).toEqual([...ids].sort());
    expect(adapter.getIncompleteListTypes().size).toBe(0);
  });

  it('non-advancing cursor aborts the walk and flags the type incomplete', async () => {
    const { handlers } = statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next, pageSize: 3, brokenCursor: true });
    mswServer.use(...handlers);
    const adapter = makeAdapter();

    for (let i = 0; i < 5; i++) {
      await adapter.createElement('event', { id: uuid(), name: `Event ${i}` });
    }

    await adapter.listElements('event');
    expect(adapter.getIncompleteListTypes().has('event')).toBe(true);
  });
});

describe('OwV2ClientAdapter — error mapping', () => {
  it('maps 404 / missing-delete / dangling-FK / dead-creds through OwV2Error', async () => {
    const authState = { blocked: false };
    const { handlers } = statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next, authState });
    mswServer.use(...handlers);
    const adapter = makeAdapter();

    // GET missing → null
    expect(await adapter.getElement('character', uuid())).toBeNull();

    // PATCH missing → throws 404 not_found
    await expect(adapter.updateElement('character', uuid(), { name: 'Nobody' })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });

    // DELETE missing → resolves (204, idempotent)
    await expect(adapter.deleteElement('character', uuid())).resolves.toBeUndefined();

    // CREATE with dangling relation → invalid_link, param set
    let linkErr: unknown;
    try {
      await adapter.createElement('character', { id: uuid(), name: 'Bob', birthplace: uuid() });
    } catch (e) {
      linkErr = e;
    }
    expect(isOwV2Error(linkErr)).toBe(true);
    expect((linkErr as { status: number }).status).toBe(400);
    expect((linkErr as { code: string }).code).toBe('invalid_link');
    expect((linkErr as { param: string | null }).param).toBe('birthplace');

    // Dead creds → 401 invalid_credentials on every endpoint
    authState.blocked = true;
    await expect(adapter.listElements('character')).rejects.toMatchObject({
      status: 401,
      code: 'invalid_credentials',
    });
  });
});

describe('OwV2ClientAdapter — /bulk', () => {
  it('resolves a 2-element reference cycle atomically', async () => {
    const { handlers } = statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);
    const adapter = makeAdapter();

    const a = uuid();
    const b = uuid();
    const result = await adapter.bulkCreate(
      [
        { type: 'character', element: { id: a, name: 'A', friends: [b] } },
        { type: 'character', element: { id: b, name: 'B', friends: [a] } },
      ],
      { atomic: true },
    );

    expect(result.errors).toBe(false);
    expect(result.items.map(i => i.status)).toEqual([201, 201]);

    const gotA = await adapter.getElement('character', a);
    const gotB = await adapter.getElement('character', b);
    expect(gotA!.friends).toEqual([b]);
    expect(gotB!.friends).toEqual([a]);
  });

  it('atomic batch with one dangling item persists NOTHING; items carry no updated_at', async () => {
    const { handlers } = statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);
    const adapter = makeAdapter();

    const good = uuid();
    const bad = uuid();
    const result = await adapter.bulkCreate(
      [
        { type: 'character', element: { id: good, name: 'Would Succeed' } },
        { type: 'character', element: { id: bad, name: 'Dangling', birthplace: uuid() } },
      ],
      { atomic: true },
    );

    expect(result.errors).toBe(true);
    expect(result.items.map(i => i.status)).toEqual([201, 400]);
    expect(result.items[1].error?.code).toBe('invalid_link');
    // No item echoes updated_at (backfill is client-side until keel ships the echo).
    for (const item of result.items) {
      expect(item).not.toHaveProperty('updated_at');
    }
    // Rollback: neither element landed, not even the would-succeed one.
    expect(await adapter.getElement('character', good)).toBeNull();
    expect(await adapter.getElement('character', bad)).toBeNull();
  });
});

describe('OwV2ClientAdapter — /changes cursor pull', () => {
  it('pages seq-ordered ops with disk-shape upserts + delete ops; terminal page is empty', async () => {
    const { handlers } = statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);
    const adapter = makeAdapter();

    // Seed: map, a marker on it, a doomed character — then delete the character.
    const mapId = uuid();
    const markerId = uuid();
    const charId = uuid();
    await adapter.createElement('map', { id: mapId, name: 'Overworld' });
    await adapter.createElement('marker', { id: markerId, name: '', map_id: mapId, x: 1, y: 2, order: 0 });
    await adapter.createElement('character', { id: charId, name: 'Doomed' });
    await adapter.deleteElement('character', charId);

    // Walk the feed with limit 2, verifying the cursor advances each page.
    const collected: ChangesPage['changes'] = [];
    let since: string | null = null;
    let guard = 0;
    for (;;) {
      const page: ChangesPage = await adapter.pullChanges(since, 2);
      collected.push(...page.changes);
      if (!page.hasMore) {
        since = page.cursor;
        break;
      }
      expect(page.cursor).not.toBe(since); // cursor MUST advance
      since = page.cursor;
      if (++guard > 10) throw new Error('changes walk did not terminate');
    }

    // 3 upserts (map, marker, character) + 1 delete = 4 ops, in commit order.
    expect(collected).toHaveLength(4);
    const seqs = collected.map(op => op.changeSeq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));

    // Upsert element for the marker is adapted to DISK shape (map_id, not map).
    const markerOp = collected.find(op => op.type === 'marker' && op.op === 'upsert');
    expect(markerOp).toBeDefined();
    expect((markerOp as { element: Record<string, unknown> }).element.map_id).toBe(mapId);
    expect((markerOp as { element: Record<string, unknown> }).element.map).toBeUndefined();

    // Delete op carries deletedAt, no element body.
    const delOp = collected.find(op => op.op === 'delete');
    expect(delOp).toBeDefined();
    expect(delOp!.id).toBe(charId);
    expect((delOp as { deletedAt: string }).deletedAt).toBeTruthy();

    // Terminal cursor replayed → empty page, no more.
    const tail = await adapter.pullChanges(since, 2);
    expect(tail.changes).toHaveLength(0);
    expect(tail.hasMore).toBe(false);
  });
});
