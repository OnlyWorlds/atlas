/**
 * A custom field holding an empty list is a value, never hidden: a world can
 * mean it ("nothing amended yet"). It reads in words, "an empty list", not the
 * raw `[]`; an empty object the same way. A list with items is the control:
 * still shown as its data.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildCustomFieldsSection, emptyStructuredWords } from '../../src/middle/element-detail-custom-fields';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';

const WORLD = 'w-empty';

function openWorld(readOnly: boolean): void {
  const entry = {
    id: WORLD,
    name: 'Recorded',
    state: 'local-only',
    ...(readOnly ? { state: 'api-linked', api: { world_id: 's1', api_key: 'k', read_only: true } } : {}),
  } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: WORLD, meta: { name: 'Recorded' } } as never);
}

function location(extra: Record<string, unknown>): Element {
  return {
    id: '00000000-0000-4000-8000-0000000000cc',
    type: 'location',
    name: 'Ostrey Late',
    local_updated_at: '2026-11-13T19:00:00.000Z',
    ...extra,
  } as Element;
}

function rowText(section: HTMLElement, label: string): string | null {
  for (const row of section.querySelectorAll<HTMLElement>('.atlas-custom-structured-row')) {
    if (row.querySelector('.atlas-custom-structured-label')?.textContent === label) {
      return row.querySelector('.atlas-custom-structured-value')?.textContent ?? null;
    }
  }
  return null;
}

afterEach(() => {
  document.body.innerHTML = '';
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
});

describe('An empty structured value reads in words', () => {
  for (const readOnly of [false, true]) {
    const where = readOnly ? 'a view-only world' : 'a writable world';

    it(`an empty list reads "an empty list" on ${where}, never hidden and never []`, () => {
      openWorld(readOnly);
      const section = buildCustomFieldsSection(location({ x_amendments: [] }))!;
      expect(section).not.toBeNull();
      expect(rowText(section, 'Amendments')).toBe('an empty list');
      expect(section.textContent).not.toContain('[]');
    });

    it(`an empty object reads in words on ${where}`, () => {
      openWorld(readOnly);
      const section = buildCustomFieldsSection(location({ x_tally: {} }))!;
      expect(rowText(section, 'Tally')).toBe('an empty set of fields');
      expect(section.textContent).not.toContain('{}');
    });

    it(`control: a list with items still shows its data on ${where}`, () => {
      openWorld(readOnly);
      const section = buildCustomFieldsSection(location({ x_amendments: ['the bell moved'] }))!;
      const text = rowText(section, 'Amendments')!;
      expect(text).toContain('the bell moved');
      expect(text).not.toBe('an empty list');
    });
  }

  it('says nothing for values that hold something', () => {
    expect(emptyStructuredWords([0])).toBeNull();
    expect(emptyStructuredWords({ a: null })).toBeNull();
    expect(emptyStructuredWords([[]])).toBeNull();
    expect(emptyStructuredWords(null)).toBeNull();
    expect(emptyStructuredWords('')).toBeNull();
    expect(emptyStructuredWords([])).toBe('an empty list');
    expect(emptyStructuredWords({})).toBe('an empty set of fields');
  });
});
