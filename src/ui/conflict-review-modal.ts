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

import { BaseModal } from './modal-base';
import { ToastManager } from './toast-manager';
import { getCurrentSyncEngine, getCurrentSyncFolder, refreshConflictsCount } from '../sync/sync-attach';
import { patchSlice, getState } from '../core/state';
import type { Conflict } from '../core/types';

export class ConflictReviewModal extends BaseModal {
  private conflicts: Conflict[] = [];

  constructor(private toasts: ToastManager) {
    super();
  }

  async open(): Promise<void> {
    const engine = getCurrentSyncEngine();
    if (!engine) {
      this.toasts.error('Engine not ready');
      return;
    }
    try {
      this.conflicts = await engine.listConflicts();
    } catch (err) {
      this.toasts.error(err instanceof Error ? err.message : String(err));
      return;
    }
    if (this.conflicts.length === 0) {
      this.toasts.info('No conflicts to review');
      return;
    }

    const { overlay, body } = this.buildModalShell({
      title: `${this.conflicts.length} conflict${this.conflicts.length === 1 ? '' : 's'} to review`,
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
    this.conflicts.forEach((c) => list.appendChild(this.renderRow(c)));
    return list;
  }

  private renderRow(c: Conflict): HTMLElement {
    const row = document.createElement('div');
    row.className = 'atlas-conflict-row';
    row.setAttribute('data-conflict-id', c.element_id);
    const name = lookupName(c.element_id) ?? '(unnamed)';
    row.innerHTML = `
      <div class="atlas-conflict-row-meta">
        <span class="atlas-conflict-type">${escapeText(c.type)}</span>
        <span class="atlas-conflict-name">${escapeText(name)}</span>
        <span class="atlas-conflict-fields">${c.fields.length} field${c.fields.length === 1 ? '' : 's'} diverged${c.fields.length ? `: ${c.fields.map(escapeText).join(', ')}` : ''}</span>
      </div>
      <div class="atlas-conflict-row-actions">
        <button class="atlas-btn-ghost" data-action="overwrite-mine" title="Push local content to server">Overwrite (mine wins)</button>
        <button class="atlas-btn-ghost" data-action="pull-theirs" title="Overwrite local with server">Pull (theirs wins)</button>
      </div>
    `;
    row.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action as 'overwrite-mine' | 'pull-theirs';
        row.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = true));
        try {
          const engine = getCurrentSyncEngine();
          if (!engine) throw new Error('Engine not ready');
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
          this.toasts.error(err instanceof Error ? err.message : String(err));
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
    if (title) title.textContent = `${this.conflicts.length} conflict${this.conflicts.length === 1 ? '' : 's'} to review`;
  }
}

function lookupName(id: string): string | null {
  const el = getState().data.elements.find((e) => e.id === id);
  return el?.name ?? null;
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
