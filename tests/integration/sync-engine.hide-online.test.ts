/**
 * The hidden mark sent for an element already online (conv. 173; folder spec
 * 4.8 at fe366935, Skeld h29 #12044; contract
 * `Forge/Notes/2026-10-24-s466-hide-online-contract.md`). A mark a file gains
 * while keel shows the element goes as keel's hide (`PUT /{type}/{id}/hidden`)
 * by the owner's or a co-builder's key, BEFORE the edit, so the edit never
 * reaches members between the two; a contributor's or a guest's key never asks;
 * a clean copy holding 1.86.2's word gets the hide and a read back; the adopt
 * door and Keep mine hide first too; a mark taken out of a file never unhides.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { HIDDEN_MARK_LINE, HIDDEN_SHOWN_ONLINE, hiddenMarkLine } from '../../src/core/hidden-mark';

let folder: MockFolderStore;
let client: FakeOwApiClient;

const WREN = '00000000-0000-4000-8000-0000000000d1';

beforeEach(async () => {
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  client.__enable_changes();
});

const wren = async () => (await folder.getElement(WREN)) as unknown as Record<string, unknown>;
const onKeel = async () => (await client.listElements('character')).find(e => e.id === WREN) as Record<string, unknown>;
const writes = () => client.calls.filter(c => c.method === 'hide' || c.method === 'update').map(c => c.method);

/** Wren online and shown, then marked hidden here with a secret in the same edit. */
async function markedAfterOnline(): Promise<SyncEngine> {
  await client.createElement('character', { id: WREN, name: 'Wren', description: 'A sailor.' });
  const engine = new SyncEngine({ folder, client });
  await engine.syncNow();
  expect((await wren()).server_updated_at).toBeTruthy();
  client.calls.length = 0;
  await folder.updateElement(WREN, { description: 'The traitor.', hidden: true } as never);
  return engine;
}

describe('an owner\'s key', () => {
  it('hides it on OnlyWorlds before the edit goes; the page says Hidden on OnlyWorlds', async () => {
    const engine = await markedAfterOnline();
    const r = await engine.syncNow();
    expect(r.failures).toEqual([]);
    expect(writes()).toEqual(['hide', 'update']);
    expect((await onKeel()).hidden).toBe(true);
    expect((await onKeel()).description).toBe('The traitor.');
    const el = await wren();
    expect(el).not.toHaveProperty(HIDDEN_SHOWN_ONLINE);
    expect(hiddenMarkLine(el, 'api-linked')).toBe(HIDDEN_MARK_LINE);
    // Nothing more owed: the next round sends no second hide.
    client.calls.length = 0;
    await engine.syncNow();
    expect(writes()).toEqual([]);
  });

  it('a co-builder\'s key hides it too', async () => {
    client.__as_member_seat('co_builder');
    client.keyRole = 'co_builder';
    const engine = await markedAfterOnline();
    expect((await engine.syncNow()).failures).toEqual([]);
    expect(writes()).toEqual(['hide', 'update']);
    expect((await onKeel()).hidden).toBe(true);
  });

  it('a busy server on the hide sends nothing: the edit waits, still unsent', async () => {
    const engine = await markedAfterOnline();
    const real = client.hideElement.bind(client);
    client.hideElement = async () => {
      const err = new Error('API Error 503: busy') as Error & { status?: number; code?: string };
      err.status = 503;
      err.code = 'server_busy';
      throw err;
    };
    await engine.syncNow();
    expect(client.calls.some(c => c.method === 'update')).toBe(false);
    expect((await onKeel()).description).toBe('A sailor.');
    const waiting = await wren();
    expect((waiting.local_updated_at as string) > (waiting.server_updated_at as string)).toBe(true);
    client.hideElement = real;
    client.calls.length = 0;
    expect((await engine.syncNow()).failures).toEqual([]);
    expect(writes()).toEqual(['hide', 'update']);
  });

  it('keel\'s 403 on the hide is no dead key: the edit goes as today, the page says Hidden here only, and it is not asked again', async () => {
    const engine = await markedAfterOnline();
    let asked = 0;
    client.hideElement = async () => {
      asked++;
      const err = new Error('API Error 403') as Error & { status?: number; code?: string };
      err.status = 403;
      err.code = 'permission_error';
      throw err;
    };
    const r = await engine.syncNow();
    expect(r.failures).toEqual([]);
    expect(engine.getState()).not.toBe('error');
    expect((await onKeel()).description).toBe('The traitor.');
    expect((await wren())[HIDDEN_SHOWN_ONLINE]).toBe(true);
    await engine.syncNow();
    expect(asked).toBe(1);
  });

  it('a role that could not be read holds the edit for the next round', async () => {
    const engine = await markedAfterOnline();
    client.meFails = true;
    await engine.syncNow();
    expect(client.calls.some(c => c.method === 'update' || c.method === 'hide')).toBe(false);
    expect((await onKeel()).description).toBe('A sailor.');
    client.meFails = false;
    await engine.syncNow();
    expect(writes()).toEqual(['hide', 'update']);
  });

  it('a clean copy holding 1.86.2\'s word gets the hide and keel\'s read back, its other words kept', async () => {
    await client.createElement('character', { id: WREN, name: 'Wren', description: 'A sailor.' });
    const engine = new SyncEngine({ folder, client });
    await engine.syncNow();
    const marked = await folder.updateElement(WREN, { hidden: true, atlas_aliases: ['the Wren'] } as never);
    const clean = new Date(Date.parse(marked.local_updated_at) + 1).toISOString();
    await folder.stampServerUpdatedAt(WREN, 'character', clean, undefined, { [HIDDEN_SHOWN_ONLINE]: true });
    client.calls.length = 0;
    expect((await engine.syncNow()).failures).toEqual([]);
    expect(writes()).toEqual(['hide']);
    expect((await onKeel()).hidden).toBe(true);
    const el = await wren();
    expect(el).not.toHaveProperty(HIDDEN_SHOWN_ONLINE);
    expect(el.hidden).toBe(true);
    expect(el.atlas_aliases).toEqual(['the Wren']);
    expect(hiddenMarkLine(el, 'api-linked')).toBe(HIDDEN_MARK_LINE);
  });

  it('a mark taken out here never unhides: the edit goes, and keel\'s mark comes back into the file', async () => {
    const engine = await markedAfterOnline();
    await engine.syncNow();
    expect((await onKeel()).hidden).toBe(true);
    await folder.updateElement(WREN, { hidden: null, description: 'A sailor again.' } as never);
    client.calls.length = 0;
    expect((await engine.syncNow()).failures).toEqual([]);
    expect(writes()).toEqual(['update']);
    expect((await onKeel()).hidden).toBe(true);
    expect((await onKeel()).description).toBe('A sailor again.');
    const el = await wren();
    expect(el.hidden).toBe(true);
    expect(hiddenMarkLine(el, 'api-linked')).toBe(HIDDEN_MARK_LINE);
  });

  it('the adopt door hides it there first, then adopts keel\'s read back', async () => {
    await client.createElement('character', { id: WREN, name: 'Wren', description: 'A sailor.' });
    await folder.createElement('character', { id: WREN, name: 'Wren', description: 'The traitor.', hidden: true } as never);
    const engine = new SyncEngine({ folder, client });
    const r = await engine.syncNow();
    expect(r.hidden_shown_ids ?? []).toEqual([]);
    expect((await onKeel()).hidden).toBe(true);
    expect((await onKeel()).description).toBe('A sailor.');
    expect((await wren()).server_updated_at).toBeTruthy();
    // Different content: dirty, so the next round sends it as an update, onto a hidden element.
    client.calls.length = 0;
    await engine.syncNow();
    expect(writes()).toEqual(['update']);
    expect((await onKeel()).description).toBe('The traitor.');
    expect((await onKeel()).hidden).toBe(true);
  });

  it('Keep mine on a held conflict hides it there before the edit goes', async () => {
    await client.createElement('character', { id: WREN, name: 'Wren', description: 'A sailor.' });
    const engine = new SyncEngine({ folder, client, policy: 'pause-and-review' });
    await engine.syncNow();
    await folder.updateElement(WREN, { description: 'The traitor.', hidden: true } as never);
    await client.updateElement('character', WREN, { description: 'A sailor, says the crew.' });
    await engine.syncNow();
    expect((await onKeel()).description).toBe('A sailor, says the crew.');
    client.calls.length = 0;
    await engine.resolveConflict(WREN, 'overwrite-mine');
    expect(writes()).toEqual(['hide', 'update']);
    expect((await onKeel()).hidden).toBe(true);
    expect((await onKeel()).description).toBe('The traitor.');
  });
});

describe('a contributor\'s key', () => {
  it('never asks keel to hide: the edit goes as today and the page says Hidden here only', async () => {
    client.__as_member_seat('contributor');
    client.keyRole = 'contributor';
    const engine = await markedAfterOnline();
    expect((await engine.syncNow()).failures).toEqual([]);
    expect(writes()).toEqual(['update']);
    expect((await onKeel()).hidden).toBeUndefined();
    expect((await wren())[HIDDEN_SHOWN_ONLINE]).toBe(true);
    // Nor in the clean round after.
    client.calls.length = 0;
    await engine.syncNow();
    expect(writes()).toEqual([]);
  });
});
