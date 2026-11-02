/**
 * Location's `vehicle` (the standard 00.34.00, SDK 4.127.0): a single link to the Object a place is
 * the inside of. Atlas reads its fields from the SDK, so the editor, the link pickers and the Web take it
 * with no list of Atlas's own; these cases hold that it arrived whole.
 */
import { describe, it, expect } from 'vitest';
import { sectionsFor, relationFieldsFor } from '../../src/editor/field-schema';
import { getFieldDescription } from '../../src/editor/field-descriptions';
import { readerEdgesOf } from '../../src/core/world-links';
import type { Element } from '../../src/core/types';

describe('Location.vehicle', () => {
  it('sits in a Location section right after parent_location', () => {
    const fields = sectionsFor('location').flatMap(s => s.fields);
    const at = fields.findIndex(f => f.name === 'vehicle');
    expect(at).toBeGreaterThan(-1);
    expect(fields[at - 1].name).toBe('parent_location');
    expect(fields[at]).toMatchObject({ widget: 'single-link', target: 'object' });
  });

  it('is a single link to an Object, with its own hint', () => {
    const rel = relationFieldsFor('location').find(r => r.schemaField === 'vehicle');
    expect(rel?.target).toBe('object');
    expect(getFieldDescription('location', 'vehicle')).toMatch(/inside of/);
  });

  it('is an edge to the Object on every surface the reader feeds', () => {
    const ship = { id: 's', type: 'object', name: 'The Gull' } as unknown as Element;
    const hold = { id: 'h', type: 'location', name: 'The hold', vehicle: 's' } as unknown as Element;
    expect(readerEdgesOf([ship, hold]).get('h')).toEqual([{ target: 's', field: 'vehicle' }]);
  });
});
