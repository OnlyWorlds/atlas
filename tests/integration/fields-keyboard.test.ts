/**
 * An element's fields by keyboard: a field's value opened its editor on a
 * mouse click alone (a div with no tabindex), as did the aliases row, and a
 * link chip's x was a span; no keyboard could edit a text or number field,
 * name an element's aliases or remove a link. Each is now reached by Tab and
 * pressed by Enter or Space; a view-only world offers none of them.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderSection } from '../../src/middle/element-detail-fields';
import { buildCustomFieldsSection } from '../../src/middle/element-detail-custom-fields';
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
    // A cut value ends on its ellipsis, never "….".
    expect(name.endsWith('… Press to edit')).toBe(true);
    expect(name).not.toContain('three fleets');
  });

  it('a value that ends its own sentence gets no second stop, and line breaks read as spaces', async () => {
    const { el } = await world({ description: 'Salt.\nMore salt.' });
    const v = section(el, [{ name: 'description', widget: 'text-long' }]).querySelector<HTMLElement>('.atlas-field-value')!;
    expect(v.getAttribute('aria-label')).toBe('Description: Salt. More salt. Press to edit');
  });

  it('a held Enter presses once: its repeats open nothing', async () => {
    const { el } = await world({ description: 'Salt' });
    const v = section(el, [{ name: 'description', widget: 'text-long' }]).querySelector<HTMLElement>('.atlas-field-value')!;
    let opened = 0;
    v.addEventListener('click', () => { opened++; });
    v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, repeat: true }));
    expect(opened).toBe(0);
    v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(opened).toBe(1);
    document.querySelector<HTMLElement>('.atlas-edit-popover-backdrop')?.remove();
  });

  it('a key press opens the editor even with text selected in the value', async () => {
    const { el } = await world({ description: 'The reef runs north.' });
    const host = section(el, [{ name: 'description', widget: 'text-long' }]);
    document.body.appendChild(host);
    const v = host.querySelector<HTMLElement>('.atlas-field-value')!;
    // Focus first (jsdom's focus can move the selection), then select inside the value.
    v.focus();
    const range = document.createRange();
    range.selectNodeContents(v);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    // A mouse's click (detail 1) with the selection inside: nothing opens.
    v.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(document.querySelector('.atlas-edit-popover')).toBeNull();
    // Enter on the focused value, the selection still there: the editor opens.
    expect(window.getSelection()!.toString()).toBe('The reef runs north.');
    v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.querySelector('.atlas-edit-popover')).not.toBeNull();
    document.querySelector<HTMLElement>('.atlas-edit-popover-backdrop')?.remove();
    window.getSelection()!.removeAllRanges();
    host.remove();
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

  it('a blank name is said as the unnamed species on the link and its x, never a nameless link', async () => {
    const { store, el } = await world({}, []);
    const sp = await store.createElement('species' as never, { name: '   ' } as Partial<Element>);
    await store.updateElement(el.id, { species: [sp.id] } as never);
    patchSlice('data', { elements: await store.listElements() });
    const fresh = (await store.getElement(el.id)) as Element;
    const s = section(fresh, [{ name: 'species', widget: 'multi-link', target: 'species' }]);
    const link = s.querySelector<HTMLElement>('.atlas-link-chip [role="link"]')!;
    expect(link.textContent).toBe('the unnamed species');
    expect(s.querySelector('.atlas-link-chip-remove')?.getAttribute('aria-label')).toBe('Remove the unnamed species');
  });
});

describe('a section\'s fold and a field\'s remove say their own names', () => {
  it('the fold\'s arrow glyph is hidden, so the fold is named by its section alone', async () => {
    const { el } = await world({ description: 'Salt' });
    const s = renderSection({ name: 'Details', order: 1, fields: [{ name: 'description', widget: 'text-long' }] as never }, el, false)!;
    document.body.appendChild(s);
    const fold = s.querySelector<HTMLElement>('.atlas-detail-section-header')!;
    expect(fold.getAttribute('role')).toBe('button');
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    const glyph = fold.querySelector<HTMLElement>('.material-symbols-outlined')!;
    expect(glyph.textContent).toBe('expand_less');
    expect(glyph.getAttribute('aria-hidden')).toBe('true');
    // What a reader hears: the header's text with the hidden glyph left out.
    const heard = [...fold.childNodes].filter(n => !(n instanceof HTMLElement && n.getAttribute('aria-hidden') === 'true')).map(n => n.textContent).join('').trim();
    expect(heard).toBe('Details');
  });

  it('a field\'s × is named for the field it removes, its glyph hidden', async () => {
    const { el } = await world({ x_mood: 'calm' });
    const s = renderSection({ name: 'Custom', order: 1, fields: [{ name: 'x_mood', widget: 'text-short' }] as never }, el, false, { onRemoveField: () => {} })!;
    document.body.appendChild(s);
    const rm = s.querySelector<HTMLElement>('.atlas-field-remove')!;
    expect(rm.getAttribute('aria-label')).toBe('Remove the field Mood');
    expect(rm.title).toBe('Remove the field Mood');
    expect(rm.querySelector('[aria-hidden="true"]')?.textContent).toBe('×');
  });

  it('a structured field\'s × is named in the same words as a plain field\'s, its glyph hidden', async () => {
    const { el } = await world({ x_tally: { won: 3 } });
    const s = buildCustomFieldsSection(el)!;
    document.body.appendChild(s);
    const rm = s.querySelector<HTMLElement>('.atlas-custom-structured-remove')!;
    expect(rm.title).toBe('Remove the field Tally');
    expect(rm.getAttribute('aria-label')).toBe('Remove the field Tally');
    expect(rm.querySelector('[aria-hidden="true"]')?.textContent).toBe('×');
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
