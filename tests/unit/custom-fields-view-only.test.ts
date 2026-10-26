/**
 * Custom fields on a view-only world (seen in a read-key walk): the store refuses
 * every UI write there, so the section offers none. No "+ Add field", no ×
 * on a row or a structured record, and no section at all on an element with
 * no fields of its own. A writable world is the control: the same element
 * shows all three.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildCustomFieldsSection } from '../../src/middle/element-detail-custom-fields';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';

const WORLD = 'w-view';

function openWorld(readOnly: boolean): void {
  const entry = {
    id: WORLD,
    name: 'Shared',
    state: 'api-linked',
    api: { world_id: 's1', api_key: 'k', read_only: readOnly },
  } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: WORLD, meta: { name: 'Shared' } } as never);
}

function character(extra: Record<string, unknown> = {}): Element {
  return {
    id: '00000000-0000-4000-8000-0000000000bb',
    type: 'character',
    name: 'Ana',
    local_updated_at: '2026-10-19T10:00:00.000Z',
    ...extra,
  } as Element;
}

afterEach(() => {
  document.body.innerHTML = '';
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
});

describe('Custom fields on a view-only world', () => {
  it('shows the rows with no Add field and no ×', () => {
    openWorld(true);
    const section = buildCustomFieldsSection(character({ x_mood: 'calm', x_record: { won: 3 } }))!;
    expect(section).not.toBeNull();
    expect(section.querySelector('[data-field="x_mood"]')).not.toBeNull();
    expect(section.querySelector('.atlas-custom-structured-row')).not.toBeNull();
    expect(section.querySelector('.atlas-custom-add-btn')).toBeNull();
    expect(section.querySelector('.atlas-field-remove')).toBeNull();
    expect(section.querySelector('.atlas-custom-structured-remove')).toBeNull();
  });

  it('draws no section for an element with no fields of its own', () => {
    openWorld(true);
    expect(buildCustomFieldsSection(character())).toBeNull();
  });

  it('control: a writable world offers Add field and both ×', () => {
    openWorld(false);
    expect(getState().registry.worlds[0].api?.read_only).toBe(false);
    const section = buildCustomFieldsSection(character({ x_mood: 'calm', x_record: { won: 3 } }))!;
    expect(section.querySelector('.atlas-custom-add-btn')).not.toBeNull();
    expect(section.querySelector('.atlas-field-remove')).not.toBeNull();
    expect(section.querySelector('.atlas-custom-structured-remove')).not.toBeNull();
    expect(buildCustomFieldsSection(character())?.querySelector('.atlas-custom-add-btn')).not.toBeNull();
  });
});
