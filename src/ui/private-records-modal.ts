/**
 * The question a world file asks when the world holds records a tool keeps
 * private (folder spec §4.5 rule 11, §4.7 OW-8, v0.3.15; Skeld 2026-10-22):
 * a download leaves them out unless the person asks, so a tool's own notes do
 * not travel the first time a world is shared. A records list that will not
 * read leaves nothing out by guess: the person includes every record, or no
 * file is made. Closing the dialog makes no file.
 */
import { BaseModal } from './modal-base';
import type { RecordsAnswer, RecordsQuestion } from '../setup/world-download';

const names = (list: string[]): string => list.length <= 1 ? (list[0] ?? '')
  : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;

export class PrivateRecordsModal extends BaseModal {
  private resolve: ((answer: RecordsAnswer) => void) | null = null;

  ask(q: RecordsQuestion): Promise<RecordsAnswer> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      const unreadable = q.kind === 'unreadable';
      const { overlay, body } = this.buildModalShell({
        title: unreadable ? 'Atlas cannot tell which records are private' : 'Some records are private',
        dataModal: 'private-records',
      });
      body.innerHTML = `
        <p class="atlas-modal-hint" data-role="what"></p>
        <p class="atlas-modal-hint" data-role="why"></p>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="button" class="atlas-btn-ghost" data-action="include">${unreadable ? 'Include every record' : 'Include them'}</button>
          ${unreadable ? '' : '<button type="button" class="atlas-btn-primary" data-action="leave-out">Leave them out</button>'}
        </div>`;
      // Producer names come from the world's own folders (conv. 93): set as text.
      const what = body.querySelector<HTMLElement>('[data-role="what"]')!;
      const why = body.querySelector<HTMLElement>('[data-role="why"]')!;
      if (q.kind === 'private') {
        const dirs = q.producers.map(p => `records/${p}`);
        what.textContent = `This world holds records ${q.producers.length === 1 ? 'a tool keeps' : 'tools keep'} private: ${names(dirs)}. A world file leaves them out unless you ask, so a tool's own notes stay with you when the world is shared.`;
        why.textContent = 'Include them only in a copy you keep for yourself.';
      } else {
        what.textContent = "This world's records list (records/RECORDS.json) cannot be read, so Atlas cannot tell which records their tools keep private, and leaves nothing out by guess.";
        why.textContent = 'Include every record only in a copy you keep for yourself, or fix the list and download again.';
      }
      const answer = (a: RecordsAnswer) => () => this.finish(a);
      body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.addEventListener('click', answer(null));
      body.querySelector<HTMLButtonElement>('[data-action="include"]')!.addEventListener('click', answer('include'));
      body.querySelector<HTMLButtonElement>('[data-action="leave-out"]')?.addEventListener('click', answer('leave-out'));
      this.modal = overlay;
      this.show();
      body.querySelector<HTMLButtonElement>(unreadable ? '[data-action="cancel"]' : '[data-action="leave-out"]')!.focus();
    });
  }

  private finish(a: RecordsAnswer): void {
    const r = this.resolve;
    this.resolve = null;
    this.hide();
    r?.(a);
  }

  /** An outside click or Escape closes through hide(): no file. */
  protected hide(): void {
    super.hide();
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r(null);
    }
  }
}
