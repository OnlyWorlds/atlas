/**
 * S367 critic C11: a schema text field holding an object or array (a foreign
 * folder, another tool) renders read-only. It must never seed an editor with
 * String(value) and get overwritten with "[object Object]".
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderSection } from '../../src/middle/element-detail-fields';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setEditorSettings } from '../../src/registry/registry';
import type { Element } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

afterEach(() => { document.body.innerHTML = ''; });

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

async function world(fields: Record<string, unknown>): Promise<{ store: MockFolderStore; el: Element }> {
  const store = new MockFolderStore();
  await store.open(null as never);
  setActiveStore(store as unknown as FsFolderStore);
  patchSlice('registry', defaultRegistry());
  const el = await store.createElement('character' as never, { name: 'Ann', ...fields } as Partial<Element>);
  patchSlice('data', { elements: await store.listElements() });
  return { store, el: (await store.getElement(el.id)) as Element };
}

describe('C11: structured value in a schema text field', () => {
  it('modal mode: shows the value read-only; clicking opens no editor; disk unchanged', async () => {
    const obj = { label: 'Knight', source: 'tool-x' };
    const { store, el } = await world({ supertype: obj });
    const section = renderSection({ name: 'S', order: 1, fields: [{ name: 'supertype', widget: 'text-short' } as never] }, el, true)!;
    document.body.appendChild(section);
    expect(section.querySelector('.atlas-field-value')).toBeNull();
    const ro = section.querySelector<HTMLElement>('.atlas-field-structured')!;
    expect(ro.textContent).toContain('Knight');
    expect(ro.textContent).not.toContain('[object Object]');
    ro.click();
    section.querySelector<HTMLElement>('.atlas-field-label')!.click();
    expect(document.querySelector('.atlas-edit-popover')).toBeNull();
    await tick(60);
    expect(((await store.getElement(el.id)) as Record<string, unknown>).supertype).toEqual(obj);
  });

  it('inline mode: an array value opens no inline editor; disk unchanged', async () => {
    const arr = ['line one', 'line two'];
    const { store, el } = await world({ description: arr });
    patchSlice('registry', setEditorSettings(getState().registry, { field_edit_mode: 'inline-single' }));
    const section = renderSection({ name: 'S', order: 1, fields: [{ name: 'description', widget: 'text-long' } as never] }, el, true)!;
    document.body.appendChild(section);
    section.querySelector<HTMLElement>('.atlas-field-structured')!.click();
    expect(section.querySelector('.atlas-field-inline-input, .atlas-field-inline-textarea')).toBeNull();
    await tick(80);
    expect(((await store.getElement(el.id)) as Record<string, unknown>).description).toEqual(arr);
  });

  it('a plain string still renders as an editable value (control)', async () => {
    const { el } = await world({ supertype: 'Knight' });
    const section = renderSection({ name: 'S', order: 1, fields: [{ name: 'supertype', widget: 'text-short' } as never] }, el, true)!;
    document.body.appendChild(section);
    section.querySelector<HTMLElement>('.atlas-field-value')!.click();
    expect(document.querySelector('.atlas-edit-popover input')).not.toBeNull();
  });
});
