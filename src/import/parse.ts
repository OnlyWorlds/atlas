/**
 * Parse + detect an import payload. Pure; takes already-JSON-parsed data.
 *
 * THREE recognized shapes (DESIGN_IMPORT.md "Format model"):
 *
 *   1. keel world-export ENVELOPE — `{format:"onlyworlds-world-export",
 *      schema_version, world:{id,...}, elements:{ <type>: [...] }}`. What
 *      ow.com emits today (keel `portal/views.py`; canonical, Orrery spec
 *      § world-export). Nested lowercase `elements`, world id PRESENT.
 *   2. `World`+PascalCase-at-root — `{World:{...}, Character:[...]}`. The
 *      older shape atlas's base-tool lineage used; kept for backward compat
 *      (Captain, 2026-07-23) so files from the old exporter still import.
 *   3. loose type-keyed lists — `{Character:[...]}` (no World). AI-assistant
 *      output; targets the current world.
 *
 * Bucket keys are PascalCase in OW exports and lowercase in atlas's type union,
 * so we always lowercase before testing membership. Envelope detection runs
 * FIRST because its `world`/`elements` keys are not element types and would
 * otherwise fall through to "unrecognized".
 */

import { ALL_ELEMENT_TYPES, type ElementType } from '../core/types';
import type { ParseResult, RawRecord } from './types';

const TYPE_SET = new Set<string>(ALL_ELEMENT_TYPES);

function isRecord(r: unknown): r is RawRecord {
  return !!r && typeof r === 'object' && !Array.isArray(r);
}

/**
 * The keel world-export envelope, by its self-describing `format` tag (the
 * reliable signal — Skeld) with a structural fallback (a `world` object beside
 * an `elements` object) so a future emitter that drops the tag still reads.
 */
function isExportEnvelope(obj: Record<string, unknown>): boolean {
  if (obj.format === 'onlyworlds-world-export') return true;
  // Structural fallback: beyond `world` + `elements` both being objects,
  // require at least one type-keyed ARRAY inside elements — a tag-less
  // non-keel JSON that merely has those two keys used to parse as a phantom
  // 0-element world (S315 gate LOW).
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
      const records = value.filter(
        (r): r is RawRecord => !!r && typeof r === 'object' && !Array.isArray(r),
      );
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
