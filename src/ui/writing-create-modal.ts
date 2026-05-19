/**
 * Writing-create modal — name a new Book / Chapter / Scene (Narrative under
 * the hood). See DESIGN_WRITING.md.
 *
 * Replaces the window.prompt call in writing.ts. Uses BaseModal for consistent
 * chrome with the rest of the app. Enter creates, Escape cancels.
 *
 * The caller provides:
 *   - label   — display label for the level being created ("Book", "Chapter", ...).
 *               Comes from getWritingLabels(worldId) so customization is honored.
 *   - parentId — optional parent_narrative for nesting; absent = top-level.
 *   - onCreate — async callback. The modal closes on resolve; on reject the
 *                modal stays open with the error inline so the user can retry.
 */

import { BaseModal } from './modal-base';
import { escapeAttr } from '../core/dom-utils';

export interface WritingCreateOptions {
  label: string;
  parentId?: string;
  defaultName?: string;
  onCreate: (name: string) => Promise<void>;
}

export class WritingCreateModal extends BaseModal {
  private opts: WritingCreateOptions;

  constructor(opts: WritingCreateOptions) {
    super();
    this.opts = opts;
  }

  open(): void {
    const { overlay, body } = this.buildModalShell({
      title: `new ${this.opts.label.toLowerCase()}`,
      dataModal: 'writing-create',
    });

    const defaultName = this.opts.defaultName ?? `new ${this.opts.label.toLowerCase()}`;
    body.innerHTML = `
      <div class="atlas-modal-field">
        <label class="atlas-modal-label">name</label>
        <input
          type="text"
          name="narrative-name"
          class="atlas-input"
          autocomplete="off"
          value="${escapeAttr(defaultName)}"
        />
      </div>
      <div class="atlas-modal-error" data-role="error" hidden></div>
      <div class="atlas-modal-actions">
        <button type="button" class="atlas-btn-ghost" data-action="cancel">cancel</button>
        <button type="button" class="atlas-btn-primary" data-action="create">create</button>
      </div>
    `;

    this.modal = overlay;
    this.show();

    const input = body.querySelector<HTMLInputElement>('input[name="narrative-name"]')!;
    const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const createBtn = body.querySelector<HTMLButtonElement>('[data-action="create"]')!;

    cancelBtn.addEventListener('click', () => this.hide());

    const submit = async (): Promise<void> => {
      const name = input.value.trim();
      if (!name) {
        errorBox.textContent = 'name is required';
        errorBox.hidden = false;
        return;
      }
      createBtn.disabled = true;
      cancelBtn.disabled = true;
      errorBox.hidden = true;
      try {
        await this.opts.onCreate(name);
        this.hide();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errorBox.textContent = message;
        errorBox.hidden = false;
        createBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    };

    createBtn.addEventListener('click', () => { void submit(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void submit();
      }
    });

    // Select all on open for fast overtype.
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
  }
}


