/**
 * A Character's Records (the record profile's "Where a reader shows it"): the
 * runs of any game this Character took part in, newest first as the SDK's
 * `recordsOf` reads them, each with the stories that are theirs; then Tactical
 * Tangle's battles from before the mark (`core/records.ts`), under their own
 * head, since a tally never makes a record.
 *
 * Reads the same elements as Referenced by (`pageLore`), so a hidden room
 * keeps its stories out of both. Renders null for any other type and for a
 * Character with neither.
 */

import type { OwRecord } from '@onlyworlds/sdk';
import { getState, patchSlice } from '../core/state';
import { navigate, elementHash } from '../core/router';
import type { Element } from '../core/types';
import { pageLore } from '../core/parlor-room';
import { characterRecords, toolName, LEGACY_TOOL_NAME, type LegacyRow } from '../core/records';

function open(id: string): void {
  const worldId = getState().active?.worldId;
  if (!worldId) return;
  patchSlice('ui', { ...getState().ui, selectedElementId: id });
  navigate(elementHash(worldId, id));
}

function rowButton(cls: string, name: string, title: string, id: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.title = title;
  b.dataset.elementId = id;
  const n = document.createElement('span');
  n.className = 'atlas-record-name';
  n.textContent = name;
  b.appendChild(n);
  b.addEventListener('click', () => open(id));
  return b;
}

const AS_WORDS: Record<'protagonist' | 'narrator' | 'both', string> = {
  protagonist: 'about them',
  narrator: 'told by them',
  both: 'about them, told by them',
};

function storyRows(stories: OwRecord['stories']): HTMLElement | null {
  if (stories.length === 0) return null;
  const list = document.createElement('div');
  list.className = 'atlas-record-stories';
  for (const s of stories) {
    const b = rowButton('atlas-record-story', s.name || '(unnamed story)', 'Open the story', s.id);
    b.dataset.role = 'record-story';
    const as = document.createElement('span');
    as.className = 'atlas-record-as';
    as.textContent = AS_WORDS[s.as];
    b.appendChild(as);
    list.appendChild(b);
  }
  return list;
}

/** `played_at` as a local date: real time, never the world's. */
export function playedOn(playedAt: string): string {
  const d = new Date(playedAt);
  return Number.isNaN(d.getTime()) ? playedAt : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** The line under a record's name: the game, the day played, the outcome, the seat. */
export function recordLine(r: OwRecord): string {
  const parts = [toolName(r.tool), playedOn(r.played_at)];
  if (r.outcome) parts.push(r.outcome);
  if (r.seat) parts.push(`as ${r.seat}`);
  return parts.join(' · ');
}

function recordItem(r: OwRecord): HTMLElement {
  const item = document.createElement('div');
  item.className = 'atlas-record';
  item.dataset.role = 'record';
  const b = rowButton('atlas-record-row', r.event.name || '(unnamed record)', `Played on ${playedOn(r.played_at)} in ${toolName(r.tool)} · open the record`, r.event.id);
  const line = document.createElement('span');
  line.className = 'atlas-record-line';
  line.textContent = recordLine(r);
  b.appendChild(line);
  item.appendChild(b);
  const stories = storyRows(r.stories);
  if (stories) item.appendChild(stories);
  return item;
}

function legacyItem(row: LegacyRow): HTMLElement {
  const item = document.createElement('div');
  item.className = 'atlas-record';
  item.dataset.role = 'record-legacy';
  const b = rowButton('atlas-record-row', row.event.name || '(unnamed battle)', `Recorded from play in ${LEGACY_TOOL_NAME} · open the battle`, row.event.id);
  if (row.outcome) {
    const line = document.createElement('span');
    line.className = 'atlas-record-line';
    line.textContent = row.outcome;
    b.appendChild(line);
  }
  item.appendChild(b);
  const stories = storyRows(row.stories);
  if (stories) item.appendChild(stories);
  return item;
}

export function buildRecordsSection(el: Element): HTMLElement | null {
  if (el.type !== 'character') return null;
  const { records, legacy } = characterRecords(el.id, pageLore(el));
  if (records.length === 0 && legacy.length === 0) return null;

  const section = document.createElement('div');
  section.className = 'atlas-detail-section atlas-records';
  section.dataset.role = 'records';

  const header = document.createElement('div');
  header.className = 'atlas-detail-section-header no-toggle';
  const title = document.createElement('span');
  const glyph = document.createElement('span');
  glyph.className = 'material-symbols-outlined atlas-records-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = 'history_edu';
  title.append(glyph, 'Records');
  const count = document.createElement('span');
  count.className = 'atlas-refs-count';
  count.textContent = String(records.length + legacy.length);
  header.append(title, count);
  section.appendChild(header);

  const body = document.createElement('div');
  body.className = 'atlas-detail-section-body';
  section.appendChild(body);

  for (const r of records) body.appendChild(recordItem(r));
  if (legacy.length > 0) {
    const sub = document.createElement('div');
    sub.className = 'atlas-records-subhead';
    sub.dataset.role = 'records-legacy-head';
    sub.textContent = `Battles from ${LEGACY_TOOL_NAME}`;
    body.appendChild(sub);
    for (const row of legacy) body.appendChild(legacyItem(row));
  }
  return section;
}
