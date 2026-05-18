/**
 * Publish detail room — view/manage a specific showcase.
 *
 * See DESIGN_PUBLISHING.md. v1 stub — backend retrieval + republish/revoke
 * flow lands in a future session.
 */

import { getState, subscribe } from '../core/state';
import { onHashChange, parseHash, navigate, publishHash } from '../core/router';

export function mountPublishDetail(target: HTMLElement): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-publish-detail';
  target.appendChild(root);

  function render(): void {
    const active = getState().active;
    const route = parseHash(window.location.hash);
    const showcaseId = route.showcaseId ?? '';

    root.innerHTML = '';

    if (!active) {
      root.innerHTML = '<div class="atlas-pane-empty">No active world.</div>';
      return;
    }

    const entry = getState().registry.worlds.find(w => w.id === active.worldId);
    const sc = entry?.showcases?.find(s => s.showcase_id === showcaseId);

    const header = document.createElement('header');
    header.className = 'atlas-room-header';
    header.innerHTML = `
      <button class="atlas-btn-ghost atlas-room-back" data-action="back-to-publish-home">
        <span class="material-symbols-outlined">arrow_back</span>
        <span>Publications</span>
      </button>
      <h1>Showcase</h1>
    `;
    header.querySelector('[data-action="back-to-publish-home"]')?.addEventListener('click', () => {
      navigate(publishHash(active.worldId));
    });
    root.appendChild(header);

    if (!sc) {
      const empty = document.createElement('div');
      empty.className = 'atlas-pane-empty';
      empty.innerHTML = `
        <p>Showcase <code>${escapeText(showcaseId)}</code> not in local cache.</p>
        <p class="atlas-publish-hint">Backend retrieval lands in a future session.</p>
      `;
      root.appendChild(empty);
      return;
    }

    const card = document.createElement('div');
    card.className = 'atlas-publish-detail-card';
    card.innerHTML = `
      <p><strong>Element:</strong> ${escapeText(sc.element_type)} · ${escapeText(sc.element_id)}</p>
      <p><strong>Published:</strong> ${escapeText(sc.published_at)}</p>
      <p><strong>Public URL:</strong> <a href="${escapeText(sc.public_url)}" target="_blank">${escapeText(sc.public_url)}</a></p>
      ${sc.hidden_fields?.length ? `<p><strong>Hidden fields:</strong> ${sc.hidden_fields.map(escapeText).join(', ')}</p>` : ''}
    `;
    root.appendChild(card);
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();
  return () => {
    unsubState();
    unsubHash();
  };
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
