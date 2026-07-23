import { describe, it, expect } from 'vitest';
import { normalizeRecord } from '../../src/import/normalize';
import type { RawRecord } from '../../src/import/types';

describe('normalizeRecord', () => {
  it('strips server/meta fields AND the published-state mirror (atlas_page_pub)', () => {
    const { record } = normalizeRecord({
      id: 'x', name: 'Page',
      created_at: 'c', updated_at: 'u', world: 'w',
      local_updated_at: 't', server_updated_at: 't',
      atlas_page_pub: { id: 'p', slug: 'old-slug', revoked: false },
    } as RawRecord, 'narrative');
    expect(record.atlas_page_pub).toBeUndefined(); // would falsely claim the source world's slug
    expect(record.created_at).toBeUndefined();
    expect(record.world).toBeUndefined();
    expect(record.server_updated_at).toBeUndefined();
    expect(record.id).toBe('x');
    expect(record.name).toBe('Page');
  });

  it('keeps page CONTENT atlas_* fields (blocks/intent travel with the import)', () => {
    const { record } = normalizeRecord({
      id: 'x', name: 'P',
      atlas_page_blocks: [{ id: 'b', kind: 'heading', text: 'h', level: 1 }],
      atlas_page_intent: 'show',
    } as RawRecord, 'narrative');
    expect(record.atlas_page_blocks).toBeDefined();
    expect(record.atlas_page_intent).toBe('show');
  });

  it('coerces numeric-string fields and counts unknown fields', () => {
    const { record, droppedUnknown } = normalizeRecord({
      name: 'E', start_date: '1015', not_a_real_field: 'x',
    } as RawRecord, 'event');
    expect(record.start_date).toBe(1015);
    expect(droppedUnknown).toBeGreaterThanOrEqual(1);
  });
});

describe('normalizeRecord — keepUnknown (envelope §8c passthrough)', () => {
  it('keeps unknown non-extension fields when keepUnknown is set, without counting them dropped', () => {
    const { record, droppedUnknown } = normalizeRecord(
      { name: 'A', future_field: 'kept' }, 'character' as never, { keepUnknown: true });
    expect(record.future_field).toBe('kept');
    expect(droppedUnknown).toBe(0);
  });

  it('still strips server stamps under keepUnknown', () => {
    const { record } = normalizeRecord(
      { name: 'A', updated_at: 'x', change_seq: 9, future_field: 'kept' },
      'character' as never, { keepUnknown: true });
    expect(record.updated_at).toBeUndefined();
    expect(record.change_seq).toBeUndefined();
    expect(record.future_field).toBe('kept');
  });

  it('default path still drops and counts unknown fields (the pair)', () => {
    const { record, droppedUnknown } = normalizeRecord(
      { name: 'A', future_field: 'dropped' }, 'character' as never);
    expect(record.future_field).toBeUndefined();
    expect(droppedUnknown).toBeGreaterThanOrEqual(1);
  });
});
