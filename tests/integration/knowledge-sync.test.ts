/**
 * Knowledge entries round-trip through the sync engine (DESIGN_KNOWLEDGE.md).
 *
 * A knowledge entry is a plain Narrative (subtype 'knowledge') whose holder
 * channels are canon OW fields (narrator single-link, collectives multi-link)
 * — so sync needs NO knowledge-specific code. This suite locks that in
 * against the FULL production stack (engine → OwClientAdapter → real SDK →
 * MSW with strict unknown-field validation + server-assigned ids):
 *
 *   - First push id-swaps the entry AND its holders/subjects; every FK
 *     (narrator, collectives, locations, circle membership) is rewritten so
 *     the computed-knowing scans still resolve on the post-swap local set.
 *   - `atlas_richtext_json` never reaches the wire (strict validator would
 *     400) but SURVIVES locally through the id-swap's applyServerRecord at a
 *     fresh id, and through a pull-overlay of a server-side edit.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OnlyWorldsClient } from '@onlyworlds/sdk';
import { mswServer } from '../setup';
import { statefulOwHandlers } from '../msw-handlers';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { OwClientAdapter } from '../../src/sync/ow-client-adapter';
import { knowledgeHeldBy, elementsKnownAboutBy, heldByOf } from '../../src/core/knowledge';

const TEST_BASE = 'https://test-ow.local/api/worldapi';
const RICHTEXT = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Barovia is cursed.' }] }] };

let folder: MockFolderStore;
let adapter: OwClientAdapter;
let engine: SyncEngine;
let clock: MonotonicClock;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  const { handlers } = statefulOwHandlers({
    baseUrl: TEST_BASE,
    clock: clock.next,
    assignsServerIds: true, // real OW enforces UUID v7 → id-swap path
  });
  mswServer.use(...handlers);
  const sdkClient = new OnlyWorldsClient({ apiKey: 'test-key', apiPin: '1234', baseUrl: TEST_BASE });
  adapter = new OwClientAdapter(sdkClient);
  engine = new SyncEngine({ folder, client: adapter });
});

/** Build the standard scenario: a narrator, a circle (with the narrator as member), a subject, an entry. */
async function seedKnowledgeWorld() {
  const ireena = await folder.createElement('character', { name: 'Ireena' });
  const party = await folder.createElement('collective', {
    name: 'the party', subtype: 'circle', characters: [ireena.id],
  });
  const barovia = await folder.createElement('location', { name: 'Barovia' });
  const entry = await folder.createElement('narrative', {
    name: 'the curse',
    subtype: 'knowledge',
    story: 'Barovia is cursed.',
    atlas_richtext_json: RICHTEXT,
    narrator: ireena.id,
    collectives: [party.id],
    locations: [barovia.id],
  });
  return { ireena, party, barovia, entry };
}

async function byName(name: string) {
  const el = (await folder.listElements()).find(e => e.name === name);
  expect(el, `local element "${name}" must exist`).toBeDefined();
  return el!;
}

describe('knowledge entry sync round-trip (full stack: adapter + SDK + MSW)', () => {
  it('first push id-swaps entry + holders + subjects, rewrites every FK, strips richtext from the wire', async () => {
    const { ireena, party, barovia, entry } = await seedKnowledgeWorld();

    const result = await engine.syncNow();
    expect(result.failures, JSON.stringify(result.failures, null, 2)).toEqual([]);
    expect(result.pushed.creates).toBe(4);

    // Every element id-swapped to a server-assigned id.
    const newIreena = await byName('Ireena');
    const newParty = await byName('the party');
    const newBarovia = await byName('Barovia');
    const newEntry = await byName('the curse');
    expect(newIreena.id).not.toBe(ireena.id);
    expect(newEntry.id).not.toBe(entry.id);

    // Holder + subject FKs rewritten to the post-swap ids.
    expect(heldByOf(newEntry)).toEqual({ narrator: newIreena.id, collectives: [newParty.id] });
    expect((newEntry as any).locations).toEqual([newBarovia.id]);
    // Circle membership rewritten too (Collective.characters drives inheritance).
    expect((newParty as any).characters).toEqual([newIreena.id]);
    expect(newEntry.server_updated_at).toBeTruthy();

    // Knowledge identity intact + richtext SURVIVED the id-swap (the swap
    // writes at a fresh id, where no existing file can donate the field —
    // the engine's swapped record must carry it itself).
    expect((newEntry as any).subtype).toBe('knowledge');
    expect((newEntry as any).story).toBe('Barovia is cursed.');
    expect((newEntry as any).atlas_richtext_json).toEqual(RICHTEXT);

    // Server side: entry exists with knowledge identity, but the atlas-local
    // richtext never landed there (strict validator would have 400'd the
    // push; absence here proves the adapter stripped it).
    const serverNarratives = await adapter.listElements('narrative');
    expect(serverNarratives).toHaveLength(1);
    const serverEntry = serverNarratives[0] as Record<string, unknown>;
    expect(serverEntry.subtype).toBe('knowledge');
    expect(serverEntry.story).toBe('Barovia is cursed.');
    expect('atlas_richtext_json' in serverEntry).toBe(false);

    // The computed-knowing scans still resolve on the post-swap local set:
    // direct narrator, circle-inherited holding, and the known-about union.
    const locals = await folder.listElements();
    expect(knowledgeHeldBy(newIreena.id, locals).map(e => e.id)).toEqual([newEntry.id]);
    expect(knowledgeHeldBy(newParty.id, locals).map(e => e.id)).toEqual([newEntry.id]);
    expect(elementsKnownAboutBy(newIreena.id, locals)).toEqual([newBarovia.id]);
  });

  it('pull-overlay of a server-side edit preserves local atlas_richtext_json', async () => {
    await seedKnowledgeWorld();
    await engine.syncNow();
    const synced = await byName('the curse');

    // Another client edits the entry's prose server-side.
    await adapter.updateElement('narrative', synced.id, { story: 'Barovia is cursed — and the mists never lift.' });

    const pull = await engine.pullNow();
    expect(pull.pulled.updates).toBe(1);

    // Local took the server's story but kept the atlas-local richtext
    // (ATLAS_LOCAL_EXTENSION_FIELDS overlay contract in applyServerRecord).
    const after = await byName('the curse');
    expect((after as any).story).toBe('Barovia is cursed — and the mists never lift.');
    expect((after as any).atlas_richtext_json).toEqual(RICHTEXT);
    expect((after as any).subtype).toBe('knowledge');
  });

  it('a knowledge entry created server-side arrives locally and is recognized by the scans', async () => {
    // A collaborator (web app, another atlas) creates a knowledge entry
    // directly on the server; this instance pulls it down. The computed model
    // means zero migration — the subtype scan picks it up immediately.
    const strahd = await adapter.createElement('character', { name: 'Strahd' } as any);
    await adapter.createElement('narrative', {
      name: 'a secret', subtype: 'knowledge', story: 'He watches.', narrator: strahd.id,
    } as any);

    const pull = await engine.pullNow();
    expect(pull.pulled.creates).toBe(2);

    const locals = await folder.listElements();
    const held = knowledgeHeldBy(strahd.id, locals);
    expect(held).toHaveLength(1);
    expect(held[0].name).toBe('a secret');
  });
});
