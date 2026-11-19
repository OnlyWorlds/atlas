/**
 * The other words for a missing name (1.124.28): where Atlas still said
 * "Unnamed", "unnamed pin", "(untitled)", "this entry" or "an unnamed element"
 * for an element with no name, it says the unnamed form every other room says
 * (`nameOrUnnamed`, in the room's own word where it has one). A link that
 * stands alone after a label takes the capital, since a reader may say it
 * alone; a control that opens an element says so in its tooltip, through one
 * builder (`openWords`); and nothing invented is written into the world as a
 * name: a knowledge entry is created only once it has one.
 *
 * The census below is the tripwire for the bare forms, as `unnamed-names`
 * is for "(unnamed": any line that is not a comment line and holds the word
 * unnamed as a word of its own (never part of a name like `theUnnamed`, a
 * property read like `row.unnamed`, or a key like `unnamed: true`), or
 * "(untitled", fails unless its file is on the allowlist with its reason.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { openWords, nameOrUnnamed } from '../../src/core/type-words';
import { pinBacklink, foldBacklinks } from '../../src/core/spatial-backlinks';
import { ambiguousLine, childClashLine, hiddenOnlineLine } from '../../src/sync/make-online-run';
import { lensChoices, lensName, keepLensOn } from '../../src/core/web-lens';
import { cardCopy, slotName, storyLines } from '../../src/core/strand-journey';
import { buildPagePayload } from '../../src/core/share-payload';
import { buildWorkPacket } from '../../src/middle/element-detail-packet';
import { fillMessageParties } from '../../src/middle/element-detail-message';
import { messageParties } from '../../src/core/message-parties';
import { findUnlinkedMentions } from '../../src/core/unlinked-mentions';
import { makeEditableTitle } from '../../src/middle/editable-title';
import { mountKnowledgeRoom } from '../../src/middle/knowledge-room';
import { knowledgeHash } from '../../src/core/router';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, Pin } from '../../src/core/types';
import type { OwStrand } from '../../src/core/strand';
import type { ToastManager } from '../../src/ui/toast-manager';
import { mountTimelineView } from '../../src/visualization/timeline/timeline-view';
import type { TimelineNode } from '../../src/visualization/timeline/types';

// It reads the source tree: on a machine another suite holds, a scan has run past the default 15 s.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');
// Release history: past entries say what was true then.
const SKIP = new Set(['src/changelog/changelog.data.ts']);

/** The word on its own: not inside a name (theUnnamed), not a property read (.unnamed) or a key or flag (unnamed: true). */
const BARE = /(?<![\w.$-])[Uu]nnamed(?![\w$])(?!\s*[?:=,;)}&|\]])/;
const UNTITLED = /\(untitled/;

/** The places left on purpose, each with its count and why. */
const LEFT: Record<string, { count: number; why: string }> = {
  'src/core/type-words.ts': {
    count: 2,
    why: 'the builder\'s own words ("the unnamed …") and the `unnamed` key named in a type',
  },
  'src/middle/element-detail-fields.ts': {
    count: 1,
    why: 'a field with no label ("Remove the unnamed field"): a field, not an element',
  },
  'src/tour/tour-data.ts': {
    count: 3,
    why: 'the tour world\'s own names (its "Unnamed Planet" and the map of it)',
  },
  'src/tour/tour-engine.ts': {
    count: 1,
    why: 'the file name of the tour planet\'s picture',
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

/** The lines that say a bare form and are not comment lines, by number. */
function hitLines(code: string): number[] {
  return code.split(/\r?\n/)
    .map((line, i) => (!isCommentLine(line) && (BARE.test(line) || UNTITLED.test(line)) ? i + 1 : 0))
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

describe('the census: no bare Unnamed or (untitled) a person can meet', () => {
  it('every bare form left in the source is on the allowlist, with its reason and count', () => {
    const now = census();
    const unexpected = Object.entries(now)
      .filter(([f, n]) => LEFT[f]?.count !== n)
      .map(([f, n]) => `${f}: ${n}`);
    expect(unexpected, 'Say a missing name with nameOrUnnamed, or add the place to LEFT with why').toEqual([]);
    // An allowlisted place that is gone takes its row with it.
    expect(Object.keys(LEFT).filter(f => !(f in now))).toEqual([]);
  });

  it('the instrument sees each form this release took out, flat and nested', () => {
    const planted = [
      "const a = el.name || 'Unnamed';",
      'row.appendChild(act(`Still at ${n.trim() || \'Unnamed\'}`, k, run));',
      "return { pin, label: t || 'unnamed pin' };",
      "zoneName: nameOf(zone) || 'unnamed zone',",
      "name: (draft.name || '').trim() || 'Unnamed knowledge',",
      "title: page.name || '(untitled)',",
      'const t = `Delete chart "${c.name ?? `unnamed`}"?`;',
      ".map(a => a.name || 'unnamed')",
      'const s = `An unnamed ${typeName(t)}`;',
    ];
    expect(hitLines(planted.join('\n'))).toEqual(planted.map((_, i) => i + 1));
  });

  it('the instrument passes names, property reads, keys, flags and comments', () => {
    const clean = [
      'const s = theUnnamed(t);',
      'const n = nameOrUnnamed(el, { start: true });',
      'if (row.unnamed) said();',
      'return { id, unnamed: true };',
      '  unnamed?: boolean;',
      'const unnamed = !ownName(el);',
      'const r = { ...row, unnamed };',
      'if (!unnamed && x) go();',
      'auditUnnamedIconControls();',
      "// was 'Unnamed'",
      ' * (untitled)',
    ];
    expect(hitLines(clean.join('\n'))).toEqual([]);
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

describe('a nameless knowledge entry is never saved under an invented name', () => {
  const W = 'w-know';
  const toasts = { info() {}, error() {}, success() {}, warning() {} } as unknown as ToastManager;

  it('Create with no name writes nothing, says Type a name first and opens the title; with a name it writes that name', async () => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: W, name: 'Know', state: 'local-only' }] } as never);
    patchSlice('active', { worldId: W, meta: { name: 'Know' } } as never);
    patchSlice('data', { elements: [] } as never);
    const createElement = vi.fn(async (type: string, data: Record<string, unknown>) => ({ id: 'k1', type, ...data }));
    setActiveStore({ createElement, listElements: async () => [] } as never);
    window.location.hash = knowledgeHash(W, 'new');
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mountKnowledgeRoom(target, toasts);
    try {
      const create = target.querySelector<HTMLButtonElement>('.atlas-knowledge-draft-actions .atlas-btn-primary')!;
      const note = target.querySelector<HTMLElement>('[data-role="draft-note"]')!;
      expect(note.getAttribute('role')).toBe('status');
      expect(note.textContent).toBe('');
      create.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(createElement).not.toHaveBeenCalled();
      expect(note.textContent).toBe('Type a name first');
      const input = target.querySelector<HTMLInputElement>('.atlas-knowledge-entry-header input.atlas-element-name-input');
      expect(input, 'the title opens for typing').not.toBeNull();
      expect(input!.placeholder).toBe('What is known…');
      input!.value = 'The abbot lies';
      input!.dispatchEvent(new Event('blur'));
      expect(note.textContent).toBe('');
      create.click();
      await vi.waitFor(() => expect(createElement).toHaveBeenCalledTimes(1));
      expect(createElement.mock.calls[0][1]).toMatchObject({ name: 'The abbot lies', subtype: 'knowledge' });
    } finally {
      unmount();
      setActiveStore(null);
      window.location.hash = '';
    }
  });

  it('a saved entry with no name is headed by its unnamed form, its input asks the prompt', () => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: W, name: 'Know', state: 'local-only' }] } as never);
    patchSlice('active', { worldId: W, meta: { name: 'Know' } } as never);
    patchSlice('data', { elements: [el('narrative', 'k1', { name: '  ', subtype: 'knowledge', story: 'Owed.' })] } as never);
    window.location.hash = knowledgeHash(W, 'k1');
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mountKnowledgeRoom(target, toasts);
    try {
      const title = target.querySelector<HTMLElement>('.atlas-knowledge-entry-header .atlas-element-name')!;
      expect(title.textContent).toBe('The unnamed entry');
      title.click();
      expect(title.querySelector('input')!.placeholder).toBe('What is known…');
    } finally {
      unmount();
      window.location.hash = '';
    }
  });

  it("the knowledge list's rows say in their tooltip what they open, through the one builder", () => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: W, name: 'Know', state: 'local-only' }] } as never);
    patchSlice('active', { worldId: W, meta: { name: 'Know' } } as never);
    patchSlice('data', { elements: [
      el('narrative', 'k1', { name: '', subtype: 'knowledge', story: 'Owed.' }),
      el('narrative', 'k2', { name: ' The debt ', subtype: 'knowledge', story: 'Owed.' }),
    ] } as never);
    window.location.hash = knowledgeHash(W);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mountKnowledgeRoom(target, toasts);
    try {
      const titles = [...target.querySelectorAll<HTMLElement>('.atlas-knowledge-row')].map(r => r.title).sort();
      expect(titles).toEqual(['Open The debt', 'Open the unnamed entry']);
    } finally {
      unmount();
      window.location.hash = '';
    }
  });
});

describe('the one builder for a tooltip that opens an element', () => {
  it('says Open and the name, or the unnamed form in lower case, in the room\'s word', () => {
    expect(openWords({ type: 'character', name: ' Ada ' })).toBe('Open Ada');
    expect(openWords({ type: 'character', name: '   ' })).toBe('Open the unnamed character');
    expect(openWords({ type: 'narrative', name: '' }, { word: 'entry' })).toBe('Open the unnamed entry');
  });
});

describe('an editable title', () => {
  it('shows a name trimmed, asks its prompt while empty, and opens on edit()', () => {
    const t = makeEditableTitle({ initial: '  Arrival ', placeholder: 'The unnamed page', prompt: 'Page name…', onCommit: () => {} });
    expect(t.el.textContent).toBe('Arrival');
    t.sync('');
    expect(t.el.textContent).toBe('The unnamed page');
    t.edit();
    expect(t.el.querySelector('input')!.placeholder).toBe('Page name…');
  });
});

describe('pins and markers that link to an element', () => {
  const map = el('map', 'm1', { name: '' });
  const nobody = el('character', 'c1', { name: ' ' });
  const pin = (extra: Record<string, unknown>) => el('pin', 'p1', { name: '', map_id: 'm1', element_id: 'c1', ...extra }) as unknown as Pin;
  const byId = new Map<string, Element>([[map.id, map], [nobody.id, nobody]]);

  it('a pin is said by its other end, or that end\'s unnamed form, never "unnamed pin"', () => {
    expect(pinBacklink(pin({}), 'm1', byId).label).toBe('The unnamed character');
    expect(pinBacklink(pin({ element_id: 'gone' }), 'm1', byId).label).toBe('The unnamed pin');
    expect(pinBacklink(pin({}), 'c1', byId).label).toBe('on the unnamed map');
    expect(pinBacklink(pin({ map_id: 'gone' }), 'c1', byId).label).toBe('The unnamed pin');
  });

  it("a marker fold says its zone's unnamed form", () => {
    const zone = el('zone', 'z1', { name: '' });
    const marker = el('marker', 'k1', { name: '', zone_id: 'z1', map_id: 'm1' });
    const folded = foldBacklinks([marker], 'm1', new Map([[zone.id, zone]]));
    expect(folded.markers[0].zoneName).toBe('The unnamed zone');
  });
});

describe('the notes after Make online', () => {
  it('say a nameless element by its unnamed form; one alone starts its sentence with the capital', () => {
    expect(hiddenOnlineLine([{ id: 'a', type: 'map', name: '' }])).toMatch(/^The unnamed map is hidden here/);
    expect(hiddenOnlineLine([{ id: 'a', type: 'map', name: '' }, { id: 'b', type: 'zone', name: 'Bay' }]))
      .toContain('(the unnamed map, Bay)');
    expect(ambiguousLine([{ type: 'character', name: ' ' }, { type: 'character', name: ' ' }])).toContain('(the unnamed character, the unnamed character)');
    expect(childClashLine([{ type: 'zone', name: '' }])).toContain('the unnamed zone');
  });
});

describe('lenses', () => {
  it('a nameless lens is the unnamed lens: the capital in the menu, lower case inside a line', () => {
    const lens = el('construct', 'l1', { name: '', supertype: 'Lens', x_lens: {} });
    expect(lensName(lens)).toBe('the unnamed lens');
    expect(lensName(lens, { start: true })).toBe('The unnamed lens');
    expect(lensChoices([lens]).map(c => c.name)).toEqual(['The unnamed lens']);
  });

  it('a lens kept on a nameless element is named for its unnamed form, never "Unnamed\'s world"', async () => {
    const nobody = el('character', 'c9', { name: '' });
    const createElement = vi.fn(async (type: string, data: Record<string, unknown>) => ({ id: 'L1', type, ...data }) as unknown as Element);
    const store = { listElements: vi.fn(async () => [nobody]), createElement };
    const kept = await keepLensOn('w1', nobody, 'characters', store, async () => {});
    expect(createElement).toHaveBeenCalledWith('construct', { name: "The unnamed character's world", supertype: 'Lens', characters: ['c9'] });
    expect(kept?.name).toBe("The unnamed character's world");
  });
});

describe('the strand', () => {
  const strand = (over: Partial<OwStrand>): OwStrand => ({ narrative: null, event: null, location: null, character: null, now: null, same: null, ...over });

  it('says a nameless slot in the strand\'s word, the capital only at a line\'s start', () => {
    const s = strand({ narrative: { id: 'n', name: '' }, event: { id: 'e', name: ' ' } });
    expect(slotName('narrative', s)).toBe('the unnamed story');
    expect(slotName('event', s, true)).toBe('The unnamed event');
    expect(cardCopy('location', s).title).toBe('Where did the unnamed event happen?');
    // Inside the story line's sentence the chip says it in lower case.
    expect(storyLines(s)[0]).toContainEqual({ chip: 'event', id: 'e', name: 'the unnamed event' });
  });
});

describe("a chart card's chips", () => {
  it('are named for what a press does, the tooltip the same string, the glyph hidden', () => {
    (globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
    (HTMLCanvasElement.prototype as unknown as { getContext: () => null }).getContext = () => null;
    const n = {
      id: 'e1', elementType: 'event', name: 'The Siege', startDate: 10, endDate: null, color: '#f00',
      dateSpec: { kind: 'exact', value: 10 }, degree: 0, contentMass: 0,
      links: [
        { id: 'c1', type: 'character', name: 'The unnamed character', unnamed: true, fieldLabel: 'Participants' },
        { id: 'o1', type: 'object', name: 'Ada', fieldLabel: 'Objects' },
      ],
    } as unknown as TimelineNode;
    const target = document.createElement('div');
    document.body.appendChild(target);
    const h = mountTimelineView(target, { onSelect: () => {}, onFocus: () => {}, onOpenElement: () => {} });
    h.setNodes([n], [n], { now: null, calendar: null, undated: [], focusId: null, chartLabel: null });
    h.setSelection(n.id);
    const chips = [...target.querySelectorAll<HTMLElement>('.atlas-timeline-chip:not(.atlas-timeline-chip-more)')];
    expect(chips.map(c => c.getAttribute('aria-label'))).toEqual([
      'Open the unnamed character (character), undated: drag onto the chart to date it',
      'Open Ada (object)',
    ]);
    expect(chips.map(c => c.title)).toEqual(chips.map(c => c.getAttribute('aria-label')));
    expect(chips.map(c => c.querySelector('.material-symbols-outlined')!.getAttribute('aria-hidden'))).toEqual(['true', 'true']);
    expect(chips[0].querySelector('.atlas-timeline-chip-name')!.textContent).toBe('The unnamed character');
    h.destroy();
  });
});

describe('a published page', () => {
  it('a nameless page is titled The unnamed page, never (untitled)', () => {
    const page = el('narrative', 'pg', { name: '', subtype: 'page', atlas_page_blocks: [] });
    expect(buildPagePayload(page, [page]).title).toBe('The unnamed page');
  });
});

describe('a work packet', () => {
  it('links a nameless element by its unnamed form', () => {
    patchSlice('active', { worldId: 'w', meta: { name: 'W' } } as never);
    const target = el('location', 'loc1', { name: '' });
    const packet = el('relation', 'r1', { x_packet_elements: [{ id: 'loc1', type: 'location' }] });
    patchSlice('data', { elements: [target, packet] } as never);
    const box = buildWorkPacket(packet)!;
    expect(box.querySelector('.atlas-work-packet-list a')!.textContent).toBe('The unnamed location');
  });
});

describe('a link that stands alone after a label takes the capital', () => {
  it("a message's From and To links; inside written by it stays lower case", () => {
    const nobody = el('character', 'c1', { name: '' });
    const ada = el('character', 'c2', { name: 'Ada' });
    const msg = el('narrative', 'm1', { name: 'Note', supertype: 'Message', narrator: 'c1', characters: ['c1', 'c2'] });
    const parties = messageParties(msg, [nobody, ada, msg])!;
    const line = document.createElement('p');
    fillMessageParties(line, parties, 'w');
    expect([...line.querySelectorAll('a')].map(a => a.textContent)).toEqual(['The unnamed character', 'The unnamed character', 'Ada']);
    // The flag is set only on the nameless one, so a named party reads as it did.
    expect(parties.to).toEqual([{ id: 'c1', name: 'the unnamed character', unnamed: true }, { id: 'c2', name: 'Ada' }]);
    fillMessageParties(line, { ...parties, sender: 'mismatch', writtenBy: parties.from }, 'w');
    expect(line.textContent).toContain(", written by the unnamed character's key");
  });

  it('the narratives listed after Mentioned, unlinked', () => {
    const subject = el('character', 's1', { name: 'Brenn' });
    const m = findUnlinkedMentions(subject, [subject, el('narrative', 'n1', { name: '', story: 'Brenn left.' })]);
    expect(m.narratives.map(n => n.name)).toEqual(['The unnamed narrative']);
    expect(nameOrUnnamed({ type: 'narrative', name: '' })).toBe('the unnamed narrative');
  });
});
