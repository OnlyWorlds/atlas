/**
 * The sync decisions read element times as instants (DESIGN_LAWS conv. 190),
 * against a fake that stamps as keel does (`+00:00`, microseconds). Another
 * tool writing into the folder stamps its own way: an edit it made at
 * `00:00:30-05:00`, after keel's last stamp, sorted before keel's text and read
 * synced, so it was never uploaded and every pull path went over it or removed
 * it. A stamp that cannot be read takes each site's mild reading (R3) and heals
 * after one round (R4b).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { SyncEngine } from '../../src/sync/sync-engine';
import type { Element } from '../../src/core/types';

const WREN = '00000000-0000-4000-8000-00000000f523';
const ANA = '00000000-0000-4000-8000-00000000f524';
/** 05:00:30 UTC, written as a tool in New York writes it: as text it sorts before every 05:… stamp. */
const OUTSIDE = '2026-11-14T00:00:30-05:00';
/** The same instant written with a space, a form the message profile does not read. */
const UNREADABLE = '2026-11-14 05:00:30+00:00';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let now: number;
/** A millisecond clock shared by the folder and the fake, that a test can move on. */
const tick = () => new Date(++now).toISOString();
const later = () => { now = Date.parse('2026-11-14T05:01:00.000Z'); };

beforeEach(async () => {
  now = Date.parse('2026-11-14T05:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(tick);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(tick);
  client.__enable_changes();
});

/** Another program rewrites the element's file: the patch, and its own stamp (absent when undefined). */
function outsideEdit(id: string, patch: Record<string, unknown>, stamp: string | undefined): void {
  const disk = (folder as unknown as { elements: Map<string, Element> }).elements;
  const next = { ...disk.get(id)!, ...patch } as Record<string, unknown>;
  if (stamp === undefined) delete next.local_updated_at; else next.local_updated_at = stamp;
  disk.set(id, next as Element);
}

async function synced(engine: SyncEngine): Promise<void> {
  await client.createElement('character', { id: WREN, name: 'Wren', description: 'one' });
  await client.createElement('character', { id: ANA, name: 'Ana' });
  await engine.pullNow();
  expect((await folder.getElement(WREN))?.server_updated_at).toMatch(/\+00:00$/);
}

const updatesOf = (id: string) => client.calls.filter(c => c.method === 'update' && c.id === id).length;
const description = async (id: string) => (await folder.getElement(id))?.description;

describe('an outside edit with an offset (R1)', () => {
  it('is uploaded, once', async () => {
    const engine = new SyncEngine({ folder, client });
    await synced(engine);
    outsideEdit(WREN, { description: 'outside' }, OUTSIDE);
    later();
    client.calls = [];
    await engine.syncNow();
    await engine.syncNow();
    expect(updatesOf(WREN)).toBe(1);
    expect(client.__server_get('character', WREN)?.description).toBe('outside');
  });

  it('is a conflict on the change feed, never pulled over', async () => {
    const engine = new SyncEngine({ folder, client });
    await synced(engine);
    outsideEdit(WREN, { description: 'outside' }, OUTSIDE);
    later();
    client.__server_mutate('character', WREN, { description: 'theirs' });
    const r = await engine.pullNow();
    expect(await description(WREN)).toBe('outside');
    expect(r.conflicts.map(c => c.element_id)).toEqual([WREN]);
  });

  it('is a conflict on the full pull, never pulled over', async () => {
    client.__enable_changes(false);
    const engine = new SyncEngine({ folder, client });
    await synced(engine);
    outsideEdit(WREN, { description: 'outside' }, OUTSIDE);
    later();
    client.__server_mutate('character', WREN, { description: 'theirs' });
    const r = await engine.pullNow();
    expect(await description(WREN)).toBe('outside');
    expect(r.conflicts.map(c => c.element_id)).toEqual([WREN]);
  });

  it('survives keel\'s hidden row: kept, not removed', async () => {
    client.keyRole = 'contributor';
    const engine = new SyncEngine({ folder, client });
    await synced(engine);
    outsideEdit(WREN, { description: 'outside' }, OUTSIDE);
    later();
    client.__server_hide('character', WREN);
    await engine.pullNow();
    expect(await description(WREN)).toBe('outside');
    expect((await folder.readSyncState()).kept_outside_view).toEqual([WREN]);
  });

  it('survives a resync that drops what keel no longer shows', async () => {
    const engine = new SyncEngine({ folder, client });
    await synced(engine);
    outsideEdit(WREN, { description: 'outside' }, OUTSIDE);
    const real = client.pullChanges!.bind(client);
    let refused = false;
    client.pullChanges = async (since, limit) => {
      if (since && !refused) {
        refused = true;
        throw Object.assign(new Error('API Error 409: resync'), { status: 409, code: 'resync_required', param: null, reason: 'view' });
      }
      const page = await real(since, limit);
      return { ...page, changes: page.changes.filter(op => op.id !== WREN) };
    };
    await engine.pullNow();
    expect(await description(WREN)).toBe('outside');
    expect((await folder.listElements()).map(e => e.id)).toContain(ANA);
  });
});

describe('a local stamp that cannot be read (R3, R4b)', () => {
  it('is uploaded, and reads clean after its round (one PATCH, not none)', async () => {
    const engine = new SyncEngine({ folder, client });
    await synced(engine);
    outsideEdit(WREN, { description: 'outside' }, UNREADABLE);
    client.calls = [];
    await engine.syncNow();
    await engine.syncNow();
    expect(updatesOf(WREN)).toBe(1);
    expect(client.__server_get('character', WREN)?.description).toBe('outside');
    expect((await folder.getElement(WREN))?.local_updated_at).toBe((await folder.getElement(WREN))?.server_updated_at);
  });

  it('one that sorted high as text no longer uploads every round (one PATCH, not two)', async () => {
    const engine = new SyncEngine({ folder, client });
    await synced(engine);
    outsideEdit(WREN, { description: 'outside' }, 'garbage');
    client.calls = [];
    await engine.syncNow();
    await engine.syncNow();
    expect(updatesOf(WREN)).toBe(1);
  });

  it('is a conflict when keel moved too, and after Take theirs reads clean', async () => {
    const engine = new SyncEngine({ folder, client, policy: 'pause-and-review' });
    await synced(engine);
    outsideEdit(WREN, { description: 'outside' }, UNREADABLE);
    client.__server_mutate('character', WREN, { description: 'theirs' });
    const r = await engine.pullNow();
    expect(await description(WREN)).toBe('outside');
    expect(r.conflicts.map(c => c.element_id)).toEqual([WREN]);
    await engine.resolveConflict(WREN, 'pull-theirs');
    expect(await description(WREN)).toBe('theirs');
    client.calls = [];
    const next = await engine.syncNow();
    expect(updatesOf(WREN)).toBe(0);
    expect(next.conflicts).toEqual([]);
  });

  it('an absent stamp with no baseline stays in the upload set and goes up as a create', async () => {
    const engine = new SyncEngine({ folder, client });
    const made = await folder.createElement('character', { name: 'Rhea' });
    outsideEdit(made.id, {}, undefined);
    expect((await folder.listLocallyChangedSince(null)).map(e => e.id)).toEqual([made.id]);
    await engine.syncNow();
    expect(client.__server_get('character', made.id)?.name).toBe('Rhea');
    expect(await folder.listLocallyChangedSince(null)).toEqual([]);
  });
});

describe('a baseline that cannot be read (R3)', () => {
  it('holds the push as a review conflict under local-wins, once; Keep mine sends it', async () => {
    const engine = new SyncEngine({ folder, client, policy: 'local-wins' });
    await synced(engine);
    outsideEdit(WREN, { server_updated_at: 'garbage' }, (await folder.getElement(WREN))!.local_updated_at);
    await folder.updateElement(WREN, { description: 'mine' });
    client.calls = [];
    await engine.syncNow();
    expect(updatesOf(WREN)).toBe(0);
    expect(client.__server_get('character', WREN)?.description).toBe('one');
    expect((await folder.readSyncState()).conflicts.map(c => c.element_id)).toEqual([WREN]);

    await engine.resolveConflict(WREN, 'overwrite-mine');
    expect(client.__server_get('character', WREN)?.description).toBe('mine');
    client.calls = [];
    const next = await engine.syncNow();
    expect(updatesOf(WREN)).toBe(0);
    expect(next.conflicts).toEqual([]);
  });
});
