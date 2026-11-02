/**
 * The strand's cards (R3): the one question Home asks next, and a filled box's Edit in place.
 *
 *   A Make card: a heading asking the question, one line saying what it is, what a held Character or Now
 *   field holds ("Proposed: Mira"), Still at <place> and "Or somewhere else:" on the Now card, Name
 *   (required), the text, When on the Event's card (a whole number, its calendar reading under it), Create,
 *   "Or pick one from your world"
 *   (only when there is one to pick) and "Skip for now" (never on the story's card). Enter in Name makes;
 *   Enter in the text is a newline; Escape empties the card and keeps the focus in Name.
 *
 *   An Edit card: Name, the text (a story with the writing room's rich text, or past six lines, says
 *   "Write it in the writing room" instead), When for an Event; Save writes only what changed, against
 *   what the card opened with; Escape and Cancel go back to the box, the focus on Edit.
 *
 *   What was typed lives in memory (`home-strand-model.ts`), so every draw restores it. The card holds
 *   Home's redraws only while the focus is inside it (`GRID_OPEN_ATTR` on focusin, let go and
 *   `gridClosed` on leaving, as `watchLeave` reads leaving); a redraw while the focus is elsewhere
 *   rebuilds it from memory.
 */

import type { Element } from '../core/types';
import { ELEMENT_ICONS, ELEMENT_TYPE_COLORS } from '../core/constants';
import { escapeText } from '../core/dom-utils';
import { escapeOwned, markEscapeOwned } from '../core/escape-mark';
import { openElementTarget } from '../core/element-room';
import { resolveCalendarLens } from '../core/calendar-lens';
import { calendarDateText } from './element-detail-fields';
import { SLOT_TYPE, type StrandSlot } from '../core/strand';
import {
  cardCopy, changedFields, editOpening, parseWhen, storyForWritingRoom, type CardValues,
} from '../core/strand-journey';
import { getActiveStore } from '../core/active-store';
import { GRID_OPEN_ATTR, afterPress, gridClosed, watchLeave } from './home-grid-kinds';
import { editStrandElement } from '../ui/strand-write';
import {
  clearDraft, clearEditDraft, draftOf, editDraftOf, flying, keepDraft, memory, skip, typeInEdit, type StrandContext,
} from './home-strand-model';
import {
  act, drawnFor, holdActs, needsPromise, openPickList, pickRows, promiseRow, rawHeld, run, stampOf, nameOf,
  type StrandPanelOptions,
} from './home-strand-acts';

const homeRoot = (): HTMLElement => document.querySelector<HTMLElement>('.atlas-world-home') ?? document.body;

/**
 * Hold Home's redraws while the focus is inside `card`, and only then. Returns the quiet let-go (no
 * redraw asked: the caller's own redraw follows).
 */
function holdWhileFocused(card: HTMLElement, worldId: string): () => void {
  let held = false;
  let unwatch: () => void = () => {};
  const letGo = (how: 'press' | 'blur' | 'quiet'): void => {
    if (!held) return;
    held = false;
    card.removeAttribute(GRID_OPEN_ATTR);
    unwatch();
    memory.openClosers.delete(quiet);
    if (how === 'press') afterPress(() => gridClosed(homeRoot()));
    else if (how === 'blur') setTimeout(() => gridClosed(homeRoot()), 0);
  };
  const quiet = (): void => letGo('quiet');
  card.addEventListener('focusin', () => {
    // A write in flight takes no hold: its own redraw must land.
    if (held || flying(worldId) || !card.isConnected) return;
    held = true;
    card.setAttribute(GRID_OPEN_ATTR, '');
    memory.openClosers.add(quiet);
    unwatch = watchLeave(card, t => card.contains(t), how => letGo(how));
  });
  return quiet;
}

let fieldSeq = 0;

function field(label: string, control: HTMLInputElement | HTMLTextAreaElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-home-strand-field';
  const id = `atlas-strand-field-${++fieldSeq}`;
  control.id = id;
  const l = document.createElement('label');
  l.htmlFor = id;
  l.textContent = label;
  wrap.append(l, control);
  return wrap;
}

function textInput(key: string, fieldName: keyof CardValues, value: string): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text';
  i.className = 'atlas-input';
  i.autocomplete = 'off';
  i.value = value;
  i.setAttribute('data-field', fieldName);
  i.setAttribute('data-strand-key', key);
  return i;
}

/** The card's frame: the form, its colour and the heading with the kind's icon. */
function frame(slot: StrandSlot, mode: 'make' | 'edit', title: string, level: 2 | 3): HTMLFormElement {
  const type = SLOT_TYPE[slot];
  const form = document.createElement('form');
  form.className = `atlas-home-strand-card is-${mode}`;
  form.noValidate = true;
  form.setAttribute('data-role', 'strand-card');
  form.setAttribute('data-mode', mode);
  form.setAttribute('data-card-slot', slot);
  form.style.setProperty('--type-color', ELEMENT_TYPE_COLORS[type]);
  const h = document.createElement(level === 2 ? 'h2' : 'h3');
  h.className = 'atlas-home-strand-card-title';
  h.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${escapeText(ELEMENT_ICONS[type] ?? 'category')}</span><span></span>`;
  h.querySelector('span:last-child')!.textContent = title;
  form.appendChild(h);
  return form;
}

/** The When field and its calendar reading (the world's calendar, when it has one). */
function whenField(c: StrandContext, key: string, value: string, onInput: () => void): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '1';
  input.inputMode = 'numeric';
  input.className = 'atlas-input';
  input.autocomplete = 'off';
  input.value = value;
  input.setAttribute('data-field', 'when');
  input.setAttribute('data-strand-key', key);
  const wrap = field('When', input);
  const lens = resolveCalendarLens(c.all as Element[], c.entry?.active_calendar_id, { fallbackToOnly: true });
  if (lens) {
    const reading = document.createElement('p');
    reading.className = 'atlas-home-strand-when-reading';
    reading.setAttribute('data-role', 'strand-when-reading');
    const read = (): void => {
      const n = parseWhen(input.value);
      reading.textContent = typeof n === 'number' ? calendarDateText({ name: 'start_date', widget: 'number' } as never, n, lens) ?? '' : '';
    };
    read();
    input.addEventListener('input', read);
    wrap.appendChild(reading);
  }
  input.addEventListener('input', onInput);
  return { wrap, input };
}

/** What a number input holds that is no number (a letter in Firefox, "1e" in Chromium): its value reads '' (C9). */
const NOT_A_NUMBER = 'not a number';

/** A field's value as typed; a When the browser could not read as a number says so, never "no When". */
function fieldValue(form: HTMLElement, f: keyof CardValues): string | undefined {
  const control = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${f}"]`);
  if (!control) return undefined;
  if (control instanceof HTMLInputElement && control.validity?.badInput) return NOT_A_NUMBER;
  return control.value;
}

const valuesIn = (form: HTMLElement, base: CardValues): CardValues => {
  const get = (f: keyof CardValues): string => fieldValue(form, f) ?? base[f];
  return { name: get('name'), text: get('text'), when: get('when') };
};

/** The question Home asks next for `slot`, drawn from memory. */
export function buildMakeCard(slot: StrandSlot, c: StrandContext, opts: StrandPanelOptions, level: 2 | 3): HTMLElement {
  const copy = cardCopy(slot, c.strand);
  const form = frame(slot, 'make', copy.title, level);
  const letGo = holdWhileFocused(form, c.worldId);
  if (copy.what) {
    const what = document.createElement('p');
    what.className = 'atlas-home-strand-card-what';
    what.textContent = copy.what;
    form.appendChild(what);
  }
  const held = rawHeld(slot, c);
  if (held) {
    const p = document.createElement('p');
    p.className = 'atlas-home-strand-held';
    p.setAttribute('data-role', 'strand-held');
    p.textContent = held.label;
    form.appendChild(p);
  }
  const draft = draftOf(c.worldId, slot);
  const remember = (): void => keepDraft(c.worldId, slot, valuesIn(form, draft));
  const note = document.createElement('p');
  note.className = 'atlas-home-strand-card-note';
  note.setAttribute('role', 'status');
  note.setAttribute('data-role', 'strand-card-note');

  /** A pick, a name or Still at: through the promise when the field holds something, else written. */
  const chosen = (how: { pick?: string; name?: string }): void => {
    memory.said = null;
    if (needsPromise(slot, c)) {
      letGo();
      memory.opened = { worldId: c.worldId, slot, mode: 'promise', card: true, ...how, drawn: drawnFor(slot, c), stamp: stampOf(slot, c) };
      memory.askFocus = { worldId: c.worldId, key: `${slot}:confirm` };
      opts.redraw();
      return;
    }
    const values = valuesIn(form, draft);
    void run(slot, c, drawnFor(slot, c), { ...how, values: how.name !== undefined ? values : undefined, fromCard: true }, opts);
  };

  // Where they are now: the place it happened, first, once that slot is filled.
  if (slot === 'now' && c.strand.location) {
    const where = c.strand.location;
    const still = act(`Still at ${where.name.trim() || 'Unnamed'}`, 'now:same', () => chosen({ pick: where.id }));
    const row = document.createElement('div');
    row.className = 'atlas-home-strand-card-same';
    row.appendChild(still);
    form.appendChild(row);
    // The question's other answer, said before the form, so Create reads as making the new place.
    const other = document.createElement('p');
    other.className = 'atlas-home-strand-card-else';
    other.setAttribute('data-role', 'strand-card-else');
    other.textContent = 'Or somewhere else:';
    form.appendChild(other);
  }
  const name = textInput(`card:${slot}:name`, 'name', draft.name);
  name.required = true;
  name.setAttribute('aria-required', 'true');
  name.addEventListener('input', remember);
  form.appendChild(field('Name', name));
  const text = document.createElement('textarea');
  text.className = 'atlas-input atlas-home-strand-text';
  text.rows = 3;
  text.value = draft.text;
  text.setAttribute('data-field', 'text');
  text.setAttribute('data-strand-key', `card:${slot}:text`);
  text.addEventListener('input', remember);
  form.appendChild(field(copy.text, text));
  if (slot === 'event') form.appendChild(whenField(c, 'card:event:when', draft.when, remember).wrap);
  form.appendChild(note);

  const promise = memory.opened && memory.opened.worldId === c.worldId && memory.opened.slot === slot && memory.opened.card && memory.opened.mode === 'promise'
    ? memory.opened : null;
  if (promise) form.appendChild(promiseRow(slot, c, promise, opts));
  const acts = document.createElement('div');
  acts.className = 'atlas-home-strand-card-acts';
  const make = document.createElement('button');
  make.type = 'submit';
  make.className = 'atlas-btn-primary atlas-home-strand-act';
  make.setAttribute('data-act', 'make');
  make.setAttribute('data-strand-key', `card:${slot}:make`);
  make.textContent = 'Create';
  acts.appendChild(make);
  const picks = pickRows(slot, c);
  const pickHost = document.createElement('div');
  pickHost.className = 'atlas-home-strand-card-pick';
  if (picks.own.length + picks.rest.length > 0) {
    const pick = act('Or pick one from your world', `card:${slot}:pick`, () => openPickList(pickHost, slot, c, pick, id => chosen({ pick: id })), 'atlas-btn-link');
    acts.appendChild(pick);
  }
  if (slot !== 'narrative') {
    acts.appendChild(act('Skip for now', `card:${slot}:skip`, () => {
      letGo();
      skip(c.worldId, slot);
      memory.askFocus = { worldId: c.worldId, key: `next:${slot}` };
      opts.redraw();
    }, 'atlas-btn-link atlas-home-strand-quiet'));
  }
  if (!promise) form.appendChild(acts);
  form.appendChild(pickHost);

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (flying(c.worldId) || promise) return;
    const v = valuesIn(form, draft);
    keepDraft(c.worldId, slot, v);
    if (!v.name.trim()) { note.textContent = 'Type a name first'; name.focus(); return; }
    if (slot === 'event' && parseWhen(v.when) === 'bad') {
      note.textContent = 'When is a whole number.';
      form.querySelector<HTMLInputElement>('[data-field="when"]')?.focus();
      return;
    }
    note.textContent = '';
    chosen({ name: v.name.trim() });
  });
  form.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || escapeOwned(e)) return;
    e.preventDefault();
    markEscapeOwned(e);
    clearDraft(c.worldId, slot);
    for (const f of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-field]')) f.value = '';
    for (const r of form.querySelectorAll('[data-role="strand-when-reading"]')) r.textContent = '';
    note.textContent = '';
    name.focus();
  });
  if (flying(c.worldId)) holdActs(form);
  return form;
}

/**
 * A filled box's Edit, in place (R7). What the person typed is kept per element (world, slot and the
 * element's id), only the fields typed in: a reopened Edit shows the element as it is now for every
 * field left alone, and never carries a typed name to another element in the slot (the code gate's C1,
 * C2). Save writes only the fields typed that differ from what the card opened with, all in one write,
 * each compared with its opened value. A change meanwhile writes nothing; the card then takes the
 * element as it is as its new baseline, keeps what was typed, and a second Save writes it (C4).
 */
export function buildEditCard(slot: StrandSlot, c: StrandContext, el: Element, opts: StrandPanelOptions, level: 2 | 3): HTMLElement {
  const ed = memory.editing!;
  const form = frame(slot, 'edit', `Edit ${nameOf(el)}`, level);
  const letGo = holdWhileFocused(form, c.worldId);
  const typed = editDraftOf(c.worldId, slot, ed.id);
  const shown: CardValues = { ...ed.opened, ...typed };
  const remember = (f: keyof CardValues) => (): void => {
    const v = fieldValue(form, f);
    if (v !== undefined) typeInEdit(c.worldId, slot, ed.id, f, v);
  };
  const close = (): void => {
    clearEditDraft(c.worldId, slot, ed.id);
    memory.editing = null;
  };
  const back = (): void => {
    letGo();
    close();
    memory.askFocus = { worldId: c.worldId, key: `${slot}:edit` };
    opts.redraw();
  };
  const note = document.createElement('p');
  note.className = 'atlas-home-strand-card-note';
  note.setAttribute('role', 'status');
  note.setAttribute('data-role', 'strand-card-note');

  let saving = false;
  /**
   * The one save path (Save, and the writing room's door with a name typed): the typed fields that
   * differ, compared at the write. Wrote: `then`. Changed meanwhile: the new baseline, the typed kept.
   */
  const save = (room: boolean, then: (wrote: boolean) => void): void => {
    if (saving) return;
    const patch = changedFields(el.type, ed.opened, { ...ed.opened, ...editDraftOf(c.worldId, slot, ed.id) }, !room);
    if (patch === 'bad-when') { note.textContent = 'When is a whole number.'; return; }
    if (Object.keys(patch).length === 0) { then(false); return; }
    saving = true;
    letGo();
    holdActs(form);
    const was = ed.opened.name.trim() || 'Unnamed';
    void editStrandElement(c.worldId, ed.id, patch, ed.raw).then(async out => {
      saving = false;
      if (out === 'wrote') {
        memory.said = null;
        then(true);
        return;
      }
      if (out === 'moved') {
        const now = await getActiveStore()?.getElement(ed.id).catch(() => null);
        if (now && memory.editing === ed) memory.editing = { ...ed, ...editOpening(now) };
        memory.said = { worldId: c.worldId, text: `${was} changed meanwhile. What you typed is kept: Save again to write it.` };
      }
      memory.askFocus = { worldId: c.worldId, key: `edit:${slot}:name` };
      opts.redraw();
    });
  };

  const name = textInput(`edit:${slot}:name`, 'name', shown.name);
  name.addEventListener('input', remember('name'));
  form.appendChild(field('Name', name));
  const room = storyForWritingRoom(el);
  if (room) {
    const p = document.createElement('p');
    p.className = 'atlas-home-strand-card-what';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'atlas-btn-link atlas-home-strand-act';
    go.setAttribute('data-act', 'writing');
    go.setAttribute('data-strand-key', `edit:${slot}:writing`);
    go.textContent = 'Write it in the writing room';
    // The writing room takes the story's text: a name typed here is saved first, through the same
    // compare; refused, the card stays and says why (the code gate's C7).
    go.addEventListener('click', () => save(true, () => {
      letGo();
      close();
      openElementTarget(el, c.worldId);
    }));
    p.appendChild(go);
    form.appendChild(p);
  } else {
    const text = document.createElement('textarea');
    text.className = 'atlas-input atlas-home-strand-text';
    text.rows = 3;
    text.value = shown.text;
    text.setAttribute('data-field', 'text');
    text.setAttribute('data-strand-key', `edit:${slot}:text`);
    text.addEventListener('input', remember('text'));
    form.appendChild(field(cardCopy(slot, c.strand).text, text));
  }
  if (slot === 'event') form.appendChild(whenField(c, 'edit:event:when', shown.when, remember('when')).wrap);
  form.appendChild(note);
  const acts = document.createElement('div');
  acts.className = 'atlas-home-strand-card-acts';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'atlas-btn-primary atlas-home-strand-act';
  saveBtn.setAttribute('data-act', 'save');
  saveBtn.setAttribute('data-strand-key', `edit:${slot}:save`);
  saveBtn.textContent = 'Save';
  acts.append(saveBtn, act('Cancel', `edit:${slot}:cancel`, back, 'atlas-btn-ghost'));
  form.appendChild(acts);

  form.addEventListener('submit', e => {
    e.preventDefault();
    save(room, wrote => {
      // Written: the focus on the box's name; nothing typed differs: closed as Cancel closes it.
      letGo();
      close();
      memory.askFocus = { worldId: c.worldId, key: wrote ? `${slot}:open` : `${slot}:edit` };
      opts.redraw();
    });
  });
  form.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || escapeOwned(e)) return;
    e.preventDefault();
    markEscapeOwned(e);
    back();
  });
  return form;
}
