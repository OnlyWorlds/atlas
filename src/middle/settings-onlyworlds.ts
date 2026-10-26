/**
 * Settings → OnlyWorlds tab (Bout OW, workplan D11) — the hub that replaced
 * the Account tab: what OnlyWorlds is, your account credentials, the
 * waypoints learning track, essential links, and a developers corner.
 *
 * Waypoint defs + state live in src/core/waypoints.ts; the contract (hook
 * table, gating, toast rules) is a design note of 2026-07-07.
 * The unmet rows ARE the self-paced tour: concept line + action line + a deep
 * link that opens the feature. No tour machinery.
 */

import { hasFolderMode } from '../core/capabilities';
import { navigate } from '../core/router';
import { escapeText } from '../core/dom-utils';
import { ToastManager } from '../ui/toast-manager';
import type { WorldsRegistry, WorldRegistryEntry } from '../core/types';
import { renderAccountTab, wireAccountTab } from './settings-account';
import { getState } from '../core/state';
import { worldPin } from '../core/seat';
import { buildV2Adapter } from '../sync/make-online';
import {
  WAYPOINTS,
  loadWaypointsState,
  completedCount,
  markAllFamiliar,
  isMuted,
  setMuted,
  completeWaypoint,
  consumePendingHighlight,
  OW_COUNCIL_URL,
} from '../core/waypoints';

const OW_SITE_URL = 'https://onlyworlds.com';
const OW_TOOLKIT_URL = 'https://onlyworlds.github.io';
const OW_GITHUB_URL = 'https://github.com/OnlyWorlds';
const OW_SDK_URL = 'https://www.npmjs.com/package/@onlyworlds/sdk';
const OW_API_URL = 'https://www.onlyworlds.com/api/v2/docs';

export function renderOnlyWorldsTab(reg: WorldsRegistry, activeWorld: WorldRegistryEntry | undefined): string {
  return `
    <section class="atlas-settings-section atlas-ow-intro">
      <h3>OnlyWorlds</h3>
      <p class="atlas-settings-hint">
        <a href="${OW_SITE_URL}" target="_blank" rel="noopener">OnlyWorlds</a>
        is an open standard for whole worlds: 22 element types, one schema, and
        a free account that stores your worlds online. Atlas keeps your
        worlds in that format, as files other OnlyWorlds tools can read, and
        syncs with your account when you link one.
      </p>
    </section>
    ${renderAccountTab(reg)}
    ${activeWorld?.api ? '<section class="atlas-settings-section" data-role="public-page" hidden></section>' : ''}
    ${renderWaypointsSection(activeWorld)}
    <section class="atlas-settings-section">
      <h3>Links</h3>
      <div class="atlas-ow-links">
        <a href="${OW_SITE_URL}" target="_blank" rel="noopener">onlyworlds.com</a>
        <a href="${OW_TOOLKIT_URL}" target="_blank" rel="noopener">AI toolkit</a>
        <a href="${OW_COUNCIL_URL}" target="_blank" rel="noopener" data-ow-council>Council</a>
        <a href="${OW_GITHUB_URL}" target="_blank" rel="noopener">GitHub</a>
      </div>
    </section>
    <section class="atlas-settings-section">
      <h3>For developers</h3>
      <p class="atlas-settings-hint">The folder is the API: every world is plain JSON on disk, one file per element. Read the type folders and key on each file's internal id. A world kept in this browser is readable by Atlas only, until you ${hasFolderMode() ? 'move it to a folder or ' : ''}download it as one file (Settings, This world).</p>
      <div class="atlas-ow-links">
        <a href="${OW_SDK_URL}" target="_blank" rel="noopener">@onlyworlds/sdk</a>
        <a href="${OW_TOOLKIT_URL}" target="_blank" rel="noopener">Schema reference</a>
        <a href="${OW_API_URL}" target="_blank" rel="noopener">REST API</a>
        ${activeWorld ? `<a href="#/w/${activeWorld.id}/import" data-ow-nav="#/w/${activeWorld.id}/import">Example world JSON</a>` : ''}
      </div>
    </section>
  `;
}

function renderWaypointsSection(activeWorld: WorldRegistryEntry | undefined): string {
  const state = loadWaypointsState();
  const count = completedCount();
  const demoActive = activeWorld?.demo === true;
  const rows = WAYPOINTS.map((w) => {
    const met = !!state.completed[w.id];
    const link = w.id === 'council' ? OW_COUNCIL_URL : w.link(activeWorld?.id ?? null);
    // Unmet cards carry a quiet arrow in the bottom-right corner that opens
    // the feature (Titus's call: an arrow reads more elegant than a text link).
    const arrow = met || !link
      ? ''
      : w.id === 'council'
        ? `<a class="atlas-ow-waypoint-arrow" href="${OW_COUNCIL_URL}" target="_blank" rel="noopener" data-ow-council aria-label="${escapeText(w.action)}" title="${escapeText(w.action)}"><span class="material-symbols-outlined">arrow_forward</span></a>`
        : `<a class="atlas-ow-waypoint-arrow" href="${link}" data-ow-nav="${link}" aria-label="${escapeText(w.action)}" title="${escapeText(w.action)}"><span class="material-symbols-outlined">arrow_forward</span></a>`;
    return `
      <div class="atlas-ow-waypoint ${met ? 'is-met' : ''}" data-waypoint="${w.id}">
        <span class="material-symbols-outlined atlas-ow-waypoint-glyph">${met ? 'check_circle' : w.glyph}</span>
        <div class="atlas-ow-waypoint-text">
          <span class="atlas-ow-waypoint-name">${escapeText(w.name)}</span>
          <span class="atlas-ow-waypoint-concept">${escapeText(w.concept)}</span>
          ${met ? '' : `<span class="atlas-ow-waypoint-action">${escapeText(w.action)}</span>`}
        </div>
        ${arrow}
      </div>
    `;
  }).join('');
  return `
    <section class="atlas-settings-section" data-role="waypoints-section">
      <div class="atlas-ow-waypoints-head">
        <h3>Waypoints</h3>
        <span class="atlas-ow-waypoints-count">${count} of ${WAYPOINTS.length}</span>
      </div>
      <p class="atlas-settings-hint">Small ways Atlas and OnlyWorlds fit together. Each one opens the feature it describes.</p>
      ${demoActive ? '<p class="atlas-settings-hint atlas-ow-demo-hint">You are exploring the sample world; these light up in a world of your own.</p>' : ''}
      <div class="atlas-ow-waypoint-grid">${rows}</div>
      <div class="atlas-ow-waypoints-foot">
        <button type="button" class="atlas-btn-ghost" data-action="waypoints-mark-all">Mark all as familiar</button>
        <button type="button" class="atlas-btn-ghost" data-action="waypoints-mute">${isMuted() ? 'Turn messages on' : 'Turn messages off'}</button>
      </div>
    </section>
  `;
}

export function wireOnlyWorldsTab(toasts: ToastManager, activeWorld: WorldRegistryEntry | undefined): void {
  wireAccountTab(toasts);
  const root = document.querySelector<HTMLElement>('.atlas-settings');
  if (!root) return;

  // (The replay control moved to the settings NAV chip — see
  // `wireReplayChip` in settings-panel.ts. It is not an OnlyWorlds feature.)

  function refreshSection(): void {
    const section = root!.querySelector<HTMLElement>('[data-role="waypoints-section"]');
    if (!section) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = renderWaypointsSection(activeWorld);
    const fresh = tmp.firstElementChild as HTMLElement | null;
    if (fresh) {
      section.replaceWith(fresh);
      wireWaypointControls();
    }
  }

  function wireWaypointControls(): void {
    root!.querySelector<HTMLButtonElement>('[data-action="waypoints-mark-all"]')?.addEventListener('click', () => {
      markAllFamiliar();
      toasts.info('All waypoints marked as familiar');
      refreshSection();
    });
    root!.querySelector<HTMLButtonElement>('[data-action="waypoints-mute"]')?.addEventListener('click', () => {
      setMuted(!isMuted());
      refreshSection();
    });
    // Internal deep links go through the router (plain href would still work,
    // but navigate keeps history behavior consistent with the rest of atlas).
    root!.querySelectorAll<HTMLAnchorElement>('[data-ow-nav]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(a.dataset.owNav!);
      });
    });
    // Council visit-through IS the waypoint (hookmap wp10 — page-level, ungated).
    root!.querySelectorAll<HTMLAnchorElement>('[data-ow-council]').forEach((a) => {
      a.addEventListener('click', () => {
        completeWaypoint('council');
        // The new tab opens; refresh so the row lights when the user returns.
        setTimeout(refreshSection, 0);
      });
    });
  }

  wireWaypointControls();
  void showPublicPage(root, activeWorld);

  // Toast click handoff: scroll to + flash the waypoint the toast named.
  const highlight = consumePendingHighlight();
  if (highlight) {
    const row = root.querySelector<HTMLElement>(`[data-waypoint="${highlight}"]`);
    if (row) {
      row.classList.add('is-highlight');
      row.scrollIntoView({ block: 'center' });
      setTimeout(() => row.classList.remove('is-highlight'), 2400);
    }
  }
}

/**
 * A linked world whose owner turned its public page on says so, with the
 * address (Skeld 2026-10-23; `core/public-page.ts`). Read live each time the
 * tab opens, never kept: the switch is keel's. Off, unreachable or refused,
 * the section stays hidden: it is a pointer, not a status.
 */
async function showPublicPage(root: HTMLElement, world: WorldRegistryEntry | undefined): Promise<void> {
  const section = root.querySelector<HTMLElement>('[data-role="public-page"]');
  if (!section || !world?.api) return;
  let url: string | null = null;
  try {
    // A prefixed key reads bare; a ten-digit key's read takes the PIN (1.79.0).
    url = await buildV2Adapter(world.api.api_key, worldPin(world, getState().registry) ?? '').publicPage();
  } catch {
    return;
  }
  // The tab may have been redrawn (its new section asks for itself), or another world opened.
  if (!url || !section.isConnected || getState().active?.worldId !== world.id) return;
  section.innerHTML = `
    <h3>Public page</h3>
    <p class="atlas-settings-hint">This world has a public page on onlyworlds.com: anyone with its address can read it. Its owner turns it on or off on the world's page there.</p>
    <div class="atlas-ow-links"><a href="${escapeText(url)}" target="_blank" rel="noopener" data-public-page>View its public page</a></div>
  `;
  section.hidden = false;
}
