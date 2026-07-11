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
import { toastManager } from '../ui/toast-manager';
import { navigate, timelineHash } from '../core/router';
import { escapeText } from '../core/dom-utils';

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

    // First-launch: no atlas folder yet. This page is the product's first
    // impression: the story first, one primary action, the demo as a quiet
    // side door (session 254 — the old version read as a storage dialog).
    if (!atlasRoot) {
      root.innerHTML = `
        <header class="atlas-room-header"><h1>Welcome to Atlas</h1></header>
        <div class="atlas-welcome-empty">
          <p class="atlas-welcome-lead">Atlas is a free, local worldbuilding studio.</p>
          <ul class="atlas-welcome-beats">
            <li>Build your world as linked elements: characters, places, events, and 19 more types you can browse, filter, and edit.</li>
            <li>Work it from every angle: maps with pins and zones, long-form writing, timelines, who-knows-what tracking.</li>
            <li>Everything lives as plain files in a folder you own. Online sync and publishing are there when you want them; never required.</li>
          </ul>
          <div class="atlas-welcome-actions">
            <button class="atlas-btn-primary" data-action="setup-atlas">Set up your atlas folder</button>
          </div>
          <p class="atlas-welcome-hint">Setup is one folder pick. Atlas creates an <code>onlyworlds-atlas/</code> subfolder inside it and keeps every world there; picking an existing atlas folder re-links it.</p>
          <p class="atlas-welcome-hint atlas-welcome-sample-hint">Want to see a finished world first? <a href="#/demo" class="atlas-welcome-demo-link">Look around the sample world</a> · view only, nothing is stored.</p>
        </div>
      `;
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
          <p class="atlas-welcome-hint atlas-welcome-sample-hint"><a href="#/demo" class="atlas-welcome-demo-link">Look around the sample world</a> · view only</p>
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


