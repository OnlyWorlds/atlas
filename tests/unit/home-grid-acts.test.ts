/**
 * The home grid's acts by presses and keys (the home that grows, release b):
 * a holding target writes on the second press; a line target's first press
 * says its promise and writes nothing, and a second press or Place writes; a
 * press on a third square writes nothing; a pair the table offers nothing for
 * says so; Tab walks the targets in grid order, a target that arrived before
 * the held square included; each lit target carries its promise.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resetGridActsForTests, wireGridActs, type ActsOptions } from '../../src/middle/home-grid-acts';

interface Sq { id: string; line: number; pos: number; row?: number }

/** Squares appended in the order given (arrival), placed where `line`, `pos`, `row` say. */
function grid(squares: Sq[]): HTMLElement {
  const host = document.createElement('div');
  for (const s of squares) {
    const cell = document.createElement('div');
    cell.setAttribute('data-grid-id', s.id);
    cell.setAttribute('data-line', String(s.line));
    cell.setAttribute('data-pos', String(s.pos));
    cell.setAttribute('data-row', String(s.row ?? 0));
    const name = document.createElement('span');
    name.className = 'atlas-home-grid-name';
    name.textContent = s.id;
    cell.appendChild(name);
    host.appendChild(cell);
  }
  document.body.appendChild(host);
  return host;
}

/** Mira (a character) holds into a place, lists into an event; Ilse is a character too (no pair). */
function acts(host: HTMLElement, over: Partial<ActsOptions> = {}) {
  const drops: [string, string][] = [];
  const said: (string | null)[] = [];
  let place: (() => void) | undefined;
  const targets: Record<string, string[]> = { Mira: ['Harbour', 'Founding'], Ilse: ['Harbour', 'Founding'] };
  const unwire = wireGridActs(host, {
    worldId: 'w',
    targetsOf: id => targets[id] ?? [],
    writeOf: (from, to) => to === 'Harbour' ? { promise: `${from} will be in ${to}`, holds: true }
      : to === 'Founding' ? { promise: `${to} will list ${from}`, holds: false } : null,
    cannotLink: (a, b) => a !== b && ['Mira', 'Ilse'].includes(a) && ['Mira', 'Ilse'].includes(b) ? `${a} and ${b} cannot be linked by placing` : null,
    say: (text, p) => { said.push(text); place = p; },
    drop: (a, b) => { drops.push([a, b]); },
    open: () => {},
    onSelect: () => {},
    ...over,
  });
  return { drops, said, place: () => place, unwire };
}

const cell = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-grid-id="${id}"]`)!;
const key = (el: HTMLElement, k: string, shift = false) => {
  const e = new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
};

afterEach(() => { resetGridActsForTests(); document.body.innerHTML = ''; });

describe('presses', () => {
  it('a holding target writes on the second press', () => {
    const host = grid([{ id: 'Mira', line: 0, pos: 0 }, { id: 'Harbour', line: 0, pos: 1 }]);
    const a = acts(host);
    cell(host, 'Mira').click();
    expect(cell(host, 'Harbour').classList.contains('is-target')).toBe(true);
    cell(host, 'Harbour').click();
    expect(a.drops).toEqual([['Mira', 'Harbour']]);
  });

  it('a line target\'s first press says its promise and writes nothing; the second press writes', () => {
    const host = grid([{ id: 'Mira', line: 0, pos: 0 }, { id: 'Founding', line: 0, pos: 1 }]);
    const a = acts(host);
    cell(host, 'Mira').click();
    cell(host, 'Founding').click();
    expect(a.drops).toEqual([]);
    expect(a.said[a.said.length - 1]).toBe('Founding will list Mira');
    expect(cell(host, 'Mira').classList.contains('is-selected')).toBe(true);
    cell(host, 'Founding').click();
    expect(a.drops).toEqual([['Mira', 'Founding']]);
  });

  it('Place writes the promised line', () => {
    const host = grid([{ id: 'Mira', line: 0, pos: 0 }, { id: 'Founding', line: 0, pos: 1 }]);
    const a = acts(host);
    cell(host, 'Mira').click();
    cell(host, 'Founding').click();
    a.place()!();
    expect(a.drops).toEqual([['Mira', 'Founding']]);
  });

  it('press Mira, press The Founding, press a third square: nothing written, the selection moves', () => {
    const host = grid([{ id: 'Mira', line: 0, pos: 0 }, { id: 'Founding', line: 0, pos: 1 }, { id: 'Harbour', line: 0, pos: 2 }]);
    const a = acts(host);
    cell(host, 'Mira').click();
    cell(host, 'Founding').click();
    cell(host, 'Harbour').click();
    expect(a.drops).toEqual([]);
    expect(cell(host, 'Harbour').classList.contains('is-selected')).toBe(true);
    expect(a.said[a.said.length - 1]).toBeNull();
  });

  it('two Characters: no target, and the line says they cannot be linked by placing', () => {
    const host = grid([{ id: 'Mira', line: 0, pos: 0 }, { id: 'Ilse', line: 0, pos: 1 }]);
    const a = acts(host);
    cell(host, 'Mira').click();
    expect(cell(host, 'Ilse').classList.contains('is-target')).toBe(false);
    cell(host, 'Ilse').click();
    expect(a.drops).toEqual([]);
    expect(a.said[a.said.length - 1]).toBe('Mira and Ilse cannot be linked by placing');
  });

  it('a said line goes with Escape, another press or an act', () => {
    const host = grid([{ id: 'Mira', line: 0, pos: 0 }, { id: 'Ilse', line: 0, pos: 1 }, { id: 'Harbour', line: 0, pos: 2 }]);
    const a = acts(host);
    cell(host, 'Mira').click();
    cell(host, 'Ilse').click();
    expect(a.said[a.said.length - 1]).toBe('Mira and Ilse cannot be linked by placing');
    key(cell(host, 'Ilse'), 'Escape');
    expect(a.said[a.said.length - 1]).toBeNull();
    cell(host, 'Mira').click();
    cell(host, 'Ilse').click();
    cell(host, 'Harbour').click();
    expect(a.said[a.said.length - 1]).toBeNull();
  });

  it('a press on the selected square lets go, and Enter is a press', () => {
    const host = grid([{ id: 'Mira', line: 0, pos: 0 }, { id: 'Founding', line: 0, pos: 1 }]);
    const a = acts(host);
    key(cell(host, 'Mira'), 'Enter');
    key(cell(host, 'Founding'), 'Enter');
    expect(a.drops).toEqual([]);
    key(cell(host, 'Founding'), 'Enter');
    expect(a.drops).toEqual([['Mira', 'Founding']]);
  });
});

describe('Tab while a square is held', () => {
  // The Harbour arrived first (its square is first in the page), Mira after it; The Founding last.
  const squares: Sq[] = [{ id: 'Harbour', line: 0, pos: 0 }, { id: 'Mira', line: 0, pos: 1 }, { id: 'Founding', line: 0, pos: 2 }];

  it('walks the held square, then its targets in grid order, a target that arrived first included', () => {
    const host = grid(squares);
    acts(host);
    cell(host, 'Mira').focus();
    key(cell(host, 'Mira'), 'Enter');
    const e = key(cell(host, 'Mira'), 'Tab');
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cell(host, 'Harbour'));
    key(cell(host, 'Harbour'), 'Tab');
    expect(document.activeElement).toBe(cell(host, 'Founding'));
    key(cell(host, 'Founding'), 'Tab', true);
    expect(document.activeElement).toBe(cell(host, 'Harbour'));
  });

  it('Tab past the last leaves the grid and ends the press; Shift+Tab before the held square too', () => {
    const host = grid(squares);
    acts(host);
    key(cell(host, 'Mira'), 'Enter');
    cell(host, 'Founding').focus();
    const e = key(cell(host, 'Founding'), 'Tab');
    expect(e.defaultPrevented).toBe(false);
    expect(host.querySelector('.is-selected')).toBeNull();
    expect(host.querySelector('.is-target')).toBeNull();
    key(cell(host, 'Mira'), 'Enter');
    const back = key(cell(host, 'Mira'), 'Tab', true);
    expect(back.defaultPrevented).toBe(false);
    expect(host.querySelector('.is-selected')).toBeNull();
    // One Tab stop again.
    expect(host.querySelectorAll('[data-grid-id][tabindex="0"]').length).toBe(1);
  });

  it('each lit target carries its promise as its description', () => {
    const host = grid(squares);
    acts(host);
    key(cell(host, 'Mira'), 'Enter');
    const desc = (id: string) => document.getElementById(cell(host, id).getAttribute('aria-describedby') ?? '')?.textContent;
    expect(desc('Harbour')).toBe('Mira will be in Harbour');
    expect(desc('Founding')).toBe('Founding will list Mira');
    expect(cell(host, 'Mira').hasAttribute('aria-describedby')).toBe(false);
    key(cell(host, 'Mira'), 'Escape');
    expect(cell(host, 'Harbour').hasAttribute('aria-describedby')).toBe(false);
  });
});
