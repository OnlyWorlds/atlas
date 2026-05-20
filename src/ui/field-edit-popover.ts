/**
 * FieldEditPopover — small floating editor anchored near a clicked field.
 *
 * Replaces in-place inline editors that cause layout shifts. The popover is
 * position: fixed and overlays the page, so nothing under it moves.
 *
 * Positioning:
 *   - Tries to anchor above the field if there's room there
 *   - Otherwise below
 *   - Constrains to viewport edges
 *
 * Keys:
 *   - Short input: Enter = Save, Escape = Cancel
 *   - Long textarea: Ctrl/Cmd+Enter = Save, Escape = Cancel
 *   - Click outside (on backdrop) = Cancel
 *
 * Save semantics (session 224): the popover closes OPTIMISTICALLY on submit —
 * the overlay tears down before awaiting `opts.onSave`. The rest of the UI
 * stays interactive while persistence happens in the background. On failure,
 * a toast surfaces the error. This matches the optimistic-UI pattern atlas
 * uses elsewhere (craft #39).
 */

import { toastManager } from './toast-manager';

export interface FieldEditOptions {
  /** Element whose bounding rect anchors the popover. */
  anchor: HTMLElement;
  /** Field display label (shown as popover title). */
  label: string;
  /** Initial value (string-ified). */
  value: string;
  /** Widget kind controls input vs textarea + parsing. */
  widget: 'text-short' | 'text-long' | 'number';
  /** Called with the parsed value when user saves. */
  onSave: (nextValue: any) => Promise<void> | void;
  /** Optional cancel callback. */
  onCancel?: () => void;
  /**
   * Optional suggestion strip rendered below the input. Click a chip to fill
   * the input. Tab autocompletes the longest-prefix match. Used by writing
   * supertype editing to surface the four tier labels.
   */
  suggestions?: string[];
}

export function openFieldEditPopover(opts: FieldEditOptions): void {
  const overlay = document.createElement('div');
  overlay.className = 'atlas-edit-popover-backdrop';

  const panel = document.createElement('div');
  panel.className = 'atlas-edit-popover';

  // Header
  const header = document.createElement('div');
  header.className = 'atlas-edit-popover-header';
  header.textContent = opts.label;
  panel.appendChild(header);

  // Input
  const isLong = opts.widget === 'text-long';
  const input: HTMLInputElement | HTMLTextAreaElement = isLong
    ? document.createElement('textarea')
    : document.createElement('input');
  input.className = isLong ? 'atlas-textarea' : 'atlas-input';
  if (input instanceof HTMLTextAreaElement) input.rows = 6;
  else if (opts.widget === 'number') input.type = 'number';
  else input.type = 'text';
  input.value = opts.value;
  panel.appendChild(input);

  // Suggestion strip (optional; shown when opts.suggestions is non-empty).
  if (opts.suggestions && opts.suggestions.length > 0 && !isLong) {
    const strip = document.createElement('div');
    strip.className = 'atlas-edit-popover-suggestions';
    for (const sug of opts.suggestions) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'atlas-edit-popover-suggestion';
      chip.textContent = sug;
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        input.value = sug;
        input.focus();
      });
      strip.appendChild(chip);
    }
    panel.appendChild(strip);

    // Tab autocompletes to the longest prefix match among suggestions.
    input.addEventListener('keydown', ((e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const current = input.value;
      const match = opts.suggestions!.find(s =>
        s.toLowerCase().startsWith(current.toLowerCase()) && s !== current,
      );
      if (match) {
        e.preventDefault();
        input.value = match;
      }
    }) as EventListener);
  }

  // Footer (hint + actions)
  const footer = document.createElement('div');
  footer.className = 'atlas-edit-popover-footer';

  const hint = document.createElement('span');
  hint.className = 'atlas-edit-popover-hint';
  hint.textContent = isLong ? 'Ctrl+Enter to save · Esc to cancel' : 'Enter to save · Esc to cancel';
  footer.appendChild(hint);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:6px;';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'atlas-btn-ghost';
  cancelBtn.textContent = 'Cancel';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'atlas-btn-primary';
  saveBtn.textContent = 'Save';
  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  footer.appendChild(actions);

  panel.appendChild(footer);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  positionPopover(panel, opts.anchor);

  // Focus + select after layout. queueMicrotask matches the idiom used for
  // the scroll-restore path elsewhere in this codebase.
  queueMicrotask(() => {
    input.focus();
    if (input instanceof HTMLInputElement) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
  });

  function cleanup(): void {
    document.removeEventListener('keydown', keyHandler);
    document.removeEventListener('atlas:save-request', saveRequestHandler);
    overlay.remove();
  }

  const saveRequestHandler = () => { save(); };

  function cancel(): void {
    opts.onCancel?.();
    cleanup();
  }

  async function save(): Promise<void> {
    let nextValue: any = input.value;
    if (opts.widget === 'number') {
      // Empty number → `null` (not undefined). undefined gets dropped through
      // JSON.stringify → server keeps the old value. null survives the wire
      // and the server clears the field. See sync-engine.fieldClear.test.ts.
      if (nextValue === '') nextValue = null;
      else {
        const n = Number(nextValue);
        if (Number.isNaN(n)) return;
        nextValue = n;
      }
    } else {
      // Empty text-short / text-long → keep as empty string. Server applies
      // the empty string as the field's new value. (Don't convert to
      // undefined — that would silently drop the clear via JSON.stringify.)
      // Convention #21 in DESIGN.md.
    }
    // Optimistic close: tear down the overlay before awaiting onSave so the
    // user can interact with the rest of the UI (sidebar clicks, chevrons,
    // navigation) without waiting for disk/sync. If onSave throws, the error
    // surfaces via toast rather than reopening the popover — keeps the flow
    // forward-moving.
    cleanup();
    void Promise.resolve(opts.onSave(nextValue)).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toastManager.error(`Could not save: ${msg}`);
    });
  }

  cancelBtn.addEventListener('click', cancel);
  saveBtn.addEventListener('click', () => { save(); });

  // Click-outside on backdrop cancels
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) cancel();
  });

  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === 'Enter') {
      if (isLong) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          save();
        }
      } else {
        e.preventDefault();
        save();
      }
    }
  };
  document.addEventListener('keydown', keyHandler);
  // Ctrl/Cmd+S also commits — even on long-text where Enter inserts newlines.
  document.addEventListener('atlas:save-request', saveRequestHandler);
}

/**
 * Anchor the popover near the given element. Try above first, then below;
 * constrain horizontally to the viewport.
 *
 * Width matches the anchor's width (clamped to MIN_WIDTH / viewport), so the
 * editor surface aligns with the field the user clicked. CSS supplies the
 * fallback min/max; the inline width here overrides them so the popover
 * adapts to wide fields (description, story).
 */
function positionPopover(panel: HTMLElement, anchor: HTMLElement): void {
  const anchorRect = anchor.getBoundingClientRect();
  const margin = 8;
  const MIN_WIDTH = 280;

  // Width = anchor width minus a small inset so the popover visually sits
  // inside the field row instead of running edge-to-edge with it. Captain's
  // smoke 2026-05-20: edge-to-edge looked "slightly too big" — 24px inset
  // gives breathing room without losing the "matches the field" effect.
  const INSET = 24;
  const maxViewportWidth = window.innerWidth - margin * 2;
  const targetWidth = Math.max(
    MIN_WIDTH,
    Math.min(anchorRect.width - INSET, maxViewportWidth),
  );
  panel.style.width = `${targetWidth}px`;
  // Override CSS max-width so the inline width wins when the field is wide.
  panel.style.maxWidth = `${maxViewportWidth}px`;

  // Re-read dimensions AFTER width is applied so vertical-fit calc uses the
  // post-resize height.
  const panelRect = panel.getBoundingClientRect();

  // Horizontal: align panel's left with anchor's left, but clamp to viewport
  let left = anchorRect.left;
  const maxLeft = window.innerWidth - panelRect.width - margin;
  if (left > maxLeft) left = maxLeft;
  if (left < margin) left = margin;

  // Vertical: prefer below the anchor; flip above if no room
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const spaceAbove = anchorRect.top;
  let top: number;
  if (spaceBelow >= panelRect.height + margin || spaceBelow >= spaceAbove) {
    top = anchorRect.bottom + 4;
  } else {
    top = anchorRect.top - panelRect.height - 4;
  }
  if (top < margin) top = margin;
  if (top + panelRect.height > window.innerHeight - margin) {
    top = window.innerHeight - panelRect.height - margin;
  }

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}
