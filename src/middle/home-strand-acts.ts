/**
 * The strand's acts on Home (shared by the cards and the boxes): what a slot was drawn with, what a
 * Character or Now field holds that the strand does not read, the pick list and the name box, the
 * promise a change says before its second press, and `run`, the one path every press writes through.
 *
 *   One write per slot at a time (C1), every act in the panel held while one runs (D1). After a write
 *   the focus goes to the next card's Name, else the box written, else the whole line (`next:<slot>`,
 *   resolved by `settleStrandFocus`); a refusal keeps it on the card that asked, its line said by the
 *   panel's status line. Each press writes its slot's one link (and a Make its one create), nothing
 *   more: since 1.122.0 no card puts the main character into the strand's Event.
 */

import type { Element } from '../core/types';
import { escapeText } from '../core/dom-utils';
import { handsOnAsProposed } from '../core/review-mark';
import { isHiddenMark } from '../core/hidden-mark';
import { markEscapeOwned } from '../core/escape-mark';
import { memberIds, offerable, rawSingle, storedMark, SLOT_TYPE, type StrandSlot } from '../core/strand';
import { SLOT_PHRASE, SLOT_WORD, type CardValues } from '../core/strand-journey';
import { canonicalExtValue } from '../sync/world-meta-sync';
import { typeName } from '../core/type-words';
import { GRID_OPEN_ATTR, afterPress, gridClosed, watchLeave } from './home-grid-kinds';
import { makeStrandSlot, writeStrandSlot, STRAND_MOVED, type StrandDrawn, type StrandWriteResult } from '../ui/strand-write';
import { clearDraft, draftOf, flightKey, memory, type Opened, type StrandContext } from './home-strand-model';

export interface StrandPanelOptions {
  /** No picture beside it: the strand draws alone (`heading`: under its own heading "Strand"). */
  alone: boolean;
  /** The strand alone draws its heading (false: no tab head and no picture, the journey's own landing). */
  heading?: boolean;
  /** Redraw Home now (its inputs may not have moved: a refusal writes nothing). */
  redraw: () => void;
  /** The draw's one reading (C7); read afresh when not given. */
  context?: StrandContext | null;
  /** The whole line's Picture: Home with its tab head, on Picture. */
  showPicture?: () => void;
}

export const nameOf = (el: { name?: unknown } | undefined | null, fallback = 'Unnamed'): string =>
  (el && typeof el.name === 'string' && el.name.trim() ? el.name.trim() : fallback);

/** What a slot was drawn with: the mark's ids as stored, and for Character and Now the raw field. */
export function drawnFor(slot: StrandSlot, c: StrandContext): StrandDrawn {
  const ids = memberIds(storedMark(c.meta));
  const base: StrandDrawn = { worldId: c.worldId, narrative: ids.narrative ?? null, event: ids.event ?? null, location: ids.location ?? null };
  if (slot === 'character') {
    const on = c.strand.narrative?.id ?? null;
    return { ...base, on, raw: rawSingle(on ? c.byId.get(on) : undefined, 'protagonist') };
  }
  if (slot === 'now') {
    const on = c.strand.character?.id ?? null;
    return { ...base, on, raw: rawSingle(on ? c.byId.get(on) : undefined, 'location') };
  }
  return base;
}

/** The slot's state as a string: an open change lets go once it moves. */
export function stampOf(slot: StrandSlot, c: StrandContext): string {
  const d = drawnFor(slot, c);
  return `${canonicalExtValue(storedMark(c.meta)) ?? ''}|${canonicalExtValue(d.raw ?? null) ?? ''}|${c.strand[slot]?.id ?? ''}`;
}

/** A kind word with its article: "a location", "an event". */
const aKind = (type: string): string => {
  const w = typeName(type);
  return `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`;
};

/**
 * What a Character or Now field holds that the strand does not read (G8), in words where it can: a
 * proposed or hidden element, one of another kind (C5), or an id that names nothing here; `label` for
 * the card, `phrase` for the middle of a promise. Null when it holds nothing.
 */
export function rawHeld(slot: StrandSlot, c: StrandContext): { label: string; phrase: string } | null {
  if (slot !== 'character' && slot !== 'now') return null;
  if (c.strand[slot]) return null;
  const raw = drawnFor(slot, c).raw;
  if (raw === null || raw === undefined) return null;
  const el = typeof raw === 'string' ? c.byId.get(raw) : undefined;
  if (!el) return { label: 'An id that names nothing here', phrase: 'an id that names nothing here' };
  const name = nameOf(el);
  if (el.type !== SLOT_TYPE[slot]) {
    const kind = aKind(el.type);
    return { label: `${kind.charAt(0).toUpperCase()}${kind.slice(1)}: ${name}`, phrase: `${kind}, ${name}` };
  }
  if (handsOnAsProposed(el)) return { label: `Proposed: ${name}`, phrase: `the proposed ${name}` };
  // Unreached at the owner rung (a hidden element is in view, so the slot fills); kept for a lower reading.
  if (isHiddenMark(el)) return { label: `Hidden: ${name}`, phrase: `the hidden ${name}` };
  return { label: name, phrase: name };
}

/** The words for what a field holds (`rawHeld`'s label). */
export function rawWords(slot: StrandSlot, c: StrandContext): string | null {
  return rawHeld(slot, c)?.label ?? null;
}

/** The pick list's elements: that kind's, the parent's own first (G12: `offerable`). */
export function pickRows(slot: StrandSlot, c: StrandContext): { own: Element[]; rest: Element[]; ownWord: string | null } {
  const type = SLOT_TYPE[slot];
  // What the slot holds now is no pick for its Use another (C14).
  const holds = c.strand[slot]?.id;
  const all = c.all.filter(e => offerable(e, type) && e.id !== holds && !c.kept(e.id))
    .sort((a, b) => nameOf(a, '').localeCompare(nameOf(b, ''), undefined, { sensitivity: 'base' }));
  const parent = slot === 'event' ? c.strand.narrative?.id : slot === 'location' ? c.strand.event?.id : slot === 'character' ? c.strand.narrative?.id : undefined;
  const field = slot === 'event' ? 'events' : slot === 'location' ? 'locations' : slot === 'character' ? 'characters' : null;
  const list = parent && field ? (c.byId.get(parent) as Record<string, unknown> | undefined)?.[field] : undefined;
  const ids = new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []);
  const ownWord = slot === 'location' ? 'In this event' : slot === 'event' || slot === 'character' ? 'In this story' : null;
  return { own: all.filter(e => ids.has(e.id)), rest: all.filter(e => !ids.has(e.id)), ownWord };
}

/** A pick or a name needs its promise first: a filled slot (Use another), or a Character or Now field already holding something (G8). */
export function needsPromise(slot: StrandSlot, c: StrandContext): boolean {
  return !!c.strand[slot] || rawHeld(slot, c) !== null;
}

/** What the slot holds now, as the middle of a promise names it (C5: lower case there). */
function holdsWords(slot: StrandSlot, c: StrandContext): string {
  const f = c.strand[slot];
  return f ? (f.name.trim() || 'Unnamed') : rawHeld(slot, c)?.phrase ?? 'nothing';
}

/** The promise's line: "Odile will be the main character in place of the proposed Mira." */
export function promiseLine(slot: StrandSlot, c: StrandContext, o: Pick<Opened, 'name' | 'pick'>): string {
  const next = o.name ?? nameOf(o.pick ? c.byId.get(o.pick) : undefined);
  return `${next} will be ${SLOT_PHRASE[slot]} in place of ${holdsWords(slot, c)}.`;
}

// ---- Buttons and the hold on a write ----

/** Every act in `panel` disabled, every field read-only. */
export function holdActs(panel: ParentNode): void {
  for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-act]')) b.disabled = true;
  for (const f of panel.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-role="strand-card"] input, [data-role="strand-card"] textarea')) f.readOnly = true;
}

/**
 * A write starts (D1): every act in the panel as drawn now is disabled, and any open name box, pick
 * list, menu or held card lets go, before the write's first await, so no press races it and the
 * write's own redraw is never held back.
 */
export function quietPanel(): void {
  for (const close of [...memory.openClosers]) close();
  for (const panel of document.querySelectorAll('[data-role="home-strand"]')) holdActs(panel);
}

export function act(label: string, key: string, run: () => void, cls = 'atlas-btn-ghost'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `${cls} atlas-home-strand-act`;
  b.setAttribute('data-strand-key', key);
  b.setAttribute('data-act', key.split(':').pop()!);
  b.textContent = label;
  b.addEventListener('click', run);
  return b;
}

const homeRoot = (): HTMLElement => document.querySelector<HTMLElement>('.atlas-world-home') ?? document.body;

// ---- The write ----

export interface RunHow {
  pick?: string;
  name?: string;
  /** A card's fields: its text and date go into the Make's one create. */
  values?: CardValues;
  /** Pressed on the slot's card (Create, Pick, Still at), not Use another: a refusal keeps the focus in the card's Name. */
  fromCard?: boolean;
}

/** Run the slot's write and say what came of it; the focus then follows the journey (S10). */
export async function run(slot: StrandSlot, c: StrandContext, drawn: StrandDrawn, how: RunHow, opts: StrandPanelOptions): Promise<void> {
  // One write per slot at a time (C1): a second Enter or press while this one runs is dropped, never a
  // second write and never "changed meanwhile" about the person's own first press.
  const key = flightKey(c.worldId, slot);
  if (memory.inFlight.has(key)) return;
  memory.inFlight.add(key);
  const picks = pickRows(slot, c);
  memory.pickAtPress.set(key, picks.own.length + picks.rest.length > 0);
  // A write pressed on the Strand tab records the tab as pressed: an empty world's unrecorded Strand
  // would otherwise be read afresh on the redraw between the make and the mark.
  if (!memory.tabs.has(c.worldId)) memory.tabs.set(c.worldId, 'strand');
  quietPanel();
  let result: StrandWriteResult = 'nothing';
  let made: Element | undefined;
  try {
    if (how.name !== undefined) {
      const out = await makeStrandSlot(slot, drawn, how.name, how.values);
      result = out.result;
      made = out.made;
    } else if (how.pick) result = await writeStrandSlot(slot, drawn, how.pick);
  } finally {
    memory.inFlight.delete(key);
    memory.pickAtPress.delete(key);
  }
  const kept = made && result !== 'wrote' ? ` ${nameOf(made)} was made and stays in the world.` : '';
  if (result === 'refused') memory.said = { worldId: c.worldId, text: `${STRAND_MOVED}${kept}` };
  else if (kept) memory.said = { worldId: c.worldId, text: kept.trim() };
  // Made and kept after a refusal: the card's name is spent, so a second Make never makes a twin (C14).
  if (made && result !== 'wrote') clearDraft(c.worldId, slot);
  if (result === 'wrote') {
    clearDraft(c.worldId, slot);
    if (memory.forced?.worldId === c.worldId && memory.forced.slot === slot) memory.forced = null;
    memory.askFocus = { worldId: c.worldId, key: `next:${slot}` };
  } else memory.askFocus = { worldId: c.worldId, key: how.fromCard ? `card:${slot}:name` : `box:${slot}` };
  opts.redraw();
}

// ---- Use another: the acts and the promise (today's Change flow) ----

/** A filled slot's ways to another element: Create one, Pick from the world (and Still at, for now), Cancel. */
export function actsRow(slot: StrandSlot, c: StrandContext, opts: StrandPanelOptions): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atlas-home-strand-acts';
  const chosen = (how: { pick?: string; name?: string }): void => {
    memory.said = null;
    if (needsPromise(slot, c)) {
      memory.opened = { worldId: c.worldId, slot, mode: 'promise', ...how, drawn: drawnFor(slot, c), stamp: stampOf(slot, c) };
      memory.askFocus = { worldId: c.worldId, key: `${slot}:confirm` };
      opts.redraw();
      return;
    }
    void run(slot, c, drawnFor(slot, c), how, opts);
  };
  const make = act('Create one', `${slot}:make`, () => openNameBox(row, slot, make, name => chosen({ name })));
  const pick = act('Pick from the world', `${slot}:pick`, () => openPickList(row, slot, c, pick, id => chosen({ pick: id })));
  row.append(make, pick);
  // Where they are now: the place it happened, offered once that slot is filled.
  if (slot === 'now' && c.strand.location && c.strand.location.id !== c.strand.now?.id) {
    const where = c.strand.location.id;
    row.appendChild(act(`Still at ${c.strand.location.name.trim() || 'Unnamed'}`, `${slot}:same`, () => chosen({ pick: where })));
  }
  row.appendChild(act('Cancel', `${slot}:cancel`, () => {
    memory.opened = null;
    memory.askFocus = { worldId: c.worldId, key: `${slot}:more` };
    opts.redraw();
  }));
  return row;
}

/** The promise and its second press; on a card (a held field) the Make carries the card's fields. */
export function promiseRow(slot: StrandSlot, c: StrandContext, o: Opened, opts: StrandPanelOptions): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atlas-home-strand-promise';
  const line = document.createElement('p');
  line.className = 'atlas-home-strand-promise-line';
  line.setAttribute('data-role', 'strand-promise');
  line.textContent = promiseLine(slot, c, o);
  row.appendChild(line);
  const back = o.card ? `card:${slot}:name` : `${slot}:more`;
  const held = c.strand[slot]?.name.trim();
  const confirm = act(held ? `Replace ${held}` : 'Change', `${slot}:confirm`, () => {
    if (confirm.disabled) return;
    confirm.disabled = true;
    const drawn = o.drawn ?? drawnFor(slot, c);
    memory.opened = null;
    const values = o.card ? draftOf(c.worldId, slot) : undefined;
    void run(slot, c, drawn, { pick: o.pick, name: o.name, values, fromCard: o.card }, opts);
  }, 'atlas-btn-primary');
  row.appendChild(confirm);
  const cancel = (): void => {
    memory.opened = null;
    memory.askFocus = { worldId: c.worldId, key: back };
    opts.redraw();
  };
  row.appendChild(act('Cancel', `${slot}:cancel`, cancel));
  row.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    markEscapeOwned(e);
    cancel();
  });
  return row;
}

// ---- The name box and the pick list (each holds Home's redraws while open) ----

/** The name box in the row: Enter makes it, Escape leaves (the focus back on its opener). */
export function openNameBox(row: HTMLElement, slot: StrandSlot, back: HTMLElement, done: (name: string) => void): void {
  if (row.querySelector('form')) return;
  const form = document.createElement('form');
  form.className = 'atlas-home-strand-make';
  form.setAttribute(GRID_OPEN_ATTR, '');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'atlas-input';
  input.placeholder = 'Name';
  input.setAttribute('aria-label', `Name for ${SLOT_PHRASE[slot]}`);
  input.setAttribute('data-role', 'strand-name');
  const note = document.createElement('span');
  note.className = 'atlas-home-strand-note';
  note.setAttribute('role', 'status');
  form.append(input, note);
  let closed = false;
  // Closed by a write starting elsewhere in the panel (D1): no focus moved, the write's redraw follows.
  const quiet = (): void => {
    if (closed) return;
    closed = true;
    memory.openClosers.delete(quiet);
    unwatch();
    form.remove();
    row.classList.remove('is-open');
  };
  memory.openClosers.add(quiet);
  const close = (how: 'escape' | 'press' | 'blur'): void => {
    if (closed) return;
    closed = true;
    memory.openClosers.delete(quiet);
    unwatch();
    form.remove();
    row.classList.remove('is-open');
    if (how === 'escape') { back.focus(); gridClosed(row); }
    else if (how === 'press') afterPress(() => gridClosed(homeRoot()));
    else setTimeout(() => gridClosed(homeRoot()), 0);
  };
  const unwatch = watchLeave(form, t => form.contains(t), how => close(how));
  form.addEventListener('submit', e => {
    e.preventDefault();
    // A second Enter while the first one's make runs (C1): nothing, the box already gave its name.
    if (closed) return;
    const n = input.value.trim();
    if (!n) { note.textContent = 'Type a name first'; input.focus(); return; }
    closed = true;
    memory.openClosers.delete(quiet);
    unwatch();
    input.disabled = true;
    form.removeAttribute(GRID_OPEN_ATTR);
    done(n);
    gridClosed(row);
  });
  form.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); markEscapeOwned(e); close('escape'); }
  });
  row.classList.add('is-open');
  row.appendChild(form);
  input.focus();
}

let listSeq = 0;

/** That kind's elements by name, filterable, the parent's own first; Enter or a press picks. */
export function openPickList(row: HTMLElement, slot: StrandSlot, c: StrandContext, back: HTMLElement, done: (id: string) => void): void {
  if (row.querySelector('.atlas-home-strand-pick')) return;
  const { own, rest, ownWord } = pickRows(slot, c);
  const wrap = document.createElement('div');
  wrap.className = 'atlas-home-strand-pick';
  wrap.setAttribute(GRID_OPEN_ATTR, '');
  const id = `atlas-strand-pick-${++listSeq}`;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'atlas-input';
  input.placeholder = 'Filter by name';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', id);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-label', `Pick ${SLOT_PHRASE[slot]}`);
  input.setAttribute('data-role', 'strand-filter');
  const list = document.createElement('ul');
  list.className = 'atlas-home-strand-options';
  list.id = id;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', SLOT_WORD[slot]);
  wrap.append(input, list);

  let options: HTMLElement[] = [];
  let active = -1;
  const setActive = (i: number): void => {
    active = options.length === 0 ? -1 : (i + options.length) % options.length;
    options.forEach((o, j) => o.setAttribute('aria-selected', String(j === active)));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', options[active].id);
      options[active].scrollIntoView?.({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  const draw = (): void => {
    const q = input.value.trim().toLowerCase();
    const match = (e: Element) => !q || nameOf(e, '').toLowerCase().includes(q);
    list.innerHTML = '';
    options = [];
    const group = (word: string | null, els: Element[]): void => {
      const shown = els.filter(match);
      if (shown.length === 0) return;
      if (word) {
        const h = document.createElement('li');
        h.className = 'atlas-home-strand-group';
        h.setAttribute('role', 'presentation');
        h.textContent = word;
        list.appendChild(h);
      }
      for (const e of shown) {
        const o = document.createElement('li');
        o.className = 'atlas-home-strand-option';
        o.id = `${id}-${options.length}`;
        o.setAttribute('role', 'option');
        o.setAttribute('data-id', e.id);
        o.textContent = nameOf(e);
        o.addEventListener('pointerdown', ev => ev.preventDefault());
        o.addEventListener('click', () => pickIt(e.id));
        list.appendChild(o);
        options.push(o);
      }
    };
    group(own.length && ownWord ? ownWord : null, own);
    group(own.length && ownWord ? 'In the world' : null, rest);
    if (options.length === 0) {
      const none = document.createElement('li');
      none.className = 'atlas-home-strand-none';
      none.setAttribute('role', 'presentation');
      none.textContent = own.length + rest.length === 0 ? 'Nothing of this kind yet' : 'No name matches';
      list.appendChild(none);
    }
    setActive(0);
  };
  let closed = false;
  // Closed by a write starting elsewhere in the panel (D1).
  const quiet = (): void => {
    if (closed) return;
    closed = true;
    memory.openClosers.delete(quiet);
    unwatch();
    wrap.remove();
    row.classList.remove('is-open');
  };
  memory.openClosers.add(quiet);
  const close = (how: 'escape' | 'press' | 'blur' | 'picked'): void => {
    if (closed) return;
    closed = true;
    memory.openClosers.delete(quiet);
    unwatch();
    wrap.remove();
    row.classList.remove('is-open');
    if (how === 'escape') { back.focus(); gridClosed(row); }
    else if (how === 'press') afterPress(() => gridClosed(homeRoot()));
    else if (how === 'blur') setTimeout(() => gridClosed(homeRoot()), 0);
  };
  const pickIt = (eid: string): void => {
    // A second press or Enter on a list already picked from (C1): nothing.
    if (closed) return;
    close('picked');
    done(eid);
    gridClosed(row.isConnected ? row : homeRoot());
  };
  const unwatch = watchLeave(wrap, t => wrap.contains(t), how => close(how));
  input.addEventListener('input', draw);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const o = options[active];
      if (o) pickIt(o.getAttribute('data-id')!);
    } else if (e.key === 'Escape') { e.preventDefault(); markEscapeOwned(e); close('escape'); }
  });
  row.classList.add('is-open');
  row.appendChild(wrap);
  draw();
  input.focus();
}

/** An icon, decoration only. */
export const iconHtml = (name: string): string => `<span class="material-symbols-outlined" aria-hidden="true">${escapeText(name)}</span>`;
