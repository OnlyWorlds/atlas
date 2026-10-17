/**
 * Drawing overlay strip (DESIGN_ZONES.md §2.5).
 *
 * Floating control bar near the top-center of the canvas, mounted only while
 * a draft is active. Shows marker count + undo/finish/cancel + shift-snap
 * hint.
 */

import type { DrawMode } from './zone-drawing';

export interface DrawingOverlayRefs {
  root: HTMLDivElement;
  update(markerCount: number, minMarkers: number): void;
  /** Mirror the trace toggle (S423). */
  setTrace(on: boolean): void;
}

export function buildDrawingOverlay(
  mode: DrawMode,
  handlers: { onUndo: () => void; onFinish: () => void; onCancel: () => void; onTrace: (on: boolean) => void },
): DrawingOverlayRefs {
  const root = document.createElement('div');
  root.className = 'atlas-zone-draft-overlay';
  root.setAttribute('data-zone-draft-overlay', '');

  root.innerHTML = `
    <span class="atlas-zone-draft-mode">${mode.charAt(0).toUpperCase()}${mode.slice(1)}</span>
    <span class="atlas-zone-draft-count"><span class="atlas-zone-draft-count-num">0</span> markers</span>
    <span class="atlas-zone-draft-hint" title="Hold shift while clicking to snap the new marker to a 45° axis from the previous marker; chain four shift-clicks for a perfect rectangle">Hold <kbd>Shift</kbd> to snap to 45° axis</span>
    <button type="button" class="atlas-zone-draft-btn" data-action="trace" aria-pressed="false" title="Drag on the map to trace a stretch; it keeps the few points that carry its shape. Clicks still place single points.">
      <span class="material-symbols-outlined" aria-hidden="true">gesture</span>
      Trace
    </button>
    <span class="atlas-zone-draft-spacer"></span>
    <span class="atlas-zone-draft-keys">
      <kbd>Enter</kbd> finish · <kbd>Esc</kbd> cancel
    </span>
    <button type="button" class="atlas-zone-draft-btn" data-action="undo" disabled>
      <span class="material-symbols-outlined">undo</span>
    </button>
    <button type="button" class="atlas-zone-draft-btn atlas-zone-draft-btn-primary" data-action="finish" disabled>
      <span class="material-symbols-outlined">check</span>
      Finish
    </button>
    <button type="button" class="atlas-zone-draft-btn atlas-zone-draft-btn-secondary" data-action="cancel">
      <span class="material-symbols-outlined">close</span>
      Cancel
    </button>
  `;

  const countEl = root.querySelector<HTMLSpanElement>('.atlas-zone-draft-count-num')!;
  const undoBtn = root.querySelector<HTMLButtonElement>('[data-action="undo"]')!;
  const finishBtn = root.querySelector<HTMLButtonElement>('[data-action="finish"]')!;
  const cancelBtn = root.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
  const traceBtn = root.querySelector<HTMLButtonElement>('[data-action="trace"]')!;
  const hintEl = root.querySelector<HTMLSpanElement>('.atlas-zone-draft-hint')!;

  undoBtn.addEventListener('click', e => { e.stopPropagation(); handlers.onUndo(); });
  finishBtn.addEventListener('click', e => { e.stopPropagation(); handlers.onFinish(); });
  cancelBtn.addEventListener('click', e => { e.stopPropagation(); handlers.onCancel(); });
  traceBtn.addEventListener('click', e => {
    e.stopPropagation();
    handlers.onTrace(traceBtn.getAttribute('aria-pressed') !== 'true');
  });

  function update(count: number, min: number): void {
    countEl.textContent = String(count);
    undoBtn.disabled = count === 0;
    finishBtn.disabled = count < min;
    finishBtn.title = count < min ? `Need at least ${min} markers` : 'Finish drawing';
  }

  const shiftHint = hintEl.innerHTML;
  function setTrace(on: boolean): void {
    traceBtn.setAttribute('aria-pressed', String(on));
    traceBtn.classList.toggle('is-active', on);
    hintEl.innerHTML = on ? 'Drag to trace · the wheel zooms' : shiftHint;
  }

  return { root, update, setTrace };
}
