/**
 * The strand's filled boxes (R5, R7, R8): each names its element (a press opens it), shows the first
 * lines of its text, and offers Edit in place and a ⋯ disclosure holding "Use another <kind>" (today's
 * Change flow, its promise before the second press). The story's box says in two lines how the parts
 * join, each part a chip that brings its box into view. Where they are now, when it is where it
 * happened, is one line in its cell with its own ⋯. Once all five are filled, one line says the
 * strand is whole.
 */

import { ELEMENT_ICONS, ELEMENT_TYPE_COLORS } from '../core/constants';
import { escapeText } from '../core/dom-utils';
import { openElementTarget } from '../core/element-room';
import { hiddenRowWord } from '../core/hidden-mark';
import { markEscapeOwned } from '../core/escape-mark';
import { mayChange } from '../core/may-change';
import { isKnownOf } from '../sync/known-of';
import { maySetSlot, SLOT_TYPE, type StrandSlot } from '../core/strand';
import {
  boxTextOf, editOpening, sameCellWords, storyLines, SLOT_OTHER, SLOT_WORD,
} from '../core/strand-journey';
import { typeNameStart } from '../core/type-words';
import { openWebOn } from '../ui/open-web';
import { GRID_OPEN_ATTR, afterPress, gridClosed, watchLeave } from './home-grid-kinds';
import { memory, type StrandContext } from './home-strand-model';
import { act, actsRow, promiseRow, stampOf, type StrandPanelOptions } from './home-strand-acts';

const homeRoot = (): HTMLElement => document.querySelector<HTMLElement>('.atlas-world-home') ?? document.body;

/** The open Use another for this slot, if any. */
const openedFor = (slot: StrandSlot, c: StrandContext) =>
  (memory.opened && memory.opened.worldId === c.worldId && memory.opened.slot === slot && !memory.opened.card ? memory.opened : null);

/**
 * A menu opened under its ⋯ stays inside Home: anchored at the button's end by default, it flips to
 * open from the button's start when that end would run past Home's left edge (the same line's ⋯ wraps
 * to the cell's start at 390; the 1.120.0 code gate's C6).
 */
function keepInView(list: HTMLElement): void {
  list.style.left = '';
  list.style.right = '';
  const bounds = (list.closest('.atlas-world-home') ?? document.documentElement).getBoundingClientRect();
  const r = list.getBoundingClientRect();
  if (r.left < bounds.left) { list.style.left = '0'; list.style.right = 'auto'; }
}

/**
 * The ⋯ disclosure:a plain list of buttons under its opener (`aria-expanded`), holding Home's redraws
 * while open, closed by a press outside or the focus leaving, Escape owned with the focus back on ⋯.
 */
function moreMenu(slot: StrandSlot, label: string, items: Array<{ label: string; key: string; run: () => void }>): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-home-strand-more';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-btn-ghost atlas-home-strand-act atlas-home-strand-more-btn';
  btn.setAttribute('data-act', 'more');
  btn.setAttribute('data-strand-key', `${slot}:more`);
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">more_horiz</span>';
  const list = document.createElement('div');
  list.className = 'atlas-home-strand-menu';
  list.id = `atlas-strand-menu-${slot}`;
  list.hidden = true;
  btn.setAttribute('aria-controls', list.id);
  let open = false;
  let unwatch: () => void = () => {};
  const close = (how: 'escape' | 'press' | 'blur' | 'quiet'): void => {
    if (!open) return;
    open = false;
    unwatch();
    memory.openClosers.delete(quiet);
    list.hidden = true;
    wrap.removeAttribute(GRID_OPEN_ATTR);
    btn.setAttribute('aria-expanded', 'false');
    if (how === 'escape') { btn.focus(); gridClosed(homeRoot()); }
    else if (how === 'press') afterPress(() => gridClosed(homeRoot()));
    else if (how === 'blur') setTimeout(() => gridClosed(homeRoot()), 0);
  };
  const quiet = (): void => close('quiet');
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'atlas-home-strand-menu-item';
    b.setAttribute('data-act', 'another');
    b.setAttribute('data-strand-key', it.key);
    b.textContent = it.label;
    b.addEventListener('click', () => { close('quiet'); it.run(); });
    list.appendChild(b);
  }
  btn.addEventListener('click', () => {
    if (open) { close('quiet'); gridClosed(homeRoot()); return; }
    open = true;
    list.hidden = false;
    wrap.setAttribute(GRID_OPEN_ATTR, '');
    btn.setAttribute('aria-expanded', 'true');
    memory.openClosers.add(quiet);
    unwatch = watchLeave(wrap, t => wrap.contains(t), how => close(how));
    keepInView(list);
    list.querySelector<HTMLButtonElement>('button')?.focus();
  });
  wrap.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    markEscapeOwned(e);
    close('escape');
  });
  wrap.append(btn, list);
  return wrap;
}

/** Use another: the slot's ways to another element, today's Change flow. */
function useAnother(slot: StrandSlot, c: StrandContext, opts: StrandPanelOptions): () => void {
  return () => {
    memory.said = null;
    memory.opened = { worldId: c.worldId, slot, mode: 'acts', stamp: stampOf(slot, c) };
    memory.askFocus = { worldId: c.worldId, key: `${slot}:make` };
    opts.redraw();
  };
}

/** A chip naming a filled slot's element: a press brings that box into view, the focus on its name. */
function chip(slot: StrandSlot, id: string, name: string, c: StrandContext): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'atlas-home-strand-chip';
  b.setAttribute('data-chip', slot);
  b.style.setProperty('--type-color', ELEMENT_TYPE_COLORS[SLOT_TYPE[slot]]);
  b.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${escapeText(ELEMENT_ICONS[SLOT_TYPE[slot]] ?? 'category')}</span><span class="atlas-home-strand-chip-name"></span>`;
  b.querySelector('.atlas-home-strand-chip-name')!.textContent = name;
  const el = c.byId.get(id);
  const hidden = el ? hiddenRowWord(el, c.entry?.state) : '';
  if (hidden) b.insertAdjacentHTML('beforeend', hidden);
  // Where they are now, when it is where it happened, has no box of its own: the place's box answers.
  const to: StrandSlot = slot === 'now' && c.strand.same === true ? 'location' : slot;
  b.addEventListener('click', () => {
    const target = document.querySelector<HTMLElement>(`[data-role="home-strand"] [data-strand-key="${to}:open"]`);
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'nearest' });
  });
  return b;
}

/** The story's two lines (R5): only what is filled, never more than the links hold. */
function linesOf(c: StrandContext): HTMLElement | null {
  const lines = storyLines(c.strand, c.byId);
  if (lines.length === 0) return null;
  const wrap = document.createElement('div');
  wrap.className = 'atlas-home-strand-lines';
  wrap.setAttribute('data-role', 'strand-lines');
  for (const line of lines) {
    const p = document.createElement('p');
    for (const part of line) {
      if ('text' in part) p.appendChild(document.createTextNode(part.text));
      else p.appendChild(chip(part.chip, part.id, part.name, c));
    }
    wrap.appendChild(p);
  }
  return wrap;
}

/** A filled slot's box. */
export function buildFilledBox(slot: StrandSlot, c: StrandContext, opts: StrandPanelOptions): HTMLElement {
  const type = SLOT_TYPE[slot];
  const filled = c.strand[slot]!;
  const el = c.byId.get(filled.id);
  const box = document.createElement('div');
  box.className = `atlas-home-strand-box is-filled${slot === 'narrative' ? ' is-story' : ''}`;
  box.setAttribute('data-box', slot);
  box.style.setProperty('--type-color', ELEMENT_TYPE_COLORS[type]);
  const head = document.createElement('div');
  head.className = 'atlas-home-strand-box-head';
  const kind = typeNameStart(type);
  const word = SLOT_WORD[slot] === kind ? kind : `${SLOT_WORD[slot]} · ${kind}`;
  head.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${escapeText(ELEMENT_ICONS[type] ?? 'category')}</span><span class="atlas-home-strand-word">${escapeText(word)}</span>`;
  box.appendChild(head);
  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'atlas-btn-link atlas-home-strand-name';
  name.setAttribute('data-strand-key', `${slot}:open`);
  name.textContent = filled.name.trim() || 'Unnamed';
  name.title = `Open ${name.textContent}`;
  name.addEventListener('click', () => { if (el) openElementTarget(el, c.worldId); });
  const nameRow = document.createElement('div');
  nameRow.className = 'atlas-home-strand-box-name';
  nameRow.appendChild(name);
  // Hidden here: the keeper knows others read this slot empty (G23).
  const hidden = el ? hiddenRowWord(el, c.entry?.state) : '';
  if (hidden) nameRow.insertAdjacentHTML('beforeend', hidden);
  box.appendChild(nameRow);
  const text = boxTextOf(el);
  if (text) {
    const p = document.createElement('p');
    p.className = 'atlas-home-strand-box-text';
    p.textContent = text;
    box.appendChild(p);
  }
  if (slot === 'narrative') {
    const lines = linesOf(c);
    if (lines) box.appendChild(lines);
  }
  const another = maySetSlot(slot, c.entry, c.meta, c.strand, c.byId);
  const o = openedFor(slot, c);
  if (o && another) {
    box.appendChild(o.mode === 'promise' ? promiseRow(slot, c, o, opts) : actsRow(slot, c, opts));
    return box;
  }
  const canEdit = !!el && !isKnownOf(el) && mayChange(c.entry, el);
  if (canEdit || another) {
    const acts = document.createElement('div');
    acts.className = 'atlas-home-strand-box-acts';
    if (canEdit) {
      acts.appendChild(act('Edit', `${slot}:edit`, () => {
        memory.said = null;
        const { values, raw } = editOpening(el!);
        memory.editing = { worldId: c.worldId, slot, id: el!.id, opened: values, raw };
        memory.askFocus = { worldId: c.worldId, key: `edit:${slot}:name` };
        opts.redraw();
      }, 'atlas-btn-link'));
    }
    if (another) {
      acts.appendChild(moreMenu(slot, `More for ${name.textContent}`, [
        { label: `Use another ${SLOT_OTHER[slot]}`, key: `${slot}:another`, run: useAnother(slot, c, opts) },
      ]));
    }
    box.appendChild(acts);
  }
  return box;
}

/** Where they are now, when it is where it happened: one line in the Now cell, with its own ⋯ (R7). */
export function buildSameLine(c: StrandContext, opts: StrandPanelOptions): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-home-strand-same';
  wrap.setAttribute('data-role', 'strand-same');
  const p = document.createElement('p');
  p.className = 'atlas-home-strand-same-line';
  p.textContent = sameCellWords(c.strand, c.byId);
  wrap.appendChild(p);
  const another = maySetSlot('now', c.entry, c.meta, c.strand, c.byId);
  const o = openedFor('now', c);
  if (o && another) {
    wrap.appendChild(o.mode === 'promise' ? promiseRow('now', c, o, opts) : actsRow('now', c, opts));
    return wrap;
  }
  if (another) {
    wrap.appendChild(moreMenu('now', `More for where ${c.strand.character?.name.trim() || 'they'} are now`, [
      { label: 'Use another location', key: 'now:another', run: useAnother('now', c, opts) },
    ]));
  }
  return wrap;
}

/** R8: the strand is whole. Picture and the Web as links; the line takes the focus after the last write. */
export function buildWholeLine(c: StrandContext, opts: StrandPanelOptions): HTMLElement {
  const p = document.createElement('p');
  p.className = 'atlas-home-strand-whole';
  p.setAttribute('data-role', 'strand-whole');
  p.tabIndex = -1;
  const story = c.strand.narrative!;
  const link = (label: string, role: string, run: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'atlas-btn-link atlas-home-strand-whole-link';
    b.setAttribute('data-role', role);
    b.textContent = label;
    b.addEventListener('click', run);
    return b;
  };
  p.append(
    document.createTextNode(`${story.name.trim() || 'Unnamed'} is whole. Your world's picture is on the `),
    link('Picture', 'strand-whole-picture', () => opts.showPicture?.()),
    document.createTextNode(' tab, and '),
    link('the Web', 'strand-whole-web', () => openWebOn(c.worldId, story.id)),
    document.createTextNode(' draws these links among everything else you make.'),
  );
  return p;
}
