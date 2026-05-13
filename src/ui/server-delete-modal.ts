/**
 * Server-Delete Review Modal — per-row resolution for elements that vanished
 * from the API since the last sync (Phase 3.5+).
 *
 * Each row offers two actions:
 *   - `delete locally` — silently remove the local file (no tombstone, the
 *     server already deleted it).
 *   - `keep + re-push` — clear server baseline; next push re-creates the
 *     element on the server.
 *
 * Opens automatically after pull when `registry.sync_confirm_server_deletes`
 * is true (default). Can also be opened manually from the world settings tab
 * (future bout) or the pill badge.
 */

import { BaseModal } from './modal-base';
import { ToastManager } from './toast-manager';
import { getCurrentSyncEngine, getCurrentSyncFolder } from '../sync/sync-attach';
import { patchSlice } from '../core/state';
import type { ServerDeleteRecord } from '../core/types';

export class ServerDeleteReviewModal extends BaseModal {
  private records: ServerDeleteRecord[] = [];

  constructor(private toasts: ToastManager) {
    super();
  }

  async open(): Promise<void> {
    const engine = getCurrentSyncEngine();
    if (!engine) {
      this.toasts.error('engine not ready');
      return;
    }
    try {
      this.records = await engine.listServerDeletes();
    } catch (err) {
      this.toasts.error(err instanceof Error ? err.message : String(err));
      return;
    }
    if (this.records.length === 0) {
      this.toasts.info('no server-side deletes to review');
      return;
    }

    const { overlay, body } = this.buildModalShell({
      title: `${this.records.length} server-side delete${this.records.length === 1 ? '' : 's'} detected`,
      panelClass: 'atlas-conflict-panel',
      dataModal: 'server-delete-review',
    });
    const hint = document.createElement('p');
    hint.className = 'atlas-conflict-hint';
    hint.textContent = 'these elements were deleted on the server (web app, another atlas, etc.). pick what to do with each.';
    body.appendChild(hint);

    body.appendChild(this.renderList());
    body.appendChild(this.renderFooter());

    this.modal = overlay;
    this.show();
  }

  private renderList(): HTMLElement {
    const list = document.createElement('div');
    list.className = 'atlas-conflict-list';
    list.setAttribute('data-role', 'server-delete-list');
    this.records.forEach((r) => list.appendChild(this.renderRow(r)));
    return list;
  }

  private renderRow(r: ServerDeleteRecord): HTMLElement {
    const row = document.createElement('div');
    row.className = 'atlas-conflict-row';
    row.setAttribute('data-server-delete-id', r.id);
    row.innerHTML = `
      <div class="atlas-conflict-row-meta">
        <span class="atlas-conflict-type">${escapeText(r.type)}</span>
        <span class="atlas-conflict-name">${escapeText(r.name ?? '(unnamed)')}</span>
        <span class="atlas-conflict-fields">vanished from the server</span>
      </div>
      <div class="atlas-conflict-row-actions">
        <button class="ow-btn atlas-btn-ghost" data-action="delete-locally" title="remove this from local; matches the server">delete locally</button>
        <button class="ow-btn atlas-btn-ghost" data-action="keep" title="keep locally; next push re-creates on server">keep + re-push</button>
      </div>
    `;
    row.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action as 'delete-locally' | 'keep';
        row.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = true));
        try {
          const engine = getCurrentSyncEngine();
          if (!engine) throw new Error('engine not ready');
          await engine.resolveServerDelete(r.id, action);
          row.remove();
          this.records = this.records.filter((x) => x.id !== r.id);
          // Refresh local elements cache — both actions changed local state.
          try {
            const folder = getCurrentSyncFolder();
            if (folder) {
              const elements = await folder.listElements();
              patchSlice('data', { elements });
            }
          } catch (e) {
            console.warn('[server-delete-modal] refresh failed:', e);
          }
          this.updateTitle();
          if (this.records.length === 0) {
            this.toasts.success('all server-side deletes resolved');
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
    close.className = 'ow-btn atlas-btn-ghost';
    close.dataset.action = 'close';
    close.textContent = 'review later';
    close.addEventListener('click', () => this.hide());
    footer.appendChild(close);
    return footer;
  }

  private updateTitle(): void {
    if (!this.modal) return;
    const title = this.modal.querySelector('.atlas-modal-title');
    if (title) title.textContent = `${this.records.length} server-side delete${this.records.length === 1 ? '' : 's'} detected`;
  }
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
