/**
 * Home "loose threads" band — the world telling you where it is thin.
 *
 * A quiet single line under the stat counts: a few cheap, honest gap classes
 * with counts, each expanding inline to the EXACT flagged elements (not a
 * type filter that would show everything). Every chip routes to the element's
 * detail, which is where the gap gets closed (add a date, place it on a map,
 * give the map art, link it in). Renders nothing when the world is fully woven.
 *
 * Deliberately cheap: one reference-set pass (collectReferencedIds) plus direct
 * field checks. No schema walk, no per-element O(N) scans. Excludes map
 * artifacts (pin/marker/zone) from the "content" it judges.
 */

import type { Element } from '../core/types';
import { getState, patchSlice } from '../core/state';
import { navigate, elementHash } from '../core/router';
import { ELEMENT_ICONS } from '../core/constants';
import { typeName } from '../core/type-words';
import { collectReferencedIds } from './element-detail-refs';
import { TEMPORAL_TYPE_FIELDS, parseTemporalValue } from '../visualization/timeline/temporal-fields';
import { findDateConflicts, type DateConflict, type DatedRef } from '../core/date-continuity';
import { worldDateFormatter } from '../core/world-date-text';

interface LooseThread {
  key: string;
  /** Lowercase summary without the count, e.g. "locations not on a map". */
  noun: (n: number) => string;
  /** Material symbol shown before the expanded chips. */
  icon: string;
  elements: Element[];
  /**
   * Dates that cannot both be true (#281): the thread counts and lists these
   * pairs, one sentence each, instead of chips.
   */
  conflicts?: DateConflict[];
}

/** How many a thread counts: its pairs, or its elements. */
const threadCount = (t: LooseThread): number => t.conflicts?.length ?? t.elements.length;

/** Read a possibly-absent field off an element without fighting the union. */
function field(el: Element, name: string): unknown {
  return (el as unknown as Record<string, unknown>)[name];
}

/**
 * Compute the loose-thread classes for a world. Pure; returns only non-empty
 * classes, in a fixed reading order. Cheap enough to run every home render.
 */
export function computeLooseThreads(elements: readonly Element[]): LooseThread[] {
  const referenced = collectReferencedIds(elements);

  // Which content elements is a pin/marker placing on some map?
  const placed = new Set<string>();
  for (const el of elements) {
    if (el.type === 'pin' || el.type === 'marker') {
      const eid = field(el, 'element_id');
      if (typeof eid === 'string' && eid) placed.add(eid);
    }
  }

  const unlinkedCharacters = elements.filter(
    el => el.type === 'character' && !referenced.has(el.id),
  );
  const unmappedLocations = elements.filter(
    el => el.type === 'location' && !placed.has(el.id),
  );
  const undatedEvents = elements.filter(el => {
    if (el.type !== 'event') return false;
    const startField = TEMPORAL_TYPE_FIELDS.event?.start;
    return startField ? parseTemporalValue(field(el, startField)) === null : false;
  });

  // Dates to check lead: every other thread is the world being thin, this one
  // is the world perhaps contradicting itself (#281).
  const conflicts = findDateConflicts(elements);
  const byId = new Map(elements.map(e => [e.id, e]));
  const conflictEls = [...new Set(conflicts.flatMap(c => [c.a.id, c.b.id]))]
    .map(id => byId.get(id)).filter((e): e is Element => !!e);

  const threads: LooseThread[] = [
    { key: 'date-conflicts', icon: 'event_busy', elements: conflictEls, conflicts,
      noun: n => (n === 1 ? 'date to check' : 'dates to check') },
    { key: 'unmapped-locations', icon: ELEMENT_ICONS.location, elements: unmappedLocations,
      noun: n => `${typeName('location', { many: n !== 1 })} not on a map` },
    { key: 'undated-events', icon: ELEMENT_ICONS.event, elements: undatedEvents,
      noun: n => `undated ${typeName('event', { many: n !== 1 })}` },
    { key: 'unlinked-characters', icon: ELEMENT_ICONS.character, elements: unlinkedCharacters,
      noun: n => `unlinked ${typeName('character', { many: n !== 1 })}` },
  ];

  return threads.filter(t => t.elements.length > 0);
}

function openElement(worldId: string, el: Element): void {
  patchSlice('ui', { ...getState().ui, selectedElementId: el.id });
  navigate(elementHash(worldId, el.id));
}

/**
 * Build the loose-threads band, or null when the world has no threads (a fully
 * woven world shows nothing here — the absence is the signal).
 */
export function buildLooseThreads(elements: readonly Element[], worldId: string): HTMLElement | null {
  const threads = computeLooseThreads(elements);
  if (threads.length === 0) return null;

  const section = document.createElement('section');
  section.className = 'atlas-home-threads';

  const row = document.createElement('div');
  row.className = 'atlas-home-threads-row';

  const lead = document.createElement('span');
  lead.className = 'atlas-home-threads-lead';
  lead.textContent = 'Loose threads';
  row.appendChild(lead);

  const expand = document.createElement('div');
  expand.className = 'atlas-home-thread-expand';
  expand.hidden = true;

  let openKey: string | null = null;

  threads.forEach((thread, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'atlas-home-threads-sep';
      sep.textContent = '·';
      row.appendChild(sep);
    }
    const n = threadCount(thread);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-home-thread';
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `<b>${n}</b> ${escapeText(thread.noun(n))}`;
    btn.addEventListener('click', () => {
      if (openKey === thread.key) {
        openKey = null;
        expand.hidden = true;
        expand.innerHTML = '';
        btn.setAttribute('aria-expanded', 'false');
        row.querySelectorAll('.atlas-home-thread').forEach(b => b.classList.remove('is-open'));
        return;
      }
      openKey = thread.key;
      row.querySelectorAll('.atlas-home-thread').forEach(b => b.classList.remove('is-open'));
      btn.classList.add('is-open');
      row.querySelectorAll('.atlas-home-thread').forEach(b => b.setAttribute('aria-expanded', 'false'));
      btn.setAttribute('aria-expanded', 'true');
      renderExpand(expand, thread, worldId);
    });
    row.appendChild(btn);
  });

  section.appendChild(row);
  section.appendChild(expand);
  return section;
}

/**
 * A date to check as a sentence: text runs and the two elements as buttons.
 * Both dates are stated, the verdict left to the reader: only `reversed` and
 * `cause-after-effect` cannot be true, and the links across a birth can (a
 * historian, a pretender; DESIGN_HOME §6).
 */
function conflictParts(c: DateConflict, date: (n: number) => string): Array<string | DatedRef> {
  const d = (r: DatedRef) => date(r.date);
  const over = (r: DatedRef) => (r.field === 'start_date' ? `took place ${d(r)}` : `ended ${d(r)}`);
  switch (c.kind) {
    case 'reversed':
      return c.a.field === 'grant_date'
        ? [c.a, ` is revoked (${d(c.b)}) before it is granted (${d(c.a)})`]
        : [c.a, ` ends (${d(c.b)}) before it starts (${d(c.a)})`];
    case 'cause-after-effect':
      return [c.b, ` (began ${d(c.b)}) is set off by `, c.a, ` (began ${d(c.a)})`];
    case 'born-after-event':
    case 'born-after-relation':
      return [c.a, ` (born ${d(c.a)}) is linked to `, c.b, ` (${over(c.b)})`];
    case 'holder-born-after-revoke':
      return [c.a, ` (born ${d(c.a)}) is a holder of `, c.b, ` (revoked ${d(c.b)})`];
  }
}

function renderConflicts(expand: HTMLElement, conflicts: DateConflict[], worldId: string): void {
  const list = document.createElement('div');
  list.className = 'atlas-home-thread-conflicts';
  const date = worldDateFormatter();
  for (const c of conflicts) {
    const row = document.createElement('div');
    row.className = 'atlas-home-thread-conflict';
    row.dataset.kind = c.kind;
    for (const part of conflictParts(c, date)) {
      if (typeof part === 'string') { row.appendChild(document.createTextNode(part)); continue; }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'atlas-home-thread-chip';
      btn.title = `Open ${part.name}`;
      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined atlas-home-thread-chip-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = ELEMENT_ICONS[part.type as keyof typeof ELEMENT_ICONS] ?? 'circle';
      btn.appendChild(icon);
      const label = document.createElement('span');
      label.textContent = part.name;
      btn.appendChild(label);
      btn.addEventListener('click', () => {
        const el = getState().data.elements.find(e => e.id === part.id);
        if (el) openElement(worldId, el);
      });
      row.appendChild(btn);
    }
    list.appendChild(row);
  }
  expand.appendChild(list);
}

function renderExpand(expand: HTMLElement, thread: LooseThread, worldId: string): void {
  expand.innerHTML = '';
  expand.hidden = false;
  if (thread.conflicts) { renderConflicts(expand, thread.conflicts, worldId); return; }
  const list = document.createElement('div');
  list.className = 'atlas-home-thread-chips';
  const sorted = thread.elements.slice().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  for (const el of sorted) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'atlas-home-thread-chip';
    chip.title = `Open ${el.name || '(unnamed)'}`;
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined atlas-home-thread-chip-icon';
    icon.textContent = thread.icon;
    chip.appendChild(icon);
    const label = document.createElement('span');
    label.textContent = el.name || '(unnamed)';
    chip.appendChild(label);
    chip.addEventListener('click', () => openElement(worldId, el));
    list.appendChild(chip);
  }
  expand.appendChild(list);
}

function escapeText(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
