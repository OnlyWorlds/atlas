/**
 * Sharing pages round-trip through the sync engine (DESIGN_SHARING.md).
 *
 * A page is a plain Narrative (subtype 'page') whose composition lives in
 * atlas-local fields (`atlas_page_blocks` / `atlas_page_refs` /
 * `atlas_page_intent`) — so sync needs NO sharing-specific code. This suite
 * locks that in against the FULL production stack (engine → OwV2ClientAdapter
 * → keel v2 MSW with strict unknown-field validation + /bulk fixpoint FK
 * resolution):
 *
 *   - First push lands the page AND its referenced elements in one atomic
 *     /bulk (v2 preserves client ids, so no id-swap); the flat
 *     `atlas_page_refs` mirror stays consistent and `blocksOf()` heals each
 *     element-card's nested id from the mirror — the make-online journey
 *     (compose locally → go online) keeps every card binding intact.
 *   - The composition fields never reach the wire (strict validator would
 *     422) but SURVIVE locally through the push and a pull-overlay.
 *   - The derived `story` mirror is what other devices/tools see.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { blocksOf, pageBlocksPatch, type PageBlock } from '../../src/core/sharing';

const TEST_BASE = 'https://test-ow.local/api/v2';

let folder: MockFolderStore;
let adapter: OwV2ClientAdapter;
let engine: SyncEngine;
let clock: MonotonicClock;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  const { handlers } = statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next });
  mswServer.use(...handlers);
  adapter = new OwV2ClientAdapter({ apiKey: 'test-key', apiPin: '1234', baseUrl: TEST_BASE });
  engine = new SyncEngine({ folder, client: adapter });
});

/** Seed: two elements + a page whose blocks bind one card to each. */
async function seedPageWorld() {
  const strahd = await folder.createElement('character', { name: 'Strahd' });
  const castle = await folder.createElement('location', { name: 'Ravenloft' });
  const blocks: PageBlock[] = [
    { id: 'h1', kind: 'heading', text: 'The Domain', level: 1 },
    { id: 'c1', kind: 'element-card', elementId: strahd.id, variant: 'full', fields: ['description'] },
    { id: 'p1', kind: 'prose', markdown: 'The mists never lift.' },
    { id: 'c2', kind: 'element-card', elementId: castle.id, variant: 'compact', fields: [] },
  ];
  const names = new Map([[strahd.id, 'Strahd'], [castle.id, 'Ravenloft']]);
  const page = await folder.createElement('narrative', {
    name: 'barovia primer',
    subtype: 'page',
    atlas_page_intent: 'reference',
    ...pageBlocksPatch(blocks, (id) => names.get(id) ?? null),
  });
  return { strahd, castle, page };
}

async function byName(name: string) {
  const el = (await folder.listElements()).find(e => e.name === name);
  expect(el, `local element "${name}" must exist`).toBeDefined();
  return el!;
}

describe('sharing page sync round-trip (full stack: adapter + SDK + MSW)', () => {
  it('first push id-swaps page + referenced elements; refs mirror rewritten; blocksOf heals card bindings', async () => {
    const { strahd, castle, page } = await seedPageWorld();

    const result = await engine.syncNow();
    expect(result.failures, JSON.stringify(result.failures, null, 2)).toEqual([]);
    expect(result.pushed.creates).toBe(3);

    const newStrahd = await byName('Strahd');
    const newCastle = await byName('Ravenloft');
    const newPage = await byName('barovia primer');
    // v2 /bulk preserves client ids — no id-swap. Bindings hold because the
    // ids never move.
    expect(newStrahd.id).toBe(strahd.id);
    expect(newPage.id).toBe(page.id);

    // The flat refs mirror is intact and the composition fields survived the
    // push (stripped from the wire, preserved on the local file).
    expect((newPage as any).atlas_page_refs).toEqual([newStrahd.id, newCastle.id]);
    expect((newPage as any).atlas_page_intent).toBe('reference');
    expect((newPage as any).subtype).toBe('page');
    expect(newPage.server_updated_at).toBeTruthy();

    // blocksOf heals the NESTED card ids from the mirror — the bindings that
    // would otherwise be permanently stale after make-online.
    const healed = blocksOf(newPage);
    expect(healed).toHaveLength(4);
    expect((healed[1] as any).elementId).toBe(newStrahd.id);
    expect((healed[3] as any).elementId).toBe(newCastle.id);

    // Server side: the page exists as a plain narrative with the derived
    // story mirror, but NONE of the composition fields landed there (strict
    // validator would have 422'd the push; absence proves the strip).
    const serverNarratives = await adapter.listElements('narrative');
    expect(serverNarratives).toHaveLength(1);
    const serverPage = serverNarratives[0] as Record<string, unknown>;
    expect(serverPage.subtype).toBe('page');
    expect(serverPage.story).toContain('# The Domain');
    expect(serverPage.story).toContain('[ Strahd · element card ]');
    expect('atlas_page_blocks' in serverPage).toBe(false);
    expect('atlas_page_refs' in serverPage).toBe(false);
    expect('atlas_page_intent' in serverPage).toBe(false);
  });

  it('pull-overlay of a server-side edit preserves the local composition fields', async () => {
    await seedPageWorld();
    await engine.syncNow();
    const synced = await byName('barovia primer');

    // Another client edits the page's name server-side.
    await adapter.updateElement('narrative', synced.id, { name: 'barovia primer v2' });

    const pull = await engine.pullNow();
    expect(pull.pulled.updates).toBe(1);

    // Local took the server's rename but kept every atlas-local composition
    // field (ATLAS_LOCAL_EXTENSION_FIELDS overlay contract in applyServerRecord).
    const after = await byName('barovia primer v2');
    expect((after as any).atlas_page_intent).toBe('reference');
    expect(blocksOf(after)).toHaveLength(4);
    expect((after as any).atlas_page_refs).toHaveLength(2);
  });

  it('a page created server-side (story only) arrives with no composition and reads its story', async () => {
    // A collaborator's tool (or Atlas on another device) creates a page-subtype
    // narrative without atlas composition: it pulls down clean, and its story is
    // the page, one prose block (it rendered as an empty page before).
    await adapter.createElement('narrative', {
      name: 'foreign page', subtype: 'page', story: '# Hello',
    } as any);

    const pull = await engine.pullNow();
    expect(pull.pulled.creates).toBe(1);

    const local = await byName('foreign page');
    expect((local as any).atlas_page_blocks).toBeUndefined();
    expect(blocksOf(local)).toEqual([{ id: `story-${local.id}`, kind: 'prose', markdown: '# Hello', richtextJson: null }]);
    expect((local as any).story).toBe('# Hello');
  });
});
