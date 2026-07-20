/**
 * Hotkeys — single dispatcher for keyboard shortcuts.
 *
 * Owns one global `keydown` listener on document. A declarative table of
 * `HotkeyBinding` entries describes each shortcut: what key + modifiers fire it,
 * an optional `when` predicate, and the action to run. The first binding whose
 * combo + predicate match wins; subsequent bindings don't fire.
 *
 * Design notes:
 *
 * - **Cross-platform**: `mod` means Ctrl on Windows/Linux, Cmd on Mac. Use
 *   `mod` instead of either to keep tables OS-agnostic.
 *
 * - **No coupling to editors**: "save the active editor" doesn't import any
 *   editor module. Instead, hotkeys dispatch a custom DOM event
 *   `atlas:save-request`; the field-edit popover and inline name editor each
 *   listen for it while open. Other editors can opt in by listening for the
 *   same event. This keeps the dispatcher independent of UI module structure.
 *
 * - **Modal interaction**: bindings can opt out when any modal is open via the
 *   `disabledInModal` flag. Esc-to-close inside modals is owned by BaseModal +
 *   the popover module — we don't intercept Esc here.
 *
 * - **Text-input guard**: most bindings should not fire while typing in an
 *   input/textarea/contenteditable. `disabledInTextInput` covers this. Bindings
 *   that intentionally trigger from within an editor (like `mod+s` save the
 *   field you're typing in) leave it false.
 *
 * Reference modal: `?` opens `openHotkeyReferenceModal()` which auto-generates
 * its content from the same table. Adding a binding is one edit, not three.
 */

export interface HotkeyBinding {
  /** Stable identifier for tests + the reference modal. */
  id: string;
  /** Human-readable description, shown in the reference modal. */
  description: string;
  /** Scope label for grouping in the reference modal. */
  scope: 'Global' | 'Editor' | 'Sidebar' | 'Map' | 'Writing';
  /** Key match (case-insensitive). Use the value of KeyboardEvent.key. */
  key: string;
  /** Modifier requirement. `mod` = Cmd on Mac, Ctrl elsewhere. */
  modifier?: 'mod' | 'shift' | 'mod+shift' | 'none';
  /** Skip the binding when a modal overlay is on screen. */
  disabledInModal?: boolean;
  /** Skip the binding when focus is in an input/textarea/contenteditable. */
  disabledInTextInput?: boolean;
  /** Optional runtime predicate; if it returns false the binding is skipped. */
  when?: () => boolean;
  /** Action to run. Return true (or void) to preventDefault + stopPropagation. */
  action: () => void | boolean | Promise<void>;
}

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // Modern detection: navigator.platform is deprecated; userAgent is sufficient.
  return /Mac|iPhone|iPad|iPod/.test(ua);
}

/** OS-appropriate display for a binding combo (Cmd+E on Mac, Ctrl+E otherwise). */
export function formatCombo(b: HotkeyBinding): string {
  const mod = isMac() ? '⌘' : 'Ctrl';
  const parts: string[] = [];
  if (b.modifier === 'mod' || b.modifier === 'mod+shift') parts.push(mod);
  if (b.modifier === 'shift' || b.modifier === 'mod+shift') parts.push('Shift');
  // Display the printable key in uppercase, multi-char keys (Escape, F, etc) as-is.
  const k = b.key.length === 1 ? b.key.toUpperCase() : b.key;
  parts.push(k);
  return parts.join(isMac() ? '' : '+');
}

/**
 * Test whether a KeyboardEvent matches a binding's key + modifier signature.
 * Exported for unit tests; the dispatcher uses it internally.
 */
export function matchesBinding(e: KeyboardEvent, b: HotkeyBinding): boolean {
  if (e.key.toLowerCase() !== b.key.toLowerCase()) return false;
  const mod = b.modifier ?? 'none';
  const isModDown = isMac() ? e.metaKey : e.ctrlKey;
  // Disallow the "other" platform's modifier if we required one.
  // (e.g. don't fire mod+E on Mac when Ctrl is held instead of Cmd — that
  // would surprise users with non-Mac muscle memory typing on a Mac.)
  const oppositeDown = isMac() ? e.ctrlKey : e.metaKey;
  switch (mod) {
    case 'none':
      // No modifier required. Reject if any "command" modifier is down — that
      // prevents `?` from firing on Cmd+? for example. Shift IS allowed (`?`
      // is literally Shift+/ on most keyboards).
      return !e.metaKey && !e.ctrlKey && !e.altKey;
    case 'mod':
      return isModDown && !oppositeDown && !e.shiftKey && !e.altKey;
    case 'shift':
      return e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
    case 'mod+shift':
      return isModDown && !oppositeDown && e.shiftKey && !e.altKey;
  }
}

/** Is focus currently in something that accepts typing? */
export function isInTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT') {
    const t = (target as HTMLInputElement).type;
    // Inputs that aren't typing-targets (button, checkbox, etc.) don't count.
    const typingTypes = new Set([
      'text', 'search', 'email', 'url', 'tel', 'number', 'password', 'date', 'datetime-local', 'time', 'month', 'week',
    ]);
    return typingTypes.has(t);
  }
  if (tag === 'TEXTAREA') return true;
  // isContentEditable is the canonical check in browsers; JSDOM doesn't
  // compute it reliably, so fall back to the contenteditable attribute.
  if (target.isContentEditable) return true;
  const attr = target.getAttribute('contenteditable');
  if (attr === '' || attr === 'true' || attr === 'plaintext-only') return true;
  return false;
}

/** Is any modal overlay currently in the DOM? */
export function isModalOpen(): boolean {
  return document.querySelector('.atlas-modal-overlay') !== null;
}

/**
 * Find the first binding (in declaration order) that matches the event +
 * runtime context. Returns null if nothing matches.
 */
export function findMatching(
  e: KeyboardEvent,
  bindings: HotkeyBinding[],
  ctx: { inModal: boolean; inTextInput: boolean },
): HotkeyBinding | null {
  for (const b of bindings) {
    if (b.disabledInModal && ctx.inModal) continue;
    if (b.disabledInTextInput && ctx.inTextInput) continue;
    if (!matchesBinding(e, b)) continue;
    if (b.when && !b.when()) continue;
    return b;
  }
  return null;
}

// ---- Save-request custom event ----

/**
 * Dispatched on `document` when the user invokes the "save" hotkey
 * (`Ctrl/Cmd+S`). Active editors (field-edit popover, inline name editor) add
 * a listener while open and call their save handler on receipt; on close, they
 * remove the listener. The hotkey dispatcher never imports editor modules.
 */
export const SAVE_REQUEST_EVENT = 'atlas:save-request';

export function dispatchSaveRequest(): void {
  document.dispatchEvent(new CustomEvent(SAVE_REQUEST_EVENT));
}

/**
 * Dispatched on `document` when the user invokes the writing focus toggle
 * (`Ctrl/Cmd+Shift+F`). The writing workspace listens while mounted and
 * toggles its focus-mode class. Decoupled from the hotkey table so this file
 * never imports workspace modules.
 */
export const WRITING_FOCUS_TOGGLE_EVENT = 'atlas:writing-focus-toggle';

export function dispatchWritingFocusToggle(): void {
  document.dispatchEvent(new CustomEvent(WRITING_FOCUS_TOGGLE_EVENT));
}

/**
 * Dispatched on `document` when the writing workspace's inline-create hotkey
 * fires (`Ctrl/Cmd+Shift+E`). The workspace listens while mounted and opens
 * ElementCreateModal pre-filled with the current text selection.
 */
export const WRITING_INLINE_CREATE_EVENT = 'atlas:writing-inline-create';

export function dispatchWritingInlineCreate(): void {
  document.dispatchEvent(new CustomEvent(WRITING_INLINE_CREATE_EVENT));
}

/**
 * Dispatched on `document` when the writing workspace's "split at cursor"
 * hotkey fires (`Ctrl/Cmd+Shift+D`). The workspace listens while mounted and
 * opens the split confirm dialog — the prose after cursor moves to a new
 * sibling narrative.
 */
export const WRITING_SPLIT_EVENT = 'atlas:writing-split';

export function dispatchWritingSplit(): void {
  document.dispatchEvent(new CustomEvent(WRITING_SPLIT_EVENT));
}

// ---- Default bindings ----

/**
 * Default binding table. Order matters: earlier bindings win on a tie.
 * Adding a binding here automatically lists it in the reference modal.
 */
export function defaultBindings(): HotkeyBinding[] {
  return [
    {
      id: 'open-reference',
      description: 'Help for this room + all shortcuts',
      scope: 'Global',
      key: '?',
      modifier: 'none',
      disabledInModal: true,
      disabledInTextInput: true,
      action: () => { openHotkeyReferenceModal(); },
    },
    {
      id: 'new-element',
      description: 'New element',
      scope: 'Global',
      key: 'e',
      modifier: 'mod',
      disabledInModal: true,
      disabledInTextInput: true,
      when: () => Boolean(getCallbacks().getActiveWorldId?.()),
      action: () => { getCallbacks().openCreateElement?.(); },
    },
    {
      id: 'command-palette',
      description: 'Search everywhere (palette)',
      scope: 'Global',
      key: 'k',
      modifier: 'mod',
      disabledInModal: true,
      when: () => Boolean(getCallbacks().getActiveWorldId?.()),
      action: () => { getCallbacks().openCommandPalette?.(); },
    },
    {
      id: 'command-palette-slash',
      description: 'Search everywhere (palette)',
      scope: 'Global',
      key: '/',
      modifier: 'none',
      disabledInModal: true,
      disabledInTextInput: true,
      when: () => Boolean(getCallbacks().getActiveWorldId?.()),
      action: () => { getCallbacks().openCommandPalette?.(); },
    },
    {
      id: 'save-active-editor',
      description: 'Save current field',
      scope: 'Editor',
      key: 's',
      modifier: 'mod',
      // INTENTIONALLY allowed in text input — that's the whole point.
      action: () => { dispatchSaveRequest(); },
    },
    {
      id: 'deselect-to-home',
      description: 'Deselect element / return to home',
      scope: 'Global',
      key: 'Escape',
      modifier: 'none',
      disabledInModal: true,
      disabledInTextInput: true,
      // Skip when ANY overlay/popover is active (each owns its Esc behavior).
      // Also requires an element to be selected — otherwise we'd be navigating
      // home from home, which is confusing.
      // Skip in writing room: after the URL/selection decoupling (conv. #46),
      // writing-room navigation is owned by the URL hierarchy; Esc pulling
      // the user out of writing AND clearing their persisted global selection
      // surprised more than it helped. Writing room exits via room-nav click.
      // Same gate for the knowledge room (session 235) and the share room
      // (Sharing arc) — both have their own editing surfaces + URL-owned
      // navigation; Esc yanking the user to home mid-edit is the identical trap.
      when: () => {
        if (!getCallbacks().hasSelectedElement?.()) return false;
        if (isAnyOverlayActive()) return false;
        // Pin-placement mode owns Esc while armed (cancel placement, not
        // deselect-to-home) — same "each mode owns its Esc" rule as overlays.
        // The watcher stamps body.atlas-placing when ui.pinPlacement is set.
        if (typeof document !== 'undefined' && document.body.classList.contains('atlas-placing')) return false;
        const hash = typeof window !== 'undefined' ? window.location.hash : '';
        if (hash.includes('/writing') || hash.includes('/knowledge') || hash.includes('/share')) return false;
        return true;
      },
      action: () => { getCallbacks().deselectToHome?.(); },
    },
    {
      id: 'open-notes',
      description: 'Open notes overlay',
      scope: 'Global',
      key: 'n',
      modifier: 'none',
      disabledInModal: true,
      disabledInTextInput: true,
      when: () => Boolean(getCallbacks().getActiveWorldId?.()),
      action: () => { getCallbacks().openNotes?.(); },
    },
    {
      id: 'writing-focus-toggle',
      description: 'Toggle focus mode (writing)',
      scope: 'Writing',
      key: 'f',
      modifier: 'mod+shift',
      // INTENTIONALLY allowed in text input — writers will be in the editor
      // when they want to toggle focus.
      when: () => {
        const hash = typeof window !== 'undefined' ? window.location.hash : '';
        return hash.includes('/writing/');
      },
      action: () => { dispatchWritingFocusToggle(); },
    },
    {
      id: 'writing-inline-create',
      description: 'Create element from selection (writing)',
      scope: 'Writing',
      key: 'e',
      modifier: 'mod+shift',
      // INTENTIONALLY allowed in text input — the writer's selection is
      // in the prose surface; we want this to fire while they're typing.
      when: () => {
        const hash = typeof window !== 'undefined' ? window.location.hash : '';
        return hash.includes('/writing/');
      },
      action: () => { dispatchWritingInlineCreate(); },
    },
    {
      id: 'writing-split-at-cursor',
      description: 'Split into sibling at cursor (writing)',
      scope: 'Writing',
      key: 'd',
      modifier: 'mod+shift',
      // INTENTIONALLY allowed in text input — the writer's cursor IS in
      // the editor when invoking.
      when: () => {
        const hash = typeof window !== 'undefined' ? window.location.hash : '';
        return hash.includes('/writing/');
      },
      action: () => { dispatchWritingSplit(); },
    },
  ];
}

/**
 * Returns true if any popover/overlay (other than modals — those use
 * `disabledInModal`) is currently active. The deselect-to-home hotkey gates on
 * this so it doesn't steal Esc from active editors.
 *
 * Modal overlay is excluded here because `disabledInModal` already handles it
 * via `isModalOpen()`. The classes below cover the non-modal overlays.
 */
function isAnyOverlayActive(): boolean {
  // Field-edit popover, visual settings popover, zone edit/drawing handles —
  // all DOM-driven. Pin placement + zone editing also use Esc (within
  // map-tab keydown). Both are tracked in state.ui.
  const popoverSelectors = [
    '.atlas-edit-popover-backdrop',
    '.atlas-field-inline-edit',
    '.atlas-visual-settings-popover',
  ];
  for (const sel of popoverSelectors) {
    if (document.querySelector(sel)) return true;
  }
  return false;
}

// ---- Wiring (callbacks-from-app pattern) ----

/**
 * The dispatcher doesn't know about app state. The app installs callbacks
 * that bindings use as their action and `when` guards. This avoids circular
 * imports (state → hotkeys → state) and keeps hotkeys.ts trivially testable.
 */
export interface HotkeyCallbacks {
  /** True when a world is active; used to gate world-scoped bindings. */
  getActiveWorldId?: () => string | null | undefined;
  /** Open the ElementCreateModal. */
  openCreateElement?: () => void;
  /** Open the command palette (Ctrl/Cmd+K, `/`) — lazy-loaded in app.ts. */
  openCommandPalette?: () => void;
  /** True when state.ui.selectedElementId is set — gates the deselect hotkey. */
  hasSelectedElement?: () => boolean;
  /** Clear selection + navigate to home (DESIGN convention #32). */
  deselectToHome?: () => void;
  /** Open the per-world notes overlay (session 223). */
  openNotes?: () => void;
}

let callbacks: HotkeyCallbacks = {};

function getCallbacks(): HotkeyCallbacks {
  return callbacks;
}

export function setHotkeyCallbacks(c: HotkeyCallbacks): void {
  callbacks = { ...callbacks, ...c };
}

// ---- Reference modal opener (lazy import to avoid bundle bloat) ----

let openModalImpl: (() => void) | null = null;

/**
 * Subclasses register their modal opener. Set during installHotkeys() so the
 * default `?` binding can call it. Kept dynamic so tests can override.
 */
export function setHotkeyReferenceModalOpener(opener: () => void): void {
  openModalImpl = opener;
}

export function openHotkeyReferenceModal(): void {
  if (openModalImpl) {
    openModalImpl();
    return;
  }
  // Bout HELP: the `?` surface is the room-aware help overlay (purpose +
  // "you can" lines + the full shortcut reference — one shape, every room).
  // Dynamic import keeps it out of the main chunk.
  void import('../ui/help-overlay').then(m => {
    m.openHelpOverlay();
  });
}

// ---- Install ----

let installed = false;
let installedBindings: HotkeyBinding[] = [];
let listener: ((e: KeyboardEvent) => void) | null = null;

export function installHotkeys(bindings: HotkeyBinding[] = defaultBindings()): () => void {
  if (installed) {
    // Replace bindings + listener. Lets tests reinstall.
    uninstallHotkeys();
  }
  installedBindings = bindings;
  listener = (e: KeyboardEvent) => {
    const ctx = { inModal: isModalOpen(), inTextInput: isInTextInput(e.target) };
    const match = findMatching(e, installedBindings, ctx);
    if (!match) return;
    const result = match.action();
    // Default: prevent default + stop propagation. The action can return
    // `false` to let the event continue (e.g. for chord-style bindings, or
    // when the action is a no-op).
    if (result !== false) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  document.addEventListener('keydown', listener);
  installed = true;
  return uninstallHotkeys;
}

export function uninstallHotkeys(): void {
  if (listener) document.removeEventListener('keydown', listener);
  listener = null;
  installed = false;
}

/** Snapshot of currently-installed bindings — used by the reference modal. */
export function getInstalledBindings(): HotkeyBinding[] {
  return [...installedBindings];
}
