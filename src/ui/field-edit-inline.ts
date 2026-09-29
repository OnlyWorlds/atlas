/**
 * In-place field editor — alternative to FieldEditPopover.
 *
 * Replaces the value cell of a field row with an `<input>` or `<textarea>`
 * directly. No floating panel; no backdrop; no layout shift on open beyond
 * what the input itself takes.
 *
 * Two variants chosen by `mode`:
 *   - 'single': single-line `<input>`. Auto-grows horizontally to fit the
 *               row; supports Enter to save, Escape to cancel.
 *   - 'multi':  textarea with rows=4 baseline that grows on overflow.
 *               Ctrl/Cmd+Enter saves, Escape cancels.
 *
 * Activation policy mirrors openFieldEditPopover's contract: caller calls
 * this with an anchor element (the field value cell) and the editor takes
 * over until save / cancel resolves. On cancel or save, the row is restored
 * to whatever the next render produces — callers must trigger a re-render
 * (which they already do via state patches).
 */

import { toastManager } from './toast-manager';

export interface FieldEditInlineOptions {
  /** The .atlas-field-value cell. Replaced in place. */
  anchor: HTMLElement;
  /** Initial value (stringified). */
  value: string;
  /** Widget controls input type + parsing. */
  widget: 'text-short' | 'text-long' | 'number';
  /** 'single' = one-line input; 'multi' = 4-row textarea (regardless of widget hint). */
  mode: 'single' | 'multi';
  /** Called with parsed value on save. */
  onSave: (nextValue: unknown) => Promise<void> | void;
  /** Optional cancel callback. */
  onCancel?: () => void;
}

export function openFieldEditInline(opts: FieldEditInlineOptions): void {
  const { anchor, value, widget, mode, onSave, onCancel } = opts;
  // Idempotency guard: if the anchor is already in edit-mode, don't double-mount.
  if (anchor.querySelector('.atlas-field-inline-input, .atlas-field-inline-textarea')) return;

  // Capture original content so cancel can restore it without waiting for a
  // re-render (gives instant feedback on Escape even if state hasn't churned).
  const originalText = anchor.textContent ?? '';
  const originalClass = anchor.className;

  // Build the editor element.
  const isMulti = mode === 'multi';
  const editor: HTMLInputElement | HTMLTextAreaElement = isMulti
    ? document.createElement('textarea')
    : document.createElement('input');

  if (editor instanceof HTMLTextAreaElement) {
    editor.className = 'atlas-field-inline-textarea';
    editor.rows = 4;
  } else {
    editor.className = 'atlas-field-inline-input';
    if (widget === 'number') editor.type = 'number';
    else editor.type = 'text';
  }
  editor.value = value;

  // Mark the anchor so CSS can drop padding / borders while editing.
  anchor.classList.add('atlas-field-value-editing');
  anchor.textContent = '';
  anchor.appendChild(editor);

  // Focus + select after layout settles.
  setTimeout(() => {
    editor.focus();
    if (editor instanceof HTMLInputElement) editor.select();
    else editor.setSelectionRange(editor.value.length, editor.value.length);
  }, 0);

  let resolved = false;
  function restoreAnchor(): void {
    anchor.className = originalClass;
    anchor.textContent = originalText;
  }

  function cancel(): void {
    if (resolved) return;
    resolved = true;
    editor.removeEventListener('blur', onBlur);
    restoreAnchor();
    onCancel?.();
  }

  async function save(): Promise<void> {
    if (resolved) return;
    resolved = true;
    editor.removeEventListener('blur', onBlur);
    let nextValue: unknown = editor.value;
    if (widget === 'number') {
      // Bad text FIRST: type=number reports '' for text it cannot parse, which
      // would read as a clear and write null; "1e999" parses to Infinity,
      // which JSON writes as null. Restore the old value, write nothing
      // (S367 critic C2).
      const bad = editor instanceof HTMLInputElement && editor.validity.badInput;
      const n = Number(nextValue);
      if (bad || (nextValue !== '' && !Number.isFinite(n))) {
        restoreAnchor();
        toastManager.info('That is not a number. The old value is kept.');
        onCancel?.();
        return;
      }
      // Empty → null (not undefined; see convention #21). Otherwise coerce.
      nextValue = nextValue === '' ? null : n;
    }
    // Disable editor visually while saving so the user can't double-trigger.
    editor.setAttribute('disabled', 'true');
    try {
      await onSave(nextValue);
      // Re-render will replace the row entirely; no manual restore needed.
    } catch {
      // Roll back to display state. Caller toast handles error surfacing.
      restoreAnchor();
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
      return;
    }
    if (e.key === 'Enter') {
      if (isMulti) {
        // Ctrl/Cmd+Enter OR Shift+Enter saves. Plain Enter inserts a newline
        // (textarea default). Shift is the conventional editor shortcut; ctrl
        // stays as an alias for muscle-memory across platforms.
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          void save();
        }
      } else {
        e.preventDefault();
        void save();
      }
    }
  }

  // Blur saves by default — clicking outside is "I'm done editing." Captures
  // the in-place editing flow's intuitive "type and click away" pattern.
  function onBlur(): void {
    // Defer so Escape's handler isn't fighting blur (Escape blurs after handling).
    setTimeout(() => { void save(); }, 0);
  }

  editor.addEventListener('keydown', onKeyDown as EventListener);
  editor.addEventListener('blur', onBlur);
}
