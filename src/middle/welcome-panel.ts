/**
 * Middle pane: welcome / empty state.
 *
 * Modes:
 * - A home folder the vault still holds after a storage clear → re-link it.
 * - Not set up (`isAtlasGrounded` false) → the landing: the tour, start a
 *   world, open a world folder (Chromium), other ways in.
 * - Set up, no active world → the next step, or "pick one from the sidebar".
 * - Active world → its name and a few stats.
 */

import { isCodeLoadError } from '../core/reload-offer';
import { getActiveStore } from '../core/active-store';
import { BROWSER_STORAGE_FULL_LINE, hasFolderMode, opfsStatus, NO_BROWSER_STORAGE_LINE } from '../core/capabilities';
import { escapeText } from '../core/dom-utils';
import { navigate, settingsHash, timelineHash } from '../core/router';
import { getState, subscribe } from '../core/state';
import { recoverAtlasRoot, setupAtlasRoot } from '../setup/atlas-root-flow';
import { finishSetupDoor, openAddWorldChooser, runAddWorldAction } from '../setup/world-doors';
import { isAtlasGrounded } from '../core/grounded';
import { isTourFlagActive } from '../tour/tour-flag';
import { toastManager } from '../ui/toast-manager';
import { showProblem } from '../ui/problem-fixes';
import { isNarrowSidebar, openDrawer } from '../layout/narrow-layout';
import { isCoarsePointer } from '../core/pointer';
import { lanternLineHtml } from '../core/ow-site';
import { landingAccountWorldsHtml } from './landing-account-worlds';
import { openAccountWorld, refreshAccountWorlds, remoteAccountWorlds } from '../sync/account-worlds';

/**
 * Whether this no-world stretch already opened the sidebar drawer.
 * Below 820px the sidebar is a drawer, and with no world open it holds the
 * only thing to do (every copy line here points at it), so the panel opens it
 * ONCE on arriving; a user who closes it is not fought on the next render.
 */
let sidebarShownForNoWorld = false;

/** A '1' flag in localStorage; false where storage refuses (private mode). */
function localStorageFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

export function mountWelcomePanel(target: HTMLElement): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-middle-body atlas-welcome';
  target.appendChild(root);

  // Active listener for the grounded state's sidebar-hover detail zone;
  // re-renders replace it, unmount clears it.
  let hoverCleanup: (() => void) | null = null;
  // What the landing was last built from: a notify that leaves it the
  // same (the account list loading, a row opening) repaints only the account
  // block, so the sigil does not restart and the storage probe's edits stay.
  let landingKey: string | null = null;
  // The account block as last written: compared against this string, never
  // against innerHTML, which the browser re-serializes (compared with it,
  // every notify rebuilt the rows and a focused row lost its focus).
  let lastAccountBlock = '';

  // The landing's account rows open as the sidebar's do, owned or shared.
  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-role="landing-worlds-retry"]')) {
      refreshAccountWorlds(true);
      return;
    }
    if (target.closest('[data-role="landing-worlds-settings"]')) {
      navigate(settingsHash(null, 'onlyworlds'));
      return;
    }
    const btn = target.closest<HTMLElement>('[data-landing-world-id]');
    if (!btn) return;
    const row = remoteAccountWorlds().find(r => r.id === btn.getAttribute('data-landing-world-id'));
    if (row) void openAccountWorld(row, toastManager);
  });

  async function render(): Promise<void> {
    hoverCleanup?.();
    hoverCleanup = null;
    const state = getState();
    const { active, atlasRoot, atlasRootRecoverable } = state;
    if (active) sidebarShownForNoWorld = false;

    // Pre-setup the splash is a BARE stage: no sidebar, no nav, no panes —
    // the same empty black the tour opens on, so starting the tour is
    // continuous (Titus's call, 2026-07-19). The class drops the moment a
    // root exists, a world is active, or the tour itself is running (the
    // tour's build-up owns the chrome then).
    const grounded = isAtlasGrounded(state);
    // The tour too: a replay exited before its world exists comes
    // back to a landing whose tour button still says "Starting…".
    if (grounded || active || (!atlasRoot && atlasRootRecoverable) || isTourFlagActive()) landingKey = null;
    const bare = !grounded && !active && !isTourFlagActive();
    document.body.classList.toggle('atlas-preroot', bare);

    // Recoverable: vault has an orphan atlas-root handle (typically after a
    // localStorage clear). Surface a single restore button before falling
    // through to the standard first-launch CTA.
    if (!atlasRoot && atlasRootRecoverable) {
      root.innerHTML = `
        <header class="atlas-room-header"><h1>Welcome back</h1></header>
        <div class="atlas-welcome-empty">
          <p>Atlas found the folder you set up before on this device: <code>${escapeText(atlasRootRecoverable.folderName)}</code>.</p>
          <p class="atlas-welcome-hint">Your worlds are still on disk. Allow the folder again below to bring the list back.</p>
          <div class="atlas-welcome-actions">
            <button class="atlas-btn-entry" data-action="recover-atlas">Re-link OnlyWorlds folder</button>
          </div>
          <p class="atlas-welcome-hint"><button class="atlas-btn-link" data-action="setup-atlas">Or set up a different folder</button></p>
        </div>
      `;
      // The second door (Titus): after a storage clear this screen
      // offered ONLY the re-link, so choosing a new place meant re-linking
      // the old one first and then changing it in Settings. Settings already
      // had both doors; the welcome now matches it.
      const altBtn = root.querySelector<HTMLButtonElement>('[data-action="setup-atlas"]')!;
      altBtn.addEventListener('click', async () => {
        altBtn.disabled = true;
        try {
          await finishSetupDoor(await setupAtlasRoot(), toastManager);
        } catch (err) {
          console.warn('[welcome] folder setup failed:', err);
          showProblem(err, { doing: 'setting up your OnlyWorlds folder', folder: 'picked' });
        } finally {
          altBtn.disabled = false;
        }
      });
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
          console.warn('[welcome] folder re-link failed:', err);
          showProblem(err, { doing: 're-linking your OnlyWorlds folder', folder: 'picked' });
        } finally {
          btn.disabled = false;
          btn.textContent = 'Re-link OnlyWorlds folder';
        }
      });
      return;
    }

    // First-launch: no home folder and no world of the user's own. The landing
    // (minimal form; tour door added 2026-07-19, after a tester's "jarring
    // first screen"): the tour needs no folder, so it leads.
    if (!grounded) {
      // Signed in: the account's worlds under the doors. The fetch is
      // token-guarded, so calling it on every render is a no-op once made.
      if (state.registry.account_token) refreshAccountWorlds();
      const accountBlock = landingAccountWorldsHtml(state);
      const key = JSON.stringify([hasFolderMode(), isCoarsePointer(), localStorageFlag('atlas_tour_done_v1')]);
      const block = root.querySelector<HTMLElement>('[data-role="landing-worlds"]');
      if (block && key === landingKey) {
        if (accountBlock !== lastAccountBlock) block.innerHTML = accountBlock;
        lastAccountBlock = accountBlock;
        block.hidden = accountBlock === '';
        return;
      }
      landingKey = key;
      lastAccountBlock = accountBlock;
      // 1.17: a world can live in this browser,
      // so every browser gets "start a world" (the dialog asks where on
      // Chromium) and "other ways in" (the chooser: bring one down, view a
      // shared world, open a world file). After a full clear of site data this
      // screen is the only surface, so the world file's door must be on it.
      // Chromium keeps "open a world folder" (the toolkit sends people
      // here with a world folder an AI made; it opens in place, and a folder
      // that keeps worlds becomes the home folder). "Set up a folder" is gone:
      // the home folder is asked for when a world is first made in a folder.
      // #127 (Titus, 2026-10-09): two doors, start a world and the
      // demo world, and one quiet line under them for the rest. The tour
      // stays one click from the first screen (his call) as a link: a choice,
      // not the first step.
      const folderMode = hasFolderMode();
      const tourDone = localStorageFlag('atlas_tour_done_v1');
      // Titus's round: the doors lost their headings and their boxes;
      // the compact doors kept a caption each (Titus), one muted line,
      // no time claim, tool voice.
      const choice = (action: string, cls: string, label: string, note: string): string =>
        `<span class="atlas-landing-choice" data-door="${action}">
           <button class="${cls} atlas-landing-btn" data-action="${action}">${label}</button>
           <span class="atlas-landing-choice-note">${note}</span>
         </span>`;
      const doors = [
        // The style ladder (2026-10-20): Start a world is this screen's one
        // Entry; the demo door is Standard, the everyday button.
        choice('start-world', 'atlas-btn-entry', 'Start a world', folderMode
          ? 'Your first world, in a folder on your drive or in this browser'
          : 'It lives in this browser'),
        // #113: the demo world as the user's own copy (needs browser storage).
        choice('try-demo', 'atlas-btn-primary', 'Explore Moppetopia', 'A demo world, your own copy to change'),
      ].join('');
      const link = (action: string, label: string, hint: string): string =>
        `<button type="button" class="atlas-btn-link atlas-landing-more-link" data-door="${action}" data-action="${action}" title="${hint}">${label}</button>`;
      // The tour is Watch how it works (onboarding step 4, Titus 2026-10-27):
      // kept whole, offered, never the onboarding. A world folder you already
      // have opens from Other ways in, with the rest of the ways a world arrives.
      const more = [
        link('start-tour', tourDone ? 'Watch it again' : 'Watch how it works', 'A guided build of a world from one sentence of a novel'),
        link('other-ways-in', 'Other ways in', folderMode
          ? 'Open a world folder you have, download one from OnlyWorlds, view a shared world, open a world file'
          : 'Download one from OnlyWorlds, view a shared world, open a world file'),
      ].filter(Boolean).join('<span class="atlas-landing-more-sep" aria-hidden="true">·</span>');
      // The note names the DESKTOP part of the constraint: mobile
      // Chrome has no folder picker either, so the sentence says "desktop".
      const folderNote = folderMode
        ? ''
        : 'Worlds you make here live in this browser. Folders on your drive need desktop Chrome, Edge or Brave.';
      // (The example-page door, "see an example page" → #/demo, was removed
      // with the other two example-page links. The #/demo route itself
      // still answers, for old links.)
      // The OnlyWorlds sigil + eyebrow (Skeld's opener note, Titus's nod,
      // 2026-07-19): users routed here from onlyworlds.com need the mark and
      // the stated relationship to read "same universe". Bundled local copy
      // of the animated logo — local-first app, local asset.
      // The sigil is the OnlyWorlds mark and now behaves like one: clicking it
      // opens onlyworlds.com. Users arriving from there get the way
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
              ${doors}
            </div>
            <p class="atlas-landing-more">${more}</p>
            <div class="atlas-landing-worlds" data-role="landing-worlds"${accountBlock ? '' : ' hidden'}>${accountBlock}</div>
            <p class="atlas-landing-tag">Worldbuilding on OnlyWorlds.</p>
            <p class="atlas-landing-note" data-role="storage-note"${folderNote ? '' : ' hidden'}>${folderNote}</p>
            ${isCoarsePointer() ? `<p class="atlas-landing-note" data-role="lantern-note">${lanternLineHtml()}</p>` : ''}
          </div>
        </div>
      `;
      const tourBtn = root.querySelector<HTMLButtonElement>('[data-action="start-tour"]')!;
      // A window that refuses browser storage (a Firefox private window), or
      // whose storage is full, says why up front rather than on a click
      // (conv. 120). Without a folder picker every door needs that
      // storage, so only the line is left; on Chromium the tour goes and the
      // folder doors stay (the dialog's browser row says why when chosen).
      void opfsStatus().then((status) => {
        if (status === 'ok' || !tourBtn.isConnected) return;
        const doomed = folderMode ? ['start-tour', 'try-demo'] : ['start-tour', 'try-demo', 'start-world', 'other-ways-in'];
        for (const action of doomed) root.querySelector(`[data-door="${action}"]`)?.remove();
        // A link row that lost a link loses its separator with it.
        const moreRow = root.querySelector<HTMLElement>('.atlas-landing-more');
        if (moreRow) {
          const links = [...moreRow.querySelectorAll('[data-door]')];
          moreRow.innerHTML = '';
          links.forEach((l, i) => {
            if (i > 0) moreRow.insertAdjacentHTML('beforeend', '<span class="atlas-landing-more-sep" aria-hidden="true">·</span>');
            moreRow.appendChild(l);
          });
          moreRow.hidden = links.length === 0;
        }
        // The doors that stay say only what still works here.
        const caption = (action: string, text: string): void => {
          const note = root.querySelector(`[data-door="${action}"] .atlas-landing-choice-note`);
          if (note) note.textContent = text;
        };
        caption('start-world', 'Your first world, in a folder on your drive');
        root.querySelector('[data-door="other-ways-in"]')?.setAttribute('title', 'Download one from OnlyWorlds, or view a shared world');
        const note = root.querySelector<HTMLElement>('[data-role="storage-note"]');
        if (!note) return;
        // A full origin is not a private window: say which.
        note.textContent = status === 'full' ? BROWSER_STORAGE_FULL_LINE : NO_BROWSER_STORAGE_LINE;
        note.hidden = false;
      });
      root.querySelector<HTMLButtonElement>('[data-action="start-world"]')?.addEventListener('click', () => {
        void runAddWorldAction('create-local', toastManager);
      });
      root.querySelector<HTMLButtonElement>('[data-action="try-demo"]')?.addEventListener('click', () => {
        void runAddWorldAction('try-demo', toastManager);
      });
      root.querySelector<HTMLButtonElement>('[data-action="other-ways-in"]')?.addEventListener('click', () => {
        openAddWorldChooser(toastManager);
      });
      tourBtn.addEventListener('click', async () => {
        tourBtn.disabled = true;
        // CAPTURE the rendered label rather than restating it. Both
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
          if (!isCodeLoadError(err)) {
            console.warn('[welcome] tour launch failed:', err);
            showProblem(err, { doing: 'starting the tour' });
          }
          tourBtn.disabled = false;
          tourBtn.textContent = tourLabel;
        }
      });
      return;
    }

    // Atlas root set but no world active. Zero worlds = the moment after
    // first setup — headline the ONE next step (Titus's smoke: "not
    // super clear what the intent is here"); with worlds, it's just a picker.
    if (!active) {
      // Not during the tour (it owns the drawers, and would use up the once),
      // and one task later: the navigation that brought this screen
      // up (a tour exit, a finished setup) fires its hashchange after this
      // render, and the drawer layer closes drawers on hashchange.
      if (!sidebarShownForNoWorld && !isTourFlagActive() && isNarrowSidebar()) {
        sidebarShownForNoWorld = true;
        setTimeout(() => {
          if (!getState().active && !isTourFlagActive() && isNarrowSidebar()) openDrawer('sidebar');
        }, 0);
      }
      const hasWorlds = state.registry.worlds.length > 0;
      if (!hasWorlds) {
        // Zero worlds = the grounding beat, minimal (Titus's call):
        // just the confirmation + path. The three sidebar + buttons are the
        // actions; HOVERING one paints its explanation into the detail zone
        // below (worlds-sidebar dispatches `atlas:worlds-path-hover`), and a
        // one-time tour tag on +folder starts the trail.
        root.innerHTML = `
          <div class="atlas-landing atlas-grounded">
            <div class="atlas-landing-hero">
              <p class="atlas-grounded-check"><span class="material-symbols-outlined">check_circle</span>Your OnlyWorlds folder is ready</p>
              <p class="atlas-grounded-path"><code>${escapeText(atlasRoot?.pathHint ?? atlasRoot?.folderName ?? "")}</code></p>
              <p class="atlas-grounded-next">${state.registry.worlds_add_icons === false
                ? 'Now make a world to put in it: <strong>Add a world</strong>, at the top of the Worlds list, shows every way to start one.'
                : `Now make a world to put in it. The
                <span class="atlas-grounded-next-glyph"
                  ><span class="material-symbols-outlined atlas-add-glyph-plus">add</span
                  ><span class="material-symbols-outlined atlas-add-glyph-main">folder</span></span>
                button in the top left creates one. The <strong>Add a world</strong> button
                under it lists every way to start one.`}</p>
            </div>
            <div class="atlas-grounded-detail" data-role="path-detail"></div>
          </div>
        `;
        const detail = root.querySelector<HTMLElement>('[data-role="path-detail"]')!;
        // No links in hover details — the panel only exists while the cursor
        // sits on the sidebar button, so nothing in it is clickable.
        const owLine =
          `<p class="atlas-grounded-detail-ow"><img src="${import.meta.env.BASE_URL}owlogo.png" alt="" />` +
          `The OnlyWorlds icon in the footer has more info</p>`;
        const DETAILS: Record<string, string> = {
          'add-world': `
            <span class="material-symbols-outlined atlas-grounded-detail-icon">add</span>
            <h3>Add a world</h3>
            <p>Every way to start a world: start one, open a world folder or file, or download or view one from OnlyWorlds.</p>
            <p class="atlas-grounded-detail-hint">Click to choose</p>`,
          'create-local': `
            <span class="material-symbols-outlined atlas-grounded-detail-icon">create_new_folder</span>
            <h3>Start a world</h3>
            <p>A new world, in your OnlyWorlds folder or in this browser: the dialog asks. It is plain files, works offline, and can go online later.</p>
            <p class="atlas-grounded-detail-hint">Click the icon to start</p>`,
          'new-api': `
            <span class="material-symbols-outlined atlas-grounded-detail-icon">cloud_upload</span>
            <h3>New world on OnlyWorlds</h3>
            <p>Creates the world here and on onlyworlds.com, synced from the start. Needs a free account.</p>
            ${owLine}
            <p class="atlas-grounded-detail-hint">Click the icon to start</p>`,
          'link-api': `
            <span class="material-symbols-outlined atlas-grounded-detail-icon">link</span>
            <h3>Download a world from OnlyWorlds</h3>
            <p>Already have a world online? Its API key and PIN bring down a full copy, kept in sync.</p>
            ${owLine}
            <p class="atlas-grounded-detail-hint">Click the icon to start</p>`,
          'view-api': `
            <span class="material-symbols-outlined atlas-grounded-detail-icon">visibility</span>
            <h3>View a shared world</h3>
            <p>Someone shared a read key with you? Paste it: Atlas downloads their world to browse, view only. No PIN needed.</p>
            ${owLine}
            <p class="atlas-grounded-detail-hint">Click the icon to start</p>`,
          // Open-folder was the ONE create button with no entry here —
          // untaught on every input path, hover included.
          'open-folder': `
            <span class="material-symbols-outlined atlas-grounded-detail-icon">folder_open</span>
            <h3>Open a world folder</h3>
            <p>Already have a world as files on your drive, from Atlas or another OnlyWorlds tool? Point at its folder and Atlas opens it in place. Nothing is copied or moved.</p>
            <p class="atlas-grounded-detail-hint">Click the icon to start</p>`,
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
      // Worlds but no home folder (opened in place on a first visit):
      // no path to show; the home folder is asked for at the first new world.
      const pathLine = atlasRoot
        ? `<p class="atlas-grounded-path"><code>${escapeText(atlasRoot.pathHint ?? atlasRoot.folderName)}</code></p>`
        : '';
      root.innerHTML = `
        <div class="atlas-landing atlas-grounded">
          <div class="atlas-landing-hero">
            <div class="atlas-landing-mark atlas-landing-mark-sm">Atlas</div>
            <p class="atlas-landing-tag">No world open. Pick one from the sidebar.</p>
            ${pathLine}
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


