/**
 * A delete removes the dead id from every link that named it, the local
 * mirror of keel's `_scrub_cross_type`. Before this, a deleted location stayed
 * in its characters' `location` field: the detail pane showed a raw id, and
 * once the world went online keel refused those characters with
 * `invalid_link` on every round, so they never uploaded.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { deadLinkPatch, findDanglingLinks } from '../../src/store/scrub-links';
import type { Element } from '../../src/core/types';

let folder: MockFolderStore;
let clock: MonotonicClock;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
});

const field = async (id: string, f: string) => ((await folder.getElement(id)) as unknown as Record<string, unknown>)[f];

describe('deleteElement scrubs referrers', () => {
  it('clears a single link and drops the id from a multi link, keeping the rest', async () => {
    const castle = await folder.createElement('location', { name: 'Castle' });
    const village = await folder.createElement('location', { name: 'Village' });
    const strahd = await folder.createElement('character', { name: 'Strahd', location: castle.id } as Partial<Element>);
    const feast = await folder.createElement('event', { name: 'The Feast', locations: [castle.id, village.id] } as Partial<Element>);

    await folder.deleteElement(castle.id);

    expect(await field(strahd.id, 'location')).toBeNull();
    expect(await field(feast.id, 'locations')).toEqual([village.id]);
  });

  it('stamps each referrer so a synced one pushes the cleared link', async () => {
    const castle = await folder.createElement('location', { name: 'Castle' });
    const strahd = await folder.createElement('character', { name: 'Strahd', location: castle.id } as Partial<Element>);
    const before = (await folder.getElement(strahd.id))!.local_updated_at!;
    await folder.deleteElement(castle.id);
    expect((await folder.getElement(strahd.id))!.local_updated_at! > before).toBe(true);
  });

  it('leaves elements that never named the dead id untouched', async () => {
    const castle = await folder.createElement('location', { name: 'Castle' });
    const kolyan = await folder.createElement('character', { name: 'Kolyan' });
    const before = (await folder.getElement(kolyan.id))!.local_updated_at;
    await folder.deleteElement(castle.id);
    expect((await folder.getElement(kolyan.id))!.local_updated_at).toBe(before);
  });

  it('scrubs a spatial element too (an event keeps its other zones)', async () => {
    const vale = await folder.createElement('zone', { name: 'Vale' });
    const coast = await folder.createElement('zone', { name: 'Coast' });
    const raid = await folder.createElement('event', { name: 'Raid', zones: [vale.id, coast.id] } as Partial<Element>);
    await folder.deleteElement(vale.id);
    expect(await field(raid.id, 'zones')).toEqual([coast.id]);
  });

  it('a silent delete (the engine and Route 2 channel) never scrubs', async () => {
    const castle = await folder.createElement('location', { name: 'Castle' });
    const strahd = await folder.createElement('character', { name: 'Strahd', location: castle.id } as Partial<Element>);
    await folder.deleteElement(castle.id, { silent: true });
    expect(await field(strahd.id, 'location')).toBe(castle.id);
  });

  it('a local world with a deleted location goes online whole', async () => {
    const castle = await folder.createElement('location', { name: 'Castle' });
    await folder.createElement('character', { name: 'Strahd', location: castle.id } as Partial<Element>);
    await folder.createElement('character', { name: 'Ireena', location: castle.id } as Partial<Element>);
    await folder.createElement('character', { name: 'Kolyan' });
    await folder.deleteElement(castle.id);

    const client = new FakeOwApiClient();
    client.setClock(clock.next);
    client.__enable_bulk();
    const engine = new SyncEngine({ folder, client });
    const r = await engine.syncNow();

    expect(r.failures).toEqual([]);
    const names = (await client.listElements('character')).map(c => (c as { name?: string }).name).sort();
    expect(names).toEqual(['Ireena', 'Kolyan', 'Strahd']);
  });
});

describe('deadLinkPatch / findDanglingLinks', () => {
  const el = (over: Record<string, unknown>) => ({ id: 'c1', type: 'character', name: 'C', ...over }) as unknown as Element;

  it('reads the foreign shapes a folder from another tool carries', () => {
    const dead = new Set(['x']);
    expect(deadLinkPatch(el({ location: { id: 'x' } }), dead)).toEqual({ location: null });
    expect(deadLinkPatch(el({ species: [{ id: 'x' }, 'y'] }), dead)).toEqual({ species: ['y'] });
    // a lone id string in a multi field (linkIdsOf reads it as a list of one)
    expect(deadLinkPatch(el({ species: 'x' }), dead)).toEqual({ species: [] });
    expect(deadLinkPatch(el({ location: 'y', species: ['y'] }), dead)).toBeNull();
  });

  it('never touches a pin element_id (the cascade owns pins)', () => {
    const pin = { id: 'p1', type: 'pin', name: '', element_id: 'x', element_type: 'character', map_id: 'm' } as unknown as Element;
    expect(deadLinkPatch(pin, new Set(['x']))).toBeNull();
  });

  it('finds links to ids that are not in the world, ignoring empty values', () => {
    const els = [
      el({ id: 'a', location: 'gone', species: ['b', 'gone2'], birthplace: '' }),
      { id: 'b', type: 'species', name: 'S' } as unknown as Element,
    ];
    expect(findDanglingLinks(els)).toEqual([
      { elementId: 'a', field: 'species', missingId: 'gone2' },
      { elementId: 'a', field: 'location', missingId: 'gone' },
    ]);
  });
});
