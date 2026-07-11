/**
 * Settings → OnlyWorlds tab (Bout OW, workplan D11) — the hub that replaced
 * the Account tab: what OnlyWorlds is, your account credentials, the
 * waypoints learning track, essential links, and a developers corner.
 *
 * Waypoint defs + state live in src/core/waypoints.ts; the contract (hook
 * table, gating, toast rules) is Forge/Notes/2026-07-07-atlas-waypoint-hookmap.md.
 * The unmet rows ARE the self-paced tour: concept line + action line + a deep
 * link that opens the feature. No tour machinery.
 */

import { navigate } from '../core/router';
import { escapeText } from '../core/dom-utils';
import { ToastManager } from '../ui/toast-manager';
import type { WorldsRegistry, WorldRegistryEntry } from '../core/types';
import { renderAccountTab, wireAccountTab } from './settings-account';
import {
  WAYPOINTS,
  loadWaypointsState,
  completedCount,
  markAllFamiliar,
  isMuted,
  setMuted,
  completeWaypoint,
  consumePendingHighlight,
} from '../core/waypoints';

const OW_SITE_URL = 'https://onlyworlds.com';
const OW_TOOLKIT_URL = 'https://onlyworlds.github.io';
const OW_COUNCIL_URL = 'https://council.onlyworlds.com';
const OW_GITHUB_URL = 'https://github.com/OnlyWorlds';
const OW_SDK_URL = 'https://www.npmjs.com/package/@onlyworlds/sdk';
const OW_API_URL = 'https://www.onlyworlds.com/api/worldapi/';

export function renderOnlyWorldsTab(reg: WorldsRegistry, activeWorld: WorldRegistryEntry | undefined): string {
  return `
    <section class="atlas-settings-section atlas-ow-intro">
      <h3>OnlyWorlds</h3>
      <p class="atlas-settings-hint">
        Atlas is a free, local worldbuilding studio, powered by
        <a href="${OW_SITE_URL}" target="_blank" rel="noopener">OnlyWorlds</a>,
        an open format for whole worlds. Your world lives as plain files in a
        folder you own, and the format is why any OnlyWorlds tool can read it.
      </p>
    </section>
    ${renderAccountTab(reg)}
    ${renderWaypointsSection(activeWorld)}
    <section class="atlas-settings-section">
      <h3>Links</h3>
      <div class="atlas-ow-links">
        <a href="${OW_SITE_URL}" target="_blank" rel="noopener">onlyworlds.com</a>
        <a href="${OW_TOOLKIT_URL}" target="_blank" rel="noopener">AI toolkit</a>
        <a href="${OW_COUNCIL_URL}" target="_blank" rel="noopener" data-ow-council>council</a>
        <a href="${OW_GITHUB_URL}" target="_blank" rel="noopener">GitHub</a>
        <a href="#/demo" data-ow-nav="#/demo">sample world</a>
      </div>
    </section>
    <section class="atlas-settings-section">
      <h3>For developers</h3>
      <p class="atlas-settings-hint">The folder is the API: every world is plain JSON on disk, one file per element. Read the type folders and key on each file's internal id.</p>
      <div class="atlas-ow-links">
        <a href="${OW_SDK_URL}" target="_blank" rel="noopener">@onlyworlds/sdk</a>
        <a href="${OW_TOOLKIT_URL}" target="_blank" rel="noopener">schema reference</a>
        <a href="${OW_API_URL}" target="_blank" rel="noopener">REST API</a>
        ${activeWorld ? `<a href="#/w/${activeWorld.id}/import" data-ow-nav="#/w/${activeWorld.id}/import">example world JSON</a>` : ''}
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
    // the feature (Captain's call: an arrow reads more elegant than a text link).
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
      <p class="atlas-settings-hint">Ten small ways atlas and OnlyWorlds fit together. Each one opens the feature it describes.</p>
      ${demoActive ? '<p class="atlas-settings-hint atlas-ow-demo-hint">You are exploring the sample world; these light up in a world of your own.</p>' : ''}
      <div class="atlas-ow-waypoint-grid">${rows}</div>
      <div class="atlas-ow-waypoints-foot">
        <button type="button" class="atlas-btn-ghost" data-action="waypoints-mark-all">mark all as familiar</button>
        <button type="button" class="atlas-btn-ghost" data-action="waypoints-mute">${isMuted() ? 'turn messages on' : 'turn messages off'}</button>
      </div>
    </section>
  `;
}

export function wireOnlyWorldsTab(toasts: ToastManager, activeWorld: WorldRegistryEntry | undefined): void {
  wireAccountTab(toasts);
  const root = document.querySelector<HTMLElement>('.atlas-settings');
  if (!root) return;

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
