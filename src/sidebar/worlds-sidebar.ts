/**
 * Worlds-mode sidebar body.
 *
 * Lists the registry. Clicking a world activates it (re-grants FS permission,
 * opens the FolderStore). "+ Create Local" launches the create-world modal.
 *
 * Body-only — the parent sidebar driver owns the mode toggle (in shell.sidebarToggle)
 * and the footer gear (in shell.sidebarFooter).
 */

import { getState, subscribe, patchSlice } from '../core/state';
import { onHashChange, parseHash, navigate, elementsHash } from '../core/router';
import { setActiveWorld, saveRegistry, setFavorite } from '../registry/registry';
import { loadHandle, ensureWritable, queryWritable } from '../store/handle-vault';
import { FsFolderStore } from '../store/folder-store-fs';
import { setActiveStore, getActiveStore, CreateWorldModal } from '../ui/create-world-modal';
import { LinkWorldModal } from '../ui/link-world-modal';
import { setupAtlasRoot } from '../setup/atlas-root-flow';
import { attachSyncEngine } from '../sync/sync-attach';
import { resetElementDetailScrollMemory } from '../middle/element-detail';
import { ToastManager } from '../ui/toast-manager';
import type { WorldRegistryEntry } from '../core/types';

export interface WorldsBodyMount {
  content: HTMLElement;
  toasts: ToastManager;
}

export function mountWorldsBody(mount: WorldsBodyMount): () => void {
  const { content, toasts } = mount;
  content.innerHTML = '';

  // Header — switches between "set up atlas" and "create local" depending on root state.
  const header = document.createElement('div');
  header.className = 'atlas-section atlas-worlds-header';
  content.appendChild(header);

  function renderHeader(): void {
    const root = getState().atlasRoot;
    header.innerHTML = root
      ? `
        <button class="atlas-btn-ghost" data-action="create-local" title="create a new world in your atlas folder">+ new local</button>
        <button class="atlas-btn-ghost" data-action="link-api" title="download an existing OnlyWorlds api world into atlas">+ link api</button>
      `
      : `
        <button class="atlas-btn-ghost" data-action="setup-atlas" title="pick the folder atlas will use for all your worlds">+ set up atlas</button>
      `;
    const createBtn = header.querySelector<HTMLButtonElement>('[data-action="create-local"]');
    createBtn?.addEventListener('click', () => new CreateWorldModal(toasts).open());
    const linkBtn = header.querySelector<HTMLButtonElement>('[data-action="link-api"]');
    linkBtn?.addEventListener('click', () => new LinkWorldModal(toasts).open());
    const setupBtn = header.querySelector<HTMLButtonElement>('[data-action="setup-atlas"]');
    setupBtn?.addEventListener('click', async () => {
      setupBtn.disabled = true;
      try {
        const result = await setupAtlasRoot();
        if (result) {
          toasts.success(
            result.imported > 0
              ? `atlas folder set up — found ${result.imported} existing world${result.imported === 1 ? '' : 's'}`
              : 'atlas folder is set up'
          );
        }
      } catch (err) {
        toasts.error(err instanceof Error ? err.message : String(err));
      } finally {
        setupBtn.disabled = false;
      }
    });
  }

  // List body
  const listEl = document.createElement('div');
  listEl.className = 'atlas-list';
  content.appendChild(listEl);

  // Click delegation — separate the favorite-toggle from the row click.
  listEl.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const favBtn = target.closest<HTMLElement>('[data-role="fav-toggle"]');
    if (favBtn) {
      e.stopPropagation();
      const worldId = favBtn.getAttribute('data-world-id')!;
      const reg = getState().registry;
      const entry = reg.worlds.find(w => w.id === worldId);
      if (!entry) return;
      const next = setFavorite(reg, worldId, !entry.favorite);
      saveRegistry(next);
      patchSlice('registry', next);
      return;
    }
    const row = target.closest<HTMLElement>('[data-world-id]');
    if (!row) return;
    const worldId = row.getAttribute('data-world-id')!;
    await activateWorld(worldId, toasts);
  });

  function render(): void {
    renderHeader();
    const state = getState();
    const route = parseHash(window.location.hash);
    const activeId = state.active?.worldId;
    const worlds = state.registry.worlds;

    if (worlds.length === 0) {
      listEl.innerHTML = state.atlasRoot
        ? `<div class="atlas-pane-empty">no worlds yet — create one to start.</div>`
        : `<div class="atlas-pane-empty">set up your atlas folder above to begin.</div>`;
      return;
    }

    // Favorites first, then alphabetical.
    const sorted = [...worlds].sort((a, b) => {
      const fa = a.favorite ? 1 : 0;
      const fb = b.favorite ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });
    listEl.innerHTML = sorted
      .map(w => renderRow(w, w.id === activeId, route.mode === 'settings' && w.id === activeId))
      .join('');
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();
  return () => { unsubState(); unsubHash(); };
}

function renderRow(world: WorldRegistryEntry, active: boolean, _settingsActive: boolean): string {
  const stateIcon = world.state === 'api-linked' ? 'cloud' : 'folder';
  const stateChip = world.state === 'api-linked'
    ? '<span class="atlas-world-state-chip api-linked">api</span>'
    : '';
  const favIcon = world.favorite ? 'star' : 'star_border';
  const favCls = world.favorite ? 'is-fav' : '';
  const cls = ['atlas-row', active ? 'selected' : ''].filter(Boolean).join(' ');
  return `
    <div class="${cls}" data-world-id="${escapeAttr(world.id)}" role="button" tabindex="0">
      <span class="material-symbols-outlined">${stateIcon}</span>
      <span class="atlas-row-main">${escapeText(world.name)}</span>
      ${stateChip}
      <span class="atlas-inline-actions">
        <button type="button" class="atlas-icon-btn-sm fav-btn ${favCls}" data-role="fav-toggle" data-world-id="${escapeAttr(world.id)}" title="${world.favorite ? 'unfavorite' : 'favorite'}">
          <span class="material-symbols-outlined">${favIcon}</span>
        </button>
      </span>
    </div>
  `;
}

export interface ActivateWorldOpts {
  /** No toasts on failure paths. Useful for silent boot-time auto-activation. */
  silent?: boolean;
  /** Keep `selectedElementId` as-is (so a URL like /element/<eid> survives activation). Default false. */
  preserveSelection?: boolean;
  /**
   * `request` (default) calls `requestPermission` — needs a user gesture, throws/returns false otherwise.
   * `query` calls `queryPermission` only — silent, used at boot when no gesture is available.
   */
  permissionMode?: 'request' | 'query';
}

/**
 * Activate (or re-activate) a world by id: recall its FS handle from the vault,
 * re-grant write permission, open the FolderStore, push state. Also primes the
 * `data.elements` cache from the newly-opened folder.
 *
 * Returns true on success. Returns false silently if the silent/query path
 * couldn't acquire permission — caller decides what to surface.
 *
 * Navigation behavior on success:
 * - If the current URL already names this world (e.g. user reloaded into a deep
 *   `/element/<eid>` URL), the URL is preserved and a hashchange is fired so
 *   subscribers re-resolve.
 * - Otherwise, navigates to `elementsHash(worldId)` for legacy parity (clicking
 *   a world drops the user into elements mode, not the welcome panel).
 */
export async function activateWorld(
  worldId: string,
  toasts: ToastManager,
  opts: ActivateWorldOpts = {}
): Promise<boolean> {
  const { silent = false, preserveSelection = false, permissionMode = 'request' } = opts;
  const state = getState();
  const entry = state.registry.worlds.find(w => w.id === worldId);
  if (!entry) {
    if (!silent) toasts.error(`world ${worldId} not found in registry`);
    return false;
  }
  // Already active? Just navigate (still respect deep URL).
  if (state.active?.worldId === worldId) {
    navigateAfterActivate(worldId);
    return true;
  }

  const handle = await loadHandle(entry.folder.handle_key);
  if (!handle) {
    if (!silent) toasts.error(`folder handle missing for ${entry.name}. delete + recreate to recover.`);
    return false;
  }
  const granted = permissionMode === 'query'
    ? await queryWritable(handle)
    : await ensureWritable(handle);
  if (!granted) {
    if (!silent) toasts.error(`folder permission denied for ${entry.name}`);
    return false;
  }

  // Close prior active store if any.
  const prior = getActiveStore();
  if (prior) await prior.close().catch(() => {});
  // World switch: drop scroll memory so stale element ids from the previous
  // world don't survive into this one.
  resetElementDetailScrollMemory();

  const store = new FsFolderStore();
  await store.open(handle);
  const meta = await store.readWorldMeta();
  setActiveStore(store);

  const nextRegistry = setActiveWorld(state.registry, worldId);
  saveRegistry(nextRegistry);
  patchSlice('registry', nextRegistry);
  patchSlice('active', { worldId, meta, opened: true });

  // Prime the elements cache for this world.
  try {
    const elements = await store.listElements();
    patchSlice('data', { elements });
  } catch (err) {
    console.warn('[worlds-sidebar] failed to prime elements:', err);
    patchSlice('data', { elements: [] });
  }
  // Reset selection unless caller asked us to preserve it (URL-driven restore).
  if (!preserveSelection) {
    patchSlice('ui', { ...getState().ui, selectedElementId: null });
  }

  // Attach SyncEngine if this world is api-linked. Auto-detaches the previous
  // world's engine. For local-only worlds this is a no-op (returns null).
  attachSyncEngine(entry, store);

  navigateAfterActivate(worldId);
  return true;
}

/**
 * Honor the existing deep URL if it already names this world; otherwise land
 * on elements mode (legacy click→elements behavior).
 */
function navigateAfterActivate(worldId: string): void {
  const route = parseHash(window.location.hash);
  if (route.worldId === worldId) {
    // URL is already on this world (possibly deep route) — re-fire hashchange.
    navigate(window.location.hash);
  } else {
    navigate(elementsHash(worldId));
  }
}

// ---- Escapes ----

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}
