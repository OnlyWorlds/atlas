/**
 * Character "war record" — a service-record section listing the chronicle
 * battle Events this character stood in (the tangle→atlas seam; recorded from
 * play by Tactical Tangle: Event supertype 'Chronicle', subtype 'Battle',
 * participants in `characters`, payload in `x_tangle_battle`).
 *
 * Curated charm on top of the exhaustive "Referenced by" scan (the same
 * events also appear there — this strip adds order, dates, and outcomes).
 * Renders null for non-characters and characters with no recorded battles.
 */

import { getState, patchSlice } from '../core/state';
import { navigate, elementHash } from '../core/router';
import type { Element } from '../core/types';
import { battleOutcomeLine } from './tangle-cards';

interface BattleRow {
  event: Element;
  date: number | null;
  outcome: string | null;
}

export function buildWarRecordSection(el: Element): HTMLElement | null {
  if (el.type !== 'character') return null;

  const rows: BattleRow[] = [];
  for (const e of getState().data.elements) {
    if (e.type !== 'event') continue;
    const rec = e as Element & { supertype?: unknown; subtype?: unknown; characters?: unknown; start_date?: unknown };
    if (rec.supertype !== 'Chronicle' || rec.subtype !== 'Battle') continue;
    if (!participates(rec.characters, el.id)) continue;
    rows.push({
      event: e,
      date: typeof rec.start_date === 'number' && Number.isFinite(rec.start_date) ? rec.start_date : null,
      outcome: battleOutcomeLine((e as Record<string, unknown>).x_tangle_battle),
    });
  }
  if (rows.length === 0) return null;

  // Chronological; undated battles close the record.
  rows.sort((a, b) => {
    if (a.date === null && b.date === null) return (a.event.name ?? '').localeCompare(b.event.name ?? '');
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date - b.date;
  });

  const section = document.createElement('div');
  section.className = 'atlas-detail-section atlas-war-record';

  const header = document.createElement('div');
  header.className = 'atlas-detail-section-header no-toggle';
  header.innerHTML =
    `<span><span class="material-symbols-outlined atlas-war-record-swords">swords</span>War record</span>` +
    `<span class="atlas-refs-count">${rows.length}</span>`;
  section.appendChild(header);

  const body = document.createElement('div');
  body.className = 'atlas-detail-section-body';
  section.appendChild(body);

  for (const row of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'atlas-war-record-row';
    rowEl.title = 'Recorded from play · open the battle record';

    const name = document.createElement('span');
    name.className = 'atlas-war-record-name';
    name.textContent = row.event.name || '(unnamed battle)';
    rowEl.appendChild(name);

    if (row.date !== null) {
      const date = document.createElement('span');
      date.className = 'atlas-war-record-date';
      date.textContent = String(row.date);
      rowEl.appendChild(date);
    }

    if (row.outcome) {
      const outcome = document.createElement('span');
      outcome.className = 'atlas-war-record-outcome';
      outcome.textContent = row.outcome;
      rowEl.appendChild(outcome);
    }

    rowEl.addEventListener('click', () => {
      const worldId = getState().active?.worldId;
      if (!worldId) return;
      patchSlice('ui', { ...getState().ui, selectedElementId: row.event.id });
      navigate(elementHash(worldId, row.event.id));
    });
    body.appendChild(rowEl);
  }

  return section;
}

/** Defensive membership test over a relation value (bare ids or {id} objects). */
function participates(value: unknown, characterId: string): boolean {
  if (!Array.isArray(value)) return false;
  return value.some(item =>
    (typeof item === 'string' && item === characterId) ||
    (item !== null && typeof item === 'object' && (item as { id?: unknown }).id === characterId)
  );
}
