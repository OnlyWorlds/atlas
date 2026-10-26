/**
 * Create modal type field.
 *
 * B1: typing "p" best-matched Phenomenon and "plan" silently kept it, so
 * Create made a Phenomenon. Unmatched text must mean NO type: the grid
 * clears, a line names the miss, and Create stays off until a type is picked.
 * B3: the "Name is required" line must go once a name is typed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ElementCreateModal } from '../../src/ui/element-create-modal';
import { patchSlice } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';

const createElement = vi.fn(async (type: string, data: { name: string }) => ({ id: 'new-1', type, name: data.name }));

function openModal(): HTMLElement {
  const toasts = { error: vi.fn(), success: vi.fn(), info: vi.fn() };
  new ElementCreateModal(toasts as never, { initialType: 'character', suppressNavigate: true, suppressToast: true }).open();
  const panel = document.querySelector<HTMLElement>('[data-modal="create-element"]');
  if (!panel) throw new Error('modal did not open');
  return panel;
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('element create modal: type field', () => {
  beforeEach(() => {
    createElement.mockClear();
    patchSlice('active', { worldId: 'w1' } as never);
    setActiveStore({ createElement, listElements: vi.fn(async () => []) } as never);
  });
  afterEach(() => {
    document.body.innerHTML = '';
    setActiveStore(null);
  });

  it('a real prefix still best-matches a type', () => {
    const panel = openModal();
    const type = panel.querySelector<HTMLInputElement>('input[name="element-type"]')!;
    typeInto(type, 'p');
    expect(panel.querySelector('.atlas-create-type-btn.active')?.getAttribute('data-type')).toBe('phenomenon');
    expect(panel.querySelector<HTMLElement>('[data-role="type-hint"]')!.hidden).toBe(true);
    expect(panel.querySelector<HTMLButtonElement>('[data-action="create"]')!.disabled).toBe(false);
  });

  it('text matching no type clears the selection, says so, and blocks Create', async () => {
    const panel = openModal();
    const type = panel.querySelector<HTMLInputElement>('input[name="element-type"]')!;
    const name = panel.querySelector<HTMLInputElement>('input[name="element-name"]')!;
    const create = panel.querySelector<HTMLButtonElement>('[data-action="create"]')!;
    const hint = panel.querySelector<HTMLElement>('[data-role="type-hint"]')!;
    typeInto(name, 'Big plan');
    typeInto(type, 'p');
    typeInto(type, 'plan');

    expect(panel.querySelector('.atlas-create-type-btn.active')).toBeNull();
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe('No type called "plan". Pick one below.');
    expect(create.disabled).toBe(true);

    // Even a forced submit (Enter) creates nothing.
    panel.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await Promise.resolve();
    expect(createElement).not.toHaveBeenCalled();

    // Emptying the field keeps it unchosen; picking a tile restores Create.
    typeInto(type, '');
    expect(hint.textContent).toBe('Pick a type below.');
    expect(create.disabled).toBe(true);
    panel.querySelector<HTMLButtonElement>('.atlas-create-type-btn[data-type="event"]')!.click();
    expect(hint.hidden).toBe(true);
    expect(create.disabled).toBe(false);
    expect(panel.querySelector('.atlas-create-type-btn.active')?.getAttribute('data-type')).toBe('event');
  });

  it('the name-required line clears once a name is typed', () => {
    const panel = openModal();
    const name = panel.querySelector<HTMLInputElement>('input[name="element-name"]')!;
    const error = panel.querySelector<HTMLElement>('[data-role="error"]')!;
    typeInto(name, '');
    panel.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('An element needs a name.');
    typeInto(name, 'A');
    expect(error.hidden).toBe(true);
  });
});
