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
import { patchSlice, getState } from '../core/state';
import { surfaceSyncUnavailable } from './sync-toasts';
import type { ServerDeleteRecord } from '../core/types';

export class ServerDeleteReviewModal extends BaseModal {
  private records: ServerDeleteRecord[] = [];
  /**
   * worldId at modal open time. Validated before each resolve so a mid-modal
   * world switch can't apply destructive actions to a different world.
   * (SYNC_NOTES M5.)
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
      this.records = await engine.listServerDeletes();
    } catch (err) {
      this.toasts.error(err instanceof Error ? err.message : String(err));
      return;
    }
    if (this.records.length === 0) {
      this.toasts.info('No server-side deletes to review');
      return;
    }

    const { overlay, body } = this.buildModalShell({
      title: `${this.records.length} server-side delete${this.records.length === 1 ? '' : 's'} detected`,
      panelClass: 'atlas-conflict-panel',
      dataModal: 'server-delete-review',
    });
    const hint = document.createElement('p');
    hint.className = 'atlas-conflict-hint';
    hint.textContent = 'These elements were deleted on the server (web app, another atlas, etc.). Pick what to do with each.';
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
        <span class="atlas-conflict-fields">Vanished from the server</span>
      </div>
      <div class="atlas-conflict-row-actions">
        <button class="atlas-btn-ghost" data-action="delete-locally" title="Remove this from local; matches the server">Delete locally</button>
        <button class="atlas-btn-ghost" data-action="keep" title="Keep locally; next push re-creates on server">Keep + re-push</button>
      </div>
    `;
    row.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action as 'delete-locally' | 'keep';
        // World-switch guard: bail if active world changed since the modal
        // opened. Both actions are destructive/local; applying them to the
        // wrong world would surprise the user (and could lose data in the
        // "delete locally" case).
        if (getState().active?.worldId !== this.capturedWorldId) {
          this.toasts.info('World changed — close and reopen to review');
          this.hide();
          return;
        }
        row.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = true));
        try {
          const engine = getCurrentSyncEngine();
          if (!engine) throw new Error('Engine not ready');
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
          if (action === 'keep') {
            // User said "keep" — push immediately so the element actually
            // re-lands on the server. Without this, the cleared baseline just
            // sits until the next folder write triggers an autosave, which
            // could be never. Fire-and-forget: the engine's onSyncResult /
            // toast paths surface the result; if the in-flight lock is busy,
            // pushOnce shares the existing promise (no-op-safe).
            const eng = getCurrentSyncEngine();
            if (eng) {
              void eng.pushOnce().catch((e) => {
                console.warn('[server-delete-modal] keep+push failed:', e);
              });
            }
          }
          if (this.records.length === 0) {
            this.toasts.success('All server-side deletes resolved');
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
    close.textContent = 'Review later';
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
