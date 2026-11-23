/**
 * Parse + detect an import payload. Pure; takes already-JSON-parsed data.
 *
 * THREE recognized shapes (DESIGN_IMPORT.md "Format model"):
 *
 *   1. keel world-export ENVELOPE — `{format:"onlyworlds-world-export",
 *      schema_version, world:{id,...}, elements:{ <type>: [...] }}`. What
 *      ow.com emits today (keel `portal/views.py`; canonical, the spec
 *      § world-export). Nested lowercase `elements`, world id PRESENT.
 *   2. `World`+PascalCase-at-root — `{World:{...}, Character:[...]}`. The
 *      older shape atlas's base-tool lineage used; kept for backward compat
 *      (Titus, 2026-07-23) so files from the old exporter still import.
 *   3. loose type-keyed lists — `{Character:[...]}` (no World). AI-assistant
 *      output; targets the current world.
 *
 * Bucket keys are PascalCase in OW exports and lowercase in atlas's type union,
 * so we always lowercase before testing membership. Envelope detection runs
 * FIRST because its `world`/`elements` keys are not element types and would
 * otherwise fall through to "unrecognized".
 */

import { ALL_ELEMENT_TYPES, type ElementType } from '../core/types';
import { knownFieldsFor } from '../editor/field-schema';
import type { ParseResult, RawRecord } from './types';

/** A fenced block of a pasted reply: its inside runs from `from` to `to`; `to` is -1 for one never closed. */
interface FencedBlock { lineEnd: number; from: number; to: number }

/**
 * The fenced blocks of a text, in order: a ``` or ~~~ mark opens one, the rest of its line is the block's
 * label, and the next mark of the same kind closes it (a block never closed runs to the end, and is the
 * last). Each kind's next mark is searched for only once the reading has passed the last one found, so
 * every stretch of the text is searched once per kind: linear in the text's length.
 */
function fencedBlocks(text: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const next = { '```': -2, '~~~': -2 };
  const find = (mark: '```' | '~~~', from: number): number => {
    if (next[mark] !== -1 && next[mark] < from) next[mark] = text.indexOf(mark, from);
    return next[mark];
  };
  let at = 0;
  for (;;) {
    const tick = find('```', at);
    const tilde = find('~~~', at);
    if (tick < 0 && tilde < 0) return blocks;
    const mark = tilde < 0 || (tick >= 0 && tick < tilde) ? '```' : '~~~';
    const open = mark === '```' ? tick : tilde;
    const lineEnd = text.indexOf('\n', open + 3);
    if (lineEnd < 0) { blocks.push({ lineEnd: text.length, from: text.length, to: -1 }); return blocks; }
    const close = find(mark, lineEnd + 1);
    if (close < 0) { blocks.push({ lineEnd, from: lineEnd + 1, to: -1 }); return blocks; }
    blocks.push({ lineEnd, from: lineEnd + 1, to: close });
    at = close + 3;
  }
}

/** A closed block's inside parses as JSON. A text that starts with no JSON value is not tried. */
function parsesAsJson(text: string, b: FencedBlock): boolean {
  if (b.to < 0) return false;
  const inside = text.slice(b.from, b.to);
  if (!/^\s*[[{"\-0-9tfn]/.test(inside)) return false;
  try { JSON.parse(inside); return true; } catch { return false; }
}

/**
 * The one block of a text with more than one that parses as JSON, or null when none or several do. It
 * stops at the second one that parses.
 */
function theOneParsing(text: string, blocks: FencedBlock[]): FencedBlock | null {
  let found: FencedBlock | null = null;
  for (const b of blocks) {
    if (!parsesAsJson(text, b)) continue;
    if (found) return null;
    found = b;
  }
  return found;
}

/**
 * The JSON inside a reply pasted with its code fence. A chat's "copy message" hands over the fence
 * lines, and some models fence their JSON whatever the instruction says; the box then met "Not valid
 * JSON" with nothing naming the fence. Text that already starts as JSON is returned as it is. A ~~~ fence
 * is read as a ``` fence is. When the text holds exactly one fenced block, the block's inside is
 * returned; with more than one, the one block whose inside parses as JSON. Either way it comes with as
 * many line ends before it as the pasted text had, so a fault's line number is the pasted text's own. One
 * block never closed, or several where none or more than one parse, are no guess: the text comes back
 * whole (`holdsSeveralBlocks` tells the second). Linear in the text's length.
 */
export function jsonTextOf(text: string): string {
  const lead = text.trimStart();
  if (lead.startsWith('{') || lead.startsWith('[')) return text;
  const blocks = fencedBlocks(text);
  if (blocks.length === 0) return text;
  const block = blocks.length === 1 ? blocks[0] : theOneParsing(text, blocks);
  if (!block || block.to < 0) return text;
  let lines = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i <= block.lineEnd; i = text.indexOf('\n', i + 1)) lines++;
  return '\n'.repeat(lines) + text.slice(block.from, block.to);
}

/** The review's line for a reply of several code blocks where none or more than one is JSON. */
export const SEVERAL_BLOCKS_LINE = 'The reply holds more than one code block, and Atlas cannot tell which one is the world. Paste only the JSON.';

/** The text holds more than one fenced block (a text `jsonTextOf` gave back whole holds no one to read). */
export function holdsSeveralBlocks(text: string): boolean {
  const lead = text.trimStart();
  if (lead.startsWith('{') || lead.startsWith('[')) return false;
  return fencedBlocks(text).length > 1;
}

/**
 * What to say after "isn't valid JSON": text that still holds code block marks was a reply Atlas could
 * not read past (a block left open), and the advice about a comma would be wrong.
 */
export function jsonFaultAdvice(text: string): string {
  return text.includes('```') || text.includes('~~~')
    ? 'It holds code block marks (``` or ~~~) that Atlas could not read past. Paste only the JSON itself.'
    : 'Check for a missing comma, quote, or bracket.';
}

/**
 * The import instruction's field list marks a number `#field` and a link `field>Type`; a reply now and then
 * writes the mark into the key. A key that is a field of this type once its mark is read off becomes that
 * field, so the review and the import read it alike. Never over a bare key written beside it; a mark on a
 * name the type does not have stays as written, for the review to say.
 */
const LIST_MARK = /^#([A-Za-z_]\w*)$|^([A-Za-z_]\w*)>{1,2}[A-Za-z]+$/;
function readListMarks(type: ElementType, rec: RawRecord): RawRecord {
  let out: RawRecord | null = null;
  for (const key of Object.keys(rec)) {
    const m = LIST_MARK.exec(key);
    const bare = m ? (m[1] ?? m[2]) : undefined;
    if (!bare || bare in rec || !knownFieldsFor(type).has(bare)) continue;
    out ??= { ...rec };
    out[bare] = out[key];
    delete out[key];
  }
  return out ?? rec;
}

const TYPE_SET = new Set<string>(ALL_ELEMENT_TYPES);

function isRecord(r: unknown): r is RawRecord {
  return !!r && typeof r === 'object' && !Array.isArray(r);
}

/**
 * The keel world-export envelope, by its self-describing `format` tag (the
 * reliable signal) with a structural fallback (a `world` object beside
 * an `elements` object) so a future emitter that drops the tag still reads.
 */
function isExportEnvelope(obj: Record<string, unknown>): boolean {
  if (obj.format === 'onlyworlds-world-export') return true;
  // Structural fallback: beyond `world` + `elements` both being objects,
  // require at least one type-keyed ARRAY inside elements — a tag-less
  // non-keel JSON that merely has those two keys used to parse as a phantom
  // 0-element world.
  return isRecord(obj.world) && isRecord(obj.elements)
    && Object.values(obj.elements).some(v => Array.isArray(v));
}

/**
 * Unwrap the envelope: `elements` is an object keyed by lowercase type slug,
 * each holding an array of keel-native element records (uuid ids, bare-name v2
 * relations, extension fields intact). `world` carries the id + meta.
 */
function parseEnvelope(
  obj: Record<string, unknown>,
  byType: Map<ElementType, RawRecord[]>,
  unknownBuckets: string[],
): ParseResult {
  let total = 0;
  const elements = obj.elements;
  if (isRecord(elements)) {
    for (const [key, value] of Object.entries(elements)) {
      const lower = key.toLowerCase();
      if (TYPE_SET.has(lower) && Array.isArray(value)) {
        const records = value.filter(isRecord);
        const existing = byType.get(lower as ElementType) ?? [];
        byType.set(lower as ElementType, [...existing, ...records]);
        total += records.length;
      } else if (TYPE_SET.has(lower)) {
        // A valid type slug with a null/absent-array value means zero elements
        // (spec §8c: absent key = zero, never an error) — not an unknown type.
      } else {
        unknownBuckets.push(key);
      }
    }
  }
  const world = isRecord(obj.world) ? obj.world : undefined;
  if (!world && total === 0) {
    return {
      ok: false,
      error: 'This looks like an onlyworlds.com world export, but it carries no world block or elements.',
      byType,
      unknownBuckets,
      totalElements: 0,
    };
  }
  // Always full-world: the envelope's whole purpose is a complete world.
  return { ok: true, format: 'full-world', envelope: true, world, byType, unknownBuckets, totalElements: total };
}

export function parsePayload(data: unknown): ParseResult {
  const byType = new Map<ElementType, RawRecord[]>();
  const unknownBuckets: string[] = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      ok: false,
      error: 'Expected a JSON object with element-type keys (e.g. {"Character": [...]}).',
      byType,
      unknownBuckets,
      totalElements: 0,
    };
  }

  const obj = data as Record<string, unknown>;

  // Shape 1: the keel world-export envelope. Detected first — its `world` and
  // `elements` keys are not element types, so the root-key scan below would
  // bucket them as unknown and report the file unrecognizable.
  if (isExportEnvelope(obj)) {
    return parseEnvelope(obj, byType, unknownBuckets);
  }

  const hasWorld = !!obj.World && typeof obj.World === 'object' && !Array.isArray(obj.World);

  let total = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'World') continue;
    const lower = key.toLowerCase();
    if (TYPE_SET.has(lower) && Array.isArray(value)) {
      const records = value
        .filter((r): r is RawRecord => !!r && typeof r === 'object' && !Array.isArray(r))
        .map(r => readListMarks(lower as ElementType, r));
      const existing = byType.get(lower as ElementType) ?? [];
      byType.set(lower as ElementType, [...existing, ...records]);
      total += records.length;
    } else {
      unknownBuckets.push(key);
    }
  }

  if (hasWorld) {
    return {
      ok: true,
      format: 'full-world',
      world: obj.World as RawRecord,
      byType,
      unknownBuckets,
      totalElements: total,
    };
  }
  if (total > 0) {
    return { ok: true, format: 'loose', byType, unknownBuckets, totalElements: total };
  }
  return {
    ok: false,
    error:
      'No recognizable OnlyWorlds elements found. Expected a "World" block or element-type arrays like "Character": [...].',
    byType,
    unknownBuckets,
    totalElements: 0,
  };
}
