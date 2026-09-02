/**
 * Custom-fields enablement (D9 layer 1, v2 port Bout 7) — the extension
 * namespaces (atlas_ / x_ / shadow_) are first-class data:
 *
 *   - import keeps them (normalizeRecord no longer drops them as unknown),
 *   - the validator doesn't flag them,
 *   - export carries them (only LOCAL_ONLY machinery is stripped),
 *   - so a custom field round-trips disk → export → import → disk losslessly.
 *
 * The wire half (v2 send + pull) is locked by ow-v2-client-adapter tests;
 * this file locks the import/export half.
 */

import { describe, it, expect } from 'vitest';
import { normalizeRecord } from '../../src/import/normalize';
import { validatePayload } from '../../src/import/validate';
import { parsePayload } from '../../src/import/parse';
import { buildWorldExport } from '../../src/import/export-world';
import { MockFolderStore } from '../fixtures/mock-folder-store';

describe('custom extension fields (atlas_/x_/shadow_) survive the import layer', () => {
  it('normalizeRecord keeps namespace fields and still drops foreign ones', () => {
    const { record, droppedUnknown } = normalizeRecord({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Hero',
      description: 'desc',
      x_mood: 'grim',
      shadow_note: 'hidden',
      atlas_custom_rank: 3,
      totally_foreign: 'dropped',
    }, 'character');
    expect(record.x_mood).toBe('grim');
    expect(record.shadow_note).toBe('hidden');
    expect(record.atlas_custom_rank).toBe(3);
    expect(record.totally_foreign).toBeUndefined();
    expect(droppedUnknown).toBe(1);
  });

  it('normalizeRecord still strips atlas_page_pub (STRIP_ALWAYS wins over the namespace)', () => {
    const { record } = normalizeRecord({
      name: 'Page', atlas_page_pub: { slug: 'stolen-slug' },
    }, 'narrative');
    expect(record.atlas_page_pub).toBeUndefined();
  });

  it('validatePayload does not flag namespace fields, still flags foreign ones', () => {
    const parsed = parsePayload({
      Character: [
        { name: 'Hero', x_mood: 'grim', shadow_note: 'n', atlas_anything: 'y', bogus_field: 1 },
      ],
    });
    const issues = validatePayload(parsed);
    const fields = issues.map(i => i.field);
    expect(fields).toContain('bogus_field');
    expect(fields).not.toContain('x_mood');
    expect(fields).not.toContain('shadow_note');
    expect(fields).not.toContain('atlas_anything');
  });

  it('export keeps wire extensions + custom fields, strips LOCAL_ONLY machinery', async () => {
    const store = new MockFolderStore();
    await store.open(null);
    await store.createElement('zone', {
      name: 'Kingdom',
      atlas_shape: 'polygon',        // WIRE extension — keep
      atlas_color: '#22d3ee',        // WIRE extension — keep
      x_founded_by: 'the old kings', // custom — keep
    });
    await store.createElement('character', {
      name: 'Hero',
      x_mood: 'grim',
      atlas_aliases: ['H'],          // LOCAL_ONLY — strip
      atlas_richtext_json: { doc: 1 }, // LOCAL_ONLY — strip
    });
    const exported = (await buildWorldExport(store) as { elements: Record<string, Array<Record<string, unknown>>> }).elements;
    const zone = exported.zone[0];
    expect(zone.atlas_shape).toBe('polygon');
    expect(zone.atlas_color).toBe('#22d3ee');
    expect(zone.x_founded_by).toBe('the old kings');
    const hero = exported.character[0];
    expect(hero.x_mood).toBe('grim');
    expect(hero.atlas_aliases).toBeUndefined();
    expect(hero.atlas_richtext_json).toBeUndefined();
    expect(hero.local_updated_at).toBeUndefined();
  });

  it('full round-trip: export → normalize keeps the custom field intact', async () => {
    const store = new MockFolderStore();
    await store.open(null);
    await store.createElement('character', { name: 'Hero', x_mood: 'grim' });
    const exported = (await buildWorldExport(store) as { elements: Record<string, unknown> }).elements;
    const record = (exported.character as Array<Record<string, unknown>>)[0];
    const { record: reimported } = normalizeRecord(record, 'character');
    expect(reimported.x_mood).toBe('grim');
    expect(reimported.name).toBe('Hero');
  });
});
