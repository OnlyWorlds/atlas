/**
 * An element's fields by keyboard: a field's value opened its editor on a
 * mouse click alone (a div with no tabindex), as did the aliases row, and a
 * link chip's x was a span; no keyboard could edit a text or number field,
 * name an element's aliases or remove a link. Each is now reached by Tab and
 * pressed by Enter or Space; a view-only world offers none of them.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderSection } from '../../src/middle/element-detail-fields';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

afterEach(() => { document.body.innerHTML = ''; patchSlice('active', null); patchSlice('registry', defaultRegistry()); });

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
function key(target: EventTarget, k: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

async function world(fields: Record<string, unknown>, extra: Array<Partial<Element>> = [], type = 'character'): Promise<{ store: MockFolderStore; el: Element }> {
  const store = new MockFolderStore();
  await store.open(null as never);
  setActiveStore(store as unknown as FsFolderStore);
  patchSlice('registry', defaultRegistry());
  for (const x of extra) await store.createElement(x.type as never, x);
  const el = await store.createElement(type as never, { name: 'Ann', ...fields } as Partial<Element>);
  patchSlice('data', { elements: await store.listElements() });
  return { store, el: (await store.getElement(el.id)) as Element };
}

const section = (el: Element, fields: unknown[]): HTMLElement => {
  const s = renderSection({ name: 'S', order: 1, fields: fields as never }, el, true)!;
  document.body.appendChild(s);
  return s;
};

describe('a field\'s value by keyboard', () => {
  it('is a button in the tab order, named by its field and value', async () => {
    const { el } = await world({ description: 'A hobbit of the Shire' });
    const v = section(el, [{ name: 'description', widget: 'text-long' }]).querySelector<HTMLElement>('.atlas-field-value')!;
    expect(v.getAttribute('role')).toBe('button');
    expect(v.tabIndex).toBe(0);
    expect(v.getAttribute('aria-label')).toBe('Description: A hobbit of the Shire. Press to edit');
    expect(v.textContent).toBe('A hobbit of the Shire');
  });

  it('Enter opens the editor; Space does too and does not scroll', async () => {
    const { el } = await world({ description: 'A hobbit' });
    const s = section(el, [{ name: 'description', widget: 'text-long' }]);
    const v = s.querySelector<HTMLElement>('.atlas-field-value')!;
    v.focus();
    key(v, 'Enter');
    const editor = (): HTMLElement | null => document.querySelector<HTMLElement>('.atlas-edit-popover textarea, .atlas-edit-popover input');
    expect(editor()).not.toBeNull();
    await tick();
    // The editor holds focus before Escape, as a person meets it.
    expect(document.activeElement).toBe(editor());
    editor()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    expect(document.querySelector('.atlas-edit-popover')).toBeNull();
    // Focus comes back to the value, never to the page.
    expect(document.activeElement).toBe(v);
    const space = key(v, ' ');
    expect(space.defaultPrevented).toBe(true);
    expect(editor()).not.toBeNull();
  });

  it('Enter on a one-line value opens the editor and leaves it open, unsaved (the opening Enter is not the save)', async () => {
    const { store, el } = await world({ level: 12 }, [], 'ability');
    const v = section(el, [{ name: 'level', widget: 'number' }]).querySelector<HTMLElement>('.atlas-field-value')!;
    v.focus();
    key(v, 'Enter');
    await tick();
    const input = document.querySelector<HTMLInputElement>('.atlas-edit-popover input');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    // An Enter typed in the editor still saves.
    input!.value = '13';
    key(input!, 'Enter');
    await tick(60);
    expect(document.querySelector('.atlas-edit-popover')).toBeNull();
    expect(((await store.getElement(el.id)) as Record<string, unknown>).level).toBe(13);
  });

  it('a long value\'s name is cut short', async () => {
    const long = 'The reef runs north for a day and a night, and the shoals beyond it hold the wrecks of three fleets.';
    const { el } = await world({ description: long });
    const v = section(el, [{ name: 'description', widget: 'text-long' }]).querySelector<HTMLElement>('.atlas-field-value')!;
    const name = v.getAttribute('aria-label')!;
    expect(name.startsWith('Description: The reef runs north')).toBe(true);
    expect(name.endsWith('…. Press to edit')).toBe(true);
    expect(name).not.toContain('three fleets');
  });

  it('an empty value says so in its name', async () => {
    const { el } = await world({});
    const v = section(el, [{ name: 'description', widget: 'text-long' }]).querySelector<HTMLElement>('.atlas-field-value')!;
    expect(v.getAttribute('aria-label')).toBe('Description: empty. Press to edit');
  });
});

describe('the aliases row by keyboard', () => {
  it('Enter opens the aliases editor', async () => {
    const { el } = await world({ atlas_aliases: ['Annie'] });
    const row = section(el, [{ name: 'atlas_aliases', widget: 'text-short' }]).querySelector<HTMLElement>('.atlas-aliases-display')!;
    expect(row.getAttribute('role')).toBe('button');
    expect(row.tabIndex).toBe(0);
    expect(row.getAttribute('aria-label')).toBe('Aliases: Annie. Press to edit');
    key(row, 'Enter');
    expect(document.querySelector('[data-modal="aliases-edit"]')).not.toBeNull();
  });
});

describe('a link chip\'s x by keyboard', () => {
  it('is a button named for what it removes, and removes the link', async () => {
    const { store, el } = await world({}, []);
    const sp = await store.createElement('species' as never, { name: 'Elf' } as Partial<Element>);
    await store.updateElement(el.id, { species: [sp.id] } as never);
    patchSlice('data', { elements: await store.listElements() });
    const fresh = (await store.getElement(el.id)) as Element;
    const s = section(fresh, [{ name: 'species', widget: 'multi-link', target: 'species' }]);
    const rm = s.querySelector<HTMLElement>('.atlas-link-chip-remove')!;
    expect(rm.tagName).toBe('BUTTON');
    expect(rm.getAttribute('aria-label')).toBe('Remove Elf');
    rm.click(); // what Enter or Space on a focused button does
    await tick(60);
    expect(((await store.getElement(el.id)) as Record<string, unknown>).species).toEqual([]);
  });
});

describe('the editor and its Enter', () => {
  it('a held Enter does not save at once; an Enter on the page behind the editor still saves', async () => {
    const { store, el } = await world({ level: 12 }, [], 'ability');
    const v = section(el, [{ name: 'level', widget: 'number' }]).querySelector<HTMLElement>('.atlas-field-value')!;
    v.focus();
    key(v, 'Enter');
    await tick();
    const input = document.querySelector<HTMLInputElement>('.atlas-edit-popover input')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true }));
    await tick();
    expect(document.querySelector('.atlas-edit-popover')).not.toBeNull();
    input.value = '14';
    input.blur(); // a click on the panel's padding leaves focus on the page
    key(document.body, 'Enter');
    await tick(60);
    expect(document.querySelector('.atlas-edit-popover')).toBeNull();
    expect(((await store.getElement(el.id)) as Record<string, unknown>).level).toBe(14);
  });
});

describe('an unresolved link chip', () => {
  it('its x says "Remove this link", never an id', async () => {
    const { el } = await world({ species: ['00000000-0000-4000-8000-00000000dead'] });
    const s = section(el, [{ name: 'species', widget: 'multi-link', target: 'species' }]);
    expect(s.querySelector('.atlas-link-chip-remove')?.getAttribute('aria-label')).toBe('Remove this link');
  });
});

describe('a view-only world offers none of them', () => {
  it('no role, no tab stop, no x', async () => {
    const { el } = await world({ description: 'Read only', atlas_aliases: ['Annie'] });
    // A linked world on a key that only reads.
    patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: 'w-view', name: 'Shared', state: 'api-linked', api: { world_id: 's1', api_key: 'k', read_only: true } } as never] });
    patchSlice('active', { worldId: 'w-view', meta: { name: 'Shared' } } as never);
    const s = section(el, [{ name: 'description', widget: 'text-long' }, { name: 'atlas_aliases', widget: 'text-short' }]);
    const v = s.querySelector<HTMLElement>('.atlas-field-value')!;
    expect(v.getAttribute('role')).toBeNull();
    expect(v.hasAttribute('tabindex')).toBe(false);
    expect(s.querySelector('.atlas-aliases-display')?.getAttribute('role') ?? null).toBeNull();
  });
});
