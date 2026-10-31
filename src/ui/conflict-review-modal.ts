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

import { typeName } from '../core/type-words';
import { BaseModal } from './modal-base';
import { ToastManager } from './toast-manager';
import { getCurrentSyncEngine, getCurrentSyncFolder, refreshConflictsCount, refreshMetaCacheNow } from '../sync/sync-attach';
import { surfaceSyncUnavailable } from './sync-toasts';
import { showProblem } from './problem-fixes';
import { PlainError } from '../core/plain-error';
import { patchSlice, getState } from '../core/state';
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
    const name = lookupName(c.element_id) ?? '(unnamed)';
    row.innerHTML = `
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
                const elements = await folder.listElements();
                patchSlice('data', { elements });
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
        }
      });
    });
    return row;
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


