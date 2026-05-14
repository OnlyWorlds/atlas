/**
 * Middle pane — Timeline (v1).
 *
 * Horizontal axis with event dots laid out by start date (or sort order if
 * no date is parseable). Click a dot → navigate to that event's detail.
 *
 * Reads from `state.data.elements` filtered by `type === 'event'`.
 */

import { getState, patchSlice, subscribe } from '../core/state';
import { onHashChange, navigate, elementHash } from '../core/router';
import type { Element } from '../core/types';
import { ToastManager } from '../ui/toast-manager';
import { ElementCreateModal } from '../ui/element-create-modal';

interface PositionedEvent {
  element: Element;
  pos: number;
  dateLabel: string;
}

export function mountTimeline(target: HTMLElement, toasts: ToastManager): () => void {
  target.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'atlas-timeline';
  wrap.style.cssText = 'display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:hidden;';
  target.appendChild(wrap);

  function render(): void {
    wrap.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'atlas-timeline-header';
    header.innerHTML = `
      <span class="material-symbols-outlined">timeline</span>
      <h2>Timeline</h2>
      <div style="flex:1 1 auto"></div>
      <button class="atlas-btn-ghost" data-action="new-event" title="create a new event">+ Event</button>
    `;
    header.querySelector<HTMLButtonElement>('[data-action="new-event"]')!.addEventListener('click', () => {
      new ElementCreateModal(toasts, { initialType: 'event' }).open();
    });
    wrap.appendChild(header);

    const canvas = document.createElement('div');
    canvas.className = 'atlas-timeline-canvas';
    wrap.appendChild(canvas);

    const axis = document.createElement('div');
    axis.className = 'atlas-timeline-axis';
    canvas.appendChild(axis);

    const line = document.createElement('div');
    line.className = 'atlas-timeline-line';
    axis.appendChild(line);

    const events = getState().data.elements.filter(e => e.type === 'event');
    const layout = layoutEvents(events);

    if (layout.hasDates && layout.minDate !== null && layout.maxDate !== null) {
      const ticks = niceTicks(layout.minDate, layout.maxDate, 6);
      ticks.forEach(t => {
        const tick = document.createElement('div');
        tick.className = 'atlas-timeline-tick';
        tick.style.left = `${((t - layout.minDate!) / (layout.maxDate! - layout.minDate! || 1)) * 100}%`;
        axis.appendChild(tick);

        const tlabel = document.createElement('div');
        tlabel.className = 'atlas-timeline-tick-label';
        tlabel.textContent = formatTick(t);
        tlabel.style.left = `${((t - layout.minDate!) / (layout.maxDate! - layout.minDate! || 1)) * 100}%`;
        axis.appendChild(tlabel);
      });
    }

    layout.positioned.forEach(pe => {
      const dot = document.createElement('div');
      dot.className = 'atlas-timeline-dot';
      dot.style.left = `${pe.pos * 100}%`;
      dot.title = pe.dateLabel === '—' ? pe.element.name : `${pe.element.name} · ${pe.dateLabel}`;

      const lbl = document.createElement('div');
      lbl.className = 'atlas-timeline-dot-label';
      lbl.style.left = `${pe.pos * 100}%`;
      lbl.textContent = pe.element.name;

      dot.addEventListener('mouseenter', () => { lbl.style.opacity = '1'; });
      dot.addEventListener('mouseleave', () => { lbl.style.opacity = '0.7'; });

      dot.addEventListener('click', () => {
        const worldId = getState().active?.worldId;
        if (!worldId) return;
        patchSlice('ui', { ...getState().ui, selectedElementId: pe.element.id });
        navigate(elementHash(worldId, pe.element.id));
      });

      axis.appendChild(dot);
      axis.appendChild(lbl);
    });

    if (events.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'atlas-timeline-empty';
      empty.innerHTML = `
        <span class="material-symbols-outlined">timeline</span>
        <div style="font-size:13px">no events yet</div>
        <div style="font-size:11px;color:var(--atlas-text-dim);max-width:280px;text-align:center;">
          click <b style="color:var(--atlas-text-soft)">+ event</b> above to start building your world's history.
        </div>
      `;
      axis.appendChild(empty);
    }
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();
  return () => { unsubState(); unsubHash(); };
}

// ============================================================
// Layout helpers
// ============================================================

interface LayoutResult {
  positioned: PositionedEvent[];
  hasDates: boolean;
  minDate: number | null;
  maxDate: number | null;
}

function layoutEvents(events: Element[]): LayoutResult {
  const withDate: Array<{ e: Element; d: number }> = [];
  const undated: Element[] = [];

  for (const e of events) {
    const d = parseEventDate(e);
    if (d !== null) withDate.push({ e, d });
    else undated.push(e);
  }

  if (withDate.length === 0) {
    return {
      positioned: undated.map((e, i) => ({
        element: e,
        pos: undated.length === 1 ? 0.5 : i / (undated.length - 1),
        dateLabel: '—',
      })),
      hasDates: false,
      minDate: null,
      maxDate: null,
    };
  }

  const dates = withDate.map(x => x.d);
  let minD = Math.min(...dates);
  let maxD = Math.max(...dates);
  if (minD === maxD) {
    minD -= 1;
    maxD += 1;
  }
  const range = maxD - minD;

  const positioned: PositionedEvent[] = [];
  undated.forEach((e, i) => {
    positioned.push({
      element: e,
      pos: -0.04 - (i % 4) * 0.008,
      dateLabel: '—',
    });
  });
  withDate.forEach(({ e, d }) => {
    positioned.push({
      element: e,
      pos: (d - minD) / range,
      dateLabel: formatTick(d),
    });
  });

  return { positioned, hasDates: true, minDate: minD, maxDate: maxD };
}

function parseEventDate(el: Element): number | null {
  const candidates: unknown[] = [
    (el as any).start_date,
    (el as any).date,
    (el as any).year,
    (el as any).timestamp,
    (el as any).when,
  ];
  for (const c of candidates) {
    if (c === undefined || c === null || c === '') continue;
    const n = Number(c);
    if (Number.isFinite(n)) return n;
    const t = Date.parse(String(c));
    if (Number.isFinite(t)) return t;
  }
  return null;
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min];
  const range = max - min;
  const step = nicestep(range / count);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) {
    ticks.push(v);
    if (ticks.length > 100) break;
  }
  return ticks;
}

function nicestep(raw: number): number {
  if (raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const f = raw / Math.pow(10, exp);
  let n: number;
  if (f < 1.5) n = 1;
  else if (f < 3) n = 2;
  else if (f < 7) n = 5;
  else n = 10;
  return n * Math.pow(10, exp);
}

function formatTick(n: number): string {
  if (Math.abs(n) > 10_000_000_000) {
    return new Date(n).getUTCFullYear().toString();
  }
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
