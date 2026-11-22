/**
 * Every place that reads a copy's baseline reads the mark of a copy with no
 * record of what OnlyWorlds held (conv. 192) as no baseline: the shape rule
 * for keel's stub (`knownOfMove`), the live folder's "not synced" count, the
 * element's sync dot. The review rows never let such a row take the place of a
 * proposal's. An import never carries the mark (as it never carries keel's
 * word on the hidden mark). Each case reds with its reading cut (the code
 * gate's S3 and S4).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { knownOfMove } from '../../src/sync/known-of';
import { notSyncedNow } from '../../src/core/live-folder';
import { withRows } from '../../src/sync/sync-engine';
import { renderHeader } from '../../src/middle/element-detail-header';
import { normalizeRecord } from '../../src/import/normalize';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Conflict, Element, WorldRegistryEntry } from '../../src/core/types';

/** A held copy whose edit time is before keel's stamp: only the mark says it is changed. */
const held = {
  id: 'a', type: 'character', name: 'Ada', description: 'v1',
  local_updated_at: '2026-01-01T00:00:00.000Z', server_updated_at: '2026-02-01T00:00:00.000000+00:00', atlas_baseline_unknown: true,
} as unknown as Element;

afterEach(() => {
  patchSlice('data', { elements: [] } as never);
  patchSlice('active', null as never);
  patchSlice('registry', defaultRegistry());
});

describe('the mark read as no baseline', () => {
  it('C2: keel\'s stub on a view walk never replaces a held copy (it counts as unsent)', () => {
    expect(knownOfMove(held, { id: 'a', type: 'character', name: 'Ada', known_of: true }, true)).toBe('keep');
  });

  it('C10: the live folder never counts a held copy as "not synced"', () => {
    const notice = { notSynced: new Set(['a']) } as unknown as Parameters<typeof notSyncedNow>[0];
    expect(notSyncedNow(notice, [held])).toBe(0);
  });

  it('C18: the element\'s sync dot shows a held copy as waiting, never as synced', () => {
    const W = 'w-dot';
    // A linked world that syncs keeps a PIN here: with none it waits on the World PIN, and its dot says kept here (1.125.0).
    patchSlice('registry', { ...defaultRegistry(), pin: '1234', worlds: [{ id: W, name: 'W', state: 'api-linked', api: { world_id: 's', api_key: 'k' }, created_at: 't' } as unknown as WorldRegistryEntry] });
    patchSlice('active', { worldId: W, meta: { name: 'W' } } as never);
    patchSlice('data', { ...getState().data, elements: [held] });
    const dot = renderHeader(held).querySelector<HTMLElement>('[data-role="element-sync-dot"]')!;
    expect(dot.dataset.state).toBe('dirty');
  });
});

describe('the rows and the import', () => {
  it('C8: a row for a copy with no record never takes the place of a proposal keel did not take', () => {
    const proposal: Conflict = { element_id: 'a', type: 'character', detected_at: 't', local_updated_at: 'l', server_updated_at: 's', fields: ['x'], proposal: { outcome: 'declined' } };
    const fresh: Conflict = { ...proposal, proposal: undefined, no_baseline: true, fields: ['description'] };
    expect(withRows([proposal], [fresh])).toEqual([proposal]);
  });

  it('S4: an import never carries the mark', () => {
    const { record } = normalizeRecord({ id: 'a', name: 'Ada', atlas_baseline_unknown: true, atlas_hidden_shown_online: true, x_note: 'kept' }, 'character');
    expect('atlas_baseline_unknown' in record).toBe(false);
    expect('atlas_hidden_shown_online' in record).toBe(false);
    expect(record.x_note).toBe('kept');
  });
});
