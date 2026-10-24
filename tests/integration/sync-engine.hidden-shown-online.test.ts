/**
 * keel's word on the hidden mark, recorded where keel answers (conv. 170, the
 * S461 gate's F3; contract `Forge/Notes/2026-10-24-s464-hidden-here-only-contract.md`).
 * keel takes the mark on a create only (keel #587, probed live S461), so a mark
 * added here to an element already online is never applied there: the update's
 * answer shows the element, and the page must say "Hidden here only", never
 * "Hidden on OnlyWorlds". keel answers `hidden: true` exactly when it hides the
 * element (probe-48, 8a and 8b), and a pull's record is keel's word whole.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { HIDDEN_HERE_ONLY_LINE, HIDDEN_MARK_LINE, HIDDEN_SHOWN_ONLINE, hiddenMarkLine } from '../../src/core/hidden-mark';

let folder: MockFolderStore;
let client: FakeOwApiClient;

const WREN = '00000000-0000-4000-8000-0000000000c1';

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

describe('a mark added here to an element OnlyWorlds already shows', () => {
  it('reads Hidden here only once keel answers the push, and the word never goes up', async () => {
    await client.createElement('character', { id: WREN, name: 'Wren', description: 'A sailor.' });
    const engine = new SyncEngine({ folder, client });
    await engine.syncNow();
    expect((await wren()).server_updated_at).toBeTruthy();

    await folder.updateElement(WREN, { description: 'The traitor.', hidden: true } as never);
    const r = await engine.syncNow();
    expect(r.failures).toEqual([]);
    expect(client.calls.some(c => c.method === 'update')).toBe(true);
    const server = (await client.listElements('character')).find(e => e.id === WREN) as Record<string, unknown>;
    expect(server.hidden).toBeUndefined();

    const el = await wren();
    expect(el[HIDDEN_SHOWN_ONLINE]).toBe(true);
    expect(hiddenMarkLine(el, 'api-linked')).toBe(HIDDEN_HERE_ONLY_LINE);
  });

  it('a pull of keel\'s record takes the word with the mark', async () => {
    await client.createElement('character', { id: WREN, name: 'Wren', description: 'A sailor.' });
    const engine = new SyncEngine({ folder, client });
    await engine.syncNow();
    await folder.updateElement(WREN, { hidden: true, description: 'The traitor.' } as never);
    await engine.syncNow();
    expect((await wren())[HIDDEN_SHOWN_ONLINE]).toBe(true);

    await client.updateElement('character', WREN, { description: 'A sailor, still.' });
    await engine.syncNow();
    const el = await wren();
    expect(el.description).toBe('A sailor, still.');
    expect(el).not.toHaveProperty(HIDDEN_SHOWN_ONLINE);
    expect(el.hidden).toBeUndefined();
  });
  it('an adopted copy keel shows under the same id records the word too (adoptServerCopy)', async () => {
    await client.createElement('character', { id: WREN, name: 'Wren', description: 'A sailor.' });
    await folder.createElement('character', { id: WREN, name: 'Wren', description: 'A sailor.', hidden: true } as never);
    const r = await new SyncEngine({ folder, client }).syncNow();
    expect(r.failures).toEqual([]);
    const el = await wren();
    expect(el.server_updated_at).toBeTruthy();
    expect(el[HIDDEN_SHOWN_ONLINE]).toBe(true);
    expect(hiddenMarkLine(el, 'api-linked')).toBe(HIDDEN_HERE_ONLY_LINE);
  });
});
// A second push of a copy holding the word goes through the real adapter: `sync-engine.hidden-shown-online.stack.test.ts`.

describe('an element keel hides', () => {
  it('an edit pushed keeps Hidden on OnlyWorlds: keel\'s answer has the mark', async () => {
    await client.createElement('character', { id: WREN, name: 'Wren', description: 'A sailor.', hidden: true });
    const engine = new SyncEngine({ folder, client });
    await engine.syncNow();
    expect((await wren()).hidden).toBe(true);
    await folder.updateElement(WREN, { description: 'The traitor.' } as never);
    const r = await engine.syncNow();
    expect(r.failures).toEqual([]);
    expect(client.calls.some(c => c.method === 'update')).toBe(true);
    const el = await wren();
    expect(el).not.toHaveProperty(HIDDEN_SHOWN_ONLINE);
    expect(hiddenMarkLine(el, 'api-linked')).toBe(HIDDEN_MARK_LINE);
  });
});
