/**
 * The home grid's acts (the home that grows): three ways in, one write.
 *
 *   A press (or Enter) selects a square and lights every square it can go
 *   to. A press on a lit square that holds (a Character onto a Location)
 *   places it there. A press on a lit square that would draw a line (a
 *   Character onto an Event) first says what it would write, with a Place
 *   button, and keeps the press: a second press on it, or Place, writes. So
 *   a browse by presses on a phone never writes a line. A press on any other
 *   square changes the selection and writes nothing; a pair the table offers
 *   nothing for says so. A second press on the selected square, Escape or a
 *   press on empty space lets go.
 *
 *   A mouse or pen drag past 4 px lifts the square and drops on the lit
 *   square under the pointer (a line pair too, at once), or springs back.
 *   Touch never drags: the page's scroll owns it, and two presses serve.
 *   Ctrl or Cmd and a press opens the element, as in the Web.
 *
 *   The grid is one Tab stop: arrows move by the grid as drawn, skipping an
 *   empty column to the next square that way; once a square is selected
 *   they move among it and its lit squares only, and Tab and Shift+Tab walk
 *   the same squares in grid order. Tab past the last, or Shift+Tab before
 *   the selected square, leaves the grid and lets go. Each lit square
 *   carries what a drop on it would write as its description.
 *
 * The selection is memory for one world, kept across the home's redraws.
 */

import { markEscapeOwned } from '../core/escape-mark';

export interface ActsOptions {
  worldId: string;
  /** The squares `id` can be dropped on (P4, P5, P8 already applied). */
  targetsOf(id: string): string[];
  /** What a drop of `from` on the lit `to` would write: its promise, and whether one square holds the other. */
  writeOf(from: string, to: string): { promise: string; holds: boolean } | null;
  /** The sentence for a pair the table offers no link for at all ("Mira and Ilse cannot be linked by placing"), else null. */
  cannotLink(from: string, to: string): string | null;
  /** Say a line under the grid (null: the card's own line again); with `place`, a Place button that writes. */
  say(text: string | null, place?: () => void): void;
  drop(from: string, to: string): void;
  open(id: string): void;
  /** The selection changed (null: none), for the card's Open line. */
  onSelect(id: string | null): void;
}

let selected: { worldId: string; id: string } | null = null;
/** A line target's first press: its promise said, the write waiting for a second press or Place. */
let pending: { worldId: string; from: string; to: string } | null = null;
let focusId: string | null = null;
let describedSeq = 0;

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

/** Grid order: line by line, row by row, left to right (never the order the squares were added in). */
const gridOrder = (a: CellPos, b: CellPos): number => a.line - b.line || a.row - b.row || a.pos - b.pos;

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
  const byId = new Map(cells.map(c => [c.id, c] as const));

  // The lit squares' descriptions (what Enter or a drop there writes), hidden, read by `aria-describedby`.
  const notes = document.createElement('div');
  notes.hidden = true;
  notes.setAttribute('data-grid-promises', '');
  host.appendChild(notes);
  const prefix = `atlas-grid-promise-${++describedSeq}`;

  const paint = (): void => {
    const sel = selectedIn(opts.worldId);
    const lit = new Set(sel ? opts.targetsOf(sel) : []);
    notes.innerHTML = '';
    cells.forEach((c, i) => {
      c.el.classList.toggle('is-selected', c.id === sel);
      c.el.classList.toggle('is-target', lit.has(c.id));
      c.el.classList.toggle('is-pending', !!pending && pending.worldId === opts.worldId && pending.to === c.id);
      c.el.setAttribute('aria-pressed', String(c.id === sel));
      const promise = sel && lit.has(c.id) ? opts.writeOf(sel, c.id)?.promise : null;
      if (promise) {
        const note = document.createElement('span');
        note.id = `${prefix}-${i}`;
        note.textContent = promise;
        notes.appendChild(note);
        c.el.setAttribute('aria-describedby', note.id);
      } else c.el.removeAttribute('aria-describedby');
    });
    host.classList.toggle('has-selection', !!sel);
  };
  const roving = (): void => {
    const keep = cells.find(c => c.id === focusId) ?? cells.find(c => c.id === selectedIn(opts.worldId)) ?? cells[0];
    for (const c of cells) c.el.tabIndex = c === keep ? 0 : -1;
  };
  const select = (id: string | null): void => {
    selected = id ? { worldId: opts.worldId, id } : null;
    if (pending) { pending = null; opts.say(null); }
    paint();
    opts.onSelect(id);
  };
  const place = (from: string, to: string): void => {
    select(null);
    opts.drop(from, to);
  };
  /** A line target's first press: the promise and Place, the press kept. */
  const promise = (from: string, to: string, text: string): void => {
    pending = { worldId: opts.worldId, from, to };
    opts.say(text, () => place(from, to));
    paint();
  };
  const press = (id: string): void => {
    const sel = selectedIn(opts.worldId);
    if (sel === id) { select(null); return; }
    const waiting = pending && pending.worldId === opts.worldId && pending.from === sel ? pending : null;
    if (sel && waiting) {
      if (waiting.to === id) place(sel, id); else select(id);
      return;
    }
    if (sel && opts.targetsOf(sel).includes(id)) {
      const w = opts.writeOf(sel, id);
      if (w && !w.holds) promise(sel, id, w.promise); else place(sel, id);
      return;
    }
    const no = sel ? opts.cannotLink(sel, id) : null;
    select(id);
    if (no) opts.say(no);
  };

  for (const c of cells) {
    c.el.setAttribute('role', 'button');
    const square = c.el.querySelector('.atlas-home-grid-name');
    c.el.setAttribute('aria-label', square?.textContent ?? '');
  }
  // A promise said before a redraw is said again, while it is still true.
  if (pending) {
    const p = pending;
    const w = p.worldId === opts.worldId && selectedIn(opts.worldId) === p.from && byId.has(p.to)
      && opts.targetsOf(p.from).includes(p.to) ? opts.writeOf(p.from, p.to) : null;
    if (w && !w.holds) opts.say(w.promise, () => place(p.from, p.to)); else pending = null;
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
      if (pending) { pending = null; opts.say(null); }
      selected = { worldId: opts.worldId, id: drag.id };
      paint();
      drag.el.classList.add('is-lifted');
      try { drag.el.setPointerCapture(e.pointerId); } catch { /* a pointer gone already */ }
    }
    drag.el.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  /** Let go without a drop: the square springs back, nothing is written. */
  const springBack = (d: NonNullable<typeof drag>): void => {
    d.el.classList.remove('is-lifted');
    d.el.style.transform = '';
    select(null);
  };
  const endDrag = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag;
    drag = null;
    if (!d.lifted) return;
    swallowClick = true;
    // A cancelled pointer (the browser took it: a scroll, a lost window) is never a drop (the code gate's SHOULD).
    if (e.type === 'pointercancel') { springBack(d); return; }
    d.el.classList.remove('is-lifted');
    d.el.style.transform = '';
    // The square under the pointer, the lifted one looked through.
    d.el.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-grid-id]');
    d.el.style.pointerEvents = '';
    const to = under && host.contains(under) ? under.getAttribute('data-grid-id') : null;
    const ok = to && opts.targetsOf(d.id).includes(to);
    const no = to && !ok && to !== d.id ? opts.cannotLink(d.id, to) : null;
    select(null);
    if (ok) opts.drop(d.id, to!);
    else if (no) opts.say(no);
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
    // Escape mid-drag lets go: the release that follows writes nothing (the code gate's SHOULD).
    if (e.key === 'Escape' && drag?.lifted) {
      markEscapeOwned(e);
      const d = drag;
      drag = null;
      swallowClick = true;
      springBack(d);
      return;
    }
    if (e.key === 'Escape' && selectedIn(opts.worldId)) {
      // Marked, never stopped: the global deselect-to-home reads the mark and steps aside.
      markEscapeOwned(e);
      select(null);
      return;
    }
    const sel = selectedIn(opts.worldId);
    if (e.key === 'Tab' && sel && !e.altKey && !e.ctrlKey && !e.metaKey) {
      // The selected square, then its lit squares in grid order: the DOM's order is arrival, never this.
      const lit = new Set(opts.targetsOf(sel));
      const walk = [byId.get(sel)!, ...cells.filter(c => lit.has(c.id)).sort(gridOrder)].filter(Boolean);
      const at = walk.findIndex(c => c.id === id);
      if (at < 0) return;
      const next = walk[at + (e.shiftKey ? -1 : 1)];
      if (!next) {
        // Leaving the grid ends the press; the browser's own Tab then moves on from this square.
        focusId = id;
        select(null);
        roving();
        return;
      }
      e.preventDefault();
      focusId = next.id;
      roving();
      next.el.focus();
      return;
    }
    if (!e.key.startsWith('Arrow')) return;
    e.preventDefault();
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
    notes.remove();
  };
}

/** Test seam. */
export function resetGridActsForTests(): void {
  selected = null;
  pending = null;
  focusId = null;
}
