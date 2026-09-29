/**
 * "Give them new ids" (S363): confirm, then a LOCKED run with progress.
 *
 * Locked because the run must own the world (re-key gate lens 1 F1, lens 3
 * F12): no outside click, no Escape, and (composition gate lens C F1) the app
 * behind the overlay goes `inert` for the run, so no keyboard focus reaches a
 * world row, a Settings button or a map while elements and their links move.
 * `rekey-run` also refuses a second run outright.
 */
import { BaseModal } from './modal-base';
import type { ToastManager } from './toast-manager';
import type { WorldRegistryEntry } from '../core/types';
import type { FolderStore } from '../store/folder-store';
import { getState } from '../core/state';
import { giveForeignElementsNewIds, RekeyRefusedError, elementsWord, willUploadNow } from '../sync/rekey-run';

/** The app behind every modal: made inert for the run, restored on every exit. */
function appRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.atlas-shell');
}

export class RekeyModal extends BaseModal {
  constructor(
    private readonly toasts: ToastManager,
    private readonly world: WorldRegistryEntry,
    private readonly store: FolderStore,
    private readonly count: number,
  ) {
    super();
  }

  /** Resolves true when ids changed, false when cancelled or refused. */
  open(): Promise<boolean> {
    const n = this.count;
    const one = n === 1;
    const uploads = willUploadNow(this.world.id);
    const { overlay, body } = this.buildModalShell({
      title: one ? 'Give 1 element a new id?' : `Give ${n} elements new ids?`,
      dataModal: 'rekey',
    });
    body.innerHTML = `
      <p data-role="rekey-body"></p>
      <div class="atlas-modal-progress" data-role="rekey-progress" hidden></div>
      <div class="atlas-modal-actions">
        <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
        <button type="button" class="atlas-btn-primary" data-action="rekey-confirm">Give new ids</button>
      </div>`;
    body.querySelector('[data-role="rekey-body"]')!.textContent =
      (one
        ? 'It gets a new id and every link to it follows. Its file gets a new name.'
        : 'Each gets a new id and every link to it follows. Their files get new names.')
      + (uploads ? (one ? ' Then it uploads.' : ' Then they upload.') : '');
    this.modal = overlay;
    this.show();

    const cancel = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const confirm = body.querySelector<HTMLButtonElement>('[data-action="rekey-confirm"]')!;
    const progress = body.querySelector<HTMLElement>('[data-role="rekey-progress"]')!;
    confirm.focus();

    return new Promise<boolean>(resolve => {
      let settled = false;
      const settle = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };
      const unlock = () => { appRoot()?.removeAttribute('inert'); };
      // Every close path settles (S361: a modal whose promise never resolves
      // strands its caller) and gives the app back.
      const observer = new MutationObserver(() => {
        if (!overlay.isConnected) { observer.disconnect(); unlock(); settle(false); }
      });
      observer.observe(document.body, { childList: true });
      cancel.addEventListener('click', () => { this.hide(); settle(false); });
      confirm.addEventListener('click', async () => {
        this.dismissLocked = true;
        appRoot()?.setAttribute('inert', '');
        cancel.disabled = true;
        confirm.disabled = true;
        progress.hidden = false;
        try {
          const result = await giveForeignElementsNewIds({
            store: this.store,
            entry: this.world,
            onStage: stage => {
              progress.textContent = stage === 'waiting' ? 'Waiting for sync to finish…' : 'Giving new ids…';
            },
            onProgress: (done, total) => { progress.textContent = `Giving new ids: ${done} of ${total}`; },
          });
          unlock();
          this.hide();
          settle(true);
          this.toasts.success(doneMessage(result.map.size, willUploadNow(this.world.id)));
          if (result.unrewritten.length > 0) {
            this.toasts.error(unrewrittenMessage(result.unrewritten), 10_000);
          }
        } catch (err) {
          unlock();
          this.dismissLocked = false;
          cancel.disabled = false;
          const refused = err instanceof RekeyRefusedError;
          if (!refused) console.error('[atlas:rekey] failed:', err);
          // Only a journal means something started (lens C F3): without one
          // the kernel wrote nothing, and "finish the update" would be false.
          const unfinished = !refused && await this.store.hasRekeyJournal().catch(() => false);
          progress.textContent = refused ? err.message
            : unfinished ? 'The ids could not all be updated, so this world is not syncing. Settings, under This world, can finish the update.'
            : 'The ids could not be updated. Nothing was changed.';
          cancel.focus();
        }
      });
    });
  }
}

export function doneMessage(n: number, uploads: boolean): string {
  const one = n === 1;
  const head = one ? '1 element has a new id.' : `${n} elements have new ids.`;
  const tail = uploads
    ? (one ? 'It is uploading.' : 'They are uploading.')
    : (one ? 'It uploads when this world syncs again.' : 'They upload when this world syncs again.');
  return `${head} ${tail}`;
}

export function unrewrittenMessage(ids: readonly string[]): string {
  const n = ids.length;
  const names = ids.slice(0, 3).map(id => getState().data.elements.find(e => e.id === id)?.name || id).join(', ');
  const more = n > 3 ? ` and ${n - 3} more` : '';
  return `${elementsWord(n)} could not be updated because ${n === 1 ? 'its file' : 'their files'} would not open (${names}${more}). Fix ${n === 1 ? 'it' : 'them'}, then use Update links in Settings.`;
}
