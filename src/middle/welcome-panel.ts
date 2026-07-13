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

  // Active listener for the grounded state's sidebar-hover detail zone;
  // re-renders replace it, unmount clears it.
  let hoverCleanup: (() => void) | null = null;

  async function render(): Promise<void> {
    hoverCleanup?.();
    hoverCleanup = null;
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
            <button class="atlas-btn-primary" data-action="recover-atlas">Re-link OnlyWorlds folder</button>
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
                ? `Re-linked OnlyWorlds folder: restored ${result.imported} world${result.imported === 1 ? '' : 's'}`
                : 'Re-linked OnlyWorlds folder (no worlds found inside)'
            );
          }
        } catch (err) {
          toastManager.error(err instanceof Error ? err.message : String(err));
        } finally {
          btn.disabled = false;
          btn.textContent = 'Re-link OnlyWorlds folder';
        }
      });
      return;
    }

    // First-launch: no atlas folder yet. The landing (session 255, minimal
    // final form): wordmark + tagline carry identity, ONE filled CTA carries
    // the action. The rooms preview lives in the nav strip, not here.
    if (!atlasRoot) {
      root.innerHTML = `
        <div class="atlas-landing">
          <div class="atlas-landing-hero">
            <div class="atlas-landing-mark">Atlas</div>
            <p class="atlas-landing-tag">A free, local-first worldbuilding studio.</p>
          </div>
          <div class="atlas-landing-cta">
            <button class="atlas-btn-primary atlas-landing-btn" data-action="setup-atlas">Set up a local folder</button>
          </div>
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
                ? `OnlyWorlds folder set up: found ${result.imported} existing world${result.imported === 1 ? '' : 's'}`
                : 'OnlyWorlds folder is set up'
            );
          }
        } catch (err) {
          toastManager.error(err instanceof Error ? err.message : String(err));
        } finally {
          // On success a state change re-renders this panel away; on cancel
          // the button stays visible, so restore its original label.
          btn.disabled = false;
          btn.textContent = 'Set up a local folder';
        }
      });
      return;
    }

    // Atlas root set but no world active. Zero worlds = the moment after
    // first setup — headline the ONE next step (Captain's smoke, S254: "not
    // super clear what the intent is here"); with worlds, it's just a picker.
    if (!active) {
      const hasWorlds = state.registry.worlds.length > 0;
      if (!hasWorlds) {
        // Zero worlds = the grounding beat, minimal (S255v2, Captain's call):
        // just the confirmation + path. The three sidebar + buttons are the
        // actions; HOVERING one paints its explanation into the detail zone
        // below (worlds-sidebar dispatches `atlas:worlds-path-hover`), and a
        // one-time tour tag on +folder starts the trail.
        root.innerHTML = `
          <div class="atlas-landing atlas-grounded">
            <div class="atlas-landing-hero">
              <p class="atlas-grounded-check"><span class="material-symbols-outlined">check_circle</span>Your OnlyWorlds folder is ready</p>
              <p class="atlas-grounded-path"><code>${escapeText(atlasRoot.pathHint ?? atlasRoot.folderName)}</code></p>
            </div>
            <div class="atlas-grounded-detail" data-role="path-detail"></div>
          </div>
        `;
        const detail = root.querySelector<HTMLElement>('[data-role="path-detail"]')!;
        // No links in hover details — the panel only exists while the cursor
        // sits on the sidebar button, so nothing in it is clickable (S255v2).
        const owLine =
          `<p class="atlas-grounded-detail-ow"><img src="${import.meta.env.BASE_URL}owlogo.png" alt="" />` +
          `the OnlyWorlds icon in the footer has more info</p>`;
        const DETAILS: Record<string, string> = {
          'create-local': `
            <span class="material-symbols-outlined atlas-grounded-detail-icon">create_new_folder</span>
            <h3>create a world</h3>
            <p>A new subfolder in your OnlyWorlds folder. Elements become files as you build, and everything works offline. You can take it online later.</p>
            <p class="atlas-grounded-detail-hint">click the icon to start</p>`,
          'new-api': `
            <span class="material-symbols-outlined atlas-grounded-detail-icon">cloud_upload</span>
            <h3>new OnlyWorlds world</h3>
            <p>Creates the world locally and on onlyworlds.com in one step, synced from the start. Needs a free account.</p>
            ${owLine}
            <p class="atlas-grounded-detail-hint">click the icon to start</p>`,
          'link-api': `
            <span class="material-symbols-outlined atlas-grounded-detail-icon">link</span>
            <h3>link an OnlyWorlds world</h3>
            <p>Already have a world online? Paste its key: atlas downloads a full local copy and keeps the two in sync.</p>
            ${owLine}
            <p class="atlas-grounded-detail-hint">click the icon to start</p>`,
        };
        const onPathHover = (e: Event): void => {
          const path = (e as CustomEvent<{ path: string | null }>).detail?.path;
          const html = path ? DETAILS[path] : undefined;
          detail.innerHTML = html ?? '';
          detail.setAttribute('data-active', html ? 'true' : 'false');
        };
        window.addEventListener('atlas:worlds-path-hover', onPathHover);
        hoverCleanup = () => window.removeEventListener('atlas:worlds-path-hover', onPathHover);
        return;
      }
      root.innerHTML = `
        <div class="atlas-landing atlas-grounded">
          <div class="atlas-landing-hero">
            <div class="atlas-landing-mark atlas-landing-mark-sm">Atlas</div>
            <p class="atlas-landing-tag">No world open. Pick one from the sidebar.</p>
            <p class="atlas-grounded-path"><code>${escapeText(atlasRoot.pathHint ?? atlasRoot.folderName)}</code></p>
          </div>
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
  return () => {
    hoverCleanup?.();
    hoverCleanup = null;
    unsub();
  };
}


