/**
 * Keep the tour world (1.17, contract §7; lane K §3; lens A A4, A5).
 *
 * The finale offers Keep this world · Save it to a folder (with the folder
 * picker) · Start fresh. Keep turns the sandbox into a world of the user's
 * own, in place: it already lives in the browser home (`browser-worlds/`), so
 * nothing moves. The order is the whole design, each step safe to crash after:
 *
 *   K0  the tour world open (`tour-engine.keepTourWorld` quiesced the tour)
 *   K1  every editor left: the world's home, then every pending save flushed
 *   K2  world.json loses `demo` FIRST: from here `tourFolderState` reads
 *       'kept', and boot's resume and every teardown finish the keep instead
 *       of revealing into it or deleting it
 *   K3  every bundle element gets a new id (journaled, resumable): the kept
 *       world shares none with the live demo world or a later tour (§7.4)
 *   K4  the commit (`commitTourKeep`): the registry entry loses `demo`, the
 *       tour ends
 *
 * A K3 refusal or failure stops before K4: the registry stays demo, the tour
 * stays at the finale, and Keep (or the next boot) tries again.
 */

import { getState, patchSlice } from '../core/state';
import { getActiveStore } from '../core/active-store';
import { navigate } from '../core/router';
import { flushBeforeLeavingWorld } from '../core/leave-flush';
import { isBrowserWorld } from '../core/browser-worlds';
import { PlainError } from '../core/plain-error';
import { escapeText } from '../core/dom-utils';
import { isZoneGestureActive } from '../core/zone-gesture';
import { hasPendingZoneEdit } from '../tabs/right/zone-edit-mode';
import type { WorldMeta, WorldRegistryEntry } from '../core/types';
import type { FolderStore } from '../store/folder-store';
import { BaseModal } from '../ui/modal-base';
import { commitTourKeep } from './tour-engine';

export type KeepOutcome =
  | { kind: 'kept'; entry: WorldRegistryEntry }
  | { kind: 'refused' }
  | { kind: 'gone' };

function isOpen(worldId: string): boolean {
  const active = getState().active;
  return active?.worldId === worldId && active.opened === true && getActiveStore() !== null;
}

/** One task later: a hash change's handler (the router, room unmounts) has run. */
const afterRoute = () => new Promise<void>(r => setTimeout(r, 0));

/**
 * K0's open, then K1-K4. Says every outcome itself (a toast), so the finale,
 * boot's resume and a teardown all speak the same sentences. `quiet` leaves
 * out the success toast (Save it to a folder says its own once the move ends).
 */
export async function keepTourWorldNow(worldId: string, opts: { quiet?: boolean } = {}): Promise<KeepOutcome> {
  const [{ toastManager }, { showProblem }] = await Promise.all([
    import('../ui/toast-manager'),
    import('../ui/problem-fixes'),
  ]);
  const entry = getState().registry.worlds.find(w => w.id === worldId && w.demo === true);
  if (!entry) return { kind: 'gone' };
  const name = entry.name || 'The tour world';
  const refuse = (err: unknown): KeepOutcome => {
    showProblem(err, { doing: 'keeping the tour world', worldId, toasts: toastManager });
    return { kind: 'refused' };
  };
  if (!isBrowserWorld(entry)) {
    return refuse(new PlainError(`${name} was made by an earlier version of Atlas and cannot be kept. Start fresh, then replay the tour to keep one.`));
  }
  // Checked before anything is written, so this refusal changes nothing.
  if (isZoneGestureActive() || hasPendingZoneEdit(worldId)) {
    return refuse(new PlainError(`Finish editing the zone first, then keep ${name}.`));
  }

  // K0: the tour world open (the user may have switched worlds at the finale,
  // or this is boot finishing a keep a closed tab began).
  if (!isOpen(worldId)) {
    const { activateWorld } = await import('../sidebar/worlds-sidebar');
    const opened = await activateWorld(worldId, toastManager);
    if (!opened || !isOpen(worldId)) {
      return refuse(new PlainError(`Atlas could not open ${name} to keep it. Close any other tab that has it open; Atlas tries again the next time it starts.`));
    }
  }
  const store = getActiveStore()!;

  // K1: no mounted editor may hold an id the re-key moves (store/rekey.ts).
  navigate(`#/w/${worldId}`);
  await afterRoute();
  await flushBeforeLeavingWorld();

  const bundle = await import('../demo/hyperion-world.json');
  const bundleIds = new Set((bundle.default as unknown as { elements: Array<{ id: string }> }).elements.map(e => e.id));
  // What K3 will move, read before K2: after a failure it tells "nothing
  // moved" from "everything moved" (S375 gate K2).
  const toMove = (await store.listElements()).map(e => e.id).filter(id => bundleIds.has(id));

  const modal = new KeepingModal(name);
  modal.open();
  let unrewritten: string[] = [];
  try {
    // K2. The return is the mirror (S361): never a re-listing, never a re-read.
    mirrorMeta(worldId, await store.writeWorldMeta({ demo: undefined }));
    // K3.
    const { giveTourWorldNewIds } = await import('../sync/rekey-run');
    const result = await giveTourWorldNewIds({ store, entry, bundleIds, onProgress: (done, total) => modal.progress(done, total) });
    unrewritten = result.unrewritten;
  } catch (err) {
    modal.close();
    console.warn('[tour] keep stopped before its commit:', err);
    const after = await afterFailedRekey(store, worldId, toMove);
    if (after === 'undone') return refuse(err);
    if (after === 'begun') {
      return refuse(new PlainError(`Keeping ${name} did not finish. Press Keep this world to try again; Atlas also finishes it the next time it starts.`));
    }
    // 'finished': every id moved and only what came after failed. The
    // world is consistent: commit it, with the screen reloaded from disk.
    patchSlice('data', { ...getState().data, elements: await store.listElements() });
  }
  modal.close();

  // K4.
  commitTourKeep(worldId);
  patchSlice('ui', { ...getState().ui, sidebarMode: 'elements' });
  if (!opts.quiet) toastManager.success(`${name} is yours now. It lives in this browser.`);
  if (unrewritten.length > 0) {
    const { unrewrittenMessage } = await import('../ui/rekey-modal');
    toastManager.error(unrewrittenMessage(unrewritten), 10_000);
  }
  return { kind: 'kept', entry: getState().registry.worlds.find(w => w.id === worldId) ?? entry };
}

function mirrorMeta(worldId: string, meta: WorldMeta): void {
  const active = getState().active;
  if (active?.worldId === worldId) patchSlice('active', { ...active, meta });
}

/**
 * Where a failed K3 left the world (S375 gate K2). A journal on disk: begun,
 * and resume, Keep or a teardown finishes it (world.json stays un-demoed, so
 * no step writes into it: `tourWorldIsActive`). No journal and every id still
 * there: nothing moved, so K2 is undone and the world is the sandbox again
 * (Start fresh deletes it, as its button says). No journal and none left: the
 * re-key finished and only what came after failed.
 */
async function afterFailedRekey(store: FolderStore, worldId: string, toMove: readonly string[]): Promise<'begun' | 'undone' | 'finished'> {
  try {
    if (await store.hasRekeyJournal()) return 'begun';
    const here = new Set((await store.listElements()).map(e => e.id));
    const left = toMove.filter(id => here.has(id)).length;
    if (left === 0 && toMove.length > 0) return 'finished';
    if (left < toMove.length) return 'begun';
    mirrorMeta(worldId, await store.writeWorldMeta({ demo: true }));
    return 'undone';
  } catch (err) {
    console.warn('[tour] could not read where the keep stopped:', err);
    return 'begun';
  }
}

/**
 * The finale's Save it to a folder (contract §7.5). The destination first,
 * inside the click (the picker and the permission prompt need its gesture; a
 * world folder is refused as a home; cancel changes nothing), then the keep in
 * full, then the §4 move with that home folder. A move that does not finish
 * leaves a kept world in this browser, and says so.
 */
export async function saveTourWorldToFolder(): Promise<boolean> {
  const [{ toastManager }, { readyHome, MoveBrowserWorldModal }, { keepTourWorld }] = await Promise.all([
    import('../ui/toast-manager'),
    import('../ui/move-browser-world-modal'),
    import('./tour-engine'),
  ]);
  const ready = await readyHome(toastManager);
  if (!ready) return false;
  const kept = await keepTourWorld({ quiet: true });
  if (kept.kind !== 'kept' || !kept.entry) return false;
  const name = kept.entry.name || 'The tour world';
  return new MoveBrowserWorldModal(kept.entry, toastManager).start(ready, {
    success: `${name} is yours now, in your OnlyWorlds folder.`,
    failed: `${name} is yours and lives in this browser; moving it to your folder did not finish. Settings, This world, can move it.`,
  });
}

/** "Keeping {name}": a locked dialog with the re-key's progress, no id jargon. */
class KeepingModal extends BaseModal {
  private line: HTMLElement | null = null;

  constructor(private readonly name: string) { super(); }

  open(): void {
    const { overlay, body } = this.buildModalShell({ title: `Keeping ${this.name}`, dataModal: 'keep-tour-world' });
    body.innerHTML = `
      <p class="atlas-modal-hint">Making ${escapeText(this.name)} a world of your own.</p>
      <div class="atlas-modal-progress" data-role="keep-progress"></div>`;
    this.line = body.querySelector<HTMLElement>('[data-role="keep-progress"]');
    this.dismissLocked = true;
    this.modal = overlay;
    this.show();
    document.querySelector<HTMLElement>('.atlas-shell')?.setAttribute('inert', '');
  }

  progress(done: number, total: number): void {
    if (this.line) this.line.textContent = `${done} of ${total}`;
  }

  close(): void {
    document.querySelector<HTMLElement>('.atlas-shell')?.removeAttribute('inert');
    this.dismissLocked = false;
    this.hide();
  }
}
