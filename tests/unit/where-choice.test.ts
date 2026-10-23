/**
 * The where-question every make or download asks (1.17 bout 2, conv. 129;
 * contract §1.4, §2.3, §9 invariants 10 and 12): two rows folder first with
 * the picker, one line without it; the answer taken synchronously in the
 * click, with `persist()` asked before the click's first await.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { loadUiPrefs, setNewWorldWherePref } from '../../src/core/ui-prefs';
import { takeWhereInClick, whereChoiceHtml, wireWhereChoice } from '../../src/ui/where-choice';

const pickerOn = () => { (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => Promise.resolve(null); };
const mount = () => { const d = document.createElement('div'); d.innerHTML = whereChoiceHtml(); return d; };
const persist = vi.fn(() => new Promise<boolean>(() => {})); // Firefox may never answer

beforeEach(() => {
  localStorage.clear();
  patchSlice('atlasRoot', null);
  patchSlice('registry', { ...defaultRegistry(), worlds: [] });
  persist.mockClear();
  (navigator as unknown as { storage: unknown }).storage = { persist };
});
afterEach(() => {
  delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  delete (navigator as unknown as { storage?: unknown }).storage;
});

describe('whereChoiceHtml', () => {
  it('with the picker: two rows, the folder first', () => {
    pickerOn();
    const rows = [...mount().querySelectorAll('.atlas-where-row strong')].map(s => s.textContent);
    expect(rows).toEqual(['In a folder on your drive', 'In this browser']);
  });
  it('pre-selects the folder, with its path, when a home folder is set', () => {
    pickerOn();
    patchSlice('atlasRoot', { folderName: 'onlyworlds-atlas', pathHint: 'Docs/onlyworlds-atlas' });
    const d = mount();
    expect(d.querySelector<HTMLInputElement>('input[value="folder"]')!.checked).toBe(true);
    expect(d.querySelector('code')!.textContent).toBe('Docs/onlyworlds-atlas');
  });
  it('without a home folder, the last pick, else this browser', () => {
    pickerOn();
    expect(mount().querySelector<HTMLInputElement>('input[value="browser"]')!.checked).toBe(true);
    setNewWorldWherePref('folder');
    expect(mount().querySelector<HTMLInputElement>('input[value="folder"]')!.checked).toBe(true);
  });
  it('without the picker: no rows, one line', () => {
    const d = mount();
    expect(d.querySelectorAll('.atlas-where-row')).toHaveLength(0);
    expect(d.querySelector('[data-role="where-browser"]')!.textContent).toBe('It lives in this browser.');
  });
});

// A world that stays on onlyworlds.com (Download, View; the Captain's ✓ on h20 B13).
describe('whereChoiceHtml for a world that stays online', () => {
  const mountOnline = () => {
    const d = document.createElement('div');
    d.innerHTML = whereChoiceHtml({ online: true });
    wireWhereChoice(d);
    return d;
  };
  const shown = (el: Element | null) => !!el && !(el as HTMLElement).hidden;

  it('with the picker and this browser picked: one line, the rows held back, the answer still this browser', () => {
    pickerOn();
    const d = mountOnline();
    expect(d.querySelector('[data-role="where-short"]')!.textContent).toContain('Kept in this browser; the world stays on onlyworlds.com too.');
    expect(shown(d.querySelector('[data-role="where"]'))).toBe(false);
    expect(takeWhereInClick(d)).toBe('browser');
  });

  it('Choose a folder instead opens the rows with the folder picked, and the answer is the folder', () => {
    pickerOn();
    const d = mountOnline();
    d.querySelector<HTMLButtonElement>('[data-action="where-folder"]')!.click();
    expect(shown(d.querySelector('[data-role="where"]'))).toBe(true);
    expect(shown(d.querySelector('[data-role="where-short"]'))).toBe(false);
    expect(d.querySelector<HTMLInputElement>('input[value="folder"]')!.checked).toBe(true);
    expect(takeWhereInClick(d)).toBe('folder');
  });

  it('a folder already picked shows the rows as before, no short line', () => {
    pickerOn();
    patchSlice('atlasRoot', { folderName: 'onlyworlds-atlas', pathHint: 'Docs/onlyworlds-atlas' });
    const d = mountOnline();
    expect(d.querySelector('[data-role="where-short"]')).toBeNull();
    expect(shown(d.querySelector('[data-role="where"]'))).toBe(true);
  });

  it('without the picker: the one line says the world stays online', () => {
    expect(mountOnline().querySelector('[data-role="where-browser"]')!.textContent).toBe('Kept in this browser; the world stays on onlyworlds.com too.');
  });

  it('a world with no other copy keeps the whole question', () => {
    pickerOn();
    const d = mount();
    expect(d.querySelector('[data-role="where-short"]')).toBeNull();
    expect(shown(d.querySelector('[data-role="where"]'))).toBe(true);
  });
});

describe('takeWhereInClick', () => {
  it('a browser answer asks persist() before returning, and remembers the pick', () => {
    pickerOn();
    const d = mount();
    d.querySelector<HTMLInputElement>('input[value="browser"]')!.checked = true;
    expect(takeWhereInClick(d)).toBe('browser');
    expect(persist).toHaveBeenCalledTimes(1); // synchronous: no await between
    expect(loadUiPrefs().newWorldWhere).toBe('browser');
  });
  it('a folder answer never asks persist(), and remembers the pick', () => {
    pickerOn();
    const d = mount();
    d.querySelector<HTMLInputElement>('input[value="folder"]')!.checked = true;
    expect(takeWhereInClick(d)).toBe('folder');
    expect(persist).not.toHaveBeenCalled();
    expect(loadUiPrefs().newWorldWhere).toBe('folder');
  });
  it('without the picker: this browser, persist() asked, nothing remembered', () => {
    expect(takeWhereInClick(mount())).toBe('browser');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(loadUiPrefs().newWorldWhere).toBeUndefined();
  });
});
