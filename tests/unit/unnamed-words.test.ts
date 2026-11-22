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
 * "(untitled" or "Untitled", fails unless its file is on the allowlist with
 * its reason. "Unnamed" with the capital counts before any punctuation
 * ("Unnamed, but kept", "Unnamed: "), since no identifier here is spelled
 * so; the lower-case word is passed before `?:=,;)}&|]`, its shape as a key
 * or a flag, so "the unnamed, " inside a string is a named limit. A world's
 * name, "Untitled world", is left as ruled: a world is not an element, and
 * keel refuses a blank world name.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { openWords, nameOrUnnamed, missingLabel, missingWords, quotedWorld } from '../../src/core/type-words';
import { freezeCircleBlock } from '../../src/core/share-payload';
import { chipWords } from '../../src/ui/map-create-modal';
import { DeleteBrowserWorldModal } from '../../src/ui/delete-browser-world-modal';
import { wireWorldTab } from '../../src/middle/settings-world';
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
import { knowledgeHash, shareHash } from '../../src/core/router';
import { mountShareRoom } from '../../src/middle/share-room';
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
const BARE = /(?<![\w.$-])(?:Unnamed(?![\w$])|unnamed(?![\w$])(?!\s*[?:=,;)}&|\]]))/;
/** "(untitled", or Untitled as a word of its own, but for a world's name. */
const UNTITLED = /\(untitled|(?<![\w.$-])[Uu]ntitled(?![\w$])(?! world)/;

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
      "toasts.info('Unnamed, but kept');",
      "const h = 'Unnamed: ' + x;",
      "const t = n.name || 'Untitled';",
      "title: p.name || 'Untitled page',",
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
      "const w = name.trim() || 'Untitled world';",
      'if (isUntitled(x)) go();',
      "// was 'Unnamed'",
      ' * (untitled)',
    ];
    expect(hitLines(clean.join('\n'))).toEqual([]);
  });
});

/**
 * The stand-ins (1.124.29): words that took a missing name's place without
 * saying the unnamed form ("this character", `this ${typeName(t)}`, "this
 * element", "(unknown)", "(home)", "its map", "a map", "an element", "it", a
 * bare type word, "Domain"), and a delete question that quotes a raw name
 * (`Delete map "${m.name}"?`, which says `Delete map ""?` for a nameless
 * one). A name goes through `nameOrUnnamed` in the room's own word; a
 * question quotes it through `quotedName`; an element that is not in the
 * world at all is said as missing through `missingWords` and `missingLabel`
 * (1.124.32; the census of the missing forms follows this one). A world's
 * name is not an element's, and "this world" and "that world" stay, as ruled.
 *
 * The allowlist holds each allowed line's own text (trimmed), never a count:
 * the line kept on purpose is a presence ternary (`x ? nameOrUnnamed(x) :
 * '(unknown)'`), and the line it replaced (`x?.name || '(unknown)'`) is a
 * different text, so putting the old line back reds even though the file
 * still holds one stand-in line. Limits, named: a fallback built some other
 * way (a variable holding the word, a helper returning it) is not seen; a
 * quoted name is seen only inside one `${…}` whose text holds `name`.
 */
const STAND_IN = new RegExp([
  // A fallback after || or ??: "this …"/"that …" (not a world or a browser), "the element", "focused", any "(…)",
  // its map, a map, an element, it, a bare word.
  /(?:\|\||\?\?)\s*['"`](?:[Tt]his (?!world\b|browser\b)|[Tt]hat (?!world\b)|[Tt]he element\b|focused['"`]|\(|its map\b|an? (?:map|element)['"`]|it['"`]|(?:element|zone|narrative|page|entry|Domain|Charter|Guide)['"`])/.source,
  // A ternary's other side: a "(…)" word for a name, or "this element" itself.
  /[?:]\s*['"`]\((?:unknown|home|this |missing|pin without)|:\s*['"`]this (?:element|narrative|one)['"`]/.source,
  // The type's word standing in for a name.
  /[Tt]his \$\{typeName\(/.source,
  // A delete, remove or revoke that quotes a raw name, trimmed or not.
  /(?:Delete|Remove|Revoke)d? [^"`]*"\$\{[^}]*\bname\b[^}]*\}"/.source,
].join('|'));

/** The stand-in lines left on purpose, by file: each line's own text, trimmed, and why. */
const STAND_IN_LEFT: Record<string, Array<{ line: string; why: string }>> = {
  'src/core/world-styles.ts': [{ line: "const base = k.supertype && k.subtype ? `${k.supertype} · ${k.subtype}` : (k.supertype || k.subtype || '(no kind)');", why: 'a zone kind with neither supertype nor subtype, not a name' }],
  'src/middle/element-detail-map-image.ts': [{ line: "render(item ? item.filename : '(missing file)');", why: 'a picture file that is gone: a file, not an element' }],
  'src/middle/import-room.ts': [
    { line: "else if (f.widget === 'single-link') fields.push(`${f.name}>${cap(f.target ?? 'element')}`);", why: 'a link field\'s target type in a schema line, not a name' },
    { line: "else if (f.widget === 'multi-link') fields.push(`${f.name}>>${cap(f.target ?? 'element')}`);", why: 'the same, for a list field' },
  ],
  'src/middle/knowledge-room.ts': [{ line: "for (const id of ids) chips.appendChild(elementChip(id, viewOnly ? undefined : () => ctx.removeAbout(id), false, ctx.aboutType?.(id) ?? 'element'));", why: 'a type word handed to the missing builder, not a name' }],
  'src/middle/settings-world.ts': [{ line: '`Remove "${world.name}" from atlas?\\n\\n` +', why: 'a world\'s name in its Remove question' }],
  'src/middle/writing-workspace-add-to-cast.ts': [{ line: "const label = (detail.name || '').trim() || '(unnamed)';", why: 'the label Add to story writes into the story text (stored; see unnamed-names)' }],
  'src/middle/writing-workspace-mention-items.ts': [{ line: "name: el.name || '(unnamed)',", why: 'the label a mention pick writes into the story text (stored; see unnamed-names)' }],
  'src/sidebar/worlds-sidebar.ts': [
    { line: 'if (!window.confirm(`Remove "${entry.name}" from your list? The browser has already cleared its storage.`)) return;', why: 'a world\'s name' },
    { line: 'if (!window.confirm(`Remove "${name}" from your list? It was never downloaded.`)) return;', why: 'a world\'s name' },
  ],
  'src/tabs/right/map-tab-pins.ts': [{ line: "const name = el?.name ?? '(loading…)';", why: 'a pin drawn before its element is read' }],
  'src/ui/guide-note.ts': [{ line: "return nameOf(id, elementOf(id)?.type ?? 'element');", why: 'a type word handed to the name builder, not a name' }],
  'src/visualization/timeline/timeline-view.ts': [{ line: "head.textContent = state.chartLabel ?? 'This chart';", why: 'the chart on screen before it is saved, not an element' }],
};

/** The lines that say a stand-in and are not comment lines, by number. */
function standInLines(code: string): number[] {
  return code.split(/\r?\n/)
    .map((line, i) => (!isCommentLine(line) && STAND_IN.test(line) ? i + 1 : 0))
    .filter(n => n > 0);
}

/**
 * The census over given files (path relative to the tree, text). Each allowed
 * row allows ONE copy of its line in its file (a multiset: a line allowed twice
 * is listed twice), so a second copy of an allowed line reds as unexpected,
 * and a row with no copy left reds as stale. `hits` finds the lines, `left`
 * is the allowlist: the stand-ins' or the missing forms'.
 */
function censusOf(
  files: Array<[string, string]>,
  hits: (code: string) => number[] = standInLines,
  left: Record<string, Array<{ line: string; why: string }>> = STAND_IN_LEFT,
): { unexpected: string[]; stale: string[] } {
  const seen = new Map<string, number>();
  const unexpected: string[] = [];
  for (const [rel, code] of files) {
    const lines = code.split(/\r?\n/);
    for (const n of hits(code)) {
      const text = lines[n - 1].trim();
      const key = `${rel}|${text}`;
      const allowed = (left[rel] ?? []).filter(a => a.line === text).length;
      const now = (seen.get(key) ?? 0) + 1;
      seen.set(key, now);
      if (now > allowed) unexpected.push(`${rel}:${n} ${text}`);
    }
  }
  const stale = Object.entries(left).flatMap(([f, rows]) => {
    const want = new Map<string, number>();
    for (const r of rows) want.set(r.line, (want.get(r.line) ?? 0) + 1);
    return [...want].filter(([line, n]) => (seen.get(`${f}|${line}`) ?? 0) < n).map(([line]) => `${f} ${line}`);
  });
  return { unexpected, stale };
}

/** The stand-ins' census over given files. */
function standInCensusOf(files: Array<[string, string]>): { unexpected: string[]; stale: string[] } {
  return censusOf(files);
}

/** Every `.ts` file in `src` but the release history, as (path, text). */
function srcFiles(): Array<[string, string]> {
  const files: Array<[string, string]> = [];
  for (const file of walk(SRC)) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (!SKIP.has(rel)) files.push([rel, readFileSync(file, 'utf8')]);
  }
  return files;
}

function standInCensus(): { unexpected: string[]; stale: string[] } {
  return standInCensusOf(srcFiles());
}

describe('the census of stand-ins: no word takes a missing name\'s place', () => {
  it('every stand-in left in the source is on the allowlist as written, with its reason', () => {
    const { unexpected, stale } = standInCensus();
    expect(unexpected, 'Say a missing name with nameOrUnnamed (a question with quotedName), or add the line with why').toEqual([]);
    // An allowed line that changed or went takes its row with it.
    expect(stale).toEqual([]);
  });

  it('the instrument sees each form this release took out', () => {
    const planted = [
      "return n || (el ? `this ${typeName(el.type)}` : '');",
      "return name || `this ${typeName(type)}`;",
      "return n || (el ? `this ${typeName(el.type)}` : 'this element');",
      "return name ? `\"${name}\"` : 'this element';",
      "const subject = name.trim() ? `\"${name.trim()}\"` : 'this narrative';",
      "const named = typeof el.name === 'string' && el.name.trim() ? el.name.trim() : 'this one';",
      "title.textContent = named ? `${named} and what it touches` : `This ${typeName(centre.type)} and what it touches`;",
      "const centerName = nodes.find(c => c.isCenter)?.el?.name || 'this element';",
      "|| (n.isCenter && n.id === homeId ? subject.name || '(home)' : '(unknown)');",
      "homeChip.title = `Back to ${subject.name || '(home)'}`;",
      "title: `Pinned on ${mapEl.name || '(this map)'}`,",
      "const mapName = m?.name || '(unknown map)';",
      "this.locationPreview = { id: found.location, name: loc?.name ?? '(unknown)' };",
      "toastManager.success(`Deleted ${el.name || 'element'}`);",
      "toasts.success(`Deleted ${zone.name || 'zone'}`);",
      "toasts.success(`Deleted ${el.name || 'narrative'}`);",
      "if (!confirm(`Delete map \"${m.name}\"?${cascadeNote} This cannot be undone.`)) return;",
      "? `Delete zone \"${zone.name}\"? This also removes its markers. This cannot be undone.`",
      "toasts.success(`Deleted map \"${m.name}\"`);",
      "+ `<span>Open ${escapeText(m.name || 'its map')}</span></button>`).join('');",
      "return { id: m.id, name: m.name?.trim() || 'a map', pinned: !!held };",
      "deleteRefusedLine(refused.map(r => r.name?.trim() || 'an element'))",
      "const name = el.name || 'it';",
      "`<li>${link(d.id, d.name.trim() || 'Domain', 'atlas-home-charter-link')}`",
      "const nameOf = (el: Element, fallback: string): string => (el.name || fallback); nameOf(x, 'Charter') || 'Charter'",
      "addMapBtn.title = `Create a new map of ${el.name || 'this location'}`;",
      "return el?.name || 'element';",
      "toasts.show(`Removed \"${chart.name}\"`, 'info');",
      // One phrase over (1.124.29's gate): the element, focused, that <type>, a trimmed quoted name, a revoke.
      "toasts.success(`${file.name} added to ${el.name || 'the element'}.`);",
      "`<span>${escapeText(target?.name || 'focused')}</span>` +",
      "return `${from}: only what ${s.name ?? `that ${characterWord(meta)}`} knows of the world.`;",
      "if (!window.confirm(`Delete \"${el.name.trim()}\"?`)) return;",
      "if (!window.confirm(`Revoke \"${page.name}\"? Its address will show no longer shared.`)) return;",
    ];
    expect(standInLines(planted.join('\n'))).toEqual(planted.map((_, i) => i + 1));
  });

  it('putting an old line back in a file that keeps an allowed line reds: the allowlist is the line, not a count', () => {
    const old: Array<[string, string]> = [
      ['src/tabs/right/right-pane.ts', "const label = m?.name || tab.label || '(missing map)';"],
      ['src/middle/share-room.ts', "name.textContent = target?.name || '(pin without element)';"],
      ['src/middle/share-room.ts', "chip.append(el?.name || '(missing)');"],
      ['src/ui/map-create-modal.ts', "this.locationPreview = { id: found.location, name: loc?.name ?? '(unknown)' };"],
      ['src/tabs/right/context-pane-graph.ts', "const label = el?.name || '(unknown)';"],
      ['src/middle/element-detail-header.ts', "const mapName = m?.name || '(unknown map)';"],
      ['src/middle/knowledge-room.ts', "const name = el?.name || '(unknown)';"],
    ];
    for (const [file, line] of old) {
      expect(standInLines(line), line).toEqual([1]);
      expect((STAND_IN_LEFT[file] ?? []).some(a => a.line === line), line).toBe(false);
    }
  });

  it('each allowed line allows one copy: a second copy in the same file reds, a missing copy is stale', () => {
    const file = 'src/sidebar/worlds-sidebar.ts';
    const allowed = STAND_IN_LEFT[file].map(a => a.line);
    // The file as allowed: clean.
    expect(standInCensusOf([[file, allowed.join('\n')]])).toEqual({ unexpected: [], stale: expect.any(Array) });
    expect(standInCensusOf([[file, allowed.join('\n')]]).stale.filter(s => s.startsWith(file))).toEqual([]);
    // A second copy of one allowed line: unexpected, by its line number.
    const twice = [...allowed, allowed[0]];
    expect(standInCensusOf([[file, twice.join('\n')]]).unexpected).toEqual([`${file}:${twice.length} ${allowed[0]}`]);
    // One copy gone: that row is stale.
    expect(standInCensusOf([[file, allowed.slice(1).join('\n')]]).stale.filter(s => s.startsWith(file))).toEqual([`${file} ${allowed[0]}`]);
  });

  it('the instrument passes the builders, a world\'s own words and comments', () => {
    const clean = [
      'const n = nameOrUnnamed(el, { start: true });',
      'const q = quotedName(m, { typed: true });',
      "const w = getState().active?.meta.name || 'This world';",
      "askForCopy(id, world.meta.name?.trim() || 'this world', toasts);",
      "toasts.info(`… the image URLs that showed it in ${entry.name || 'that world'}.`);",
      "const them = n === 1 ? 'it' : 'them';",
      "toasts.success(`Deleted ${nameOrUnnamed(zone)}`);",
      'const scope = `this ${tierLabel.toLowerCase()}`;',
      "// was `this ${typeName(t)}`",
      " * (unknown)",
    ];
    expect(standInLines(clean.join('\n'))).toEqual([]);
  });
});

/**
 * A missing element said one way (1.124.32): an element that is not in the world at all is "a missing
 * location" inside a sentence (`missingWords`) and "(missing location)" on a chip, a row or a label
 * (`missingLabel`), in the type its field or pin names, else "element". The five forms it replaced
 * ("(unknown)", "(unknown map)", "(missing)", "(pin without element)", "(missing knower)", and the map
 * tab's "(missing map)" literal) are gone. The census finds "(unknown…" or "(missing…" anywhere on a line
 * that is not a comment line (at a string's start or inside it: "Back to (unknown)"), a bare "Unknown" in
 * quotes, and "without element" or "missing knower".
 * Limits, named: a form built from parts (a variable holding "(unknown") is not seen; quotes pair left to
 * right, so a regex literal holding a quote (`/'/.test(s) ? '(unknown)' : ''`) hides the strings after it on
 * its line; a continuation line of a multi-line template, with no quote of its own, is not read.
 */
const MISSING_FORM = /\([Uu]nknown\b|\([Mm]issing\b|^\s*Unknown\s*$|without element|missing knower/;
/** A line's string literals, in each quote form (a template's `${…}` parts ride along; a code word like `(missing.length` is no string). */
const STRINGS = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;

/** The missing forms left on purpose, by file: each line's own text, trimmed, and why. */
const MISSING_LEFT: Record<string, Array<{ line: string; why: string }>> = {
  'src/core/type-words.ts': [{ line: 'return `(missing ${opts.word?.trim() || typeName(type)})`;', why: 'the builder itself' }],
  'src/middle/element-detail-map-image.ts': [{ line: "render(item ? item.filename : '(missing file)');", why: 'a picture file that is gone: a file, not an element' }],
};

function missingLines(code: string): number[] {
  return code.split(/\r?\n/)
    .map((line, i) => (!isCommentLine(line) && (line.match(STRINGS) ?? []).some(lit => MISSING_FORM.test(lit.slice(1, -1))) ? i + 1 : 0))
    .filter(n => n > 0);
}

describe('a missing element is said one way', () => {
  it('the builders: a missing location in a sentence, (missing location) as a label, element where nothing names a type', () => {
    expect(missingWords('location')).toBe('a missing location');
    expect(missingLabel('location')).toBe('(missing location)');
    expect(missingLabel('map')).toBe('(missing map)');
    expect(missingLabel('element')).toBe('(missing element)');
    expect(missingLabel('narrative', { word: 'page' })).toBe('(missing page)');
    expect(missingLabel('character')).not.toContain('unnamed');
  });

  it('the census: no other form for a missing element is left in the source', () => {
    const { unexpected, stale } = censusOf(srcFiles(), missingLines, MISSING_LEFT);
    expect(unexpected, 'Say a missing element with missingWords in a sentence or missingLabel on a label, or add the line with why').toEqual([]);
    expect(stale).toEqual([]);
  });

  it('the instrument sees every form this release folded, in every quote form', () => {
    const planted = [
      "const name = el ? nameOrUnnamed(el, { start: true }) : '(unknown)';",
      "const rawName = said ? nameOrUnnamed(said, { start: true }) : '(unknown)';",
      "const mapName = m ? nameOrUnnamed(m) : '(unknown map)';",
      "name.textContent = target ? nameOrUnnamed(target, { start: true }) : '(pin without element)';",
      "chip.append(el ? nameOrUnnamed(el, { start: true }) : '(missing)');",
      "return { id: block.id, kind: 'circle', knowerId: block.knowerId, title: '(missing knower)', knowerType: 'collective', entries: [] };",
      "const label = m ? nameOrUnnamed(m, { start: true }) : (tab.label || '(missing map)');",
      'const label = el ? nameOrUnnamed(el) : "(Unknown)";',
      'const label = el ? nameOrUnnamed(el) : `(unknown ${t})`;',
      "const x = 'a pin without element here';",
      // Inside a string, not only at its start, and the bare word.
      "crumb.title = 'Back to (unknown)';",
      'label.textContent = `${x} (missing map)`;',
      "const name = el ? el.name : 'Unknown';",
    ];
    expect(missingLines(planted.join('\n'))).toEqual(planted.map((_, i) => i + 1));
    const clean = [
      "const name = el ? nameOrUnnamed(el, { start: true }) : missingLabel('element');",
      "const back = el ? nameOrUnnamed(el) : missingWords('element');",
      "// was '(unknown)'",
      " * (missing knower)",
      "showError('Check for a missing comma, quote, or bracket.');",
      'if (missing.length === 0) continue;',
      "if (code === 'unknown') return;",
      'if (missing) {',
    ];
    expect(missingLines(clean.join('\n'))).toEqual([]);
  });

  it("the knowledge room's chips: a holder or subject not in the world is missing in its field's type", () => {
    const W2 = 'w-miss';
    patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: W2, name: 'Miss', state: 'local-only' }] } as never);
    patchSlice('active', { worldId: W2, meta: { name: 'Miss' } } as never);
    patchSlice('data', { elements: [el('narrative', 'k1', { name: 'Debt', subtype: 'knowledge', narrator: 'gone-c', collectives: ['gone-g'], locations: ['gone-l'], story: 'Owed.' })] } as never);
    window.location.hash = knowledgeHash(W2, 'k1');
    const target = document.createElement('div');
    document.body.appendChild(target);
    const toasts = { info() {}, error() {}, success() {}, warning() {} } as unknown as ToastManager;
    const unmount = mountKnowledgeRoom(target, toasts);
    try {
      const chips = [...target.querySelectorAll<HTMLElement>('.atlas-knowledge-chip-body span:not(.material-symbols-outlined)')].map(c => c.textContent!.trim());
      expect(chips).toEqual(['(missing character)', '(missing collective)', '(missing location)']);
      expect(target.textContent).not.toContain('(unknown)');
    } finally {
      unmount();
      window.location.hash = '';
    }
  });

  it("a page's collection chip and a map block's pin row: missing, in the pin's type", async () => {
    const W2 = 'w-miss2';
    const MAPX = '00000000-0000-4000-8000-0000000000b1';
    patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: W2, name: 'Miss', state: 'local-only' }] } as never);
    patchSlice('active', { worldId: W2, meta: { name: 'Miss' } } as never);
    patchSlice('data', { elements: [
      el('narrative', 'p1', { name: 'Arrival', subtype: 'page', atlas_page_blocks: [
        { id: 'b1', kind: 'collection', elementIds: ['gone'] },
        { id: 'b2', kind: 'map', mapId: MAPX, pinIds: [], fullPinIds: [] },
      ] }),
      el('map', MAPX, { name: 'Harbour', image_url: 'https://example.com/m.png', width: 100, height: 100 }),
      el('pin', 'pn1', { name: '', map_id: MAPX, element_id: 'gone-c', element_type: 'character', x: 1, y: 2 }),
      el('pin', 'pn2', { name: '', map_id: MAPX, element_id: 'gone-x', x: 3, y: 4 }),
    ] } as never);
    window.location.hash = shareHash(W2, 'p1');
    setActiveStore({ listElements: async () => [], readCharts: async () => [], findDependents: async () => [] } as never);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const toasts = { info() {}, error() {}, success() {}, warning() {} } as unknown as ToastManager;
    const unmount = mountShareRoom(target, toasts);
    try {
      const open = async (kind: string): Promise<HTMLElement> => {
        target.querySelector<HTMLElement>(`.atlas-share-block[data-block-kind="${kind}"] .is-editable`)!.click();
        await vi.waitFor(() => expect(target.querySelector(`.atlas-share-block[data-block-kind="${kind}"].is-editing`)).not.toBeNull());
        return target.querySelector<HTMLElement>(`.atlas-share-block[data-block-kind="${kind}"]`)!;
      };
      const coll = await open('collection');
      expect(coll.querySelector('.atlas-share-collection-member')!.firstChild!.textContent).toBe('(missing element)');
      const map = await open('map');
      const rows = [...map.querySelectorAll<HTMLElement>('.atlas-share-card-edit-fieldrow span')].map(s => s.textContent);
      expect(rows).toEqual(expect.arrayContaining(['(missing character)', '(missing element)']));
      expect(map.textContent).not.toContain('without element');
    } finally {
      unmount();
      setActiveStore(null);
      window.location.hash = '';
    }
  });

  it("a circle block whose knower is not in the world freezes to (missing element), as the page prints it", () => {
    const frozen = freezeCircleBlock({ id: 'b1', kind: 'circle', knowerId: 'gone' }, [], new Map());
    expect(frozen.title).toBe('(missing element)');
    expect(frozen.entries).toEqual([]);
  });

  it("the map dialog's place and parent map: (missing location) and (missing map), removed as a missing one", () => {
    expect(chipWords({ name: '', missing: true }, 'location')).toEqual({ label: '(missing location)', inLine: 'a missing location' });
    expect(chipWords({ name: '', missing: true }, 'map')).toEqual({ label: '(missing map)', inLine: 'a missing map' });
    // One that is there: its name, or its unnamed form.
    expect(chipWords({ name: ' Reef ' }, 'location')).toEqual({ label: 'Reef', inLine: 'Reef' });
    expect(chipWords({ name: '' }, 'map')).toEqual({ label: 'The unnamed map', inLine: 'the unnamed map' });
  });
});

describe('a delete names its type: a published page and a world', () => {
  const W2 = 'w-pub';
  const page = (name: string) => el('narrative', 'p1', { name, subtype: 'page', atlas_page_blocks: [], atlas_page_pub: { id: 'pub1', slug: 'arrival-page' } });

  for (const linked of [false, true]) {
    for (const c of [
      { name: ' Arrival ', ask: 'Delete page "Arrival"?' },
      { name: '  ', ask: 'Delete the unnamed page?' },
    ]) {
      it(`a published page${linked ? ' with a key to take it down' : ' with no key'}: ${c.ask}`, async () => {
        const entry = linked
          ? { id: W2, name: 'Pub', state: 'api-linked', api: { world_id: 'srv', api_key: 'ow_w_test', pin: '1234' } }
          : { id: W2, name: 'Pub', state: 'local-only' };
        patchSlice('registry', { ...defaultRegistry(), pin: '1234', worlds: [entry] } as never);
        patchSlice('active', { worldId: W2, meta: { name: 'Pub' } } as never);
        patchSlice('data', { elements: [page(c.name)] } as never);
        window.location.hash = shareHash(W2, 'p1');
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        setActiveStore({ deleteElement: vi.fn(async () => {}), findDependents: async () => [], listElements: async () => [], readCharts: async () => [] } as never);
        const target = document.createElement('div');
        document.body.appendChild(target);
        const toasts = { info() {}, error() {}, success() {}, warning() {} } as unknown as ToastManager;
        const unmount = mountShareRoom(target, toasts);
        try {
          target.querySelector<HTMLButtonElement>('.atlas-share-delete')!.click();
          await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
          const asked = confirm.mock.calls[0][0] as string;
          // The question leads, as every delete's does; what being published adds follows it.
          expect(asked.startsWith(`${c.ask} It is published at `)).toBe(true);
          expect(asked).toContain(linked ? 'Deleting it also takes the published page down.' : 'Atlas has no key or World PIN for this world');
          expect(asked).not.toMatch(/Continue\?|Delete anyway\?/);
        } finally {
          unmount();
          confirm.mockRestore();
          setActiveStore(null);
          window.location.hash = '';
        }
      });
    }
  }

  it('a world as its questions name it: world and its name in quotes, or this world', () => {
    expect(quotedWorld(' Harbour ')).toBe('world "Harbour"');
    expect(quotedWorld('')).toBe('this world');
    expect(quotedWorld('   ')).toBe('this world');
    expect(quotedWorld(42)).toBe('this world');
  });

  for (const c of [{ name: 'Harbour', ask: 'Delete world "Harbour"?' }, { name: ' ', ask: 'Delete this world?' }]) {
    it(`a browser world's delete dialog asks ${c.ask}`, () => {
      const toasts = { info() {}, error() {}, success() {}, warning() {} } as unknown as ToastManager;
      new DeleteBrowserWorldModal({ id: 'wb', name: c.name, state: 'local-only' } as never, toasts).open();
      expect(document.querySelector('[data-modal="delete-browser-world"] .atlas-modal-title')!.textContent).toBe(c.ask);
    });

    it(`a folder world's delete with its folder asks ${c.ask.replace('Delete', 'Permanently delete')}`, () => {
      const world = { id: 'wf', name: c.name, state: 'local-only' } as never;
      document.body.innerHTML = '<div class="atlas-settings"><button data-action="delete-world-permanent"></button></div>';
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      try {
        wireWorldTab(world, { info() {}, error() {}, success() {}, warning() {} } as unknown as ToastManager);
        document.querySelector<HTMLButtonElement>('[data-action="delete-world-permanent"]')!.click();
        expect((confirm.mock.calls[0][0] as string).split('\n')[0]).toBe(`${c.ask.replace('Delete', 'Permanently delete').replace(/\?$/, '')} and its folder on disk?`);
      } finally {
        confirm.mockRestore();
      }
    });
  }
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

  it('emptied over a name, it writes nothing and shows that name again at once', () => {
    const commits: string[] = [];
    const t = makeEditableTitle({ initial: 'Ada', placeholder: 'The unnamed entry', onCommit: n => commits.push(n) });
    t.edit();
    const input = t.el.querySelector('input')!;
    input.value = '   ';
    input.dispatchEvent(new Event('blur'));
    expect(t.el.textContent).toBe('Ada');
    expect(commits).toEqual([]);
    // A later rename still writes.
    t.edit();
    const again = t.el.querySelector('input')!;
    again.value = 'Ada of the Vale';
    again.dispatchEvent(new Event('blur'));
    expect(commits).toEqual(['Ada of the Vale']);
  });

  it('a draft may empty its name again (allowEmpty)', () => {
    const commits: string[] = [];
    const t = makeEditableTitle({ initial: 'Half', placeholder: 'What is known…', allowEmpty: true, onCommit: n => commits.push(n) });
    t.edit();
    const input = t.el.querySelector('input')!;
    input.value = '';
    input.dispatchEvent(new Event('blur'));
    expect(commits).toEqual(['']);
    expect(t.el.textContent).toBe('What is known…');
  });
});

describe('the knowledge room says a nameless element and a deleted entry as its rows do', () => {
  const W = 'w-know2';
  const opened = (elements: Element[]): void => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: W, name: 'Know', state: 'local-only' }] } as never);
    patchSlice('active', { worldId: W, meta: { name: 'Know' } } as never);
    patchSlice('data', { elements } as never);
  };

  it("a holder chip for a nameless character reads its unnamed form, its tooltip what it opens", () => {
    opened([el('character', 'c1', { name: ' ' }), el('narrative', 'k1', { name: 'Debt', subtype: 'knowledge', narrator: 'c1', story: 'Owed.' })]);
    window.location.hash = knowledgeHash(W, 'k1');
    const target = document.createElement('div');
    document.body.appendChild(target);
    const toasts = { info() {}, error() {}, success() {}, warning() {} } as unknown as ToastManager;
    const unmount = mountKnowledgeRoom(target, toasts);
    try {
      const chip = target.querySelector<HTMLButtonElement>('.atlas-knowledge-chip-body')!;
      expect(chip.textContent).toContain('The unnamed character');
      expect(chip.textContent).not.toContain('(unknown)');
      expect(chip.title).toBe('Open the unnamed character');
      expect(chip.querySelector('.material-symbols-outlined')!.getAttribute('aria-hidden')).toBe('true');
    } finally {
      unmount();
      window.location.hash = '';
    }
  });

  // The toast says a name as the app's other delete notes do, with no quotes; the confirm keeps its quotes, after the room's word.
  for (const c of [
    { name: '', toast: 'Deleted the unnamed entry', ask: /^Delete the unnamed entry\?/ },
    { name: ' Debt ', toast: 'Deleted Debt', ask: /^Delete entry "Debt"\?/ },
  ]) {
    it(`the entry's delete toast: ${c.toast}`, async () => {
      opened([el('narrative', 'k1', { name: c.name, subtype: 'knowledge', story: 'Owed.' })]);
      window.location.hash = knowledgeHash(W, 'k1');
      const said: string[] = [];
      const toasts = { info() {}, error() {}, success: (m: string) => said.push(m), warning() {} } as unknown as ToastManager;
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      setActiveStore({ deleteElement: vi.fn(async () => {}), findDependents: async () => [], listElements: async () => [] } as never);
      const target = document.createElement('div');
      document.body.appendChild(target);
      const unmount = mountKnowledgeRoom(target, toasts);
      try {
        target.querySelector<HTMLButtonElement>('.atlas-knowledge-delete')!.click();
        await vi.waitFor(() => expect(said).toEqual([c.toast]));
        expect(confirm.mock.calls[0][0]).toMatch(c.ask);
      } finally {
        unmount();
        confirm.mockRestore();
        setActiveStore(null);
        window.location.hash = '';
      }
    });
  }

  for (const c of [
    { name: '  ', toast: 'Deleted the unnamed page', ask: /^Delete the unnamed page\?/ },
    { name: 'Arrival', toast: 'Deleted Arrival', ask: /^Delete page "Arrival"\?/ },
  ]) {
    it(`the page's delete toast: ${c.toast}`, async () => {
      opened([el('narrative', 'p1', { name: c.name, subtype: 'page', atlas_page_blocks: [] })]);
      window.location.hash = shareHash(W, 'p1');
      const said: string[] = [];
      const toasts = { info() {}, error() {}, success: (m: string) => said.push(m), warning() {} } as unknown as ToastManager;
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      setActiveStore({ deleteElement: vi.fn(async () => {}), findDependents: async () => [], listElements: async () => [], readCharts: async () => [] } as never);
      const target = document.createElement('div');
      document.body.appendChild(target);
      const unmount = mountShareRoom(target, toasts);
      try {
        target.querySelector<HTMLButtonElement>('.atlas-share-delete')!.click();
        await vi.waitFor(() => expect(said).toEqual([c.toast]));
        expect(confirm.mock.calls[0][0]).toMatch(c.ask);
      } finally {
        unmount();
        confirm.mockRestore();
        setActiveStore(null);
        window.location.hash = '';
      }
    });
  }

  /** The room on a draft restored from its stash, as a person left it. */
  function draftRoom(stash: Record<string, unknown>, elements: Element[] = []) {
    opened(elements);
    localStorage.setItem(`atlas_knowledge_draft_${W}`, JSON.stringify({ name: '', story: '', narrator: null, collectives: [], aboutIds: [], ...stash }));
    window.location.hash = knowledgeHash(W, 'new');
    const target = document.createElement('div');
    document.body.appendChild(target);
    const toasts = { info() {}, error() {}, success() {}, warning() {} } as unknown as ToastManager;
    const unmount = mountKnowledgeRoom(target, toasts);
    return {
      target,
      done: () => { unmount(); localStorage.removeItem(`atlas_knowledge_draft_${W}`); window.location.hash = ''; },
    };
  }

  it("a chip derived from the text says the element's name trimmed, or its unnamed form", () => {
    // An address in prose names an element by its uuid.
    const ADA = '0192a000-0000-7000-8000-00000000c002';
    const NOBODY = '0192a000-0000-7000-8000-00000000c003';
    const story = `[Ada](ow://character/${ADA}) met [someone](ow://character/${NOBODY}).`;
    const room = draftRoom({ name: 'Met', story }, [el('character', ADA, { name: ' Ada ' }), el('character', NOBODY, { name: '' })]);
    try {
      const titles = [...room.target.querySelectorAll<HTMLElement>('.atlas-knowledge-chip.is-derived .atlas-knowledge-chip-body')].map(b => b.title).sort();
      expect(titles).toEqual(['Ada · mentioned in the text', 'The unnamed character · mentioned in the text']);
    } finally {
      room.done();
    }
  });

  it("a draft's name may be emptied again: the heading shows the prompt, and Create asks for a name", async () => {
    const createElement = vi.fn();
    setActiveStore({ createElement, listElements: async () => [] } as never);
    const room = draftRoom({ name: 'Half' });
    try {
      const title = room.target.querySelector<HTMLElement>('.atlas-knowledge-entry-header .atlas-element-name')!;
      expect(title.textContent).toBe('Half');
      title.click();
      const input = title.querySelector('input')!;
      input.value = '';
      input.dispatchEvent(new Event('blur'));
      expect(title.textContent).toBe('What is known…');
      room.target.querySelector<HTMLButtonElement>('.atlas-knowledge-draft-actions .atlas-btn-primary')!.click();
      await Promise.resolve();
      expect(room.target.querySelector('[data-role="draft-note"]')!.textContent).toBe('Type a name first');
      expect(createElement).not.toHaveBeenCalled();
    } finally {
      room.done();
      setActiveStore(null);
    }
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
  (globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
  (HTMLCanvasElement.prototype as unknown as { getContext: () => null }).getContext = () => null;
  const node = (id: string, name: string, startDate: number, links: unknown[] = []) => ({
    id, elementType: 'event', name, startDate, endDate: null, color: '#f00',
    dateSpec: { kind: 'exact', value: startDate }, degree: 0, contentMass: 0, links,
  }) as unknown as TimelineNode;
  const fall = node('e2', 'The Fall', 20);
  const siege = node('e1', 'The Siege', 10, [
    { id: 'c1', type: 'character', name: 'The unnamed character', unnamed: true, fieldLabel: 'Participants' },
    { id: 'o1', type: 'object', name: 'Ada', fieldLabel: 'Objects' },
    { id: 'e2', type: 'event', name: 'The Fall', fieldLabel: 'Events' },
  ]);
  /** The card's chips by their visible name, the chart left mounted for a press. */
  function card(onDateElement?: () => void) {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onSelect = vi.fn();
    const h = mountTimelineView(target, { onSelect, onFocus: () => {}, onOpenElement: () => {}, onDateElement });
    h.setNodes([siege, fall], [siege, fall], { now: null, calendar: null, undated: [], focusId: null, chartLabel: null });
    h.setSelection(siege.id);
    const chips = new Map([...target.querySelectorAll<HTMLElement>('.atlas-timeline-chip:not(.atlas-timeline-chip-more)')]
      .map(c => [c.querySelector('.atlas-timeline-chip-name')!.textContent!, c] as const));
    return { chips, onSelect, h };
  }

  it('are named for what a press does, the glyph hidden; only an undated one\'s tooltip adds the drag', () => {
    const { chips, h } = card(() => {});
    const names = Object.fromEntries([...chips].map(([k, c]) => [k, c.getAttribute('aria-label')]));
    expect(names).toEqual({
      // Its own mark on the chart: it is shown.
      'The Fall': 'Show The Fall (event) on the chart',
      // No mark of its own: the chart narrows to what it is linked to. The unnamed form says its type once.
      // Its name says only what a press does; the drag is no part of it.
      'The unnamed character': 'Show what the unnamed character is linked to on the chart',
      'Ada': 'Show what Ada (object) is linked to on the chart',
    });
    // The tooltip: the press, then the drag where a drag dates it, two sentences each ended with its stop.
    expect(chips.get('The unnamed character')!.title).toBe('Show what the unnamed character is linked to on the chart. It is undated: drag it onto the chart to date it.');
    for (const [k, c] of chips) {
      if (k !== 'The unnamed character') expect(c.title).toBe(c.getAttribute('aria-label'));
      expect(c.querySelector('.material-symbols-outlined')!.getAttribute('aria-hidden')).toBe('true');
    }
    h.destroy();
    // A chart that dates nothing (a view-only world) offers no drag, so it names none.
    const viewOnly = card();
    expect(viewOnly.chips.get('The unnamed character')!.getAttribute('aria-label')).toBe('Show what the unnamed character is linked to on the chart');
    expect(viewOnly.chips.get('The unnamed character')!.title).toBe('Show what the unnamed character is linked to on the chart');
    viewOnly.h.destroy();
  });

  it('a chip whose name is empty or only spaces shows the unnamed form, and its name agrees', () => {
    const bare = node('e3', 'The Walk', 30, [
      { id: 'c2', type: 'character', name: '', fieldLabel: 'Participants' },
      { id: 'l2', type: 'location', name: '   ', fieldLabel: 'Locations' },
    ]);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const h = mountTimelineView(target, { onSelect: vi.fn(), onFocus: () => {}, onOpenElement: () => {} });
    h.setNodes([bare], [bare], { now: null, calendar: null, undated: [], focusId: null, chartLabel: null });
    h.setSelection(bare.id);
    const seen = [...target.querySelectorAll<HTMLElement>('.atlas-timeline-chip:not(.atlas-timeline-chip-more)')]
      .map(c => [c.querySelector('.atlas-timeline-chip-name')!.textContent, c.getAttribute('aria-label')]);
    expect(seen).toEqual([
      ['The unnamed character', 'Show what the unnamed character is linked to on the chart'],
      ['The unnamed location', 'Show what the unnamed location is linked to on the chart'],
    ]);
    h.destroy();
  });

  it('the undated chip answers Enter and Space (a keyboard click), and a mouse click does not press it twice', () => {
    const { chips, onSelect, h } = card(() => {});
    const undated = chips.get('The unnamed character')!;
    undated.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(onSelect).toHaveBeenCalledWith('c1');
    onSelect.mockClear();
    // A mouse click comes after the drag's own release, which already selected: no second press.
    undated.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(onSelect).not.toHaveBeenCalled();
    h.destroy();
  });

  /** The card as the room drives it: a press peeks the chip's element, which draws the card again. */
  function drivenCard() {
    const target = document.createElement('div');
    document.body.appendChild(target);
    let h: ReturnType<typeof mountTimelineView> | null = null;
    h = mountTimelineView(target, { onSelect: (id) => h?.setSelection(id), onFocus: () => {}, onOpenElement: () => {}, onDateElement: () => {} });
    h.setNodes([siege, fall], [siege, fall], { now: null, calendar: null, undated: [], focusId: null, chartLabel: null });
    h.setSelection(siege.id);
    const chip = (name: string) => [...target.querySelectorAll<HTMLElement>('.atlas-timeline-chip')]
      .find(c => c.querySelector('.atlas-timeline-chip-name')?.textContent === name)!;
    return { target, h, chip, cardEl: target.querySelector<HTMLElement>('.atlas-timeline-card')! };
  }

  it('Enter or Space on a chip lands focus on the card it opened, and it stays through the next draws', () => {
    const { h, chip, cardEl } = drivenCard();
    const fallChip = chip('The Fall');
    fallChip.focus();
    fallChip.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    // The card now shows The Fall, the chip that was pressed is gone with the old inside.
    expect(cardEl.querySelector('.atlas-timeline-card-title')!.textContent).toBe('The Fall');
    expect(fallChip.isConnected).toBe(false);
    expect(document.activeElement).toBe(cardEl);
    // A later draw (a data tick, the room's own second draw) keeps it: the card itself is never replaced.
    h.setNodes([siege, fall], [siege, fall], { now: null, calendar: null, undated: [], focusId: null, chartLabel: null });
    expect(document.activeElement).toBe(cardEl);
    // It takes focus from a script only, and leaves the order again as focus moves on.
    expect(cardEl.getAttribute('tabindex')).toBe('-1');
    cardEl.querySelector<HTMLElement>('.atlas-timeline-card-close')!.focus();
    expect(cardEl.hasAttribute('tabindex')).toBe(false);
    h.destroy();
  });

  it('Enter on an undated chip lands focus on the card too; a mouse click moves no focus', () => {
    const keyed = drivenCard();
    keyed.chip('The unnamed character').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(document.activeElement).toBe(keyed.cardEl);
    keyed.h.destroy();
    document.body.innerHTML = '';
    const clicked = drivenCard();
    const fallChip = clicked.chip('The Fall');
    fallChip.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(clicked.cardEl.querySelector('.atlas-timeline-card-title')!.textContent).toBe('The Fall');
    expect(document.activeElement).toBe(document.body);
    expect(clicked.cardEl.hasAttribute('tabindex')).toBe(false);
    clicked.h.destroy();
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
