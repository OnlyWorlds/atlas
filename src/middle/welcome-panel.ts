/**
 * Middle pane: welcome / empty state.
 *
 * Three modes:
 * - No atlas root yet → "set up atlas folder" CTA (first launch).
 * - Atlas root set, no active world → "create or open a world" prompt.
 * - Active world  → "Welcome to {name}" with a few stats (placeholder until
 *   elements list lands in Phase 4).
 */

import { getActiveStore } from '../core/active-store';
import { hasFolderMode } from '../core/capabilities';
import { escapeText } from '../core/dom-utils';
import { navigate, timelineHash } from '../core/router';
import { getState, subscribe } from '../core/state';
import { recoverAtlasRoot, setupAtlasRoot } from '../setup/atlas-root-flow';
import { isTourFlagActive } from '../tour/tour-flag';
import { toastManager } from '../ui/toast-manager';

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

    // Pre-setup the splash is a BARE stage: no sidebar, no nav, no panes —
    // the same empty black the tour opens on, so starting the tour is
    // continuous (Captain's call, 2026-07-19). The class drops the moment a
    // root exists, a world is active, or the tour itself is running (the
    // tour's build-up owns the chrome then).
    const bare = !atlasRoot && !active && !isTourFlagActive();
    document.body.classList.toggle('atlas-preroot', bare);

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

    // First-launch: no atlas folder yet. The landing (session 255 minimal
    // form; tour door added 2026-07-19 — Freek's "jarring first screen"): the
    // tour needs NO folder (browser storage), so it leads; the folder CTA
    // carries honest context about where worlds live; about-link for depth.
    if (!atlasRoot) {
      // OPFS-only browsers (Safari 18.2+, Firefox: tour-capable boot) have no
      // folder picker — the folder door becomes an honest line instead of a
      // button that would fail on click. After a completed tour the emphasis
      // swaps: the folder is the primary door, the tour a replay.
      const folderMode = hasFolderMode();
      let tourDone = false;
      try { tourDone = localStorage.getItem('atlas_tour_done_v1') === '1'; } catch { /* private mode */ }
      const tourBtnClass = tourDone ? 'atlas-btn-ghost' : 'atlas-btn-primary';
      const folderBtnClass = tourDone ? 'atlas-btn-primary' : 'atlas-btn-ghost';
      // S301 (Captain's round): the doors lost their headings and their boxes
      // — a heading that repeats its own button is noise, and the panels made
      // two small actions look like a decision. What is left is a compact
      // button pair sitting with the tagline, plus the honest folder line on
      // browsers that cannot pick a folder.
      // The compact doors kept a caption each (Captain, S302): the S301 pass
      // cut the redundant TITLES (they repeated their own buttons) but took
      // the explanations with them, so the pair read as two bare unlabelled
      // buttons. One muted line each, no time claim, tool voice.
      const folderDoor = folderMode
        ? `<span class="atlas-landing-choice">
             <button class="${folderBtnClass} atlas-landing-btn" data-action="setup-atlas">set up a folder</button>
             <span class="atlas-landing-choice-note">each world a folder with text files for elements</span>
           </span>`
        : '';
      const folderNote = folderMode
        ? ''
        : `<p class="atlas-landing-note">Folder mode (your worlds as real files) needs a Chromium browser: Chrome or Brave. This browser can take the tour.</p>`;
      // The OnlyWorlds sigil + eyebrow (Skeld's opener note, Captain's nod,
      // 2026-07-19): users routed here from onlyworlds.com need the mark and
      // the stated relationship to read "same universe". Bundled local copy
      // of the animated logo — local-first app, local asset.
      // The sigil is the OnlyWorlds mark and now behaves like one: clicking it
      // opens onlyworlds.com (S301). Users arriving from there get the way
      // back; users arriving cold get the context.
      root.innerHTML = `
        <div class="atlas-landing atlas-landing-compact">
          <div class="atlas-landing-hero">
            <a class="atlas-landing-siglink" href="https://www.onlyworlds.com" target="_blank"
              rel="noopener noreferrer" title="onlyworlds.com" aria-label="Open onlyworlds.com in a new tab">
              <video class="atlas-landing-sigil" autoplay loop muted playsinline
                src="${import.meta.env.BASE_URL}ow-logo.mp4" aria-hidden="true"></video>
            </a>
            <div class="atlas-landing-mark">Atlas</div>
            <div class="atlas-landing-actions">
              <span class="atlas-landing-choice">
                <button class="${tourBtnClass} atlas-landing-btn" data-action="start-tour">${tourDone ? 'replay the tour' : 'take the tour'}</button>
                <span class="atlas-landing-choice-note">one sentence becomes a small linked world</span>
              </span>
              ${folderDoor}
            </div>
            <p class="atlas-landing-tag">A free, local-first worldbuilding studio.</p>
            ${folderNote}
          </div>
        </div>
      `;
      const tourBtn = root.querySelector<HTMLButtonElement>('[data-action="start-tour"]')!;
      tourBtn.addEventListener('click', async () => {
        tourBtn.disabled = true;
        // CAPTURE the rendered label rather than restating it (S310). Both
        // restores below used to hard-code a string that no longer matched
        // what the markup renders — the door says "take the tour" and this
        // said "Take the tour"; the folder door says "set up a folder" and its
        // restore said "Set up your OnlyWorlds folder". A cancelled picker or
        // a failed launch RENAMED the landing button, on the first screen of
        // the tool. A restated constant is a drift waiting for a quiet
        // afternoon; read the source of truth instead.
        const tourLabel = tourBtn.textContent ?? '';
        tourBtn.textContent = 'Starting…';
        try {
          const engine = await import('../tour/tour-engine');
          await engine.launchTour();
        } catch (err) {
          toastManager.error(err instanceof Error ? err.message : String(err));
          tourBtn.disabled = false;
          tourBtn.textContent = tourLabel;
        }
      });
      const btn = root.querySelector<HTMLButtonElement>('[data-action="setup-atlas"]');
      if (!btn) return;
      btn.addEventListener('click', async () => {
        const setupLabel = btn.textContent ?? '';
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
          // the button stays visible, so restore the label it actually had.
          btn.disabled = false;
          btn.textContent = setupLabel;
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
              <p class="atlas-grounded-next">Now make a world to put in it. The
                <span class="material-symbols-outlined atlas-grounded-next-icon">create_new_folder</span>
                button in the top left creates one; the others beside it open a
                folder you already have, or bring a world down from
                onlyworlds.com.</p>
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
          'view-api': `
            <span class="material-symbols-outlined atlas-grounded-detail-icon">visibility</span>
            <h3>view a shared world</h3>
            <p>Someone shared a read key with you? Paste it: atlas downloads their world to browse, view only. No PIN needed.</p>
            ${owLine}
            <p class="atlas-grounded-detail-hint">click the icon to start</p>`,
          // S309: open-folder was the ONE create button with no entry here —
          // untaught on every input path, hover included.
          'open-folder': `
            <span class="material-symbols-outlined atlas-grounded-detail-icon">folder_open</span>
            <h3>open a world folder</h3>
            <p>Already have a world as files on your drive, from atlas or another OnlyWorlds tool? Point at its folder and atlas opens it in place. Nothing is copied or moved.</p>
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
    document.body.classList.remove('atlas-preroot');
    unsub();
  };
}


