/**
 * The strand's writes (`src/ui/strand-write.ts`, the contract's S4) against the in-memory store: one
 * field per element write, the link landing before the mark, the guard refusing before anything is
 * made, compare-and-set on a single link, and the mark's guard asked again inside the meta op.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getState, patchSlice } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldMeta, WorldRegistryEntry } from '../../src/core/types';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { clearStrand, makeStrandSlot, writeStrandSlot, type StrandDrawn } from '../../src/ui/strand-write';

const W = 'w-strand';
const N = '0192a000-0000-7000-8000-000000000a01';
const N2 = '0192a000-0000-7000-8000-000000000a02';
const E = '0192a000-0000-7000-8000-000000000b01';
const L = '0192a000-0000-7000-8000-000000000c01';
const C = '0192a000-0000-7000-8000-000000000d01';
/** Ids that name nothing here: a mark of three strings reads as a strand on every SDK serial. */
const GONE_E = '0192a000-0000-7000-8000-00000000ee01';
const GONE_L = '0192a000-0000-7000-8000-00000000ee02';

let store: MockFolderStore;
/** Every write in order: an element's patch (its field names) or the mark. */
let log: Array<{ kind: 'element'; id: string; fields: string[] } | { kind: 'mark'; value: unknown }>;

async function put(type: string, id: string, extra: Record<string, unknown> = {}): Promise<void> {
  await store.createElementVerbatim(type as never, { id, type, name: `${type} ${id.slice(-4)}`, ...extra } as unknown as Element);
}

async function open(mark: unknown, entry: Partial<WorldRegistryEntry> = {}): Promise<void> {
  if (mark !== undefined) await store.writeWorldMeta({ x_strand: mark } as unknown as Partial<WorldMeta>);
  const meta = await store.readWorldMeta();
  patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: W, name: 'W', state: 'local-only', ...entry } as WorldRegistryEntry] });
  patchSlice('active', { worldId: W, meta } as never);
  patchSlice('data', { elements: await store.listElements(), loading: false } as never);
  log = [];
}

/** What a box was drawn with, read off the mirror as Home reads it. */
function drawn(extra: Partial<StrandDrawn> = {}): StrandDrawn {
  const m = (getState().active!.meta as unknown as Record<string, unknown>).x_strand as Record<string, string | null> | undefined;
  return { worldId: W, narrative: m?.narrative ?? null, event: m?.event ?? null, location: m?.location ?? null, ...extra } as StrandDrawn;
}

const onDisk = async (id: string) => (await store.listElements()).find(e => e.id === id) as unknown as Record<string, unknown>;
const markOnDisk = async () => (await store.readWorldMeta() as unknown as Record<string, unknown>).x_strand;

beforeEach(() => {
  store = new MockFolderStore();
  setActiveStore(store as never);
  const update = store.updateElementWith.bind(store);
  store.updateElementWith = async (id, mutate) => update(id, ex => {
    const patch = mutate(ex);
    if (patch) log.push({ kind: 'element', id, fields: Object.keys(patch) });
    return patch;
  });
  const meta = store.writeWorldMetaWith.bind(store);
  store.writeWorldMetaWith = async mutate => meta(cur => {
    const patch = mutate(cur);
    if (patch) log.push({ kind: 'mark', value: (patch as Record<string, unknown>).x_strand });
    return patch;
  });
  log = [];
});

afterEach(() => {
  setActiveStore(null);
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
  patchSlice('data', { elements: [] } as never);
});

describe('the story', () => {
  it('a pick on an empty strand writes the mark alone, the story id and two nulls', async () => {
    await put('narrative', N);
    await open(undefined);
    expect(await writeStrandSlot('narrative', drawn(), N)).toBe('wrote');
    expect(log).toEqual([{ kind: 'mark', value: { narrative: N, event: null, location: null } }]);
    expect(await markOnDisk()).toEqual({ narrative: N, event: null, location: null });
    expect((getState().active!.meta as unknown as Record<string, unknown>).x_strand).toEqual({ narrative: N, event: null, location: null });
  });

  it('a change keeps the happening and its place only where the new story lists them', async () => {
    await put('narrative', N, { events: [E] });
    await put('narrative', N2, { events: [E] });
    await put('event', E, { locations: [L] });
    await put('location', L);
    await open({ narrative: N, event: E, location: L });
    expect(await writeStrandSlot('narrative', drawn(), N2)).toBe('wrote');
    expect(await markOnDisk()).toEqual({ narrative: N2, event: E, location: L });
  });

  it('Make one: the guard first, then a story with the first writing label and the mark naming it', async () => {
    await open(undefined);
    const out = await makeStrandSlot('narrative', drawn(), 'The Long Road');
    expect(out.result).toBe('wrote');
    const made = await onDisk(out.made!.id);
    expect(made.name).toBe('The Long Road');
    expect(typeof made.supertype).toBe('string');
    expect((made.supertype as string).length).toBeGreaterThan(0);
    expect(await markOnDisk()).toEqual({ narrative: out.made!.id, event: null, location: null });
  });
});

describe('the happening and where it happened', () => {
  it('a happening: one field on the story (its events, the id appended), then the mark', async () => {
    await put('narrative', N, { events: [] });
    await put('event', E);
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    expect(await writeStrandSlot('event', drawn(), E)).toBe('wrote');
    expect(log).toEqual([
      { kind: 'element', id: N, fields: ['events'] },
      { kind: 'mark', value: { narrative: N, event: E, location: null } },
    ]);
    expect((await onDisk(N)).events).toEqual([E]);
  });

  it('an id the SDK already reads as listed is never appended again; an object entry gets the bare id beside it', async () => {
    await put('narrative', N, { events: [E] });
    await put('event', E);
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    expect(await writeStrandSlot('event', drawn(), E)).toBe('wrote');
    expect(log.map(l => l.kind)).toEqual(['mark']);

    await put('narrative', N2, { events: [{ id: E, name: 'Old shape' }] });
    await open({ narrative: N2, event: GONE_E, location: GONE_L });
    expect(await writeStrandSlot('event', drawn(), E)).toBe('wrote');
    expect((await onDisk(N2)).events).toEqual([{ id: E, name: 'Old shape' }, E]);
  });

  it('where it happened: the place appended to the happening, then the full mark', async () => {
    await put('narrative', N, { events: [E] });
    await put('event', E, { locations: [] });
    await put('location', L);
    await open({ narrative: N, event: E, location: GONE_L });
    expect(await writeStrandSlot('location', drawn(), L)).toBe('wrote');
    expect(log).toEqual([
      { kind: 'element', id: E, fields: ['locations'] },
      { kind: 'mark', value: { narrative: N, event: E, location: L } },
    ]);
  });
});

describe('the guard (G3)', () => {
  it('refuses before anything is made when the mark on disk names another story', async () => {
    await put('narrative', N, { events: [] });
    await put('narrative', N2, { events: [] });
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    const box = drawn();
    // Another tab moved the story on disk; this tab still draws N.
    await store.writeWorldMeta({ x_strand: { narrative: N2, event: GONE_E, location: GONE_L } } as unknown as Partial<WorldMeta>);
    const before = (await store.listElements()).length;
    const out = await makeStrandSlot('event', box, 'The Fire');
    expect(out).toEqual({ result: 'refused' });
    expect((await store.listElements()).length).toBe(before);
    expect(log.filter(l => l.kind === 'element')).toEqual([]);
    expect((await onDisk(N)).events).toEqual([]);
    expect(await markOnDisk()).toEqual({ narrative: N2, event: GONE_E, location: GONE_L });
  });

  it('where it happened is refused when the happening moved', async () => {
    await put('narrative', N, { events: [E] });
    await put('event', E, { locations: [] });
    await put('location', L);
    await open({ narrative: N, event: E, location: GONE_L });
    const box = drawn();
    await store.writeWorldMeta({ x_strand: { narrative: N, event: GONE_E, location: GONE_L } } as unknown as Partial<WorldMeta>);
    expect(await writeStrandSlot('location', box, L)).toBe('refused');
    expect((await onDisk(E)).locations).toEqual([]);
  });

  it('asked again inside the meta op: a mark moved after the link leaves the link and no mark', async () => {
    await put('narrative', N, { events: [] });
    // The story the mark moves to is in the world, so its mark reads as a strand a write could start from.
    await put('narrative', N2, { events: [] });
    await put('event', E);
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    const box = drawn();
    const meta = store.writeWorldMetaWith.bind(store);
    store.writeWorldMetaWith = async mutate => {
      await store.writeWorldMeta({ x_strand: { narrative: N2, event: GONE_E, location: GONE_L } } as unknown as Partial<WorldMeta>);
      return meta(mutate);
    };
    expect(await writeStrandSlot('event', box, E)).toBe('refused');
    expect((await onDisk(N)).events).toEqual([E]);
    expect(await markOnDisk()).toEqual({ narrative: N2, event: GONE_E, location: GONE_L });
  });
});

describe('the hero and where the hero is now', () => {
  it('Hero: the story\'s protagonist, one field, no mark write', async () => {
    await put('narrative', N);
    await put('character', C);
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    expect(await writeStrandSlot('character', drawn({ on: N, raw: null }), C)).toBe('wrote');
    expect(log).toEqual([{ kind: 'element', id: N, fields: ['protagonist'] }]);
    expect((await onDisk(N)).protagonist).toBe(C);
  });

  it('compare-and-set: a protagonist that moved since the promise is never overwritten', async () => {
    await put('narrative', N, { protagonist: 'someone-else' });
    await put('character', C);
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    expect(await writeStrandSlot('character', drawn({ on: N, raw: null }), C)).toBe('refused');
    expect((await onDisk(N)).protagonist).toBe('someone-else');
    // The value the promise named: written.
    expect(await writeStrandSlot('character', drawn({ on: N, raw: 'someone-else' }), C)).toBe('wrote');
    expect((await onDisk(N)).protagonist).toBe(C);
  });

  it('Make one for where the hero is now: a Location made, then the hero\'s location', async () => {
    await put('narrative', N, { protagonist: C });
    await put('character', C);
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    const out = await makeStrandSlot('now', drawn({ on: C, raw: null }), 'The Lighthouse');
    expect(out.result).toBe('wrote');
    expect(log).toEqual([{ kind: 'element', id: C, fields: ['location'] }]);
    expect((await onDisk(C)).location).toBe(out.made!.id);
  });

  it('C6: a Make one whose field already moved makes nothing, for the hero and for where the hero is now', async () => {
    await put('narrative', N, { protagonist: 'moved' });
    await put('character', C, { location: 'moved-too' });
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    const before = (await store.listElements()).length;
    expect(await makeStrandSlot('character', drawn({ on: N, raw: null }), 'Mira')).toEqual({ result: 'refused' });
    await store.updateElement(N, { protagonist: C } as Partial<Element>);
    await open(undefined);
    expect(await makeStrandSlot('now', drawn({ on: C, raw: null }), 'The Mill')).toEqual({ result: 'refused' });
    expect((await store.listElements()).length).toBe(before);
    expect((await onDisk(N)).protagonist).toBe(C);
    expect((await onDisk(C)).location).toBe('moved-too');
  });

  it('a Make one whose field moves while it makes keeps what it made, and writes nothing over the move', async () => {
    await put('narrative', N);
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    const create = store.createElement.bind(store);
    store.createElement = async (type, data) => {
      const made = await create(type, data);
      await store.updateElement(N, { protagonist: 'moved' } as Partial<Element>);
      return made;
    };
    const out = await makeStrandSlot('character', drawn({ on: N, raw: null }), 'Mira');
    expect(out.result).toBe('refused');
    expect(out.made && (await onDisk(out.made.id)).name).toBe('Mira');
    expect((await onDisk(N)).protagonist).toBe('moved');
  });

  it('C3: where the hero is now is refused once the story names another hero, before and right before the lock', async () => {
    await put('narrative', N, { protagonist: C });
    await put('character', C);
    await put('character', '0192a000-0000-7000-8000-000000000d02');
    await put('location', L);
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    const box = drawn({ on: C, raw: null });
    await store.updateElement(N, { protagonist: '0192a000-0000-7000-8000-000000000d02' } as Partial<Element>);
    expect(await writeStrandSlot('now', box, L)).toBe('refused');
    expect((await onDisk(C)).location ?? null).toBeNull();
    // A Make one for the old hero makes nothing (C6 with C3).
    const before = (await store.listElements()).length;
    expect(await makeStrandSlot('now', box, 'The Mill')).toEqual({ result: 'refused' });
    expect((await store.listElements()).length).toBe(before);

    // Moved after the first read: the read right before the hero's lock refuses it.
    await store.updateElement(N, { protagonist: C } as Partial<Element>);
    const get = store.getElement.bind(store);
    let reads = 0;
    store.getElement = async id => {
      if (id === N && ++reads === 2) await store.updateElement(N, { protagonist: 'someone-else' } as Partial<Element>);
      return get(id);
    };
    expect(await writeStrandSlot('now', box, L)).toBe('refused');
    expect((await onDisk(C)).location ?? null).toBeNull();
    expect(log.filter(l => l.kind === 'element' && l.id === C)).toEqual([]);
  });
});

describe('C2: a change compares the member it replaces', () => {
  const E2 = '0192a000-0000-7000-8000-000000000b02';
  const E3 = '0192a000-0000-7000-8000-000000000b03';
  const L2 = '0192a000-0000-7000-8000-000000000c02';

  it('Change on the happening is refused when another tab moved it, before any write', async () => {
    await put('narrative', N, { events: [E, E2] });
    await put('event', E);
    await put('event', E2);
    await put('event', E3);
    await open({ narrative: N, event: E, location: GONE_L });
    const box = drawn();
    await store.writeWorldMeta({ x_strand: { narrative: N, event: E2, location: GONE_L } } as unknown as Partial<WorldMeta>);
    expect(await writeStrandSlot('event', box, E3)).toBe('refused');
    expect((await onDisk(N)).events).toEqual([E, E2]);
    expect(await markOnDisk()).toEqual({ narrative: N, event: E2, location: GONE_L });
  });

  it('and inside the meta op, when it moves after the link', async () => {
    await put('narrative', N, { events: [E, E2] });
    await put('event', E);
    await put('event', E2);
    await put('event', E3);
    await open({ narrative: N, event: E, location: GONE_L });
    const box = drawn();
    const meta = store.writeWorldMetaWith.bind(store);
    store.writeWorldMetaWith = async mutate => {
      await store.writeWorldMeta({ x_strand: { narrative: N, event: E2, location: GONE_L } } as unknown as Partial<WorldMeta>);
      return meta(mutate);
    };
    expect(await writeStrandSlot('event', box, E3)).toBe('refused');
    expect(await markOnDisk()).toEqual({ narrative: N, event: E2, location: GONE_L });
  });

  it('Change on where it happened is refused when the place moved', async () => {
    await put('narrative', N, { events: [E] });
    await put('event', E, { locations: [L, L2] });
    await put('location', L);
    await put('location', L2);
    await open({ narrative: N, event: E, location: L });
    const box = drawn();
    await store.writeWorldMeta({ x_strand: { narrative: N, event: E, location: L2 } } as unknown as Partial<WorldMeta>);
    expect(await writeStrandSlot('location', box, GONE_L)).toBe('refused');
    expect(await markOnDisk()).toEqual({ narrative: N, event: E, location: L2 });
    expect((await onDisk(E)).locations).toEqual([L, L2]);
  });
});

describe('Not the strand, and where nothing is written', () => {
  it('removes the key while the mark still names the story drawn; refused once it moved', async () => {
    await put('narrative', N);
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    const box = drawn();
    await store.writeWorldMeta({ x_strand: { narrative: N2, event: null, location: null } } as unknown as Partial<WorldMeta>);
    expect(await clearStrand(box)).toBe('refused');
    expect(await markOnDisk()).toEqual({ narrative: N2, event: null, location: null });
    await open({ narrative: N, event: null, location: null });
    expect(await clearStrand(drawn())).toBe('wrote');
    expect(await markOnDisk()).toBeUndefined();
    expect((getState().active!.meta as unknown as Record<string, unknown>).x_strand).toBeUndefined();
  });

  it('a view-only world writes nothing', async () => {
    await put('narrative', N);
    await open(undefined, { copy_of: { world_id: 'x' } } as never);
    expect(await writeStrandSlot('narrative', drawn(), N)).toBe('nothing');
    expect(await makeStrandSlot('narrative', drawn(), 'X')).toEqual({ result: 'nothing' });
    expect(log).toEqual([]);
  });
});
