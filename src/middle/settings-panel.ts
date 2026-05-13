/**
 * Settings panel — Phase 2 minimum.
 *
 * Two sections:
 * 1. Identity — global PIN + email (registry-level, persisted to localStorage).
 *    Used later by Make-Online (Route 1 needs email + PIN).
 * 2. Active world — read-only metadata for now (id, name, folder name, state).
 *    Plus "delete world" (registry only — folder is preserved on disk).
 *
 * Make-Online / Unlink actions arrive in Phase 3.
 */

import { getState, subscribe, patchSlice } from '../core/state';
import { saveRegistry, setPin, setEmail, deleteWorldEntry } from '../registry/registry';
import { deleteHandle } from '../store/handle-vault';
import { getActiveStore, setActiveStore } from '../ui/create-world-modal';
import { setupAtlasRoot } from '../setup/atlas-root-flow';
import { MakeOnlineModal } from '../ui/make-online-modal';
import { ToastManager } from '../ui/toast-manager';
import { navigate } from '../core/router';

export interface SettingsMount {
  target: HTMLElement;
  toasts: ToastManager;
}

export function mountSettingsPanel(mount: SettingsMount): () => void {
  const { target, toasts } = mount;
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-middle-body atlas-settings';
  target.appendChild(root);

  function render(): void {
    const state = getState();
    const reg = state.registry;
    const active = state.active
      ? state.registry.worlds.find(w => w.id === state.active!.worldId)
      : undefined;

    root.innerHTML = `
      <header class="atlas-middle-header">
        <h2>settings</h2>
      </header>
      <section class="atlas-settings-section">
        <h3>atlas folder</h3>
        <p class="atlas-settings-hint">where atlas keeps your worlds. new local worlds default here. changing this folder doesn't move existing worlds — they stay where they were created.</p>
        ${state.atlasRoot
          ? `<dl class="atlas-settings-meta">
              <dt>folder</dt><dd><code>${escapeText(state.atlasRoot.pathHint ?? state.atlasRoot.folderName)}</code></dd>
            </dl>
            <div class="atlas-settings-actions">
              <button class="ow-btn ow-btn-secondary" data-action="change-atlas-root">change folder</button>
            </div>`
          : `<p>not set up yet.</p>
             <div class="atlas-settings-actions">
               <button class="ow-btn ow-btn-primary" data-action="change-atlas-root">set up atlas folder</button>
             </div>`}
      </section>
      <section class="atlas-settings-section">
        <h3>identity</h3>
        <p class="atlas-settings-hint">global, used when creating or linking online worlds.</p>
        <label class="atlas-settings-field">
          <span>email</span>
          <input class="ow-input" type="email" name="email"
                 value="${escapeAttr(reg.email ?? '')}"
                 placeholder="you@example.com"
                 autocomplete="email" />
        </label>
        <label class="atlas-settings-field">
          <span>pin</span>
          <input class="ow-input" type="text" name="pin"
                 value="${escapeAttr(reg.pin ?? '')}"
                 placeholder="onlyworlds pin (4 digits)"
                 inputmode="numeric"
                 maxlength="4" />
        </label>
      </section>
      <section class="atlas-settings-section">
        <h3>active world</h3>
        ${active ? renderActiveWorld(active) : '<p>no world is active.</p>'}
      </section>
    `;

    // Wire inputs (debounced save to localStorage)
    const emailInput = root.querySelector<HTMLInputElement>('input[name="email"]')!;
    const pinInput = root.querySelector<HTMLInputElement>('input[name="pin"]')!;
    emailInput.addEventListener('change', () => {
      const next = setEmail(getState().registry, emailInput.value);
      saveRegistry(next);
      patchSlice('registry', next);
      toasts.info('email saved');
    });
    pinInput.addEventListener('change', () => {
      const next = setPin(getState().registry, pinInput.value);
      saveRegistry(next);
      patchSlice('registry', next);
      toasts.info('pin saved');
    });

    const changeRootBtn = root.querySelector<HTMLButtonElement>('[data-action="change-atlas-root"]');
    changeRootBtn?.addEventListener('click', async () => {
      changeRootBtn.disabled = true;
      try {
        const result = await setupAtlasRoot();
        if (result) {
          toasts.success(
            result.imported > 0
              ? `atlas folder updated — found ${result.imported} world${result.imported === 1 ? '' : 's'} there`
              : 'atlas folder updated'
          );
        }
      } catch (err) {
        toasts.error(err instanceof Error ? err.message : String(err));
      } finally {
        changeRootBtn.disabled = false;
      }
    });

    const makeOnlineBtn = root.querySelector<HTMLButtonElement>('[data-action="make-online"]');
    makeOnlineBtn?.addEventListener('click', () => new MakeOnlineModal(toasts).open());

    const deleteBtn = root.querySelector<HTMLButtonElement>('[data-action="delete-world"]');
    deleteBtn?.addEventListener('click', async () => {
      const target = active;
      if (!target) return;
      const ok = window.confirm(
        `remove "${target.name}" from atlas?\n\n` +
        `the folder on disk is NOT deleted — atlas just forgets about it. you can re-open the folder anytime to recover.`
      );
      if (!ok) return;
      const store = getActiveStore();
      if (store) await store.close().catch(() => {});
      setActiveStore(null);
      const next = deleteWorldEntry(getState().registry, target.id);
      saveRegistry(next);
      await deleteHandle(target.folder.handle_key).catch(() => {});
      patchSlice('registry', next);
      patchSlice('active', null);
      patchSlice('data', { elements: [] });
      patchSlice('ui', { ...getState().ui, selectedElementId: null });
      toasts.success(`forgot ${target.name}`);
      navigate('#/');
    });
  }

  const unsub = subscribe(render);
  render();
  return unsub;
}

function renderActiveWorld(world: import('../core/types').WorldRegistryEntry): string {
  const stateLabel = world.state === 'api-linked' ? 'api-linked' : 'local-only';
  const makeOnlineBtn = world.state === 'local-only'
    ? '<button class="ow-btn ow-btn-primary" data-action="make-online">make online</button>'
    : '';
  return `
    <dl class="atlas-settings-meta">
      <dt>name</dt><dd>${escapeText(world.name)}</dd>
      <dt>folder</dt><dd><code>${escapeText(world.folder.folder_name)}</code></dd>
      <dt>state</dt><dd>${stateLabel}</dd>
      <dt>id</dt><dd><code>${escapeText(world.id)}</code></dd>
    </dl>
    <div class="atlas-settings-actions">
      ${makeOnlineBtn}
      <button class="ow-btn ow-btn-secondary" data-action="delete-world">forget world (keep folder)</button>
    </div>
  `;
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}
