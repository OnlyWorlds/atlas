/**
 * Timeline room — full timeline view.
 *
 * Session 223 swap: previous event-only DOM timeline replaced with the new
 * canvas-based timeline-bar (see src/visualization/timeline/), which renders
 * all temporal element types (events, narratives, characters w/ birth_date,
 * etc.) per the OW schema's temporal field mapping. See DESIGN_HOME.md and
 * the timeline-bar source for the layout algorithm and deferred features.
 */

import { getState, subscribe } from '../core/state';
import { navigate, elementHash } from '../core/router';
import { ToastManager } from '../ui/toast-manager';
import { ElementCreateModal } from '../ui/element-create-modal';
import { mountTimelineBar, type TimelineBarHandle } from '../visualization/timeline/timeline-bar';

export function mountTimeline(target: HTMLElement, toasts: ToastManager): () => void {
  target.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'atlas-timeline-room';
  target.appendChild(wrap);

  const header = document.createElement('div');
  header.className = 'atlas-timeline-header';
  header.innerHTML = `
    <span class="material-symbols-outlined">timeline</span>
    <h2>Timeline</h2>
    <div style="flex:1 1 auto"></div>
    <button class="atlas-btn-ghost" data-action="new-event" title="Create a new event">+ Event</button>
  `;
  header.querySelector<HTMLButtonElement>('[data-action="new-event"]')!.addEventListener('click', () => {
    new ElementCreateModal(toasts, { initialType: 'event' }).open();
  });
  wrap.appendChild(header);

  const barMount = document.createElement('div');
  barMount.className = 'atlas-timeline-bar-mount';
  wrap.appendChild(barMount);

  const active = getState().active;
  let handle: TimelineBarHandle | null = null;

  function render(): void {
    if (!handle) {
      handle = mountTimelineBar(barMount, {
        mode: 'expanded',
        onNavigate: (elementId) => {
          const a = getState().active;
          if (!a) return;
          navigate(elementHash(a.worldId, elementId));
        },
      });
    }
    handle.setElements(getState().data.elements);
  }

  if (active) render();
  const unsub = subscribe(render);

  return () => {
    unsub();
    handle?.destroy();
    handle = null;
  };
}
