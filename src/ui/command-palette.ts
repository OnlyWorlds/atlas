/**
 * Command palette (Ctrl/Cmd+K or `/`) — search everywhere, jump anywhere.
 *
 * The search room's replacement (deleted S256): a lazy overlay summonable
 * from any room. One input, ranked results across two kinds:
 *
 *   - elements — matched on name (prefix > substring), atlas_aliases,
 *     supertype/subtype, then description (with a context snippet).
 *     Enter/click navigates to the element room.
 *   - rooms — matched on room name ("wri" → writing). Navigates to the room.
 *
 * A final "see all →" row hands the query to the elements-sidebar filter
 * (state.ui.search) for the full list. Esc closes (BaseModal). The overlay
 * uses the standard modal chrome (convention #16) with its own panel class;
 * `.atlas-cmdk-*` is this surface's locator family — don't reuse elsewhere.
 *
 * Ranking is deliberately simple tiers, not fuzzy: predictable beats clever
 * for a jump tool. Unnamed elements only surface via description matches.
 */

import { BaseModal } from './modal-base';
import { getState, patchSlice } from '../core/state';
import { navigate, elementHash, homeHash } from '../core/router';
import { setSidebarModePref } from '../core/ui-prefs';
import { scoreElementMatch } from '../core/element-search';
import { roomOf, openElementTarget } from '../core/element-room';
import { ELEMENT_ICONS } from '../core/constants';
import type { Element, ElementType } from '../core/types';

const MAX_ELEMENT_RESULTS = 12;
const MAX_ROOM_RESULTS = 3;

export interface PaletteResult {
  kind: 'element' | 'room';
  /** Element id, or the room's route segment ('' = home). */
  id: string;
  name: string;
  type?: ElementType;
  /** Right-aligned context: element taxonomy, or "room". */
  hint: string;
  /** Description context around the match (description matches only). */
  snippet?: string;
  score: number;
}

/**
 * Rooms reachable by name. Route segment '' = the world home.
 *
 * `aliases` exist because a room's LABEL and its ROUTE SEGMENT can diverge:
 * the Data room still routes on `import`, and "import"/"export" are what a user
 * actually types. Before S308 this list keyed on the segment word, so the room
 * was branded "Data" everywhere else and searching "data" here found nothing.
 */
const ROOMS: Array<{ label: string; segment: string; icon: string; aliases?: string[] }> = [
  { label: 'home', segment: '', icon: 'home' },
  { label: 'writing', segment: 'writing', icon: 'edit_note' },
  { label: 'knowledge', segment: 'knowledge', icon: 'psychology' },
  { label: 'charts', segment: 'timeline', icon: 'timeline', aliases: ['timeline'] },
  { label: 'pages', segment: 'share', icon: 'wall_art', aliases: ['share'] },
  { label: 'data', segment: 'import', icon: 'swap_vert', aliases: ['import', 'export'] },
  { label: 'settings', segment: 'settings', icon: 'settings' },
];

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Pure ranked search over elements + rooms. Exported for unit tests. */
export function searchPalette(query: string, elements: readonly Element[]): PaletteResult[] {
  const q = normalize(query);
  if (!q) return [];

  const out: PaletteResult[] = [];

  for (const room of ROOMS) {
    // Match the label AND its aliases, but always DISPLAY the label — typing
    // "import" should find the room and then teach you it is called Data.
    const names = [room.label, ...(room.aliases ?? [])];
    if (names.some(n => n.startsWith(q))) {
      out.push({ kind: 'room', id: room.segment, name: room.label, hint: 'room', score: 90 });
    } else if (names.some(n => n.includes(q))) {
      out.push({ kind: 'room', id: room.segment, name: room.label, hint: 'room', score: 55 });
    }
  }

  for (const el of elements) {
    // Pins/markers are map artifacts, not browse targets — the elements
    // sidebar excludes them, so the palette does too (see-all consistency).
    if (el.type === 'pin' || el.type === 'marker') continue;
    const hit = scoreElementMatch(el, q);
    if (!hit) continue;
    const superT = String((el as Record<string, unknown>).supertype ?? '').trim();
    const subT = String((el as Record<string, unknown>).subtype ?? '').trim();
    const taxonomy = [superT, subT].filter(Boolean).join(' · ');
    out.push({
      kind: 'element',
      id: el.id,
      name: el.name?.trim() || '(unnamed)',
      type: el.type,
      hint: taxonomy ? `${el.type} · ${taxonomy}` : el.type,
      snippet: hit.snippet,
      score: hit.score,
    });
  }

  out.sort((a, b) => (b.score - a.score) || (a.name ?? '').localeCompare(b.name ?? ''));

  const rooms = out.filter(r => r.kind === 'room').slice(0, MAX_ROOM_RESULTS);
  const els = out.filter(r => r.kind === 'element').slice(0, MAX_ELEMENT_RESULTS);
  return [...rooms, ...els].sort((a, b) => (b.score - a.score) || (a.name ?? '').localeCompare(b.name ?? ''));
}

// ---------------------------------------------------------------------------
// The overlay.
// ---------------------------------------------------------------------------

let openInstance: CommandPalette | null = null;

class CommandPalette extends BaseModal {
  private results: PaletteResult[] = [];
  private activeIndex = 0;
  private query = '';
  private list!: HTMLElement;
  private worldId!: string;

  open(): void {
    const active = getState().active;
    if (!active) return;
    this.worldId = active.worldId;

    const { overlay, body } = this.buildModalShell({
      panelClass: 'atlas-cmdk-panel',
      dataModal: 'command-palette',
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'atlas-cmdk-input';
    input.placeholder = 'Search elements and rooms...';
    input.setAttribute('data-role', 'cmdk-input');
    body.appendChild(input);

    this.list = document.createElement('div');
    this.list.className = 'atlas-cmdk-list';
    body.appendChild(this.list);

    input.addEventListener('input', () => {
      this.query = input.value;
      this.results = searchPalette(this.query, getState().data.elements);
      this.activeIndex = 0;
      this.renderList();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.activeIndex = Math.min(this.activeIndex + 1, this.rowCount() - 1);
        this.renderList();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.activeIndex = Math.max(this.activeIndex - 1, 0);
        this.renderList();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.pick(this.activeIndex);
      }
      // Esc falls through to BaseModal's close handling.
    });

    this.modal = overlay;
    this.show();
    openInstance = this;
    this.renderList();
    queueMicrotask(() => input.focus());
  }

  protected override hide(): void {
    super.hide();
    openInstance = null;
  }

  /** Result rows + the see-all row when a query is live. */
  private rowCount(): number {
    return this.results.length + (this.query.trim() ? 1 : 0);
  }

  private renderList(): void {
    this.list.innerHTML = '';

    if (!this.query.trim()) {
      const hint = document.createElement('div');
      hint.className = 'atlas-cmdk-hint';
      hint.textContent = 'Type to search names, aliases, types, and descriptions. ↑↓ to move, Enter to jump.';
      this.list.appendChild(hint);
      return;
    }

    this.results.forEach((r, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'atlas-cmdk-row' + (i === this.activeIndex ? ' is-active' : '');
      row.setAttribute('data-kind', r.kind);

      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined atlas-cmdk-icon';
      icon.textContent = r.kind === 'room'
        ? (ROOMS.find(rm => rm.segment === r.id)?.icon ?? 'door_open')
        : (r.type ? ELEMENT_ICONS[r.type] : 'category');
      row.appendChild(icon);

      const main = document.createElement('span');
      main.className = 'atlas-cmdk-main';
      const name = document.createElement('span');
      name.className = 'atlas-cmdk-name';
      name.textContent = r.name;
      main.appendChild(name);
      if (r.snippet) {
        const snip = document.createElement('span');
        snip.className = 'atlas-cmdk-snippet';
        snip.textContent = r.snippet;
        main.appendChild(snip);
      }
      row.appendChild(main);

      const hint = document.createElement('span');
      hint.className = 'atlas-cmdk-rowhint';
      hint.textContent = r.hint;
      row.appendChild(hint);

      row.addEventListener('mouseenter', () => {
        if (this.activeIndex !== i) { this.activeIndex = i; this.renderList(); }
      });
      row.addEventListener('click', () => this.pick(i));
      this.list.appendChild(row);
    });

    // See-all: hand the query to the elements-sidebar filter.
    const seeAll = document.createElement('button');
    seeAll.type = 'button';
    seeAll.className = 'atlas-cmdk-row atlas-cmdk-seeall'
      + (this.activeIndex === this.results.length ? ' is-active' : '');
    seeAll.setAttribute('data-action', 'cmdk-see-all');
    seeAll.textContent = this.results.length > 0
      ? 'see all in the sidebar →'
      : 'no quick matches: filter the sidebar →';
    seeAll.addEventListener('mouseenter', () => {
      if (this.activeIndex !== this.results.length) {
        this.activeIndex = this.results.length;
        this.renderList();
      }
    });
    seeAll.addEventListener('click', () => this.pick(this.results.length));
    this.list.appendChild(seeAll);

    this.list.querySelector<HTMLElement>('.atlas-cmdk-row.is-active')
      ?.scrollIntoView({ block: 'nearest' });
  }

  private pick(index: number): void {
    if (index === this.results.length) {
      const q = this.query.trim();
      this.hide();
      if (!q) return;
      if (getState().ui.sidebarMode !== 'elements') {
        patchSlice('ui', { ...getState().ui, sidebarMode: 'elements', search: q });
        setSidebarModePref('elements');
      } else {
        patchSlice('ui', { ...getState().ui, search: q });
      }
      return;
    }
    const r = this.results[index];
    if (!r) return;
    this.hide();
    if (r.kind === 'room') {
      navigate(r.id === '' ? homeHash(this.worldId) : `#/w/${this.worldId}/${r.id}`);
      return;
    }
    // Route to the room the element actually LIVES in (S306). This used to be
    // a bare `navigate(elementHash(...))` for every non-room result, so Cmd+K
    // on a map, a page, a knowledge entry or a chapter landed in the generic
    // field editor instead of the room that owns it — the palette is the app's
    // only global jump, so it flattened all four, app-wide, while the world
    // home twenty lines away resolved them correctly. `core/element-room.ts`
    // is now the single answer both surfaces ask.
    const el = getState().data.elements.find(e => e.id === r.id);
    if (!el) {
      // Result outsurvived its element (deleted mid-search): the generic hash
      // at least lands on the app's own not-found card rather than nothing.
      patchSlice('ui', { ...getState().ui, selectedElementId: r.id });
      navigate(elementHash(this.worldId, r.id));
      return;
    }
    // Selection is only meaningful for the generic element view; a room-owning
    // element opens its room instead, exactly as the home's desk rows do.
    if (roomOf(el, this.worldId).label === '') {
      patchSlice('ui', { ...getState().ui, selectedElementId: r.id });
    }
    // `routeToMap`: the palette is global and fires from inside the writing
    // editor, where focus/reading mode hides the right pane — a tab-only jump
    // there is a dead click. The home desk deliberately does not route.
    openElementTarget(el, this.worldId, { routeToMap: true });
  }
}

/** Open the palette (no-op without an active world, or when already open). */
export function openCommandPalette(): void {
  if (openInstance) return;
  new CommandPalette().open();
}
