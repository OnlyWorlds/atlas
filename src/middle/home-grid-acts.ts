/**
 * The home grid's acts (the home that grows): three ways in, one write.
 *
 *   A press (or Enter) selects a square and lights every square it can go
 *   to; a press on a lit square drops there; a second press, Escape or a
 *   press on empty space lets go. A mouse or pen drag past 4 px lifts the
 *   square and drops on the lit square under the pointer, or springs back.
 *   Touch never drags: the page's scroll owns it, and two presses serve.
 *   Ctrl or Cmd and a press opens the element, as in the Web.
 *
 *   The grid is one Tab stop: arrows move by the grid as drawn, skipping an
 *   empty column to the next square that way; once a square is selected
 *   they move among its lit squares only.
 *
 * The selection is memory for one world, kept across the home's redraws.
 */

import { markEscapeOwned } from '../core/escape-mark';

export interface ActsOptions {
  worldId: string;
  /** The squares `id` can be dropped on (P4, P5, P8 already applied). */
  targetsOf(id: string): string[];
  drop(from: string, to: string): void;
  open(id: string): void;
  /** The selection changed (null: none), for the card's Open line. */
  onSelect(id: string | null): void;
}

let selected: { worldId: string; id: string } | null = null;
let focusId: string | null = null;

export function selectedIn(worldId: string): string | null {
  return selected && selected.worldId === worldId ? selected.id : null;
}

const DRAG_PX = 4;

interface CellPos { id: string; line: number; pos: number; row: number; el: HTMLElement }

function cellsOf(host: HTMLElement): CellPos[] {
  return [...host.querySelectorAll<HTMLElement>('[data-grid-id]')].map(el => ({
    id: el.getAttribute('data-grid-id')!,
    line: Number(el.getAttribute('data-line')),
    pos: Number(el.getAttribute('data-pos')),
    row: Number(el.getAttribute('data-row')),
    el,
  }));
}

/** The next square from `from` in a direction, by the grid as drawn: rows count down a line, then the next line. */
function step(cells: CellPos[], from: CellPos, key: string): CellPos | null {
  const y = (c: CellPos): number => c.line * 1000 + c.row;
  const candidates = cells.filter(c => c.id !== from.id && (
    key === 'ArrowRight' ? y(c) === y(from) && c.pos > from.pos
      : key === 'ArrowLeft' ? y(c) === y(from) && c.pos < from.pos
        : key === 'ArrowDown' ? y(c) > y(from)
          : y(c) < y(from)));
  if (!candidates.length) return null;
  const score = (c: CellPos): number => key === 'ArrowRight' || key === 'ArrowLeft'
    ? Math.abs(c.pos - from.pos)
    : Math.abs(y(c) - y(from)) * 100 + Math.abs(c.pos - from.pos);
  return candidates.sort((a, b) => score(a) - score(b))[0];
}

/** Wire a freshly drawn grid. Returns its unwire. */
export function wireGridActs(host: HTMLElement, opts: ActsOptions): () => void {
  if (selected && selected.worldId !== opts.worldId) selected = null;
  const cells = cellsOf(host);
  if (selected && !cells.some(c => c.id === selected!.id)) selected = null;

  const paint = (): void => {
    const sel = selectedIn(opts.worldId);
    const lit = new Set(sel ? opts.targetsOf(sel) : []);
    for (const c of cells) {
      c.el.classList.toggle('is-selected', c.id === sel);
      c.el.classList.toggle('is-target', lit.has(c.id));
      c.el.setAttribute('aria-pressed', String(c.id === sel));
    }
    host.classList.toggle('has-selection', !!sel);
  };
  const roving = (): void => {
    const keep = cells.find(c => c.id === focusId) ?? cells.find(c => c.id === selectedIn(opts.worldId)) ?? cells[0];
    for (const c of cells) c.el.tabIndex = c === keep ? 0 : -1;
  };
  const select = (id: string | null): void => {
    selected = id ? { worldId: opts.worldId, id } : null;
    paint();
    opts.onSelect(id);
  };
  const press = (id: string): void => {
    const sel = selectedIn(opts.worldId);
    if (sel === id) { select(null); return; }
    if (sel && opts.targetsOf(sel).includes(id)) { select(null); opts.drop(sel, id); return; }
    select(id);
  };

  for (const c of cells) {
    c.el.setAttribute('role', 'button');
    const square = c.el.querySelector('.atlas-home-grid-name');
    c.el.setAttribute('aria-label', square?.textContent ?? '');
  }
  roving();
  paint();

  let drag: { id: string; x: number; y: number; lifted: boolean; pointer: number; el: HTMLElement } | null = null;
  let swallowClick = false;

  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-grid-id]');
    if (!el || !host.contains(el)) return;
    drag = { id: el.getAttribute('data-grid-id')!, x: e.clientX, y: e.clientY, lifted: false, pointer: e.pointerId, el };
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.lifted && Math.hypot(dx, dy) < DRAG_PX) return;
    if (!drag.lifted) {
      drag.lifted = true;
      selected = { worldId: opts.worldId, id: drag.id };
      paint();
      drag.el.classList.add('is-lifted');
      try { drag.el.setPointerCapture(e.pointerId); } catch { /* a pointer gone already */ }
    }
    drag.el.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const endDrag = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag;
    drag = null;
    if (!d.lifted) return;
    swallowClick = true;
    d.el.classList.remove('is-lifted');
    d.el.style.transform = '';
    // The square under the pointer, the lifted one looked through.
    d.el.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-grid-id]');
    d.el.style.pointerEvents = '';
    const to = under && host.contains(under) ? under.getAttribute('data-grid-id') : null;
    const ok = to && opts.targetsOf(d.id).includes(to);
    select(null);
    if (ok) opts.drop(d.id, to!);
  };
  const onClick = (e: MouseEvent): void => {
    if (swallowClick) { swallowClick = false; return; }
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-grid-id]');
    if (!el || !host.contains(el)) { if (selectedIn(opts.worldId)) select(null); return; }
    const id = el.getAttribute('data-grid-id')!;
    focusId = id;
    if (e.ctrlKey || e.metaKey) { opts.open(id); return; }
    press(id);
  };
  const onKey = (e: KeyboardEvent): void => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-grid-id]');
    if (!el) return;
    const id = el.getAttribute('data-grid-id')!;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { opts.open(id); return; }
      press(id);
      return;
    }
    if (e.key === 'Escape' && selectedIn(opts.worldId)) {
      // Marked, never stopped: the global deselect-to-home reads the mark and steps aside.
      markEscapeOwned(e);
      select(null);
      return;
    }
    if (!e.key.startsWith('Arrow')) return;
    e.preventDefault();
    const sel = selectedIn(opts.worldId);
    const pool = sel ? cells.filter(c => c.id === sel || opts.targetsOf(sel).includes(c.id)) : cells;
    const from = cells.find(c => c.id === id)!;
    const next = step(pool, from, e.key);
    if (!next) return;
    focusId = next.id;
    roving();
    next.el.focus();
  };

  host.addEventListener('pointerdown', onPointerDown);
  host.addEventListener('pointermove', onPointerMove);
  host.addEventListener('pointerup', endDrag);
  host.addEventListener('pointercancel', endDrag);
  host.addEventListener('click', onClick);
  host.addEventListener('keydown', onKey);
  return () => {
    host.removeEventListener('pointerdown', onPointerDown);
    host.removeEventListener('pointermove', onPointerMove);
    host.removeEventListener('pointerup', endDrag);
    host.removeEventListener('pointercancel', endDrag);
    host.removeEventListener('click', onClick);
    host.removeEventListener('keydown', onKey);
  };
}

/** Test seam. */
export function resetGridActsForTests(): void {
  selected = null;
  focusId = null;
}
