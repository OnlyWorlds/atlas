/**
 * A missing name is said one way (1.124.27): every place a person can meet an
 * element with no name says "the unnamed <type>", through `theUnnamed`, in the
 * world's own word for the type. Where it stands alone or starts a line (a
 * heading, a row, a chip, a button's whole name) it takes the capital, "The
 * unnamed event"; inside a longer line it stays lower case, "Open the unnamed
 * event". A name of only spaces counts as none.
 *
 * The census below is a TRIPWIRE over the raw source, line by line: any
 * line that holds "(unnamed" and is not a comment line fails, unless its file
 * is on the allowlist with the reason it is left. It pairs no quotes, so a
 * form nested in a template (`${n.name || `(unnamed ${t})`}`) is seen too.
 * Named limits: a form built from pieces ("(un" + "named") is not seen, and a
 * comment after code on the same line counts (it errs on the side of a look).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { capitalise, nameOrUnnamed, ownName, theUnnamed } from '../../src/core/type-words';
import { createStickyBar } from '../../src/middle/writing-workspace-sticky-bar';
import { mountCompiledView } from '../../src/middle/writing-compiled';
import { mountShareRoom } from '../../src/middle/share-room';
import { mountKnowledgeRoom } from '../../src/middle/knowledge-room';
import { shareHash, knowledgeHash } from '../../src/core/router';
import { buildRecordsSection } from '../../src/middle/element-detail-records';
import { searchPalette } from '../../src/ui/command-palette';
import { findUnlinkedMentions } from '../../src/core/unlinked-mentions';
import { playableCharacters } from '../../src/ui/invite-modal';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element } from '../../src/core/types';
import { buildLooseThreads, computeLooseThreads } from '../../src/middle/home-loose-threads';
import { findDateConflicts } from '../../src/core/date-continuity';
import { CALENDAR_WORD, worldCalendars } from '../../src/core/calendar-lens';
import { mountWritingBody } from '../../src/sidebar/writing-sidebar';
import { writingHash } from '../../src/core/router';
import { setActiveStore } from '../../src/core/active-store';
import type { ToastManager } from '../../src/ui/toast-manager';
import { projectElementEntry } from '../../src/core/share-payload';
import { renderHeader } from '../../src/middle/element-detail-header';
import { makeEditableTitle } from '../../src/middle/editable-title';

// It reads the source tree: on a machine another suite holds, a scan has run past the default 15 s.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');
// Release history: past entries say what was true then.
const SKIP = new Set(['src/changelog/changelog.data.ts']);
const NEEDLE = '(unnamed';

/**
 * The places left on purpose, each with its count and why. A label a pick
 * writes into a story is the story's text, and a story's text is the
 * person's: what an insert writes there is a decision of its own, not this
 * sweep's (ruled for 1.124.27). The chip-label sync owns it from there.
 */
const LEFT: Record<string, { count: number; why: string }> = {
  'src/middle/writing-workspace-add-to-cast.ts': {
    count: 1,
    why: 'the label "Add to story" writes into the story text as the chip\'s label (stored)',
  },
  'src/middle/writing-workspace-mention-items.ts': {
    count: 1,
    why: 'the label a mention pick writes into the story text (stored); the list row says the unnamed form',
  },
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.ts$/.test(name) && !/\.d\.ts$/.test(name) ? [p] : [];
  });
}

/** A comment line: a line comment, or a block comment's open or inner line. Its words are not copy. */
function isCommentLine(line: string): boolean {
  return /^\s*(\/\/|\/\*|\*)/.test(line);
}

/** The lines that hold the needle and are not comment lines, by number. */
function hitLines(code: string): number[] {
  return code.split(/\r?\n/)
    .map((line, i) => (line.includes(NEEDLE) && !isCommentLine(line) ? i + 1 : 0))
    .filter(n => n > 0);
}

function census(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const file of walk(SRC)) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (SKIP.has(rel)) continue;
    const n = hitLines(readFileSync(file, 'utf8')).length;
    if (n > 0) out[rel] = n;
  }
  return out;
}

describe('the census: no "(unnamed" a person can meet', () => {
  it('every "(unnamed" left in the source is on the allowlist, with its reason and count', () => {
    const now = census();
    const unexpected = Object.entries(now)
      .filter(([f, n]) => LEFT[f]?.count !== n)
      .map(([f, n]) => `${f}: ${n}`);
    expect(unexpected, 'Say a missing name with theUnnamed or nameOrUnnamed, or add the place to LEFT with why').toEqual([]);
    // An allowlisted place that is gone takes its row with it.
    expect(Object.keys(LEFT).filter(f => !(f in now))).toEqual([]);
  });

  it('the instrument sees flat and nested forms and ignores comment lines', () => {
    expect(hitLines("const a = el.name || '(unnamed)';")).toEqual([1]);
    expect(hitLines('const t = `New ${c} in "${n.name || `(unnamed ${t})`}"`;')).toEqual([1]);
    expect(hitLines('const o = `Open ${x ? `(unnamed)` : y}`;\nconst h = `Held by ${n.name || `(unnamed)`}`;')).toEqual([1, 2]);
    expect(hitLines("// was '(unnamed)'\n/* \"(unnamed)\" */\n * (unnamed: <id>.json)\nconst c = 'named';")).toEqual([]);
  });

  it('sees both places in the writing tree as it was at 1.124.26, one of them nested in a template', () => {
    const old = readFileSync(join(__dirname, '..', 'fixtures', 'unnamed-census', 'writing-sidebar-95b9bc5.txt'), 'utf8');
    expect(hitLines(old)).toEqual([510, 540]);
  });
});

function el(type: string, id: string, extra: Record<string, unknown> = {}): Element {
  return { id, type, name: id, ...extra } as unknown as Element;
}

afterEach(() => {
  document.body.innerHTML = '';
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
  patchSlice('data', { elements: [] } as never);
});

describe('nameOrUnnamed', () => {
  it("is the element's own name, trimmed, never re-cased", () => {
    expect(nameOrUnnamed({ name: '  ada of the vale ', type: 'character' })).toBe('ada of the vale');
    expect(nameOrUnnamed({ name: 'ada', type: 'character' }, { start: true })).toBe('ada');
  });

  it('says a missing name, or one of spaces, as the unnamed type: lower case mid-line, the capital at the start', () => {
    for (const name of [undefined, null, '', '   ', 7]) {
      expect(nameOrUnnamed({ name, type: 'event' })).toBe('the unnamed event');
      expect(nameOrUnnamed({ name, type: 'event' }, { start: true })).toBe('The unnamed event');
    }
    expect(capitalise(theUnnamed('zone'))).toBe('The unnamed zone');
  });

  it('reads a row flagged unnamed as unnamed, so a line can say it in lower case', () => {
    expect(nameOrUnnamed({ name: 'The unnamed event', type: 'event', unnamed: true })).toBe('the unnamed event');
  });

  it("keeps the world's own word for the type as the world wrote it", () => {
    patchSlice('active', { worldId: 'w', meta: { name: 'W', x_names: { version: 1, types: { character: { one: 'Employee' } } } } } as never);
    expect(nameOrUnnamed({ name: '', type: 'character' })).toBe('the unnamed Employee');
    expect(nameOrUnnamed({ name: '', type: 'character' }, { start: true })).toBe('The unnamed Employee');
  });
});

describe("the home page's loose threads", () => {
  function open(elements: Element[], key: string): HTMLElement {
    patchSlice('data', { elements } as never);
    const band = buildLooseThreads(elements, 'w')!;
    document.body.appendChild(band);
    const i = computeLooseThreads(elements).findIndex(t => t.key === key);
    band.querySelectorAll<HTMLButtonElement>('.atlas-home-thread')[i].click();
    return band.querySelector<HTMLElement>('.atlas-home-thread-expand')!;
  }

  it('a chip for an element with no name is named "Open the unnamed …" and shows "The unnamed …"', () => {
    const expand = open([el('character', 'c1', { name: '   ' }), el('character', 'c2', { name: 'Ada' })], 'unlinked-characters');
    const chips = [...expand.querySelectorAll<HTMLButtonElement>('.atlas-home-thread-chip')];
    const blank = chips.find(c => c.title !== 'Open Ada')!;
    expect(blank.title).toBe('Open the unnamed character');
    expect(blank.querySelector('span:not(.material-symbols-outlined)')?.textContent).toBe('The unnamed character');
    expect(chips.map(c => c.title)).toContain('Open Ada');
  });

  it('a date to check says its first element with the capital and a later one in lower case', () => {
    const elements = [
      el('character', 'c1', { name: '', birth_date: 120 }),
      el('event', 'e1', { name: '  ', start_date: 100, end_date: 105, characters: ['c1'] }),
    ];
    const expand = open(elements, 'date-conflicts');
    const chips = [...expand.querySelectorAll<HTMLButtonElement>('.atlas-home-thread-conflict .atlas-home-thread-chip')];
    expect(chips.map(c => c.querySelector('span:not(.material-symbols-outlined)')?.textContent))
      .toEqual(['The unnamed character', 'the unnamed event']);
    expect(chips.map(c => c.title)).toEqual(['Open the unnamed character', 'Open the unnamed event']);
  });
});

describe('the rows other parts read', () => {
  it('a date conflict carries the start form and its flag', () => {
    const [c] = findDateConflicts([
      el('character', 'c1', { name: '', birth_date: 120 }),
      el('event', 'e1', { name: 'Siege', start_date: 100, end_date: 105, characters: ['c1'] }),
    ]);
    expect(c.a).toMatchObject({ name: 'The unnamed character', unnamed: true });
    expect(c.b.name).toBe('Siege');
    expect(c.b.unnamed).toBeUndefined();
  });

  it('a calendar with no name keeps its room\'s word: the unnamed calendar, a menu item with the capital, a title in lower case', () => {
    const cfg = { version: 1, grain: 'year', eras: [{ name: 'Age', abbrev: 'A', start: 0 }], format: '{year} {era}' };
    const [cal] = worldCalendars([el('construct', 'k1', { name: ' ', supertype: 'calendar', atlas_calendar: cfg })]);
    expect(cal?.name).toBe('The unnamed calendar');
    expect(nameOrUnnamed(cal!, { word: CALENDAR_WORD })).toBe('the unnamed calendar');
  });

  it('a shared page carries the unnamed form as the name it prints alone', () => {
    const blank = el('event', 'e1', { name: '' });
    const entry = projectElementEntry(blank, new Map([[blank.id, blank]]), new Set([blank.id]), [], false);
    expect(entry.name).toBe('The unnamed event');
  });
});

describe('the headings', () => {
  it("an element's page heading says the unnamed form with the capital", () => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: 'w', name: 'W', state: 'local-only' }] } as never);
    patchSlice('active', { worldId: 'w', meta: { name: 'W' } } as never);
    const h = renderHeader(el('event', 'e1', { name: '   ' }));
    expect(h.querySelector('[data-role="element-name"]')?.textContent).toBe('The unnamed event');
  });

  it('an editable title of only spaces shows its placeholder, never a blank heading', () => {
    const t = makeEditableTitle({ initial: '   ', placeholder: 'The unnamed character', onCommit: () => {} });
    expect(t.el.textContent).toBe('The unnamed character');
    expect(t.el.classList.contains('is-placeholder')).toBe(true);
  });
});

describe("a room's own word for the type", () => {
  it('theUnnamed and nameOrUnnamed keep the word a room passes, as given', () => {
    expect(theUnnamed('narrative', { word: 'chapter' })).toBe('the unnamed chapter');
    expect(nameOrUnnamed({ name: ' ', type: 'construct' }, { start: true, word: 'calendar' })).toBe('The unnamed calendar');
    expect(nameOrUnnamed({ name: 'Ada', type: 'character' }, { word: 'hero' })).toBe('Ada');
    // No word, or only spaces: the type's word.
    expect(theUnnamed('narrative', { word: '  ' })).toBe('the unnamed narrative');
  });

  it("the writing tree says a nameless book and chapter by their tiers, and the row's + in lower case", () => {
    const toasts = { info() {}, error() {}, success() {}, warning() {} } as unknown as ToastManager;
    const W = 'w-tree';
    patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: W, name: 'Tree', state: 'local-only' }] } as never);
    patchSlice('active', { worldId: W, meta: { name: 'Tree' } } as never);
    patchSlice('data', { elements: [
      el('narrative', 'b1', { name: '  ', supertype: 'Book', order: 0 }),
      el('narrative', 'ch1', { name: '', supertype: 'Chapter', parent_narrative: 'b1', order: 0 }),
    ] } as never);
    window.location.hash = writingHash(W);
    const content = document.createElement('div');
    document.body.appendChild(content);
    const unmount = mountWritingBody({ content, toasts });
    try {
      const names = [...content.querySelectorAll('.atlas-writing-tree-name')].map(n => n.textContent);
      expect(names).toEqual(['The unnamed book', 'The unnamed chapter']);
      const add = content.querySelector<HTMLElement>('.atlas-writing-tree-row-add');
      expect(add?.title).toBe('New chapter in the unnamed book');
    } finally {
      unmount();
      setActiveStore(null);
      window.location.hash = '';
    }
  });
});

describe('a room says a nameless thing by its own word', () => {
  const W = 'w-rooms';
  const toasts = { info() {}, error() {}, success() {}, warning() {} } as unknown as ToastManager;
  function openWorld(elements: Element[]): void {
    patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: W, name: 'Rooms', state: 'local-only' }] } as never);
    patchSlice('active', { worldId: W, meta: { name: 'Rooms' } } as never);
    patchSlice('data', { elements } as never);
  }
  const book = el('narrative', 'b1', { name: 'The Book', supertype: 'Book', order: 0 });
  const chapter = el('narrative', 'ch1', { name: '  ', supertype: 'Chapter', parent_narrative: 'b1', order: 0, story: 'It rained.' });

  it("the writing room's crumbs say a nameless chapter as the tree does", () => {
    openWorld([book, chapter]);
    const bar = createStickyBar({ root: document.body, getViewMode: () => 'edit' as never, onSwitchViewMode: () => {} });
    const crumbs = [...bar.render(chapter).querySelectorAll('.atlas-writing-workspace-crumb-seg')].map(c => c.textContent);
    expect(crumbs).toEqual(['The Book', 'The unnamed chapter']);
  });

  it("the compiled view's section marker says a nameless chapter as the tree does", () => {
    openWorld([book, chapter]);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmount = mountCompiledView(host, book);
    expect(host.querySelector('.atlas-writing-compiled-marker-name')?.textContent).toBe('The unnamed chapter');
    unmount();
  });

  it('a page row says the unnamed page, a knowledge row the unnamed entry', () => {
    const rooms = [
      { mount: mountShareRoom, hash: shareHash(W), sub: 'page', row: '.atlas-share-row-name', want: 'The unnamed page' },
      { mount: mountKnowledgeRoom, hash: knowledgeHash(W), sub: 'knowledge', row: '.atlas-knowledge-row-name', want: 'The unnamed entry' },
    ];
    for (const r of rooms) {
      openWorld([el('narrative', 'n1', { name: '', subtype: r.sub, story: 'Owed.' })]);
      window.location.hash = r.hash;
      const target = document.createElement('div');
      document.body.appendChild(target);
      const unmount = r.mount(target, toasts);
      expect(target.querySelector(r.row)?.textContent).toBe(r.want);
      unmount();
      window.location.hash = '';
    }
  });

  it("a character's record rows say the unnamed record and the unnamed battle", () => {
    const tally = { winner: 'Left', sides: [{ name: 'Left', fallen: 3 }, { name: 'Right', fallen: 9 }], units: [] };
    const els = [
      el('character', 'c1', { name: 'Ada' }),
      el('event', 'e1', { name: '', x_record: { tool: 'subs', played_at: '2026-10-20T12:00:00Z' }, characters: ['c1'] }),
      el('event', 'e2', { name: ' ', x_tangle_battle: tally, characters: ['c1'] }),
    ];
    openWorld(els);
    const sec = buildRecordsSection(els[0])!;
    expect([...sec.querySelectorAll('.atlas-record-name')].map(n => n.textContent))
      .toEqual(['The unnamed record', 'The unnamed battle']);
  });
});

describe('one test for a usable name', () => {
  it('ownName is the trimmed own name, or empty for none, a non-string, spaces or a flagged row', () => {
    expect(ownName({ name: ' Ada ' })).toBe('Ada');
    for (const name of [undefined, null, '', '   ', 7, {}]) expect(ownName({ name })).toBe('');
    expect(ownName({ name: 'The unnamed event', unnamed: true })).toBe('');
  });

  it('the rows that carry a flag read it through ownName, so a non-string name neither throws nor names', () => {
    const cfg = { version: 1, grain: 'year', eras: [{ name: 'Age', abbrev: 'A', start: 0 }], format: '{year} {era}' };
    const [cal] = worldCalendars([el('construct', 'k1', { name: 7, atlas_calendar: cfg })]);
    expect(cal).toMatchObject({ name: 'The unnamed calendar', unnamed: true });
    const [c] = findDateConflicts([
      el('character', 'c1', { name: 7, birth_date: 120 }),
      el('event', 'e1', { name: 'Siege', start_date: 100, end_date: 105, characters: ['c1'] }),
    ]);
    expect(c.a).toMatchObject({ name: 'The unnamed character', unnamed: true });
  });
});

describe('an unnamed row sorts first, by its own name', () => {
  it('in the dates to check', () => {
    const conflicts = findDateConflicts([
      el('character', 'c2', { name: 'Ada', birth_date: 120 }),
      el('character', 'c1', { name: '', birth_date: 120 }),
      el('event', 'e1', { name: 'Siege', start_date: 100, end_date: 105, characters: ['c1', 'c2'] }),
    ]);
    expect(conflicts.map(c => c.a.name)).toEqual(['The unnamed character', 'Ada']);
  });

  it('in the palette, on a tie', () => {
    const results = searchPalette('harbor', [
      el('character', 'a1', { name: 'Aaron', description: 'A harbor man.' }),
      el('character', 'u1', { name: '', description: 'A harbor man.' }),
    ]);
    expect(results.map(r => r.name)).toEqual(['The unnamed character', 'Aaron']);
  });

  it('in the unlinked mentions', () => {
    const subject = el('character', 's1', { name: 'Brenn' });
    const m = findUnlinkedMentions(subject, [
      subject,
      el('narrative', 'n2', { name: 'Arrival', story: 'Brenn came.' }),
      el('narrative', 'n1', { name: '', story: 'Brenn left.' }),
    ]);
    expect(m.narratives.map(n => n.name)).toEqual(['the unnamed narrative', 'Arrival']);
  });

  it('in the plays-as list', () => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: 'w', name: 'W', state: 'api-linked', api: { world_id: 's1', api_key: 'k' } }] } as never);
    patchSlice('active', { worldId: 'w', meta: { name: 'W' } } as never);
    const synced = { server_updated_at: '2026-10-19T09:00:00.000Z' };
    patchSlice('data', { elements: [
      el('character', 'a1', { name: 'Aaron', ...synced }),
      el('character', 'u1', { name: ' ', ...synced }),
    ] } as never);
    expect(playableCharacters('s1').map(c => c.name)).toEqual(['The unnamed character', 'Aaron']);
  });
});
