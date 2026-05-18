/**
 * Publish room — showcase home. Lists all publications for this world from the
 * atlas-local registry cache (the backend is the truth via POST/GET
 * /showcase/*).
 *
 * See DESIGN_PUBLISHING.md. v1 stub — no real publish flow yet (Bout 9).
 */

import { getState, subscribe } from '../core/state';
import { navigate, publishDetailHash } from '../core/router';

export function mountPublishRoom(target: HTMLElement): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-publish-room';
  target.appendChild(root);

  function render(): void {
    const active = getState().active;
    if (!active) {
      root.innerHTML = '<div class="atlas-pane-empty">No active world.</div>';
      return;
    }
    const entry = getState().registry.worlds.find(w => w.id === active.worldId);
    const showcases = entry?.showcases ?? [];

    root.innerHTML = '';

    const header = document.createElement('header');
    header.className = 'atlas-room-header';
    header.innerHTML = `
      <h1>Publish</h1>
      <p class="atlas-room-subtitle">
        Share elements as public showcases. Each publish creates a snapshot
        with its own URL. See <a href="https://onlyworlds.com/showcase" target="_blank">onlyworlds.com/showcase</a>.
      </p>
    `;
    root.appendChild(header);

    if (showcases.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'atlas-pane-empty atlas-publish-empty';
      empty.innerHTML = `
        <p>No publications yet.</p>
        <p class="atlas-publish-hint">
          Open an element and use the publish action to create a showcase.
          (Publish flow lands in a future session.)
        </p>
      `;
      root.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'atlas-publish-list';
    for (const sc of showcases) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'atlas-publish-row';
      row.innerHTML = `
        <div class="atlas-publish-row-main">
          <span class="atlas-publish-row-name">${escapeText(sc.element_type)} · ${escapeText(sc.element_id.slice(0, 8))}</span>
          <span class="atlas-publish-row-meta">Published ${escapeText(sc.published_at)}</span>
        </div>
        <span class="atlas-publish-row-url">${escapeText(sc.public_url)}</span>
      `;
      row.addEventListener('click', () => {
        navigate(publishDetailHash(active.worldId, sc.showcase_id));
      });
      list.appendChild(row);
    }
    root.appendChild(list);
  }

  const unsub = subscribe(render);
  render();
  return () => unsub();
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
