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
import { getActiveStore } from '../ui/create-world-modal';
import { setupAtlasRoot } from '../setup/atlas-root-flow';
import { toastManager } from '../ui/toast-manager';
import { navigate, timelineHash } from '../core/router';

export function mountWelcomePanel(target: HTMLElement): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-middle-body atlas-welcome';
  target.appendChild(root);

  async function render(): Promise<void> {
    const state = getState();
    const { active, atlasRoot } = state;

    // First-launch: no atlas folder yet.
    if (!atlasRoot) {
      root.innerHTML = `
        <header class="atlas-middle-header"><h2>Welcome to Atlas</h2></header>
        <div class="atlas-welcome-empty">
          <p>atlas keeps your worlds as folders on disk. one chosen folder holds all your worlds.</p>
          <p class="atlas-welcome-hint">pick any folder — atlas will create an <code>onlyworlds-atlas/</code> subfolder inside it for your worlds. (if you pick a folder that's already an atlas root, atlas just re-uses it.)</p>
          <div class="atlas-welcome-actions">
            <button class="ow-btn ow-btn-primary" data-action="setup-atlas">Set up atlas folder</button>
          </div>
        </div>
      `;
      const btn = root.querySelector<HTMLButtonElement>('[data-action="setup-atlas"]')!;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'picking…';
        try {
          const result = await setupAtlasRoot();
          if (result) {
            toastManager.success(
              result.imported > 0
                ? `atlas folder set up — found ${result.imported} existing world${result.imported === 1 ? '' : 's'}`
                : 'atlas folder is set up'
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
        <header class="atlas-middle-header"><h2>Atlas</h2></header>
        <div class="atlas-welcome-empty">
          <p>no world open.</p>
          <p class="atlas-welcome-hint">use the sidebar to <strong>create local</strong>, or pick an existing world from the list.</p>
          <p class="atlas-welcome-hint">atlas folder: <code>${escapeText(atlasRoot.pathHint ?? atlasRoot.folderName)}</code></p>
        </div>
      `;
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
      <header class="atlas-middle-header">
        <h2>${escapeText(active.meta.name || 'untitled world')}</h2>
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

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
