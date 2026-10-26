/**
 * A bad number entry must never clear the field (or delete a
 * custom number field through the null tombstone).
 *
 * A real browser reports value '' plus validity.badInput for text a
 * type=number input cannot parse ("12,5", "1e", "seven"). jsdom sanitises the
 * value to '' but does not track badInput, so `typeBad` sets both, the way a
 * browser presents them.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { openFieldEditPopover } from '../../src/ui/field-edit-popover';
import { renderSection } from '../../src/middle/element-detail-fields';
import { buildCustomFieldsSection } from '../../src/middle/element-detail-custom-fields';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setEditorSettings } from '../../src/registry/registry';
import type { Element } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

afterEach(() => { document.body.innerHTML = ''; });

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
function key(target: EventTarget, k: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}
function typeBad(input: HTMLInputElement, text: string): void {
  input.value = text; // sanitised to '' for type=number
  Object.defineProperty(input, 'validity', {
    configurable: true,
    get: () => ({ badInput: true, valid: false }),
  });
}

async function world(fields: Record<string, unknown>, type = 'character'): Promise<{ store: MockFolderStore; el: Element }> {
  const store = new MockFolderStore();
  await store.open(null as never);
  setActiveStore(store as unknown as FsFolderStore);
  patchSlice('registry', defaultRegistry());
  const el = await store.createElement(type as never, { name: 'Ann', ...fields } as Partial<Element>);
  patchSlice('data', { elements: await store.listElements() });
  return { store, el: (await store.getElement(el.id)) as Element };
}

function openPopover(onSave: (v: unknown) => void): HTMLInputElement {
  const anchor = document.createElement('div');
  document.body.appendChild(anchor);
  openFieldEditPopover({ anchor, label: 'Age', value: '12', widget: 'number', onSave });
  return document.querySelector<HTMLInputElement>('.atlas-edit-popover input')!;
}

describe('C2: popover number entry', () => {
  it('bad text + Enter writes nothing, keeps the popover open and says why', async () => {
    const onSave = vi.fn();
    const input = openPopover(onSave);
    typeBad(input, '12,5');
    key(input, 'Enter');
    await tick();
    expect(onSave).not.toHaveBeenCalled();
    expect(document.querySelector('.atlas-edit-popover')).not.toBeNull();
    const err = document.querySelector<HTMLElement>('.atlas-edit-popover-error')!;
    expect(err.dataset.active).toBe('true');
    expect(err.textContent).toMatch(/not a number/i);
    key(input, 'Escape');
    await tick();
    expect(onSave).not.toHaveBeenCalled();
    expect(document.querySelector('.atlas-edit-popover')).toBeNull();
  });

  it('"1e999" (Infinity) + Enter writes nothing', async () => {
    const onSave = vi.fn();
    const input = openPopover(onSave);
    // jsdom sanitises "1e999" to '' (the badInput case above); a browser that
    // keeps the text hands back "1e999", which parses to Infinity.
    Object.defineProperty(input, 'value', { configurable: true, get: () => '1e999', set: () => {} });
    key(input, 'Enter');
    await tick();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('a deliberate clear still saves null (control)', async () => {
    const onSave = vi.fn();
    const input = openPopover(onSave);
    input.value = '';
    key(input, 'Enter');
    await tick();
    expect(onSave).toHaveBeenCalledWith(null);
  });
});

describe('C2: real editor keeps the stored number', () => {
  it('schema number field: bad text + Enter leaves 12 on disk', async () => {
    const { store, el } = await world({ level: 12 }, 'ability');
    const section = renderSection({ name: 'S', order: 1, fields: [{ name: 'level', widget: 'number' } as never] }, el, true)!;
    document.body.appendChild(section);
    section.querySelector<HTMLElement>('.atlas-field-value')!.click();
    const input = document.querySelector<HTMLInputElement>('.atlas-edit-popover input')!;
    typeBad(input, '12,5');
    key(input, 'Enter');
    await tick(60);
    expect(((await store.getElement(el.id)) as Record<string, unknown>).level).toBe(12);
  });

  it('custom number field: bad text + Enter does not delete the field', async () => {
    const { store, el } = await world({ x_strength: 7 });
    const section = buildCustomFieldsSection(el)!;
    document.body.appendChild(section);
    section.querySelector<HTMLElement>('[data-field="x_strength"] .atlas-field-value')!.click();
    const input = document.querySelector<HTMLInputElement>('.atlas-edit-popover input')!;
    typeBad(input, 'seven');
    key(input, 'Enter');
    await tick(60);
    expect(((await store.getElement(el.id)) as Record<string, unknown>).x_strength).toBe(7);
  });

  it('inline mode: bad text then click away (blur) leaves 12 on disk', async () => {
    const { store, el } = await world({ level: 12 }, 'ability');
    patchSlice('registry', setEditorSettings(getState().registry, { field_edit_mode: 'inline-single' }));
    const section = renderSection({ name: 'S', order: 1, fields: [{ name: 'level', widget: 'number' } as never] }, el, true)!;
    document.body.appendChild(section);
    section.querySelector<HTMLElement>('.atlas-field-value')!.click();
    const input = section.querySelector<HTMLInputElement>('.atlas-field-inline-input')!;
    typeBad(input, '1e');
    input.dispatchEvent(new FocusEvent('blur'));
    await tick(80);
    expect(((await store.getElement(el.id)) as Record<string, unknown>).level).toBe(12);
    expect(section.querySelector('.atlas-field-inline-input')).toBeNull();
  });
});
