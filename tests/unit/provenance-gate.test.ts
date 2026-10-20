/**
 * The S446 gate's findings on the provenance lines (folder spec §4.2; the
 * contract `Forge/Notes/2026-10-20-s446-provenance-lines.md`), each with the
 * case that broke it: G1 a JSON export and its import keep the lines, G2 a
 * guest's unlink records its slice, G4 a demo key asks nothing, G6 a key of
 * another world names no slice, G8 the download words, G11 a long name.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { exportProvenance, setExportMeReaderForTests, unlinkProvenance } from '../../src/sync/export-provenance';
import { downloadLabel, partialSliceNote } from '../../src/core/provenance';
import { parsePayload } from '../../src/import/parse';
import { reconcile } from '../../src/import/reconcile';
import { buildWorldExport } from '../../src/import/export-world';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import type { WorldRegistryEntry } from '../../src/core/types';

const ANA = { id: '0192a000-0000-7000-8000-0000000000a1', name: 'Ana' };
const SLICE = { kind: 'character', role: 'guest', character: ANA };
const SOURCE = { server: 'https://www.onlyworlds.com', world: 'srv', at: '2026-10-20T19:00:00.000Z' };
const now = new Date('2026-10-20T19:00:00.000Z');
const linked = (api: Record<string, unknown>) => ({ id: 'w', name: 'Hollow Reach', api: { world_id: 'srv', ...api } }) as unknown as WorldRegistryEntry;
afterEach(() => setExportMeReaderForTests(null));

describe('G1: a JSON export and its import keep the lines', () => {
  it('the export carries them out', async () => {
    const store = new MockFolderStore();
    await store.open(null);
    await store.writeWorldMeta({ source: SOURCE, exported_as: SLICE } as never);
    const json = await buildWorldExport(store as never) as { world: Record<string, unknown> };
    expect(json.world.source).toEqual(SOURCE);
    expect(json.world.exported_as).toEqual(SLICE);
  });

  it('an import as a new world reads them back; a line that is not an object is left out', () => {
    const envelope = (world: Record<string, unknown>) => parsePayload({ format: 'onlyworlds-world-export', world: { name: 'Hollow Reach', ...world }, elements: {} });
    const plan = reconcile(envelope({ source: SOURCE, exported_as: SLICE }), [], { genId: () => 'gen' });
    expect(plan.worldMeta).toMatchObject({ source: SOURCE, exported_as: SLICE });
    expect(partialSliceNote(plan.worldMeta)).toBe("This is Ana's view of the world, not the whole world.");
    const bad = reconcile(envelope({ source: 'here', exported_as: ['character'] }), [], { genId: () => 'gen' });
    expect('source' in (bad.worldMeta ?? {})).toBe(false);
    expect('exported_as' in (bad.worldMeta ?? {})).toBe(false);
  });
});

describe('G2: a guest\'s unlink records that its folder is one Character\'s view', () => {
  it('a guest, or a seat, gets the character kind with no Character named (the role is known, the Character is not)', () => {
    for (const api of [{ api_key: 'k', member_role: 'guest' }, { api_key: 'k', seat: { role: 'guest' } }]) {
      expect(unlinkProvenance(linked(api), now)).toEqual({ source: SOURCE, exported_as: { kind: 'character', role: 'guest', character: null } });
    }
  });

  it('an owner, a member and a world whose role was never read: nothing', () => {
    for (const api of [{ api_key: 'k', member_role: 'owner' }, { api_key: 'k', member_role: 'contributor' }, { api_key: 'k' }]) {
      expect(unlinkProvenance(linked(api), now)).toBeNull();
    }
    expect(unlinkProvenance({ id: 'w', name: 'x' } as unknown as WorldRegistryEntry, now)).toBeNull();
  });

  it('the recorded slice reads as one Character\'s view', () => {
    expect(partialSliceNote(unlinkProvenance(linked({ api_key: 'k', member_role: 'guest' }), now))).toBe("This is one Character's view of the world, not the whole world.");
  });
});

describe('G4, G6: what /me may say', () => {
  it('a demo key is never asked: the file says where it came from only', async () => {
    const me = vi.fn(async () => ({ role: 'owner', world: { id: 'srv' } }));
    setExportMeReaderForTests(me);
    const p = await exportProvenance(linked({ api_key: '0000000001', read_only: true }), async () => undefined, now);
    expect(me).not.toHaveBeenCalled();
    expect(p).toEqual({ source: SOURCE, exportedAs: null });
  });

  it('a key that answers for another world names no slice', async () => {
    setExportMeReaderForTests(async () => ({ role: 'owner', character: null, world: { id: 'another-world' } }));
    expect((await exportProvenance(linked({ api_key: 'ow_w_k' }), async () => undefined, now))?.exportedAs).toBeNull();
    setExportMeReaderForTests(async () => ({ role: 'owner', character: null }));
    expect((await exportProvenance(linked({ api_key: 'ow_w_k' }), async () => undefined, now))?.exportedAs).toBeNull();
    setExportMeReaderForTests(async () => ({ role: 'owner', character: null, world: { id: 'srv' } }));
    expect((await exportProvenance(linked({ api_key: 'ow_w_k' }), async () => undefined, now))?.exportedAs).toEqual({ kind: 'owner', role: 'owner', character: null });
  });
});

describe('G8, G11: words beside a slice', () => {
  it('the download is "this world" for a slice, "the whole world" otherwise', () => {
    expect(downloadLabel({ exported_as: SLICE })).toBe('Download this world');
    expect(downloadLabel({ exported_as: { kind: 'owner' } })).toBe('Download the whole world');
    expect(downloadLabel({})).toBe('Download the whole world');
  });

  it('a Character name past 80 characters is cut where it is shown', () => {
    const note = partialSliceNote({ exported_as: { kind: 'character', character: { id: 'x', name: 'A'.repeat(5000) } } })!;
    expect(note.length).toBeLessThan(140);
    expect(note).toContain('A'.repeat(80) + '…');
  });
});
