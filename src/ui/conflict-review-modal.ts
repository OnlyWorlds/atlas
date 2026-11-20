/**
 * Conflict Review Modal — per-row resolution for sync conflicts (Phase 3.5+).
 *
 * Lists every conflict recorded in `.atlas/sync-state.json`. Each row offers
 * two actions: `overwrite-mine` (push local to server) and `pull-theirs`
 * (overwrite local with server). Closing the modal without picking is a
 * valid "decide later" — the badge stays as a reminder.
 *
 * The actions call `SyncEngine.resolveConflict(id, action)`; on success the
 * row is removed from the modal. When the list empties, the modal closes.
 */

import { nameOrUnnamed, typeName } from '../core/type-words';
import { BaseModal } from './modal-base';
import { ToastManager } from './toast-manager';
import { getCurrentSyncEngine, getCurrentSyncFolder, refreshConflictsCount, refreshMetaCacheNow } from '../sync/sync-attach';
import { surfaceSyncUnavailable } from './sync-toasts';
import { showProblem } from './problem-fixes';
import { PlainError } from '../core/plain-error';
import { getState } from '../core/state';
import { patchElementsFrom } from '../core/active-store';
import type { Conflict } from '../core/types';
import { escapeText } from '../core/dom-utils';
import { proposalReviewLine } from '../sync/proposal-lines';
import { memberIds, storedMark } from '../core/strand';
import { STRAND_KEY } from '../core/strand-mark';

export class ConflictReviewModal extends BaseModal {
  private conflicts: Conflict[] = [];
  /** Contested world-meta fields — rendered as
   *  compact "world setting" rows above the element rows. */
  private metaConflicts: string[] = [];
  /**
   * worldId at modal open time. Validated before every resolve action so a
   * mid-modal world switch can't apply the user's choice to a different
   * world's engine. (SYNC_NOTES M5.)
   */
  private capturedWorldId: string | null = null;

  constructor(private toasts: ToastManager) {
    super();
  }

  async open(): Promise<void> {
    const engine = getCurrentSyncEngine();
    if (!engine) {
      surfaceSyncUnavailable(this.toasts);
      return;
    }
    this.capturedWorldId = getState().active?.worldId ?? null;
    try {
      this.conflicts = await engine.listConflicts();
      this.metaConflicts = await engine.listMetaConflicts();
    } catch (err) {
      console.error('[conflict-review] listing failed:', err);
      showProblem(err, { doing: 'reading the conflicts', toasts: this.toasts });
      return;
    }
    if (this.conflicts.length === 0 && this.metaConflicts.length === 0) {
      this.toasts.info('No conflicts to review');
      return;
    }

    const total = this.conflicts.length + this.metaConflicts.length;
    const { overlay, body } = this.buildModalShell({
      title: `${total} conflict${total === 1 ? '' : 's'} to review`,
      panelClass: 'atlas-conflict-panel',
      dataModal: 'conflict-review',
    });
    body.appendChild(this.renderList());
    body.appendChild(this.renderFooter());

    this.modal = overlay;
    this.show();
  }

  private renderList(): HTMLElement {
    const list = document.createElement('div');
    list.className = 'atlas-conflict-list';
    list.setAttribute('data-role', 'conflict-list');
    this.metaConflicts.forEach((field) => list.appendChild(this.renderMetaRow(field)));
    this.conflicts.forEach((c) => list.appendChild(this.renderRow(c)));
    return list;
  }

  /** A contested world-meta field: same two verbs as element rows, resolved
   *  via engine.resolveMetaConflict. */
  private renderMetaRow(field: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'atlas-conflict-row';
    row.setAttribute('data-meta-conflict', field);
    row.innerHTML = `
      <div class="atlas-conflict-row-meta">
        <span class="atlas-conflict-type">world setting</span>
        <span class="atlas-conflict-name">${escapeText(metaFieldWord(field))}</span>
        <span class="atlas-conflict-fields">changed here and on the server</span>
      </div>
      <div class="atlas-conflict-row-actions">
        <button class="atlas-btn-ghost" data-action="overwrite-mine" title="Push local value to server">Overwrite (mine wins)</button>
        <button class="atlas-btn-ghost" data-action="pull-theirs" title="Overwrite local with server">Pull (theirs wins)</button>
      </div>
    `;
    // The world's strand (S9): each side's story by name, the server's read once the row is drawn.
    if (field === STRAND_KEY) void this.nameStrandSides(row);
    row.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const choice = btn.dataset.action === 'overwrite-mine' ? 'mine' as const : 'theirs' as const;
        if (getState().active?.worldId !== this.capturedWorldId) {
          this.toasts.info('Another world is open now. Switch back to review its conflicts.');
          this.hide();
          return;
        }
        row.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = true));
        try {
          const engine = getCurrentSyncEngine();
          if (!engine) throw new PlainError('Sync is not running for this world right now. Close this, wait a moment, then try again.');
          await engine.resolveMetaConflict(field, choice);
          row.remove();
          this.metaConflicts = this.metaConflicts.filter((f) => f !== field);
          await refreshMetaCacheNow(); // 'theirs' rewrote world.json — reflect it
          await refreshConflictsCount();
          this.updateTitle();
          if (this.conflicts.length === 0 && this.metaConflicts.length === 0) {
            this.toasts.success('All conflicts resolved');
            this.hide();
          }
        } catch (err) {
          row.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = false));
          // The row's buttons are live again: pressing one is the retry.
          console.error('[conflict-review] resolve failed:', err);
          showProblem(err, { doing: 'resolving the conflict', toasts: this.toasts });
        }
      });
    });
    return row;
  }

  /** The strand's row says which story each side names: here from world.json's mirror, the server's by a read. */
  private async nameStrandSides(row: HTMLElement): Promise<void> {
    const line = row.querySelector<HTMLElement>('.atlas-conflict-fields');
    if (!line) return;
    const here = strandStoryWord(storedMark(getState().active?.meta));
    line.textContent = `Here: ${here}`;
    try {
      const engine = getCurrentSyncEngine();
      if (!engine) return;
      const theirs = strandStoryWord(await engine.serverExtValue(STRAND_KEY));
      if (row.isConnected) line.textContent = `Here: ${here} · On OnlyWorlds: ${theirs}`;
    } catch {
      // The server's side stays unnamed; the two verbs still work.
    }
  }

  private renderRow(c: Conflict): HTMLElement {
    const row = document.createElement('div');
    row.className = 'atlas-conflict-row';
    row.setAttribute('data-conflict-id', c.element_id);
    const name = nameOrUnnamed({ name: lookupName(c.element_id), type: c.type }, { start: true });
    if (c.no_baseline) {
      row.setAttribute('data-no-baseline', '');
      row.innerHTML = noBaselineRowHtml(c, name);
    } else row.innerHTML = `
      <div class="atlas-conflict-row-meta">
        <span class="atlas-conflict-type">${escapeText(typeName(c.type))}</span>
        <span class="atlas-conflict-name">${escapeText(name)}</span>
        <span class="atlas-conflict-fields">${c.fields.length} field${c.fields.length === 1 ? '' : 's'} differ${c.fields.length ? `: ${c.fields.map(escapeText).join(', ')}` : ''}</span>
        ${c.proposal ? `<span class="atlas-conflict-proposal" data-role="proposal-line">${escapeText(proposalReviewLine(c.proposal))}</span>` : ''}
      </div>
      <div class="atlas-conflict-row-actions">
        <button class="atlas-btn-ghost" data-action="overwrite-mine" title="${c.proposal ? 'Send your edit for review again' : 'Push local content to server'}">Overwrite (mine wins)</button>
        <button class="atlas-btn-ghost" data-action="pull-theirs" title="${c.proposal ? "Drop your edit and take the world's copy" : 'Overwrite local with server'}">Pull (theirs wins)</button>
      </div>
    `;
    this.wireRow(row, c);
    return row;
  }

  private wireRow(row: HTMLElement, c: Conflict): void {
    row.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action as 'overwrite-mine' | 'pull-theirs';
        // World-switch guard: bail if the active world changed since the modal
        // opened. resolveConflict acts on the current engine; without the
        // guard, a mid-modal world switch would apply the user's choice to
        // the wrong world's local files.
        if (getState().active?.worldId !== this.capturedWorldId) {
          this.toasts.info('Another world is open now. Switch back to review its conflicts.');
          this.hide();
          return;
        }
        row.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = true));
        try {
          const engine = getCurrentSyncEngine();
          if (!engine) throw new PlainError('Sync is not running for this world right now. Close this, wait a moment, then try again.');
          await engine.resolveConflict(c.element_id, action);
          row.remove();
          this.conflicts = this.conflicts.filter((x) => x.element_id !== c.element_id);
          // Refresh local elements cache if local content changed.
          if (action === 'pull-theirs' || action === 'overwrite-mine') {
            try {
              const folder = getCurrentSyncFolder();
              if (folder) {
                patchElementsFrom(folder, await folder.listElements());
              }
            } catch (e) {
              console.warn('[conflict-modal] refresh-after-resolve failed:', e);
            }
          }
          // Refresh the badge count from sync-state so the pill updates
          // immediately. Without this, the badge stays at the old count
          // until the next engine state transition.
          await refreshConflictsCount();
          this.updateTitle();
          if (this.conflicts.length === 0) {
            this.toasts.success('All conflicts resolved');
            this.hide();
          }
        } catch (err) {
          row.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = false));
          // The row's buttons are live again: pressing one is the retry.
          console.error('[conflict-review] resolve failed:', err);
          showProblem(err, { doing: 'resolving the conflict', toasts: this.toasts });
          // A copy with no record of what OnlyWorlds held: the row may have taken the OnlyWorlds copy as
          // it is now (it changed while this was open, M6). Drawn again from what the engine holds.
          if (c.no_baseline) await this.redrawRow(row, c.element_id);
        }
      });
    });
  }

  private async redrawRow(row: HTMLElement, id: string): Promise<void> {
    try {
      const fresh = (await getCurrentSyncEngine()?.listConflicts())?.find((x) => x.element_id === id);
      if (!fresh || !row.isConnected) return;
      this.conflicts = this.conflicts.map((x) => (x.element_id === id ? fresh : x));
      row.replaceWith(this.renderRow(fresh));
    } catch {
      // The row stays as drawn; its buttons still work.
    }
  }

  private renderFooter(): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'atlas-conflict-footer';
    const close = document.createElement('button');
    close.className = 'atlas-btn-ghost';
    close.dataset.action = 'close';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.hide());
    footer.appendChild(close);
    return footer;
  }

  private updateTitle(): void {
    if (!this.modal) return;
    const title = this.modal.querySelector('.atlas-modal-title');
    const total = this.conflicts.length + this.metaConflicts.length;
    if (title) title.textContent = `${total} conflict${total === 1 ? '' : 's'} to review`;
  }
}

function lookupName(id: string): string | null {
  const el = getState().data.elements.find((e) => e.id === id);
  return el?.name ?? null;
}

/** The words a row for a copy with no record of what OnlyWorlds held opens with (conv. 192, S2). */
export const NO_BASELINE_LINE = 'This copy has no record of what OnlyWorlds held, so Atlas cannot tell which is newer.';

/** An unset value, the folder format's way: absent, null, an empty text or list. */
function unsetValue(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/** One side's value in words: names for linked elements this copy holds, text cut short. */
export function sideWord(v: unknown): string {
  if (unsetValue(v)) return 'empty';
  const one = (x: unknown): string => {
    if (typeof x === 'string') {
      const named = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x) ? lookupName(x) : null;
      const s = named && named.trim() ? named.trim() : x;
      return s.length > 120 ? `${s.slice(0, 117)}...` : s;
    }
    if (typeof x === 'number' || typeof x === 'boolean') return String(x);
    const s = JSON.stringify(x);
    return s.length > 120 ? `${s.slice(0, 117)}...` : s;
  };
  if (Array.isArray(v)) {
    const words = v.map(one).join(', ');
    return words.length > 160 ? `${words.slice(0, 157)}...` : words;
  }
  return one(v);
}

/**
 * The row for a copy with no record of what OnlyWorlds held (conv. 192): the line that says so, each
 * field that differs with both values, what Keep this copy leaves on OnlyWorlds (S3), and the two
 * choices by their plain names (S2). The copy's own values are read from the open world.
 */
export function noBaselineRowHtml(c: Conflict, name: string): string {
  const here = (getState().data.elements.find((e) => e.id === c.element_id) ?? {}) as Record<string, unknown>;
  const theirs = c.theirs ?? {};
  const sides = c.fields.map((f) => `
          <div class="atlas-conflict-side" data-field="${escapeText(f)}">
            <span class="atlas-conflict-side-field">${escapeText(f)}</span>
            <span class="atlas-conflict-side-here">Here: ${escapeText(sideWord(here[f]))}</span>
            <span class="atlas-conflict-side-theirs">On OnlyWorlds: ${escapeText(sideWord(theirs[f]))}</span>
          </div>`).join('');
  // A field this copy leaves empty keeps its OnlyWorlds value when this copy is kept (S3).
  const left = c.fields.filter((f) => unsetValue(here[f]) && !unsetValue(theirs[f]));
  const leftLine = left.length === 0 ? '' : `
        <span class="atlas-conflict-note" data-role="keeps-online">Keep this copy does not empty what this copy leaves empty: ${escapeText(left.join(', '))} ${left.length === 1 ? 'stays' : 'stay'} as OnlyWorlds has ${left.length === 1 ? 'it' : 'them'}.</span>`;
  const moved = c.changed_while_open ? `
        <span class="atlas-conflict-note" data-role="changed-while-open">It changed on OnlyWorlds while this was open: the OnlyWorlds side below is as it is now.</span>` : '';
  return `
      <div class="atlas-conflict-row-meta">
        <span class="atlas-conflict-type">${escapeText(typeName(c.type))}</span>
        <span class="atlas-conflict-name">${escapeText(name)}</span>
        <span class="atlas-conflict-fields" data-role="no-baseline-line">${escapeText(NO_BASELINE_LINE)}</span>${moved}
        <div class="atlas-conflict-sides" data-role="conflict-sides">${sides}
        </div>${leftLine}
      </div>
      <div class="atlas-conflict-row-actions">
        <button class="atlas-btn-ghost" data-action="overwrite-mine" title="Send this copy to OnlyWorlds">Keep this copy</button>
        <button class="atlas-btn-ghost" data-action="pull-theirs" title="Replace this copy with the one on OnlyWorlds">Keep the OnlyWorlds copy</button>
      </div>
    `;
}

/** A contested world key in words: the world's own words for the types, the world's strand, else the key. */
export function metaFieldWord(field: string): string {
  if (field === 'x_names') return "The world's words for the types";
  if (field === STRAND_KEY) return "The world's strand";
  return field;
}

/** The story a strand mark names, by name where this copy holds it. */
export function strandStoryWord(mark: unknown): string {
  const id = memberIds(mark).narrative;
  if (!id) return 'no strand';
  const name = lookupName(id);
  return name && name.trim() ? name.trim() : 'a story not in this copy';
}


