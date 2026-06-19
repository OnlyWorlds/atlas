/**
 * Timeline room — the full, interactive timeline view.
 *
 * Mounts the room-grade `timeline-view` (canvas + DOM card; see
 * src/visualization/timeline/timeline-view.ts) — NOT the compact home bar.
 * Selection round-trips through the URL: clicking an event navigates to
 * `/timeline/<id>`, which (a) keeps this room mounted (mode stays 'timeline',
 * app.ts only re-mounts on mode change) and (b) focuses the right-pane context
 * graph on the same element (context-tab's timeline case). Chip clicks jump to
 * the element room. See DESIGN_TIMELINE.md.
 */

import { getState, subscribe } from '../core/state';
import { navigate, elementHash, timelineHash, parseHash, onHashChange } from '../core/router';
import { ToastManager } from '../ui/toast-manager';
import { ElementCreateModal } from '../ui/element-create-modal';
import { mountTimelineView, type TimelineViewHandle } from '../visualization/timeline/timeline-view';

export function mountTimeline(target: HTMLElement, toasts: ToastManager): () => void {
  target.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'atlas-timeline-room';
  target.appendChild(wrap);

  // Room landing header — big-title treatment, matching every other room.
  const header = document.createElement('header');
  header.className = 'atlas-room-header';
  header.innerHTML = `
    <h1>Timeline</h1>
    <p class="atlas-room-subtitle">Your world along a time axis — click any event to see everything it touches.</p>
  `;
  wrap.appendChild(header);

  const actions = document.createElement('div');
  actions.className = 'atlas-room-actions';
  const newEventBtn = document.createElement('button');
  newEventBtn.type = 'button';
  newEventBtn.className = 'atlas-btn-ghost';
  newEventBtn.dataset.action = 'new-event';
  newEventBtn.title = 'Create a new event';
  newEventBtn.textContent = '+ Event';
  newEventBtn.addEventListener('click', () => {
    new ElementCreateModal(toasts, { initialType: 'event' }).open();
  });
  actions.appendChild(newEventBtn);
  wrap.appendChild(actions);

  const viewMount = document.createElement('div');
  viewMount.className = 'atlas-timeline-view-mount';
  wrap.appendChild(viewMount);

  let handle: TimelineViewHandle | null = null;

  function currentWorldId(): string | null {
    return getState().active?.worldId ?? null;
  }

  function render(): void {
    const worldId = currentWorldId();
    if (!worldId) return;
    if (!handle) {
      handle = mountTimelineView(viewMount, {
        onSelect: (elementId) => {
          const wid = currentWorldId();
          if (!wid) return;
          // Empty id = the card's close button → clear selection.
          navigate(elementId ? timelineHash(wid, elementId) : timelineHash(wid));
        },
        onNavigateToElement: (elementId) => {
          const wid = currentWorldId();
          if (wid) navigate(elementHash(wid, elementId));
        },
      });
    }
    handle.setElements(getState().data.elements);
    const route = parseHash(window.location.hash);
    handle.setSelection(route.mode === 'timeline' ? (route.elementId ?? null) : null);
  }

  if (getState().active) render();
  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);

  return () => {
    unsubState();
    unsubHash();
    handle?.destroy();
    handle = null;
  };
}
