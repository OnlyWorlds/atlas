/**
 * The folder format's provenance lines (spec §4.2, v0.3.9; the provenance-lines
 * contract): a linked world's world
 * file says where it came from (`source`) and which slice it is
 * (`exported_as`, from /me, never guessed); Atlas says the slice; a slice that
 * is not the whole world never goes online as a world of its own.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  exportedAsFromMe, withProvenance, sliceOf, sliceLine, partialSliceNote, slicePushRefusal, exportDate,
} from '../../src/core/provenance';
import { collectWorldFiles, withProvenanceLines, zipWorld, readWorldZip } from '../../src/store/world-file';
import { exportProvenance, setExportMeReaderForTests } from '../../src/sync/export-provenance';
import { FOLDER_FORMAT_VERSION } from '../../src/core/constants';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { MakeOnlineModal } from '../../src/ui/make-online-modal';
import { mergeLocalIntoApi, MergeRefusedError } from '../../src/sync/make-online';
import { patchSlice, getState } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { ToastManager } from '../../src/ui/toast-manager';
import type { WorldRegistryEntry } from '../../src/core/types';

const ANA = { id: '0192a000-0000-7000-8000-0000000000a1', name: 'Ana' };
const nameOf = (id: string) => (id === ANA.id ? ANA.name : undefined);
const CHARACTER_SLICE = { kind: 'character', role: 'guest', character: ANA };

describe('W3: the slice from /me, never guessed', () => {
  it('maps the spec\'s table', () => {
    expect(exportedAsFromMe({ role: 'owner', character: null }, nameOf)).toEqual({ kind: 'owner', role: 'owner', character: null });
    expect(exportedAsFromMe({ role: 'co_builder' }, nameOf)).toEqual({ kind: 'member', role: 'co_builder', character: null });
    expect(exportedAsFromMe({ role: 'contributor' }, nameOf)).toEqual({ kind: 'member', role: 'contributor', character: null });
    expect(exportedAsFromMe({ role: 'guest', character: ANA.id }, nameOf)).toEqual(CHARACTER_SLICE);
  });

  it('a guest with no Character, a hidden one, or one not in the copy, and an unknown role: no line', () => {
    expect(exportedAsFromMe({ role: 'guest' }, nameOf)).toBeNull();
    expect(exportedAsFromMe({ role: 'guest', character: null }, nameOf)).toBeNull();
    expect(exportedAsFromMe({ role: 'guest', character: 'not-in-the-copy' }, nameOf)).toBeNull();
    expect(exportedAsFromMe({ role: 'steward' }, nameOf)).toBeNull();
  });
});

describe('W2: the lines in world.json', () => {
  const source = { server: 'https://www.onlyworlds.com', world: 'srv', at: '2026-10-20T19:00:00.000Z' };

  it('source is fresh, the slice is this export\'s, every other key stays', () => {
    const meta = { id: 'w', name: 'Hollow Reach', time_current: 12, source: { server: 'old', world: 'old', at: 'old' } };
    expect(withProvenance(meta, source, CHARACTER_SLICE as never)).toEqual({ id: 'w', name: 'Hollow Reach', time_current: 12, source, exported_as: CHARACTER_SLICE });
  });

  it('an older slice goes when this export cannot know one', () => {
    const out = withProvenance({ id: 'w', exported_as: { kind: 'owner' } }, source, null);
    expect(out).toEqual({ id: 'w', source });
    expect('exported_as' in out).toBe(false);
  });
});

describe('K1: the world file carries the lines through a round trip', () => {
  it('stamped on the way out, read back as written, with the version it was written against', async () => {
    const d = new FakeDirHandle('w');
    d.put('world.json', JSON.stringify({ id: '0192a000-aaaa-7bbb-8ccc-000000000001', name: 'Hollow Reach', api: { world_id: 'srv', api_key: 'ow_w_secret' } }));
    d.put('elements/character/ana--000000a1.json', JSON.stringify(ANA));
    const source = { server: 'https://www.onlyworlds.com', world: 'srv', at: '2026-10-20T19:00:00.000Z' };
    const files = withProvenanceLines(await collectWorldFiles(d as never), source, CHARACTER_SLICE as never);
    const back = readWorldZip(zipWorld(files, 'hollow-reach'));
    const meta = JSON.parse(new TextDecoder().decode(back.files.find(f => f.path === 'world.json')!.data));
    expect(meta.source).toEqual(source);
    expect(meta.exported_as).toEqual(CHARACTER_SLICE);
    expect(meta.format_version).toBe(FOLDER_FORMAT_VERSION);
    expect(meta.api).toBeUndefined();
    expect(JSON.stringify(meta)).not.toContain('ow_w_secret');
  });
});

describe('W1-W3: what an export asks', () => {
  const linked = (key = 'ow_w_key') => ({ id: 'w', name: 'Hollow Reach', api: { world_id: 'srv', api_key: key } }) as unknown as WorldRegistryEntry;
  const now = new Date('2026-10-20T19:00:00.000Z');
  afterEach(() => setExportMeReaderForTests(null));

  it('a local world: no lines (its file carries what its world.json holds)', async () => {
    const me = vi.fn();
    setExportMeReaderForTests(me);
    expect(await exportProvenance({ id: 'w', name: 'x' } as unknown as WorldRegistryEntry, async () => undefined, now)).toBeNull();
    expect(me).not.toHaveBeenCalled();
  });

  it('a linked world: source from its link, the slice from /me with its own key', async () => {
    const me = vi.fn(async () => ({ role: 'guest', character: ANA.id, world: { id: 'srv' } }));
    setExportMeReaderForTests(me);
    const p = await exportProvenance(linked('ow_w_mine'), async (id) => nameOf(id), now);
    expect(me).toHaveBeenCalledWith('ow_w_mine');
    expect(p).toEqual({ source: { server: 'https://www.onlyworlds.com', world: 'srv', at: now.toISOString() }, exportedAs: CHARACTER_SLICE });
  });

  it('/me refused: source alone', async () => {
    setExportMeReaderForTests(async () => { throw new Error('401'); });
    const p = await exportProvenance(linked(), async (id) => nameOf(id), now);
    expect(p?.source.world).toBe('srv');
    expect(p?.exportedAs).toBeNull();
  });

  it('offline: source alone, and /me is not asked', async () => {
    const me = vi.fn();
    setExportMeReaderForTests(me);
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      expect((await exportProvenance(linked(), async () => undefined, now))?.exportedAs).toBeNull();
      expect(me).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});

describe('R1: saying the slice', () => {
  const at = '2026-10-20T19:00:00.000Z';
  const date = exportDate(at)!;

  it('Settings names where it came from and which slice', () => {
    expect(sliceLine({ source: { server: 'https://www.onlyworlds.com', at }, exported_as: CHARACTER_SLICE }, exportDate)).toBe(`Exported from onlyworlds.com on ${date} as Ana's view: only what Ana knows of the world.`);
    expect(sliceLine({ source: { server: 'https://staging.onlyworlds.com', at }, exported_as: { kind: 'owner', role: 'owner' } }, exportDate)).toBe(`Exported from staging.onlyworlds.com on ${date} by its owner: the whole world.`);
    expect(sliceLine({ exported_as: { kind: 'member', role: 'co_builder' } }, exportDate)).toBe('Exported by a co-builder.');
    expect(sliceLine({ exported_as: { kind: 'member', role: '<b>owner</b>' } }, exportDate)).toBe('Exported by a member.');
    expect(sliceLine({ source: { server: 'not a url' }, exported_as: { kind: 'public' } }, exportDate)).toBe("Exported: the world's public view, not the whole world.");
    expect(sliceLine({ id: 'w', name: 'x' }, exportDate)).toBeNull();
  });

  it('Home notes only a slice that is not the whole world', () => {
    expect(partialSliceNote({ exported_as: CHARACTER_SLICE })).toBe("This is Ana's view of the world, not the whole world.");
    expect(partialSliceNote({ exported_as: { kind: 'public' } })).toBe("This is the world's public view, not the whole world.");
    expect(partialSliceNote({ exported_as: { kind: 'owner' } })).toBeNull();
    expect(partialSliceNote({ exported_as: { kind: 'member', role: 'contributor' } })).toBeNull();
  });

  it('a malformed line is no line (world data is untrusted)', () => {
    for (const bad of [{ exported_as: 'character' }, { exported_as: { kind: 'everyone' } }, { exported_as: null }, null, 'x']) {
      expect(sliceOf(bad)).toBeNull();
    }
    expect(sliceOf({ exported_as: { kind: 'character', character: { name: 7 } } })?.name).toBeNull();
  });
});

describe('P1: a slice never goes online as the whole', () => {
  let store: MockFolderStore;
  beforeEach(async () => {
    document.body.innerHTML = '';
    store = new MockFolderStore();
    await store.open(null);
    setActiveStore(store as never);
  });

  function activate(meta: Record<string, unknown>): void {
    const entry = { id: 'w-1', name: 'Hollow Reach', state: 'local-only', folder: { handle_key: 'world-w-1', folder_name: 'hollow' } };
    patchSlice('registry', { ...getState().registry, worlds: [entry as never] });
    patchSlice('active', { worldId: 'w-1', meta: { id: 'w-1', name: 'Hollow Reach', ...meta } as never, opened: true });
  }

  it('the modal refuses a Character\'s view and the public view, and opens nothing', () => {
    for (const exported_as of [CHARACTER_SLICE, { kind: 'public', role: null, character: null }]) {
      document.body.innerHTML = '';
      activate({ exported_as });
      const toasts = new ToastManager();
      const info = vi.spyOn(toasts, 'info');
      new MakeOnlineModal(toasts).open();
      expect(info).toHaveBeenCalledWith(expect.stringMatching(/of Hollow Reach, not the whole world, so it can't go online/));
      expect(document.querySelector('.atlas-modal-overlay')).toBeNull();
    }
  });

  it('an owner\'s or a member\'s copy, and a world with no line, still open it', () => {
    for (const meta of [{ exported_as: { kind: 'owner', role: 'owner', character: null } }, { exported_as: { kind: 'member', role: 'contributor', character: null } }, {}]) {
      document.body.innerHTML = '';
      activate(meta);
      new MakeOnlineModal(new ToastManager()).open();
      expect(document.querySelector('.atlas-modal-overlay')).not.toBeNull();
    }
  });

  it('linking into an existing world refuses before anything is read or written', async () => {
    await store.writeWorldMeta({ exported_as: CHARACTER_SLICE } as never);
    const adapter = new Proxy({}, { get: () => () => { throw new Error('the client was asked'); } });
    await expect(mergeLocalIntoApi(store as never, adapter as never, 'keep-both' as never)).rejects.toBeInstanceOf(MergeRefusedError);
    await expect(mergeLocalIntoApi(store as never, adapter as never, 'keep-both' as never)).rejects.toThrow(/Ana's view of .*, not the whole world/);
  });

  it('the refusal words', () => {
    expect(slicePushRefusal({ exported_as: CHARACTER_SLICE }, 'Hollow Reach')).toBe("This is Ana's view of Hollow Reach, not the whole world, so it can't go online as a world of its own.");
    expect(slicePushRefusal({ exported_as: { kind: 'owner' } }, 'Hollow Reach')).toBeNull();
  });
});
