/**
 * keel's word on the hidden mark through the full stack (engine, the real
 * OwV2ClientAdapter, keel's v2 MSW): the word is local-only, so a push of a
 * copy holding it never puts it on keel, however many pushes follow; and the
 * mark taken out here takes the word with it (conv. 170, the S461 gate's F3).
 * keel's MSW round-trips any `atlas_` key, so keel's stored copy is the proof.
 */
import { it, expect, beforeEach } from 'vitest';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { HIDDEN_HERE_ONLY_LINE, HIDDEN_SHOWN_ONLINE, hiddenMarkLine } from '../../src/core/hidden-mark';

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

it('the word stays here through every push, and leaves with the mark', async () => {
  const wren = await folder.createElement('character', { name: 'Wren', description: 'A sailor.' });
  expect((await engine.syncNow()).failures).toEqual([]);
  const read = async () => (await folder.getElement(wren.id)) as unknown as Record<string, unknown>;
  expect((await read()).server_updated_at).toBeTruthy();

  // Marked here after it went online: the update's answer shows it.
  await folder.updateElement(wren.id, { hidden: true, description: 'The traitor.' } as never);
  expect((await engine.syncNow()).failures).toEqual([]);
  expect((await read())[HIDDEN_SHOWN_ONLINE]).toBe(true);
  expect(hiddenMarkLine(await read(), 'api-linked')).toBe(HIDDEN_HERE_ONLY_LINE);

  // A second push of the copy holding the word: it never reaches keel.
  await folder.updateElement(wren.id, { description: 'Still the traitor.' } as never);
  expect((await engine.syncNow()).failures).toEqual([]);
  const onKeel = (await adapter.getElement('character', wren.id)) as unknown as Record<string, unknown>;
  expect(onKeel.description).toBe('Still the traitor.');
  expect(onKeel).not.toHaveProperty(HIDDEN_SHOWN_ONLINE);
  expect(onKeel.hidden).toBeUndefined();
  expect((await read())[HIDDEN_SHOWN_ONLINE]).toBe(true);

  // The mark taken out here: the next stamp takes the word.
  await folder.updateElement(wren.id, { hidden: null, description: 'A sailor again.' } as never);
  expect((await engine.syncNow()).failures).toEqual([]);
  expect(await read()).not.toHaveProperty(HIDDEN_SHOWN_ONLINE);
});

it('a word a cleared baseline left never survives the create that follows through /bulk (the S464 gate\'s M1)', async () => {
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
