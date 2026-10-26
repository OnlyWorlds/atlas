/**
 * Field-edit popover close discipline (Titus: "seems a risky way to
 * have people lose writing") — the backdrop used to CANCEL on mousedown and
 * silently discard typed text. The contract now:
 *   - full outside click (press + release on backdrop) with CHANGED,
 *     non-empty text COMMITS like Enter
 *   - unchanged, or emptied, closes without writing
 *   - a drag that starts inside and releases outside does nothing
 *   - Escape stays the explicit discard
 * Plus: the optional field description renders behind the header label.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openFieldEditPopover } from '../../src/ui/field-edit-popover';

function fire(target: Element, type: string): void {
  target.dispatchEvent(new Event(type, { bubbles: true }));
}

function open(opts: Partial<Parameters<typeof openFieldEditPopover>[0]> = {}) {
  const anchor = document.createElement('div');
  document.body.appendChild(anchor);
  const onSave = vi.fn();
  const onCancel = vi.fn();
  openFieldEditPopover({
    anchor,
    label: 'Description',
    value: 'original',
    widget: 'text-short',
    onSave,
    onCancel,
    ...opts,
  });
  const overlay = document.querySelector<HTMLElement>('.atlas-edit-popover-backdrop')!;
  const input = document.querySelector<HTMLInputElement>('.atlas-edit-popover input')!;
  return { overlay, input, onSave, onCancel };
}

describe('field-edit popover close discipline', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  // The suite runs singleFork — a popover left mounted leaks into OTHER
  // files' DOM-sensitive checks (isAnyOverlayActive saw our backdrop and
  // failed the deselect-to-home when() test). Tear down what we mount.
  afterEach(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.body.innerHTML = '';
  });

  it('full outside click with changed non-empty text COMMITS it', () => {
    const { overlay, input, onSave, onCancel } = open();
    input.value = 'typed work';
    fire(overlay, 'pointerdown');
    fire(overlay, 'pointerup');
    expect(onSave).toHaveBeenCalledWith('typed work');
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.querySelector('.atlas-edit-popover')).toBeNull();
  });

  it('full outside click with UNCHANGED text closes without writing', () => {
    const { overlay, onSave, onCancel } = open();
    fire(overlay, 'pointerdown');
    fire(overlay, 'pointerup');
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('full outside click with EMPTIED text closes without writing (clears commit via Enter only)', () => {
    const { overlay, input, onSave, onCancel } = open();
    input.value = '';
    fire(overlay, 'pointerdown');
    fire(overlay, 'pointerup');
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('a drag from inside the panel released on the backdrop does NOTHING', () => {
    const { overlay, input, onSave, onCancel } = open();
    input.value = 'half-typed';
    fire(input, 'pointerdown');
    fire(overlay, 'pointerup');
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.querySelector('.atlas-edit-popover')).not.toBeNull();
    // and the pair must be fresh — a stray later release alone stays inert
    fire(overlay, 'pointerup');
    expect(document.querySelector('.atlas-edit-popover')).not.toBeNull();
  });

  it('Escape remains the explicit discard for changed text', () => {
    const { input, onSave, onCancel } = open();
    input.value = 'about to be discarded';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('renders the field description behind the label when provided, and not otherwise', () => {
    open({ description: 'Details about the element' });
    const desc = document.querySelector('.atlas-edit-popover-desc');
    expect(desc?.textContent).toBe('Details about the element');
    document.body.innerHTML = '';
    open();
    expect(document.querySelector('.atlas-edit-popover-desc')).toBeNull();
  });
});
