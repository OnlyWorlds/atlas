/**
 * A missing name is said one way (1.124.27): every place a person can meet an
 * element with no name says "the unnamed <type>", through `theUnnamed`, in the
 * world's own word for the type. Where it stands alone or starts a line (a
 * heading, a row, a chip, a button's whole name) it takes the capital, "The
 * unnamed event"; inside a longer line it stays lower case, "Open the unnamed
 * event". A name of only spaces counts as none.
 *
 * The census below is a TRIPWIRE over the source: any string literal that
 * still says "(unnamed" fails, unless its file is on the allowlist with the
 * reason it is left. Named limits: a form built from pieces is not seen, and
 * comments are not copy.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { capitalise, nameOrUnnamed, theUnnamed } from '../../src/core/type-words';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element } from '../../src/core/types';
import { buildLooseThreads, computeLooseThreads } from '../../src/middle/home-loose-threads';
import { findDateConflicts } from '../../src/core/date-continuity';
import { worldCalendars } from '../../src/core/calendar-lens';
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
 * writes into a story is stored text: the chip-label sync owns it from there,
 * and the story keeps what was written (a stored value is never rewritten).
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

const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.ts$/.test(name) && !/\.d\.ts$/.test(name) ? [p] : [];
  });
}

/** Comment text is not copy: drop block comments and line comments first. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

function hitsIn(code: string): number {
  let n = 0;
  for (const lit of stripComments(code).match(LITERAL) ?? []) n += lit.split(NEEDLE).length - 1;
  return n;
}

function census(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const file of walk(SRC)) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (SKIP.has(rel)) continue;
    const n = hitsIn(readFileSync(file, 'utf8'));
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

  it('the instrument sees a planted literal and ignores comments', () => {
    expect(hitsIn("const a = el.name || '(unnamed)'; const b = `x ${y || '(unnamed map)'}`;")).toBe(2);
    expect(hitsIn("// was '(unnamed)'\n/* \"(unnamed)\" */ const c = 'named';")).toBe(0);
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

  it('a calendar with no name is the unnamed construct, a menu item with the capital, a title in lower case', () => {
    const cfg = { version: 1, grain: 'year', eras: [{ name: 'Age', abbrev: 'A', start: 0 }], format: '{year} {era}' };
    const [cal] = worldCalendars([el('construct', 'k1', { name: ' ', supertype: 'calendar', atlas_calendar: cfg })]);
    expect(cal?.name).toBe('The unnamed construct');
    expect(nameOrUnnamed(cal!)).toBe('the unnamed construct');
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
