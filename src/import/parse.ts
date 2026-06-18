/**
 * Parse + detect an import payload. Pure; takes already-JSON-parsed data.
 *
 * Format detection (DESIGN_IMPORT.md "Format model"):
 *   - has a "World" key (object) → full-world
 *   - else keys (lowercased) in ALL_ELEMENT_TYPES with array values → loose
 *   - else → not recognizable OnlyWorlds data
 *
 * Top-level bucket keys are PascalCase in OW exports ("Character"); atlas types
 * are lowercase. We always lowercase before testing membership.
 */

import { ALL_ELEMENT_TYPES, type ElementType } from '../core/types';
import type { ParseResult, RawRecord } from './types';

const TYPE_SET = new Set<string>(ALL_ELEMENT_TYPES);

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
