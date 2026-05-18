/**
 * Convention #32: Esc deselects element → navigates to home.
 *
 * Verifies the hotkey binding metadata and the callback contract. The actual
 * navigation/state-mutation behavior is wired in app.ts and exercised by
 * Playwright e2e specs.
 *
 * (Earlier session-223 draft also had a click-already-selected-row toggle;
 * that was reverted because it conflicted with common UX/test patterns where
 * re-clicking a row is meant to refocus. Esc is now the canonical deselect.)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  defaultBindings,
  setHotkeyCallbacks,
  installHotkeys,
  uninstallHotkeys,
  findMatching,
  type HotkeyBinding,
} from '../../src/core/hotkeys';

describe('Convention #32 — Esc deselect-to-home', () => {
  afterEach(() => {
    uninstallHotkeys();
    setHotkeyCallbacks({});
  });

  it('binding exists with id "deselect-to-home"', () => {
    const bindings = defaultBindings();
    const binding = bindings.find(b => b.id === 'deselect-to-home');
    expect(binding).toBeDefined();
    expect(binding!.key).toBe('Escape');
    expect(binding!.disabledInModal).toBe(true);
    expect(binding!.disabledInTextInput).toBe(true);
  });

  it('when() returns false if no element is selected', () => {
    setHotkeyCallbacks({
      hasSelectedElement: () => false,
    });
    const bindings = defaultBindings();
    const binding = bindings.find(b => b.id === 'deselect-to-home')!;
    expect(binding.when?.()).toBe(false);
  });

  it('when() returns true if an element is selected and no overlay active', () => {
    setHotkeyCallbacks({
      hasSelectedElement: () => true,
    });
    const bindings = defaultBindings();
    const binding = bindings.find(b => b.id === 'deselect-to-home')!;
    expect(binding.when?.()).toBe(true);
  });

  it('action calls deselectToHome callback', () => {
    const deselect = vi.fn();
    setHotkeyCallbacks({
      hasSelectedElement: () => true,
      deselectToHome: deselect,
    });
    const bindings = defaultBindings();
    const binding = bindings.find(b => b.id === 'deselect-to-home')!;
    binding.action();
    expect(deselect).toHaveBeenCalledOnce();
  });

  it('findMatching skips when text input is focused', () => {
    setHotkeyCallbacks({
      hasSelectedElement: () => true,
      deselectToHome: vi.fn(),
    });
    const bindings: HotkeyBinding[] = defaultBindings();
    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    const matched = findMatching(event, bindings, { inModal: false, inTextInput: true });
    expect(matched).toBeNull();
  });

  it('findMatching skips when modal is open', () => {
    setHotkeyCallbacks({
      hasSelectedElement: () => true,
      deselectToHome: vi.fn(),
    });
    const bindings: HotkeyBinding[] = defaultBindings();
    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    const matched = findMatching(event, bindings, { inModal: true, inTextInput: false });
    expect(matched).toBeNull();
  });

  it('install + fire matches when world+selection are set', () => {
    const deselect = vi.fn();
    setHotkeyCallbacks({
      hasSelectedElement: () => true,
      deselectToHome: deselect,
    });
    const uninstall = installHotkeys();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(deselect).toHaveBeenCalledOnce();
    uninstall();
  });
});
