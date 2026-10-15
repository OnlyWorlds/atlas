/**
 * The first screen's account worlds (S414, the S413 pinch).
 *
 * The first-visit landing has no sidebar, so a signed-in account's worlds
 * (the sidebar's On OnlyWorlds rows) were offered nowhere on it: a person
 * sent from keel's join page, or anyone who signed in before making a world,
 * met two doors that did not know them. Signed in, the landing lists every
 * world on the account under the doors; a row opens through the sidebar's
 * own path (`openAccountWorld`, #199), so owned and shared open alike.
 *
 * Pure markup here; the welcome panel renders it and delegates the clicks.
 */

import { escapeAttr, escapeText } from '../core/dom-utils';
import type { AppState } from '../core/state';
import { opensToWrite, remoteAccountWorlds } from '../sync/account-worlds';

export const LANDING_WORLDS_HEAD = 'Your worlds on OnlyWorlds';

/** The block's markup for this state, or '' when there is nothing to say. */
export function landingAccountWorldsHtml(state: AppState): string {
  if (!state.registry.account_token) return '';
  const aw = state.accountWorlds;
  const rows = remoteAccountWorlds();
  if (aw.status === 'error' && rows.length === 0) {
    // A token keel refused fails every retry: the way out is Settings, where
    // a new one is pasted (the gate's M3; this screen has no other way there).
    const action = aw.errorKind === 'auth'
      ? '<button type="button" class="atlas-btn-link" data-role="landing-worlds-settings">Open Settings, OnlyWorlds</button>'
      : '<button type="button" class="atlas-btn-link" data-role="landing-worlds-retry">Try again</button>';
    return `
      <p class="atlas-landing-worlds-head">${LANDING_WORLDS_HEAD}</p>
      <p class="atlas-landing-worlds-error">${escapeText(aw.error ?? 'Could not reach OnlyWorlds')} ${action}</p>`;
  }
  if (rows.length === 0) {
    // A first fetch says it is looking; an account with no worlds stays quiet.
    return aw.status === 'loading' || aw.status === 'idle'
      ? `<p class="atlas-landing-worlds-head">${LANDING_WORLDS_HEAD} <span class="atlas-remote-loading">…</span></p>`
      : '';
  }
  const items = rows.map((r) => {
    const opening = aw.opening === r.id;
    const shared = r.role === 'collaborator';
    // A guest's world opens to read (#199), so its row says so (gate L3).
    const what = opensToWrite(r) ? 'work on it' : 'read it';
    return `
      <li><button type="button" class="atlas-landing-world${opening ? ' is-opening' : ''}" data-landing-world-id="${escapeAttr(r.id)}"
          title="${escapeAttr(r.name)}. ${shared ? 'Shared with you. ' : ''}Open: download this world to ${what} here">
        <span class="material-symbols-outlined" aria-hidden="true">${opening ? 'downloading' : 'cloud'}</span>
        <span class="atlas-landing-world-name">${escapeText(r.name)}</span>
        ${shared ? '<span class="atlas-world-state-chip">shared</span>' : ''}
        ${opening ? '<span class="atlas-remote-loading">opening…</span>' : ''}
      </button></li>`;
  }).join('');
  return `
    <p class="atlas-landing-worlds-head">${LANDING_WORLDS_HEAD}</p>
    <ul class="atlas-landing-worlds-list">${items}</ul>`;
}
