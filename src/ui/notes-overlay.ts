/**
 * Notes overlay — a freeform per-world note pad available from any room.
 *
 * Captain's request (session 223 design chat): "a random notes modal/page
 * that is persistent in app, just overlays and for random dumps". Lives on
 * the registry entry (atlas-local, never synced). Accessible via:
 *   - The notepad button in the sidebar footer (everywhere)
 *   - The `N` global hotkey (when no other text input is focused)
 *
 * Save semantics: debounced auto-save on input. The modal is non-blocking
 * (you can close it with Esc or backdrop click and changes persist).
 */

import { BaseModal } from './modal-base';
import { getState, patchSlice, subscribe } from '../core/state';
import { saveRegistry } from '../registry/registry';

const SAVE_DEBOUNCE_MS = 600;

export class NotesOverlay extends BaseModal {
  private debounceTimer: number | null = null;

  open(): void {
    const active = getState().active;
    if (!active) return; // Notes are per-world; no-op without one.
    const reg = getState().registry;
    const entry = reg.worlds.find(w => w.id === active.worldId);
    if (!entry) return;

    const { overlay, body, panel } = this.buildModalShell({
      title: `notes · ${entry.name}`,
      dataModal: 'notes-overlay',
      panelClass: 'atlas-notes-panel',
    });
    void panel;

    body.innerHTML = `
      <textarea
        class="atlas-textarea atlas-notes-textarea"
        placeholder="random thoughts, plot beats, todos. saves as you type."
        spellcheck="false"
      ></textarea>
      <div class="atlas-notes-status" data-role="status">saved</div>
    `;

    this.modal = overlay;
    this.show();

    const ta = body.querySelector<HTMLTextAreaElement>('textarea')!;
    const status = body.querySelector<HTMLElement>('[data-role="status"]')!;
    ta.value = entry.notes ?? '';
    // What the textarea last took from, or gave to, the registry. The notes
    // can move under an open overlay (the world-prefs merge folding in
    // another machine's notes, another tab's save): S365 gate lens A M1.
    let loaded = ta.value;
    const notesNow = (): string => getState().registry.worlds.find(w => w.id === active.worldId)?.notes ?? '';

    const persist = (): void => {
      const next = getState().registry;
      const idx = next.worlds.findIndex(w => w.id === active.worldId);
      if (idx < 0) return;
      const current = next.worlds[idx].notes ?? '';
      let value = ta.value;
      if (current !== loaded) {
        // Moved underneath while typing: keep both. The part this overlay
        // loaded is replaced by what was typed; anything else stays.
        // A replacer function: typed text holding `$'` or `$&` would expand
        // as a replacement string (S388, the family of Boss's show find).
        value = loaded && current.includes(loaded)
          ? current.replace(loaded, () => ta.value)
          : `${current}\n\nNotes from this browser:\n${ta.value}`;
        ta.value = value;
      }
      loaded = value;
      const updated = { ...next.worlds[idx], notes: value };
      const updatedReg = { ...next, worlds: next.worlds.map((w, i) => (i === idx ? updated : w)) };
      saveRegistry(updatedReg);
      patchSlice('registry', updatedReg);
      status.textContent = 'saved';
      status.classList.remove('dirty');
    };

    // Not typing: the textarea follows the registry.
    const unsub = subscribe(() => {
      if (!ta.isConnected) { unsub(); return; }
      if (this.debounceTimer != null) return;
      const now = notesNow();
      if (now !== loaded) { ta.value = now; loaded = now; }
    });

    ta.addEventListener('input', () => {
      status.textContent = 'saving…';
      status.classList.add('dirty');
      if (this.debounceTimer != null) window.clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(persist, SAVE_DEBOUNCE_MS);
    });

    // Save immediately on close (don't lose the last few keystrokes if user
    // hits Esc within the debounce window).
    ta.addEventListener('blur', () => {
      if (this.debounceTimer != null) {
        window.clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
        persist();
      }
    });

    queueMicrotask(() => {
      ta.focus();
      // Place caret at the end (don't select-all — preserves writing flow).
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    });
  }
}

let activeOverlay: NotesOverlay | null = null;

export function openNotesOverlay(): void {
  if (activeOverlay) return; // Idempotent — re-clicking the button when already open is a no-op.
  activeOverlay = new NotesOverlay();
  activeOverlay.open();
  // BaseModal owns Esc + backdrop close. We listen for the resulting DOM
  // removal so we can clear the active reference.
  const observer = new MutationObserver(() => {
    if (!document.querySelector('[data-modal="notes-overlay"]')) {
      activeOverlay = null;
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}
