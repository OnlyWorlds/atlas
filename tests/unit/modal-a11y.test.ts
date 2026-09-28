/**
 * S361 (lane a A1/B2): modals are real dialogs to assistive tech and hand
 * focus back when they close; the field popover leaves Enter to a focused
 * button (Tab to Cancel + Enter used to SAVE).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BaseModal } from '../../src/ui/modal-base';
import { openFieldEditPopover } from '../../src/ui/field-edit-popover';

class ProbeModal extends BaseModal {
  open(): void {
    const { overlay, body } = this.buildModalShell({ title: 'Probe title', dataModal: 'probe' });
    body.innerHTML = '<input name="probe-input" /><button type="button" data-action="close">Close</button>';
    this.modal = overlay;
    this.show();
    body.querySelector<HTMLButtonElement>('[data-action="close"]')!.addEventListener('click', () => this.hide());
  }
}

beforeEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('BaseModal dialog semantics', () => {
  it('the panel is a labelled modal dialog', () => {
    new ProbeModal().open();
    const panel = document.querySelector('[data-modal="probe"]')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    const labelId = panel.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelId)?.textContent).toBe('Probe title');
  });

  it('focus returns to the opener when a focused modal closes', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    new ProbeModal().open();
    const input = document.querySelector<HTMLInputElement>('input[name="probe-input"]')!;
    input.focus();
    document.querySelector<HTMLButtonElement>('[data-action="close"]')!.click();
    expect(document.activeElement).toBe(opener);
  });
});

describe('field popover Enter', () => {
  it('Enter on a focused Cancel button cancels, it does not save', () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    const onSave = vi.fn();
    const onCancel = vi.fn();
    openFieldEditPopover({ anchor, label: 'Name', value: 'old', widget: 'text-short', onSave, onCancel });
    const input = document.querySelector<HTMLInputElement>('.atlas-modal-overlay input, input')!;
    input.value = 'changed';
    const cancel = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Cancel')!;
    cancel.focus();
    cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
