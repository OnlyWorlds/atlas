/**
 * Worlds sidebar — Phase 2 minimum.
 *
 * Lists the registry. Clicking a world activates it (re-grants FS permission,
 * opens the FolderStore). "+ Create Local" launches the create-world modal.
 * Settings gear at the bottom routes to the settings panel for the active world.
 */

import { getState, subscribe } from '../core/state';
import { onHashChange, parseHash, navigate, worldHash, settingsHash } from '../core/router';
import { setActiveWorld, saveRegistry } from '../registry/registry';
import { loadHandle, ensureWritable } from '../store/handle-vault';
import { FsFolderStore } from '../store/folder-store-fs';
import { patchSlice } from '../core/state';
import { setActiveStore, getActiveStore, CreateWorldModal } from '../ui/create-world-modal';
import { setupAtlasRoot } from '../setup/atlas-root-flow';
import { ToastManager } from '../ui/toast-manager';
import type { WorldRegistryEntry } from '../core/types';

export interface WorldsSidebarMount {
  content: HTMLElement;
  footer: HTMLElement;
  toasts: ToastManager;
}

export function mountWorldsSidebar(mount: WorldsSidebarMount): () => void {
  const { content, footer, toasts } = mount;
  content.innerHTML = '';
  footer.innerHTML = '';

  // Header — switches between "set up atlas" and "create local" depending on root state.
  const header = document.createElement('div');
  header.className = 'atlas-sidebar-section atlas-worlds-header';
  content.appendChild(header);

  function renderHeader(): void {
    const root = getState().atlasRoot;
    header.innerHTML = root
      ? `
        <div class="atlas-sidebar-title">worlds</div>
        <button class="ow-btn ow-btn-secondary atlas-sidebar-action" data-action="create-local">
          <span class="material-symbols-outlined">add</span> create local
        </button>
      `
      : `
        <div class="atlas-sidebar-title">setup</div>
        <button class="ow-btn ow-btn-primary atlas-sidebar-action" data-action="setup-atlas">
          <span class="material-symbols-outlined">folder_open</span> set up atlas
        </button>
      `;
    const createBtn = header.querySelector<HTMLButtonElement>('[data-action="create-local"]');
    createBtn?.addEventListener('click', () => new CreateWorldModal(toasts).open());
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
  listEl.className = 'atlas-worlds-list';
  content.appendChild(listEl);

  // Footer: settings gear
  const gear = document.createElement('button');
  gear.className = 'atlas-icon-btn';
  gear.setAttribute('data-action', 'open-settings');
  gear.setAttribute('aria-label', 'settings');
  gear.innerHTML = '<span class="material-symbols-outlined">settings</span>';
  footer.appendChild(gear);

  gear.addEventListener('click', () => {
    const active = getState().active;
    navigate(settingsHash(active?.worldId ?? null));
  });

  // Click delegation for the list (event bubbling so we don't re-bind per row)
  listEl.addEventListener('click', async (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-world-id]');
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
        ? `<div class="atlas-worlds-empty">no worlds yet — create one to start.</div>`
        : `<div class="atlas-worlds-empty">set up your atlas folder above to begin.</div>`;
      return;
    }

    listEl.innerHTML = worlds
      .map(w => renderRow(w, w.id === activeId, route.mode === 'settings' && w.id === activeId))
      .join('');
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();
  return () => { unsubState(); unsubHash(); };
}

function renderRow(world: WorldRegistryEntry, active: boolean, settingsActive: boolean): string {
  const stateBadge = world.state === 'api-linked'
    ? '<span class="atlas-world-badge" data-state="api">api</span>'
    : '<span class="atlas-world-badge" data-state="local">local</span>';
  const cls = [
    'atlas-world-row',
    active ? 'is-active' : '',
    settingsActive ? 'is-settings' : '',
  ].filter(Boolean).join(' ');
  return `
    <div class="${cls}" data-world-id="${escapeAttr(world.id)}" role="button" tabindex="0">
      <div class="atlas-world-name">${escapeText(world.name)}</div>
      <div class="atlas-world-meta">${stateBadge}</div>
    </div>
  `;
}

/**
 * Activate (or re-activate) a world by id: recall its FS handle from the vault,
 * re-grant write permission, open the FolderStore, push state.
 */
export async function activateWorld(worldId: string, toasts: ToastManager): Promise<void> {
  const state = getState();
  const entry = state.registry.worlds.find(w => w.id === worldId);
  if (!entry) {
    toasts.error(`world ${worldId} not found in registry`);
    return;
  }
  // Already active? Just navigate.
  if (state.active?.worldId === worldId) {
    navigate(worldHash(worldId));
    return;
  }

  const handle = await loadHandle(entry.folder.handle_key);
  if (!handle) {
    toasts.error(`folder handle missing for ${entry.name}. delete + recreate to recover.`);
    return;
  }
  const granted = await ensureWritable(handle);
  if (!granted) {
    toasts.error(`folder permission denied for ${entry.name}`);
    return;
  }

  // Close prior active store if any.
  const prior = getActiveStore();
  if (prior) await prior.close().catch(() => {});

  const store = new FsFolderStore();
  await store.open(handle);
  const meta = await store.readWorldMeta();
  setActiveStore(store);

  const nextRegistry = setActiveWorld(state.registry, worldId);
  saveRegistry(nextRegistry);
  patchSlice('registry', nextRegistry);
  patchSlice('active', { worldId, meta, opened: true });
  navigate(worldHash(worldId));
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
