/**
 * Hotkeys dispatcher unit tests.
 *
 * Covers the matching logic, context predicates, and the save-request event
 * dispatch. Doesn't exercise the document keydown listener directly — the
 * pieces under test are pure functions that take the event + context.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  type HotkeyBinding,
  defaultBindings,
  findMatching,
  isInTextInput,
  matchesBinding,
  formatCombo,
  comboParts,
  SAVE_REQUEST_EVENT,
  dispatchSaveRequest,
} from '../../src/core/hotkeys';

function makeKey(opts: {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: opts.key,
    code: opts.code,
    ctrlKey: opts.ctrlKey,
    metaKey: opts.metaKey,
    shiftKey: opts.shiftKey,
    altKey: opts.altKey,
  });
}

const NO_CTX = { inModal: false, inTextInput: false };

describe('matchesBinding', () => {
  const binding: HotkeyBinding = {
    id: 'test',
    description: 'test',
    scope: 'Global',
    key: 'e',
    modifier: 'mod',
    action: () => {},
  };

  it('matches Ctrl+E on non-Mac', () => {
    // Default jsdom userAgent is not Mac.
    expect(matchesBinding(makeKey({ key: 'e', ctrlKey: true }), binding)).toBe(true);
  });

  it('rejects bare E (no modifier)', () => {
    expect(matchesBinding(makeKey({ key: 'e' }), binding)).toBe(false);
  });

  it('rejects Ctrl+Shift+E (extra shift held)', () => {
    expect(matchesBinding(makeKey({ key: 'e', ctrlKey: true, shiftKey: true }), binding)).toBe(false);
  });

  it('rejects Alt+E', () => {
    expect(matchesBinding(makeKey({ key: 'e', altKey: true }), binding)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchesBinding(makeKey({ key: 'E', ctrlKey: true }), binding)).toBe(true);
  });

  it("doesn't fire mod+E for a bare `?` binding", () => {
    const helpBinding: HotkeyBinding = {
      id: 'help', description: 'help', scope: 'Global', key: '?', modifier: 'none', action: () => {},
    };
    expect(matchesBinding(makeKey({ key: '?' }), helpBinding)).toBe(true);
    expect(matchesBinding(makeKey({ key: '?', ctrlKey: true }), helpBinding)).toBe(false);
  });
});

// Non-Latin layouts match modified letter bindings by e.code.
describe('matchesBinding on a non-Latin layout', () => {
  const save: HotkeyBinding = {
    id: 's', description: 's', scope: 'Editor', key: 's', modifier: 'mod', action: () => {},
  };
  const bare: HotkeyBinding = {
    id: 'n', description: 'n', scope: 'Global', key: 'n', modifier: 'none', action: () => {},
  };

  it('Ctrl+S on a Cyrillic layout (key ы, code KeyS) matches', () => {
    expect(matchesBinding(makeKey({ key: 'ы', code: 'KeyS', ctrlKey: true }), save)).toBe(true);
  });

  it('Ctrl with the wrong physical key does not match', () => {
    expect(matchesBinding(makeKey({ key: 'ы', code: 'KeyD', ctrlKey: true }), save)).toBe(false);
  });

  it('a Latin key on another physical key (Dvorak) follows the typed char', () => {
    expect(matchesBinding(makeKey({ key: 'o', code: 'KeyS', ctrlKey: true }), save)).toBe(false);
  });

  it('unmodified non-Latin key never triggers an unmodified letter binding', () => {
    expect(matchesBinding(makeKey({ key: 'т', code: 'KeyN' }), bare)).toBe(false);
  });

  it('digit bindings match Digit codes with a modifier', () => {
    const d: HotkeyBinding = { id: 'd', description: 'd', scope: 'Global', key: '1', modifier: 'mod', action: () => {} };
    expect(matchesBinding(makeKey({ key: '&', code: 'Digit1', ctrlKey: true }), d)).toBe(true);
  });
});

describe('findMatching', () => {
  let order: string[];
  let bindings: HotkeyBinding[];

  beforeEach(() => {
    order = [];
    bindings = [
      {
        id: 'a',
        description: 'a',
        scope: 'Global',
        key: 'e',
        modifier: 'mod',
        action: () => { order.push('a'); },
      },
      {
        id: 'b',
        description: 'b',
        scope: 'Global',
        key: 'e',
        modifier: 'mod',
        when: () => false, // skipped via predicate
        action: () => { order.push('b'); },
      },
    ];
  });

  it('returns the first matching binding', () => {
    const match = findMatching(makeKey({ key: 'e', ctrlKey: true }), bindings, NO_CTX);
    expect(match?.id).toBe('a');
  });

  it('honors the when predicate', () => {
    bindings[0].when = () => false;
    const match = findMatching(makeKey({ key: 'e', ctrlKey: true }), bindings, NO_CTX);
    expect(match).toBeNull();
  });

  it('skips bindings when modal is open and disabledInModal=true', () => {
    bindings[0].disabledInModal = true;
    bindings[1].when = undefined;
    const match = findMatching(makeKey({ key: 'e', ctrlKey: true }), bindings, { inModal: true, inTextInput: false });
    expect(match?.id).toBe('b');
  });

  it('skips bindings when focus is in a text input and disabledInTextInput=true', () => {
    bindings[0].disabledInTextInput = true;
    bindings[1].when = undefined;
    const match = findMatching(makeKey({ key: 'e', ctrlKey: true }), bindings, { inModal: false, inTextInput: true });
    expect(match?.id).toBe('b');
  });
});

describe('isInTextInput', () => {
  it('returns true for INPUT type=text', () => {
    const el = document.createElement('input');
    el.type = 'text';
    expect(isInTextInput(el)).toBe(true);
  });

  it('returns true for INPUT type=search', () => {
    const el = document.createElement('input');
    el.type = 'search';
    expect(isInTextInput(el)).toBe(true);
  });

  it('returns false for INPUT type=button', () => {
    const el = document.createElement('input');
    el.type = 'button';
    expect(isInTextInput(el)).toBe(false);
  });

  it('returns false for INPUT type=checkbox', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    expect(isInTextInput(el)).toBe(false);
  });

  it('returns true for TEXTAREA', () => {
    const el = document.createElement('textarea');
    expect(isInTextInput(el)).toBe(true);
  });

  it('returns true for contenteditable (via attribute)', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    expect(isInTextInput(el)).toBe(true);
  });

  it('returns true for contenteditable="" (bare attribute)', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', '');
    expect(isInTextInput(el)).toBe(true);
  });

  it('returns false for a button', () => {
    expect(isInTextInput(document.createElement('button'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isInTextInput(null)).toBe(false);
  });
});

describe('formatCombo', () => {
  it('renders Ctrl+E on non-Mac for a mod binding', () => {
    const b: HotkeyBinding = {
      id: 't', description: 't', scope: 'Global', key: 'e', modifier: 'mod', action: () => {},
    };
    expect(formatCombo(b)).toBe('Ctrl+E');
  });

  it('renders the key uppercase for single-char keys', () => {
    const b: HotkeyBinding = {
      id: 't', description: 't', scope: 'Global', key: 's', modifier: 'mod', action: () => {},
    };
    expect(formatCombo(b)).toMatch(/S$/);
  });

  it('keeps multi-char keys as-is', () => {
    const b: HotkeyBinding = {
      id: 't', description: 't', scope: 'Global', key: 'Escape', modifier: 'none', action: () => {},
    };
    expect(formatCombo(b)).toBe('Escape');
  });
});

describe('comboParts (C12c)', () => {
  it('splits a mod+shift binding into Ctrl, Shift, key on non-Mac', () => {
    const b: HotkeyBinding = {
      id: 't', description: 't', scope: 'Global', key: 'f', modifier: 'mod+shift', action: () => {},
    };
    expect(comboParts(b)).toEqual(['Ctrl', 'Shift', 'F']);
  });

  it('keeps Escape as one part', () => {
    const b: HotkeyBinding = {
      id: 't', description: 't', scope: 'Global', key: 'Escape', modifier: 'none', action: () => {},
    };
    expect(comboParts(b)).toEqual(['Escape']);
  });
});

describe('dispatchSaveRequest', () => {
  it('fires an atlas:save-request event on document', () => {
    const handler = vi.fn();
    document.addEventListener(SAVE_REQUEST_EVENT, handler);
    dispatchSaveRequest();
    expect(handler).toHaveBeenCalledTimes(1);
    document.removeEventListener(SAVE_REQUEST_EVENT, handler);
  });
});

describe('defaultBindings', () => {
  it('declares the MVP set: open-reference, new-element, command-palette (both triggers), save-active-editor', () => {
    const ids = defaultBindings().map(b => b.id);
    expect(ids).toContain('open-reference');
    expect(ids).toContain('new-element');
    expect(ids).toContain('command-palette');
    expect(ids).toContain('command-palette-slash');
    expect(ids).toContain('save-active-editor');
  });

  it('open-reference is `?` with no modifier', () => {
    const b = defaultBindings().find(b => b.id === 'open-reference')!;
    expect(b.key).toBe('?');
    expect(b.modifier ?? 'none').toBe('none');
  });

  it('new-element gates on having an active world', () => {
    const b = defaultBindings().find(b => b.id === 'new-element')!;
    expect(b.when).toBeDefined();
    // With no callbacks installed, `when` returns false (no active world).
    expect(b.when!()).toBe(false);
  });

  it('save-active-editor is NOT disabled in text input (that is the point)', () => {
    const b = defaultBindings().find(b => b.id === 'save-active-editor')!;
    expect(b.disabledInTextInput ?? false).toBe(false);
  });

  it('save-active-editor fires the save-request event', () => {
    const handler = vi.fn();
    document.addEventListener(SAVE_REQUEST_EVENT, handler);
    const b = defaultBindings().find(b => b.id === 'save-active-editor')!;
    b.action();
    expect(handler).toHaveBeenCalledTimes(1);
    document.removeEventListener(SAVE_REQUEST_EVENT, handler);
  });
});
