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
 *   - Full click outside (press + release on backdrop): commits changed
 *     non-empty text like Enter; otherwise closes without writing (S318 —
 *     typed work is never lost to a stray click; Escape stays the discard)
 *
 * Save semantics (session 224): the popover closes OPTIMISTICALLY on submit —
 * the overlay tears down before awaiting `opts.onSave`. The rest of the UI
 * stays interactive while persistence happens in the background. On failure,
 * a toast surfaces the error. This matches the optimistic-UI pattern atlas
 * uses elsewhere (craft #39).
 */

import { toastManager } from './toast-manager';
import { showProblem } from './problem-fixes';
import { problemWasShown } from '../core/problems';
import { forPointer } from '../core/pointer';

export interface FieldEditOptions {
  /** Element whose bounding rect anchors the popover. */
  anchor: HTMLElement;
  /** Field display label (shown as popover title). */
  label: string;
  /** Optional field description, rendered quietly behind the label in the
   *  header (Captain, S318: "we have space for it, would be useful"). */
  description?: string;
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
  /**
   * Optional live hint under the input, recomputed per keystroke from the raw
   * text (2B date entry: the quiet "resolves to" line — the user sees what
   * will be saved before committing). null/'' hides the line.
   */
  liveHint?: (raw: string) => string | null;
}

export function openFieldEditPopover(opts: FieldEditOptions): void {
  const overlay = document.createElement('div');
  overlay.className = 'atlas-edit-popover-backdrop';

  const panel = document.createElement('div');
  panel.className = 'atlas-edit-popover';

  // Header — the label, with the field's description quietly behind it.
  const header = document.createElement('div');
  header.className = 'atlas-edit-popover-header';
  const labelSpan = document.createElement('span');
  labelSpan.textContent = opts.label;
  header.appendChild(labelSpan);
  if (opts.description) {
    const desc = document.createElement('span');
    desc.className = 'atlas-edit-popover-desc';
    desc.textContent = opts.description;
    header.appendChild(desc);
  }
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

  // Live hint (optional): a quiet resolves-to line under the input, updated
  // per keystroke (2B date entry).
  if (opts.liveHint) {
    const live = document.createElement('div');
    live.className = 'atlas-edit-popover-live';
    const update = (): void => {
      const text = opts.liveHint!(input.value);
      live.textContent = text ?? '';
      live.style.display = text ? '' : 'none';
    };
    input.addEventListener('input', update);
    update();
    panel.appendChild(live);
  }

  // Bad-number line: shown instead of saving when the typed text is not a
  // number, so the old value stays put (S367 critic C2).
  const errorLine = document.createElement('div');
  // Its own class: `.atlas-edit-popover-live` is the resolution hint that
  // callers (and specs) read.
  errorLine.className = 'atlas-edit-popover-error';
  errorLine.dataset.active = 'false';
  panel.appendChild(errorLine);
  input.addEventListener('input', () => { errorLine.dataset.active = 'false'; });

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
      // Bad text FIRST: a type=number input reports '' for text it cannot
      // parse ("12,5", "1e"), which would read as a deliberate clear and
      // write null (deleting a custom field). Too-big numbers ("1e999")
      // parse to Infinity, which JSON writes as null. Keep the popover open
      // and write nothing (S367 critic C2).
      const bad = input instanceof HTMLInputElement && input.validity.badInput;
      const n = Number(nextValue);
      if (bad || (nextValue !== '' && !Number.isFinite(n))) {
        errorLine.textContent = forPointer('That is not a number. Fix it, or press Esc to keep the old value.', 'That is not a number. Fix it, or tap Cancel to keep the old value.');
        errorLine.dataset.active = 'true';
        input.focus();
        return;
      }
      // Empty number → `null` (not undefined). undefined gets dropped through
      // JSON.stringify → server keeps the old value. null survives the wire
      // and the server clears the field. See sync-engine.fieldClear.test.ts.
      nextValue = nextValue === '' ? null : n;
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
      // A save that already said what went wrong (the element page's own
      // field save does) is not said twice (S368).
      if (problemWasShown(err)) return;
      console.warn('[field-edit-popover] save failed:', err);
      showProblem(err, { doing: 'saving this field' });
    });
  }

  cancelBtn.addEventListener('click', cancel);
  saveBtn.addEventListener('click', () => { save(); });

  // Click-outside discipline (Captain, S318 — "seems a risky way to have
  // people lose writing"). The old rule cancelled on backdrop MOUSEDOWN and
  // silently discarded whatever was typed. Now:
  //   - a full outside click (press AND release on the backdrop — the
  //     modal-base pair, so a text-selection drag that slips off the panel
  //     never triggers anything) with CHANGED, NON-EMPTY text COMMITS it,
  //     exactly like Enter; typed work is never lost to a stray click.
  //   - unchanged text, or an emptied input, closes without writing — a
  //     deliberate clear still commits via Enter/Save, never by accident.
  let pressedOnBackdrop = false;
  overlay.addEventListener('pointerdown', (e) => {
    pressedOnBackdrop = e.target === overlay;
  });
  overlay.addEventListener('pointerup', (e) => {
    const fullOutsideClick = pressedOnBackdrop && e.target === overlay;
    pressedOnBackdrop = false;
    if (!fullOutsideClick) return;
    const changed = input.value !== opts.value;
    if (changed && input.value.trim() !== '') save();
    else cancel();
  });

  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === 'Enter') {
      // A focused BUTTON keeps its own Enter (S361, lane a B2): Tab to
      // Cancel and press Enter used to SAVE.
      if (e.target instanceof HTMLButtonElement) return;
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
