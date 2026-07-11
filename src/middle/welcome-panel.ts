/**
 * Middle pane: welcome / empty state.
 *
 * Three modes:
 * - No atlas root yet → "set up atlas folder" CTA (first launch).
 * - Atlas root set, no active world → "create or open a world" prompt.
 * - Active world  → "Welcome to {name}" with a few stats (placeholder until
 *   elements list lands in Phase 4).
 */

import { getState, subscribe } from '../core/state';
import { getActiveStore } from '../core/active-store';
import { setupAtlasRoot, recoverAtlasRoot } from '../setup/atlas-root-flow';
import { createSampleWorld, existingSampleWorld } from '../demo/sample-world';
import { toastManager } from '../ui/toast-manager';
import { navigate, timelineHash, homeHash } from '../core/router';
import { escapeText } from '../core/dom-utils';

/** "Explore the sample world" (D10) — shared by both no-world welcome states. */
function wireSampleButton(root: HTMLElement): void {
  const btn = root.querySelector<HTMLButtonElement>('[data-action="explore-sample"]');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const existing = existingSampleWorld();
    if (existing) {
      toastManager.info('The sample world already exists. Open it from the Worlds list.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Opening Sikelia…';
    try {
      const entry = await createSampleWorld();
      toastManager.success('Welcome to Sikelia. Poke anything, it\'s your copy.');
      navigate(homeHash(entry.id));
    } catch (err) {
      toastManager.error(err instanceof Error ? err.message : String(err));
      btn.disabled = false;
      btn.textContent = 'Explore the sample world';
    }
  });
}

export function mountWelcomePanel(target: HTMLElement): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-middle-body atlas-welcome';
  target.appendChild(root);

  async function render(): Promise<void> {
    const state = getState();
    const { active, atlasRoot, atlasRootRecoverable } = state;

    // Recoverable: vault has an orphan atlas-root handle (typically after a
    // localStorage clear). Surface a single restore button before falling
    // through to the standard first-launch CTA.
    if (!atlasRoot && atlasRootRecoverable) {
      root.innerHTML = `
        <header class="atlas-room-header"><h1>Welcome back</h1></header>
        <div class="atlas-welcome-empty">
          <p>Atlas detected a previously-set-up folder on this device: <code>${escapeText(atlasRootRecoverable.folderName)}</code>.</p>
          <p class="atlas-welcome-hint">Your worlds are still on disk. Click below to re-grant folder access and restore the world list.</p>
          <div class="atlas-welcome-actions">
            <button class="atlas-btn-primary" data-action="recover-atlas">Re-link atlas folder</button>
          </div>
        </div>
      `;
      const btn = root.querySelector<HTMLButtonElement>('[data-action="recover-atlas"]')!;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Re-linking…';
        try {
          const result = await recoverAtlasRoot();
          if (result) {
            toastManager.success(
              result.imported > 0
                ? `Re-linked atlas folder: restored ${result.imported} world${result.imported === 1 ? '' : 's'}`
                : 'Re-linked atlas folder (no worlds found inside)'
            );
          }
        } catch (err) {
          toastManager.error(err instanceof Error ? err.message : String(err));
        } finally {
          btn.disabled = false;
          btn.textContent = 'Re-link atlas folder';
        }
      });
      return;
    }

    // First-launch: no atlas folder yet.
    if (!atlasRoot) {
      root.innerHTML = `
        <header class="atlas-room-header"><h1>Welcome to Atlas</h1></header>
        <div class="atlas-welcome-empty">
          <p>Atlas keeps your worlds as folders on disk. One chosen folder holds all your worlds.</p>
          <p class="atlas-welcome-hint">Pick any folder; atlas creates an <code>onlyworlds-atlas/</code> subfolder inside it for your worlds. (If you pick a folder that's already an atlas root, atlas just re-uses it.)</p>
          <div class="atlas-welcome-actions">
            <button class="atlas-btn-primary" data-action="setup-atlas">Set up atlas folder</button>
            <button class="atlas-btn-ghost" data-action="explore-sample">Explore the sample world</button>
          </div>
          <p class="atlas-welcome-hint atlas-welcome-sample-hint">The sample opens instantly in browser storage, no folder needed.</p>
        </div>
      `;
      wireSampleButton(root);
      const btn = root.querySelector<HTMLButtonElement>('[data-action="setup-atlas"]')!;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Picking…';
        try {
          const result = await setupAtlasRoot();
          if (result) {
            toastManager.success(
              result.imported > 0
                ? `Atlas folder set up: found ${result.imported} existing world${result.imported === 1 ? '' : 's'}`
                : 'Atlas folder is set up'
            );
          }
        } catch (err) {
          toastManager.error(err instanceof Error ? err.message : String(err));
        } finally {
          btn.disabled = false;
          btn.textContent = 'Set up atlas folder';
        }
      });
      return;
    }

    // Atlas root set but no world active.
    if (!active) {
      root.innerHTML = `
        <header class="atlas-room-header"><h1>Atlas</h1></header>
        <div class="atlas-welcome-empty">
          <p>No world open.</p>
          <p class="atlas-welcome-hint">Use the sidebar to <strong>Create local</strong>, or pick an existing world from the list.</p>
          <p class="atlas-welcome-hint">Atlas folder: <code>${escapeText(atlasRoot.pathHint ?? atlasRoot.folderName)}</code></p>
          <div class="atlas-welcome-actions">
            <button class="atlas-btn-ghost" data-action="explore-sample">Explore the sample world</button>
          </div>
        </div>
      `;
      wireSampleButton(root);
      return;
    }
    // Stats from the active store, if open.
    const store = getActiveStore();
    let counts: { content: number; spatial: number } = { content: 0, spatial: 0 };
    if (store) {
      try {
        const all = await store.listElements();
        for (const e of all) {
          if (e.type === 'map' || e.type === 'pin' || e.type === 'zone' || e.type === 'marker') counts.spatial++;
          else counts.content++;
        }
      } catch (err) {
        console.warn('[welcome] listElements failed:', err);
      }
    }
    root.innerHTML = `
      <header class="atlas-room-header">
        <h1>${escapeText(active.meta.name || 'Untitled world')}</h1>
      </header>
      <div class="atlas-welcome-body">
        <p>${counts.content} content element${counts.content === 1 ? '' : 's'},
           ${counts.spatial} spatial element${counts.spatial === 1 ? '' : 's'}.</p>
        <div class="atlas-welcome-actions">
          <button class="atlas-btn-ghost" data-action="open-timeline">View timeline →</button>
        </div>
      </div>
    `;
    root.querySelector<HTMLButtonElement>('[data-action="open-timeline"]')?.addEventListener('click', () => {
      if (active) navigate(timelineHash(active.worldId));
    });
  }

  const unsub = subscribe(() => { render().catch(console.error); });
  render().catch(console.error);
  return unsub;
}


