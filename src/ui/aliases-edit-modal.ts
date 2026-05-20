/**
 * Aliases edit modal — one row per alias, with add/remove affordances.
 *
 * Aliases are stored as `string[]` on `atlas_aliases` (atlas-local extension
 * field, convention #49). The CSV-in-a-text-input UI was unintuitive — this
 * modal makes it a list of rows the user can tweak directly. Trim/dedupe on
 * save; an empty list persists as `null` so the field clears cleanly.
 *
 * See DESIGN_WRITING.md §Linking model + Aliases.
 */

import { BaseModal } from './modal-base';

export interface AliasesEditModalOpts {
  /** Element name — shown in the modal title for context. */
  elementName: string;
  /** Current aliases — the modal seeds rows from this. */
  current: string[];
  /** Called when the user clicks Save. Receives the cleaned list. */
  onSave: (next: string[]) => Promise<void> | void;
}

export class AliasesEditModal extends BaseModal {
  private rows: HTMLElement[] = [];
  private rowsHost: HTMLElement | null = null;

  constructor(private readonly opts: AliasesEditModalOpts) {
    super();
  }

  open(): void {
    const { overlay, body } = this.buildModalShell({
      title: `aliases — ${this.opts.elementName || '(unnamed)'}`,
      dataModal: 'aliases-edit',
      panelClass: 'atlas-aliases-modal',
    });
    body.innerHTML = `
      <p class="atlas-modal-hint">
        Alternate names that the writing room's <code>@</code> picker matches against
        when looking for this element. One alias per row — handy for nicknames,
        titles, abbreviations.
      </p>
      <div class="atlas-aliases-rows" data-role="rows"></div>
      <button type="button" class="atlas-aliases-add-link" data-role="add-row">
        + add alias
      </button>
      <div class="atlas-modal-actions">
        <button type="button" class="atlas-btn-ghost" data-role="cancel">Cancel</button>
        <button type="button" class="atlas-btn-primary" data-role="save">Save</button>
      </div>
    `;
    this.rowsHost = body.querySelector<HTMLElement>('[data-role="rows"]');

    // Seed with current aliases (or a single empty row if there are none, so
    // the user can start typing immediately).
    if (this.opts.current.length === 0) {
      this.addRow('');
    } else {
      for (const alias of this.opts.current) this.addRow(alias);
    }

    body.querySelector<HTMLElement>('[data-role="add-row"]')?.addEventListener('click', () => {
      this.addRow('', { focus: true });
    });
    body.querySelector<HTMLElement>('[data-role="cancel"]')?.addEventListener('click', () => this.hide());
    body.querySelector<HTMLElement>('[data-role="save"]')?.addEventListener('click', () => { void this.save(); });

    this.modal = overlay;
    this.show();
    // Focus the first input on open for direct typing.
    queueMicrotask(() => {
      this.rowsHost?.querySelector<HTMLInputElement>('input')?.focus();
    });
  }

  private addRow(value: string, opts: { focus?: boolean } = {}): void {
    if (!this.rowsHost) return;
    const row = document.createElement('div');
    row.className = 'atlas-aliases-row';
    row.innerHTML = `
      <input class="atlas-input" type="text" value="" />
      <button type="button" class="atlas-icon-btn-sm" data-role="remove" title="Remove this alias">
        <span class="material-symbols-outlined">close</span>
      </button>
    `;
    const input = row.querySelector<HTMLInputElement>('input');
    if (input) {
      input.value = value;
      // Enter on a row → either add a new empty row below (if this row is the
      // last) or move focus to the next row. Tab works as expected (browser default).
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const rowsList = Array.from(this.rowsHost?.children ?? []);
          const idx = rowsList.indexOf(row);
          if (idx === rowsList.length - 1) {
            this.addRow('', { focus: true });
          } else {
            const next = rowsList[idx + 1] as HTMLElement;
            next.querySelector<HTMLInputElement>('input')?.focus();
          }
        }
      });
    }
    row.querySelector<HTMLElement>('[data-role="remove"]')?.addEventListener('click', () => {
      row.remove();
      this.rows = this.rows.filter(r => r !== row);
      // If the user removes the last row, leave them with a single empty row
      // ready for input instead of an empty list.
      if (this.rows.length === 0) this.addRow('', { focus: true });
    });
    this.rowsHost.appendChild(row);
    this.rows.push(row);
    if (opts.focus) queueMicrotask(() => input?.focus());
  }

  private collect(): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const row of this.rows) {
      const input = row.querySelector<HTMLInputElement>('input');
      const raw = input?.value ?? '';
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue; // case-insensitive dedup
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  }

  private async save(): Promise<void> {
    const cleaned = this.collect();
    try {
      await this.opts.onSave(cleaned);
      this.hide();
    } catch (err) {
      console.error('[aliases-edit] save failed', err);
      // Stay open so the user can retry without losing their edits.
    }
  }
}
