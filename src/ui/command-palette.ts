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

import { typeName } from '../core/type-words';
import { BaseModal } from './modal-base';
import { getState, patchSlice } from '../core/state';
import { worldIsViewOnly } from '../core/view-only';
import { navigate, elementHash, homeHash } from '../core/router';
import { setSidebarModePref } from '../core/ui-prefs';
import { scoreElementMatch } from '../core/element-search';
import { roomOf, openElementTarget } from '../core/element-room';
import { ELEMENT_ICONS } from '../core/constants';
import { browserStorageDoorOpen, hasFolderMode } from '../core/capabilities';
import { filesWhereOf } from '../core/browser-worlds';
import { isTourFlagActive } from '../tour/tour-flag';
import type { Element, ElementType } from '../core/types';
import { forPointer } from '../core/pointer';
import { currentLore } from '../core/parlor-room';

const MAX_ELEMENT_RESULTS = 12;
const MAX_ROOM_RESULTS = 3;

export interface PaletteResult {
  kind: 'element' | 'room' | 'action' | 'create';
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
/**
 * Commands reachable by name (S364: the palette's first). `id` is what
 * `activate` switches on.
 */
const ACTIONS: Array<{ label: string; id: string; icon: string; aliases?: string[]; folderOnly?: boolean; door?: boolean; diskOnly?: boolean; browserStorage?: boolean; makesWorld?: boolean }> = [
  // A world kept in this browser has no folder to rescan, so it hides this.
  { label: 'Reload from disk', id: 'reload-disk', icon: 'folder_open', aliases: ['refresh from disk', 'rescan', 'files'], diskOnly: true },
  // The world doors (S365): the same runner as the Worlds list's buttons.
  { label: 'Add a world', id: 'add-world', icon: 'add', aliases: ['new world', 'create world', 'world'], door: true, makesWorld: true },
  { label: 'Open a world folder', id: 'open-world-folder', icon: 'folder_open', aliases: ['open folder', 'open world'], folderOnly: true, door: true },
  // 1.17 (contract §8): a world file opens wherever browser storage works.
  { label: 'Open a world file', id: 'open-world-file', icon: 'file_open', aliases: ['world file', 'open file', 'zip'], door: true, browserStorage: true },
];

const ROOMS: Array<{ label: string; segment: string; icon: string; aliases?: string[] }> = [
  { label: 'Home', segment: '', icon: 'home' },
  { label: 'Writing', segment: 'writing', icon: 'edit_note' },
  { label: 'Knowledge', segment: 'knowledge', icon: 'psychology' },
  { label: 'Charts', segment: 'timeline', icon: 'timeline', aliases: ['timeline'] },
  { label: 'Pages', segment: 'share', icon: 'wall_art', aliases: ['share'] },
  { label: 'Data', segment: 'import', icon: 'swap_vert', aliases: ['import', 'export'] },
  { label: 'Settings', segment: 'settings', icon: 'settings' },
];

function openWorldEntry() {
  const { registry, active } = getState();
  return registry.worlds.find(w => w.id === active?.worldId);
}

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
    // Labels are Sentence case (1.32.0) and the query is lowercased, so the
    // names are too.
    const names = [room.label, ...(room.aliases ?? [])].map(normalize);
    if (names.some(n => n.startsWith(q))) {
      out.push({ kind: 'room', id: room.segment, name: room.label, hint: 'room', score: 90 });
    } else if (names.some(n => n.includes(q))) {
      out.push({ kind: 'room', id: room.segment, name: room.label, hint: 'room', score: 55 });
    }
  }

  for (const action of ACTIONS) {
    // The world doors are locked during the tour, as its sidebar locks them
    // (S365 gate lens B F5 / C M3).
    if (action.folderOnly && !hasFolderMode()) continue;
    // A door that needs browser storage asks the probe (conv. 120); a world
    // can be made where either a folder or browser storage works.
    if (action.browserStorage && !browserStorageDoorOpen()) continue;
    if (action.makesWorld && !hasFolderMode() && !browserStorageDoorOpen()) continue;
    if (action.door && isTourFlagActive()) continue;
    if (action.diskOnly && filesWhereOf(openWorldEntry()) === 'browser') continue;
    const names = [action.label, ...(action.aliases ?? [])].map(normalize);
    if (names.some(n => n.startsWith(q))) {
      out.push({ kind: 'action', id: action.id, name: action.label, hint: 'command', score: 85 });
    } else if (q.length >= 3 && names.some(n => n.includes(q))) {
      out.push({ kind: 'action', id: action.id, name: action.label, hint: 'command', score: 50 });
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
      hint: taxonomy ? `${typeName(el.type, { supertype: el.supertype })} · ${taxonomy}` : typeName(el.type, { supertype: el.supertype }),
      snippet: hit.snippet,
      score: hit.score,
    });
  }

  out.sort((a, b) => (b.score - a.score) || (a.name ?? '').localeCompare(b.name ?? ''));

  const rooms = out.filter(r => r.kind === 'room').slice(0, MAX_ROOM_RESULTS);
  const actions = out.filter(r => r.kind === 'action');
  const els = out.filter(r => r.kind === 'element').slice(0, MAX_ELEMENT_RESULTS);
  return [...rooms, ...actions, ...els].sort((a, b) => (b.score - a.score) || (a.name ?? '').localeCompare(b.name ?? ''));
}

/**
 * The rows the palette shows (S369): the search, plus one "Create "<query>"
 * as…" row when the query names no element. It sits after any room or command
 * matches, so with nothing else matched it is the first row and Enter runs
 * it. `id` carries the name to prefill. Not offered during the tour.
 * Exported for unit tests.
 */
export function paletteRows(query: string, elements: readonly Element[]): PaletteResult[] {
  const results = searchPalette(query, elements);
  const name = query.trim();
  // The tour scripts every create; a typed name would be ignored there. A
  // view-only world creates nothing (conv. 149).
  if (!name || isTourFlagActive() || worldIsViewOnly() || results.some(r => r.kind === 'element')) return results;
  return [...results, { kind: 'create', id: name, name: `Create "${name}" as…`, hint: 'new element', score: 0 }];
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
    input.placeholder = 'Search elements and rooms…';
    input.setAttribute('data-role', 'cmdk-input');
    body.appendChild(input);

    this.list = document.createElement('div');
    this.list.className = 'atlas-cmdk-list';
    body.appendChild(this.list);

    input.addEventListener('input', () => {
      this.query = input.value;
      this.results = paletteRows(this.query, currentLore());
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
      hint.textContent = forPointer(
      'Type to search names, aliases, types, and descriptions. ↑↓ to move, Enter to jump.',
      'Type to search names, aliases, types, and descriptions. Tap one to jump.',
    );
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
        : r.kind === 'action'
          ? (ACTIONS.find(a => a.id === r.id)?.icon ?? 'bolt')
          : r.kind === 'create'
            ? 'add'
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
    seeAll.textContent = this.results.some(r => r.kind !== 'create')
      ? 'See all in the sidebar →'
      : 'No quick matches: filter the sidebar →';
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
    if (r.kind === 'action') {
      if (r.id === 'reload-disk') void reloadFromDisk();
      else if (r.id === 'add-world' || r.id === 'open-world-folder' || r.id === 'open-world-file') void openWorldDoor(r.id);
      return;
    }
    if (r.kind === 'create') {
      void openCreateWithName(r.id);
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

/**
 * Ctrl+K's create row (S369): the shared create door (so the tour's scripting
 * still holds), the name prefilled and the type left to the modal.
 */
async function openCreateWithName(name: string): Promise<void> {
  const [{ openCreateDoor }, { toastManager }] = await Promise.all([
    import('./create-element-door'), import('./toast-manager'),
  ]);
  openCreateDoor(toastManager, { initialName: name });
}

/** Ctrl+K's world doors (S365): the same runner as the Worlds list's buttons. */
async function openWorldDoor(id: 'add-world' | 'open-world-folder' | 'open-world-file'): Promise<void> {
  const [{ openAddWorldChooser, runAddWorldAction }, { toastManager }] = await Promise.all([
    import('../setup/world-doors'), import('./toast-manager'),
  ]);
  if (id === 'add-world') openAddWorldChooser(toastManager);
  else await runAddWorldAction(id === 'open-world-file' ? 'open-file' : 'open-folder', toastManager);
}

/**
 * "Reload from disk" (S364): a FULL live-folder pass, every file confirmed by
 * content. Says what it found, including nothing.
 */
export async function reloadFromDisk(): Promise<void> {
  const { rescanNow } = await import('../core/live-folder');
  const { toastManager } = await import('./toast-manager');
  let scan: Awaited<ReturnType<typeof rescanNow>>;
  try {
    scan = await rescanNow({ force: true, full: true });
  } catch (err) {
    // A rescan only reads: running it again is safe.
    console.error('[palette] reload from disk failed:', err);
    const { showProblem } = await import('./problem-fixes');
    showProblem(err, { doing: 'reloading from disk', retry: reloadFromDisk });
    return;
  }
  const { changes, skipped } = scan;
  if (skipped) {
    // Never "nothing changed" when it did not look (S364 gate lens B B10).
    const why = skipped === 'rekey' ? 'ids are being updated' : skipped === 'busy' ? 'the world is busy (loading, the tour, or a map edit)' : 'no world is open';
    toastManager.info(`Atlas could not check the folder just now: ${why}.`);
    return;
  }
  const shown = changes.filter(c => c.kind !== 'unreadable').length;
  const broken = changes.length - shown;
  if (shown === 0 && broken === 0) toastManager.info('Nothing changed on disk.');
  else if (broken === 0) toastManager.info(`${shown} ${shown === 1 ? 'element' : 'elements'} changed on disk.`);
  else toastManager.info(`${shown} changed on disk, ${broken} could not be read.`);
}
