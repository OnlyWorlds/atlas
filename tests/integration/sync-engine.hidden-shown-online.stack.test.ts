/**
 * keel's word on the hidden mark through the full stack (engine, the real
 * OwV2ClientAdapter, keel's v2 MSW): the word is local-only, so a push of a
 * copy holding it never puts it on keel, however many pushes follow; and the
 * mark taken out here takes the word with it (conv. 170).
 * keel's MSW round-trips any `atlas_` key, so keel's stored copy is the proof.
 */
import { it, expect, beforeEach } from 'vitest';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { HIDDEN_HERE_ONLY_LINE, HIDDEN_MARK_LINE, HIDDEN_SHOWN_ONLINE, hiddenMarkLine } from '../../src/core/hidden-mark';

const TEST_BASE = 'https://test-ow.local/api/v2';

let folder: MockFolderStore;
let adapter: OwV2ClientAdapter;
let engine: SyncEngine;

beforeEach(async () => {
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  const { handlers } = statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next });
  mswServer.use(...handlers);
  adapter = new OwV2ClientAdapter({ apiKey: 'test-key', apiPin: '1234', baseUrl: TEST_BASE });
  engine = new SyncEngine({ folder, client: adapter });
});

it('an owner\'s mark added after it went online hides it on keel through the adapter; taken out here, it never unhides (conv. 173)', async () => {
  const wren = await folder.createElement('character', { name: 'Wren', description: 'A sailor.' });
  expect((await engine.syncNow()).failures).toEqual([]);
  const read = async () => (await folder.getElement(wren.id)) as unknown as Record<string, unknown>;
  const onKeel = async () => (await adapter.getElement('character', wren.id)) as unknown as Record<string, unknown>;
  expect((await read()).server_updated_at).toBeTruthy();

  // Marked here after it went online: keel's hide, then the edit; its answer carries the mark.
  await folder.updateElement(wren.id, { hidden: true, description: 'The traitor.' } as never);
  expect((await engine.syncNow()).failures).toEqual([]);
  expect((await onKeel()).hidden).toBe(true);
  expect((await onKeel()).description).toBe('The traitor.');
  expect(await read()).not.toHaveProperty(HIDDEN_SHOWN_ONLINE);
  expect(hiddenMarkLine(await read(), 'api-linked')).toBe(HIDDEN_MARK_LINE);

  // The mark taken out here: the edit goes, and keel keeps it hidden (an unhide is the site's).
  await folder.updateElement(wren.id, { hidden: null, description: 'A sailor again.' } as never);
  expect((await engine.syncNow()).failures).toEqual([]);
  expect((await onKeel()).description).toBe('A sailor again.');
  expect((await onKeel()).hidden).toBe(true);
});

it('a clean copy holding 1.86.2\'s word is hidden on keel, and the word never reaches keel (conv. 173)', async () => {
  const wren = await folder.createElement('character', { name: 'Wren', description: 'A sailor.' });
  expect((await engine.syncNow()).failures).toEqual([]);
  // As 1.86.2 left it: the mark and the word, stamped clean (the stamp just past the edit).
  const marked = await folder.updateElement(wren.id, { hidden: true } as never);
  const clean = new Date(Date.parse(marked.local_updated_at) + 1).toISOString();
  await folder.stampServerUpdatedAt(wren.id, 'character', clean, undefined, { [HIDDEN_SHOWN_ONLINE]: true });
  const before = (await folder.getElement(wren.id)) as unknown as Record<string, unknown>;
  expect(before[HIDDEN_SHOWN_ONLINE]).toBe(true);
  expect(hiddenMarkLine(before, 'api-linked')).toBe(HIDDEN_HERE_ONLY_LINE);

  expect((await engine.syncNow()).failures).toEqual([]);
  const keel = (await adapter.getElement('character', wren.id)) as unknown as Record<string, unknown>;
  expect(keel.hidden).toBe(true);
  expect(keel).not.toHaveProperty(HIDDEN_SHOWN_ONLINE);
  const after = (await folder.getElement(wren.id)) as unknown as Record<string, unknown>;
  expect(after).not.toHaveProperty(HIDDEN_SHOWN_ONLINE);
  expect(after.hidden).toBe(true);
  expect(hiddenMarkLine(after, 'api-linked')).toBe(HIDDEN_MARK_LINE);
});

it('a word a cleared baseline left never survives the create that follows through /bulk', async () => {
  // The file as a Keep, a reset or a re-key leaves it: the mark, the old word, no baseline.
  const wren = await folder.createElement('character', { name: 'Wren', description: 'The traitor.', hidden: true, [HIDDEN_SHOWN_ONLINE]: true } as never);
  await folder.createElement('character', { name: 'Ada' });
  expect((await engine.syncNow()).failures).toEqual([]);
  const onKeel = (await adapter.getElement('character', wren.id)) as unknown as Record<string, unknown>;
  expect(onKeel.hidden).toBe(true);
  const el = (await folder.getElement(wren.id)) as unknown as Record<string, unknown>;
  expect(el.server_updated_at).toBeTruthy();
  expect(el).not.toHaveProperty(HIDDEN_SHOWN_ONLINE);
  expect(hiddenMarkLine(el, 'api-linked')).not.toBe(HIDDEN_HERE_ONLY_LINE);
});
