/**
 * Modal close discipline (S318, Captain): a modal closes on a FULL outside
 * click only — press AND release both on the overlay. A drag that starts
 * inside the panel (text selection in an input, a slipped cursor) and ends
 * outside must NOT close it; that gesture used to eat half-typed modals via
 * the `click` event firing on the common ancestor.
 *
 * Present/absent pair: the guard test (drag-out keeps it open) rides with
 * the behaviour test (full outside click still closes) so a regression in
 * either direction fails loudly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BaseModal } from '../../src/ui/modal-base';

class ProbeModal extends BaseModal {
  open(): void {
    const { overlay, body } = this.buildModalShell({ title: 'probe', dataModal: 'probe' });
    body.innerHTML = '<input name="probe-input" />';
    this.modal = overlay;
    this.show();
  }
  isOpen(): boolean {
    return !!document.querySelector('[data-modal="probe"]');
  }
}

function fire(target: Element, type: string): void {
  target.dispatchEvent(new Event(type, { bubbles: true }));
}

describe('modal close discipline', () => {
  let modal: ProbeModal;
  let overlay: HTMLElement;
  let input: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    modal = new ProbeModal();
    modal.open();
    overlay = document.querySelector('.atlas-modal-overlay')!;
    input = document.querySelector('input[name="probe-input"]')!;
  });

  // singleFork suite: never leave a mounted overlay (or the base class's
  // document-level Escape listener) behind for other files' DOM checks.
  afterEach(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.body.innerHTML = '';
  });

  it('stays open when a press starts inside and releases outside (drag-out)', () => {
    fire(input, 'pointerdown');
    fire(overlay, 'pointerup');
    expect(modal.isOpen()).toBe(true);
  });

  it('stays open when a press starts outside and releases inside', () => {
    fire(overlay, 'pointerdown');
    fire(input, 'pointerup');
    expect(modal.isOpen()).toBe(true);
  });

  it('closes on a full outside click (press and release on the overlay)', () => {
    fire(overlay, 'pointerdown');
    fire(overlay, 'pointerup');
    expect(modal.isOpen()).toBe(false);
  });

  it('a drag-out does not arm a later overlay release', () => {
    // press inside, release outside (no close), then a stray overlay
    // pointerup alone must not close either — the pair must be fresh.
    fire(input, 'pointerdown');
    fire(overlay, 'pointerup');
    fire(overlay, 'pointerup');
    expect(modal.isOpen()).toBe(true);
  });

  it('closes on Escape', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal.isOpen()).toBe(false);
  });
});
