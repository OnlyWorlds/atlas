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
 * And the footer one for them all (#122): `Delete all locally` removes every
 * row's copy in one confirmed step. A copy holding edits never synced is
 * listed first and kept unless its box is ticked; each delete is guarded by
 * the stamp read when the modal opened, so a copy edited since is kept too.
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
import { showProblem } from './problem-fixes';
import { PlainError } from '../core/plain-error';
import type { ServerDeleteReviewRow } from '../core/types';
import { escapeText } from '../core/dom-utils';
import { getDiskNotice } from '../core/live-folder';

/**
 * The review's rows, edited copies first. An outside edit that kept its edit
 * time is "not synced" to the live folder (the sidebar says so) while its
 * stamps read clean: it counts as edited here too (S390 gate F2).
 */
function arrange(rows: ServerDeleteReviewRow[], worldId: string | null): ServerDeleteReviewRow[] {
  const notice = getDiskNotice();
  const outside = notice && notice.worldId === worldId ? notice.notSynced : null;
  const out = rows.map((r) => (outside?.has(r.id) && !r.unsynced ? { ...r, unsynced: true } : r));
  return out.sort((a, b) => Number(b.unsynced) - Number(a.unsynced));
}

export class ServerDeleteReviewModal extends BaseModal {
  private records: ServerDeleteReviewRow[] = [];
  /** Rows with unsynced edits the user ticked into the bulk delete. */
  private included = new Set<string>();
  /** True while the bulk delete runs: the rows' own buttons wait. */
  private bulkRunning = false;
  private footer: HTMLElement | null = null;
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
      this.records = await engine.reviewServerDeletes();
    } catch (err) {
      console.error('[server-delete] listing failed:', err);
      showProblem(err, { doing: 'reading the deletes from OnlyWorlds', toasts: this.toasts });
      return;
    }
    if (this.records.length === 0) {
      this.toasts.info('No server-side deletes to review');
      return;
    }
    // The copies with edits first: they are the ones that need a look.
    this.records = arrange(this.records, this.capturedWorldId);

    const { overlay, body } = this.buildModalShell({
      title: this.titleText(),
      panelClass: 'atlas-conflict-panel',
      dataModal: 'server-delete-review',
    });
    const hint = document.createElement('p');
    hint.className = 'atlas-conflict-hint';
    hint.textContent = 'Another tool or another Atlas deleted these on OnlyWorlds. Pick what to do with each.';
    body.appendChild(hint);

    body.appendChild(this.renderList());
    this.footer = document.createElement('div');
    this.footer.className = 'atlas-conflict-footer';
    body.appendChild(this.footer);
    this.renderFooter();

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

  private renderRow(r: ServerDeleteReviewRow): HTMLElement {
    const row = document.createElement('div');
    row.className = 'atlas-conflict-row';
    row.setAttribute('data-server-delete-id', r.id);
    if (r.unsynced) row.setAttribute('data-unsynced', '');
    row.innerHTML = `
      <div class="atlas-conflict-row-meta">
        <span class="atlas-conflict-type">${escapeText(r.type)}</span>
        <span class="atlas-conflict-name">${escapeText(r.name ?? '(unnamed)')}</span>
        <span class="atlas-conflict-fields">${r.unsynced ? 'Vanished from the server · edited here since the last sync' : 'Vanished from the server'}</span>
        ${r.unsynced ? '<label class="atlas-conflict-include"><input type="checkbox" data-role="include"> Include in Delete all</label>' : ''}
      </div>
      <div class="atlas-conflict-row-actions">
        <button class="atlas-btn-ghost" data-action="delete-locally" title="Remove this from local; matches the server">Delete locally</button>
        <button class="atlas-btn-ghost" data-action="keep" title="Keep it here; the next sync puts it back online">Keep + re-push</button>
      </div>
    `;
    const box = row.querySelector<HTMLInputElement>('input[data-role="include"]');
    box?.setAttribute('aria-label', `Include ${r.name ?? '(unnamed)'} in Delete all`);
    box?.addEventListener('change', (e) => {
      if (this.bulkRunning) return;
      if ((e.target as HTMLInputElement).checked) this.included.add(r.id);
      else this.included.delete(r.id);
      this.renderFooter();
    });
    row.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (this.bulkRunning) return;
        const action = btn.dataset.action as 'delete-locally' | 'keep';
        // World-switch guard: bail if active world changed since the modal
        // opened. Both actions are destructive/local; applying them to the
        // wrong world would surprise the user (and could lose data in the
        // "delete locally" case).
        if (!this.sameWorld()) return;
        row.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = true));
        try {
          const engine = getCurrentSyncEngine();
          if (!engine) throw new PlainError('Sync is not running for this world right now. Close this, wait a moment, then try again.');
          await engine.resolveServerDelete(r.id, action);
          this.dropRows([r.id]);
          // Refresh local elements cache — both actions changed local state.
          await this.refreshElements();
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
          // The row's buttons are live again: pressing one is the retry.
          console.error('[server-delete] resolve failed:', err);
          showProblem(err, { doing: 'resolving the delete', toasts: this.toasts });
        }
      });
    });
    return row;
  }

  /** The rows the bulk step would delete: every clean one, plus ticked ones. */
  private bulkRows(): ServerDeleteReviewRow[] {
    return this.records.filter((r) => !r.unsynced || this.included.has(r.id));
  }

  private renderFooter(confirming = false): void {
    const footer = this.footer;
    // A run owns the footer until it ends (S390 gate F3: a redraw mid-run
    // offered a second, concurrent Delete all).
    if (!footer || this.bulkRunning) return;
    // Focus that sat on a footer button follows the redraw instead of dropping to the page.
    const wasInFooter = footer.contains(document.activeElement);
    footer.replaceChildren();
    const rows = this.bulkRows();
    const n = rows.length;
    const copies = `${n} local cop${n === 1 ? 'y' : 'ies'}`;
    if (confirming) {
      const kept = this.records.length - n;
      const edited = rows.filter((r) => r.unsynced).length;
      const text = document.createElement('p');
      text.className = 'atlas-conflict-confirm';
      text.setAttribute('data-role', 'bulk-confirm-text');
      text.textContent = `Delete ${copies}? The server no longer has ${n === 1 ? 'it' : 'them'}, so there is no undo.`
        + (edited > 0 ? ` That includes ${edited} with edits made here.` : '')
        + (kept > 0 ? ` ${kept} with edits made here ${kept === 1 ? 'stays' : 'stay'}.` : '');
      const cancel = this.button('Cancel', 'bulk-cancel', 'atlas-btn-ghost');
      cancel.addEventListener('click', () => this.renderFooter());
      const go = this.button(`Delete ${n}`, 'bulk-confirm', 'atlas-btn-ghost atlas-btn-danger');
      go.addEventListener('click', () => void this.runBulk(rows));
      footer.append(text, cancel, go);
      cancel.focus();
      return;
    }
    const later = this.button('Review later', 'close', 'atlas-btn-ghost');
    later.addEventListener('click', () => this.hide());
    const all = this.button('Delete all locally', 'bulk-delete', 'atlas-btn-ghost atlas-btn-danger');
    all.disabled = n === 0;
    if (n === 0) all.title = 'Every copy left holds edits made here: tick one to include it';
    all.addEventListener('click', () => this.renderFooter(true));
    footer.append(later, all);
    if (wasInFooter && !all.disabled) all.focus();
  }

  private async runBulk(rows: ServerDeleteReviewRow[]): Promise<void> {
    if (!this.sameWorld()) return;
    this.bulkRunning = true;
    // The run's own buttons are the only way out until it ends.
    this.dismissLocked = true;
    this.modal?.querySelectorAll<HTMLButtonElement | HTMLInputElement>('.atlas-conflict-footer button, [data-role="server-delete-list"] button, [data-role="server-delete-list"] input')
      .forEach((b) => (b.disabled = true));
    let result: { deleted: string[]; kept: string[]; failed: string[] } | null = null;
    try {
      const engine = getCurrentSyncEngine();
      if (!engine) throw new PlainError('Sync is not running for this world right now. Close this, wait a moment, then try again.');
      result = await engine.deleteServerDeletesLocally(rows);
    } catch (err) {
      console.error('[server-delete] delete all failed:', err);
      showProblem(err, { doing: 'deleting the local copies', toasts: this.toasts });
    }
    this.bulkRunning = false;
    if (this.modal) this.dismissLocked = false;
    // Some may have gone before a failure: the review reads the truth again.
    await this.refreshElements();
    await this.reload();
    if (result) {
      const d = result.deleted.length;
      const k = result.kept.length;
      const f = result.failed.length;
      const parts = [
        ...(k > 0 ? [`${k} changed and ${k === 1 ? 'was' : 'were'} kept`] : []),
        ...(f > 0 ? [`${f} could not be deleted`] : []),
      ];
      const head = d > 0 ? `Deleted ${d} local cop${d === 1 ? 'y' : 'ies'}` : 'Nothing was deleted';
      const line = [head, ...parts].join('. ');
      if (d > 0 && f === 0) this.toasts.success(line);
      else this.toasts.info(line);
    }
    if (this.modal && this.records.length === 0) this.hide();
  }

  /** Re-read the rows after a bulk step: deleted ones go, the rest stay with fresh stamps. */
  private async reload(): Promise<void> {
    const engine = getCurrentSyncEngine();
    if (!engine || !this.modal) return;
    // Never show another world's rows in this world's dialog (S390 gate F7).
    if (getState().active?.worldId !== this.capturedWorldId) {
      this.hide();
      return;
    }
    try {
      this.records = arrange(await engine.reviewServerDeletes(), this.capturedWorldId);
      const fresh = this.records;
      const ids = new Set(fresh.map((r) => r.id));
      for (const id of [...this.included]) if (!ids.has(id)) this.included.delete(id);
      this.modal.querySelector('[data-role="server-delete-list"]')?.replaceWith(this.renderList());
      // A ticked box survives the redraw.
      this.included.forEach((id) => {
        const box = this.modal?.querySelector<HTMLInputElement>(`[data-server-delete-id="${CSS.escape(id)}"] input[data-role="include"]`);
        if (box) box.checked = true;
      });
    } catch (err) {
      console.warn('[server-delete-modal] reload failed:', err);
    }
    this.updateTitle();
    this.renderFooter();
  }

  private dropRows(ids: string[]): void {
    const gone = new Set(ids);
    this.records = this.records.filter((x) => !gone.has(x.id));
    ids.forEach((id) => {
      this.included.delete(id);
      this.modal?.querySelector(`[data-server-delete-id="${CSS.escape(id)}"]`)?.remove();
    });
    this.updateTitle();
    this.renderFooter();
  }

  private sameWorld(): boolean {
    if (getState().active?.worldId === this.capturedWorldId) return true;
    this.toasts.info('Another world is open now. Switch back to review.');
    this.hide();
    return false;
  }

  private async refreshElements(): Promise<void> {
    try {
      const folder = getCurrentSyncFolder();
      if (folder) {
        const elements = await folder.listElements();
        patchSlice('data', { elements });
      }
    } catch (e) {
      console.warn('[server-delete-modal] refresh failed:', e);
    }
  }

  private button(label: string, action: string, cls: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = cls;
    b.dataset.action = action;
    b.textContent = label;
    return b;
  }

  private titleText(): string {
    return `${this.records.length} server-side delete${this.records.length === 1 ? '' : 's'} detected`;
  }

  private updateTitle(): void {
    if (!this.modal) return;
    const title = this.modal.querySelector('.atlas-modal-title');
    if (title) title.textContent = this.titleText();
  }
}


