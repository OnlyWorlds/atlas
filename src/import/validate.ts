/**
 * Import validation — advisory, non-blocking. Pure.
 *
 * Produces user-fixable ValidationIssues (each with the six fields the fix-prompt
 * needs) so the UI can show problems + a "copy fix prompt for AI" button. Import
 * still proceeds on issues (unresolved links drop, invalid records skip) — this
 * is the escape hatch for repairing the source JSON, not a gate.
 *
 * Operates on the RAW parsed records (incoming = bare relation names, which match
 * the SDK schema names), so it can see and report unknown fields before reconcile
 * strips them.
 */

import { knownFieldsFor, relationFieldsFor } from '../editor/field-schema';
import { isExtensionField, ELEMENT_LABELS, SPATIAL_TYPES } from '../core/constants';
import { ALL_ELEMENT_TYPES, type Element, type ElementType } from '../core/types';
import { isUuid, normName } from './normalize';
import type { ParseResult, RawRecord, ValidationIssue } from './types';
const SPATIAL_SAFE = new Set(['x', 'y', 'z', 'order', 'element_type']);
// Server bookkeeping stamps. Files in an api-linked world carry these, so
// atlas's OWN export round-trips through here — flagging them produced 45
// bogus "unknown field" warnings on a clean export (Captain's smoke, S254).
// `change_seq` is the keel v2 addition, present on every element in the
// world-export envelope — without it a 36-element import shows "36 things to
// check", one per element (2026-07-23). Reconcile strips them all; the
// validator's job is only to not cry wolf.
const SERVER_STAMPS = new Set(['created_at', 'updated_at', 'change_seq']);
const VALID_TYPE_LIST = ALL_ELEMENT_TYPES.map(t => cap(t)).join(', ');

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function validatePayload(parsed: ParseResult, existing: Element[] = []): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!parsed.ok) return issues;

  for (const bucket of parsed.unknownBuckets) {
    issues.push({
      path: bucket,
      field: bucket,
      value: undefined,
      issue: `Unknown element type "${bucket}"`,
      expected: `One of: ${VALID_TYPE_LIST}`,
      suggestion: `Remove "${bucket}" or rename it to a valid OnlyWorlds element type.`,
    });
  }

  // name lookups for relation-existence (import + existing), per target type.
  const namesByType = new Map<ElementType, Set<string>>();
  const addName = (t: ElementType, n: string) => {
    let set = namesByType.get(t);
    if (!set) { set = new Set(); namesByType.set(t, set); }
    set.add(normName(n));
  };
  for (const e of existing) if (e.name) addName(e.type, e.name);
  for (const [type, records] of parsed.byType) {
    for (const r of records) if (typeof r.name === 'string' && r.name.trim()) addName(type, r.name);
  }
  const nameExists = (t: ElementType, n: string): boolean => namesByType.get(t)?.has(normName(n)) ?? false;

  for (const [type, records] of parsed.byType) {
    const known = knownFieldsFor(type);
    const isSpatial = SPATIAL_TYPES.has(type);
    const relBySchemaField = new Map(relationFieldsFor(type).map(r => [r.schemaField, r]));
    const label = ELEMENT_LABELS[type]?.singular ?? type;

    records.forEach((rec, i) => {
      const path = `${cap(type)}[${i}]`;

      // Pins and markers are UNNAMED BY DESIGN (atlas creates them with an
      // empty name) — requiring a name here silently dropped every unnamed
      // spatial artifact on re-import, breaking export→import round-trips
      // (found via the bundled sample world, session 248).
      const nameOptional = type === 'pin' || type === 'marker';
      if (!nameOptional && (typeof rec.name !== 'string' || !rec.name.trim())) {
        issues.push({
          path: `${path}.name`,
          field: 'name',
          value: rec.name,
          issue: 'Missing or empty "name"',
          expected: 'Non-empty string',
          suggestion: `"name": "Example ${label}"`,
        });
      }

      for (const [k, v] of Object.entries(rec)) {
        if (k === 'id' || k === 'type' || k === 'name') continue;

        const rel = relBySchemaField.get(k);
        if (rel) {
          const target = rel.target ?? polymorphicTarget(rec);
          if (rel.kind === 'single') {
            if (v !== null && v !== '' && typeof v !== 'string') {
              issues.push(cardinalityIssue(path, k, v, 'a single element name or id (string)'));
            } else if (typeof v === 'string' && v.trim() && !isUuid(v) && target && !nameExists(target, v)) {
              issues.push(missingRefIssue(path, k, v, target));
            }
          } else {
            if (v !== undefined && v !== null && !Array.isArray(v)) {
              issues.push(cardinalityIssue(path, k, v, 'an array of element names or ids'));
            } else if (Array.isArray(v)) {
              v.forEach((item, j) => {
                if (typeof item === 'string' && item.trim() && !isUuid(item) && target && !nameExists(target, item)) {
                  issues.push(missingRefIssue(`${path}.${k}[${j}]`, k, item, target));
                }
              });
            }
          }
          continue;
        }

        // Extension-namespace fields (atlas_/x_/shadow_) are legal custom
        // data — keel v2 round-trips them; never cry wolf on them.
        if (!known.has(k) && !isExtensionField(k) && !SERVER_STAMPS.has(k) && !(isSpatial && SPATIAL_SAFE.has(k))) {
          issues.push({
            path: `${path}.${k}`,
            field: k,
            value: v,
            issue: `Unknown field "${k}" for ${label}`,
            expected: 'A valid OnlyWorlds field name',
            suggestion: `Remove "${k}", check the spelling, or rename it to "x_${k}" to keep it as a custom field.`,
          });
        }
      }
    });
  }

  return issues;
}

function polymorphicTarget(record: RawRecord): ElementType | null {
  const et = record.element_type;
  if (typeof et === 'string' && (ALL_ELEMENT_TYPES as readonly string[]).includes(et.toLowerCase())) {
    return et.toLowerCase() as ElementType;
  }
  return null;
}

function cardinalityIssue(path: string, field: string, value: unknown, expected: string): ValidationIssue {
  return {
    path: `${path}.${field}`,
    field,
    value,
    issue: `Field "${field}" has the wrong shape`,
    expected,
    suggestion: `"${field}": "Element Name"`,
  };
}

function missingRefIssue(path: string, field: string, value: string, target: ElementType): ValidationIssue {
  return {
    path: `${path}.${field}`,
    field,
    value,
    issue: `"${value}" not found in the import or the existing world`,
    expected: `An existing ${target} name/id, or include a ${target} named "${value}" in the import`,
    suggestion: `Add a ${target}: {"name": "${value}", ...}`,
  };
}

/** Turn validation issues into a paste-back prompt for the user's parsing AI (kept feature). */
export function generateFixPrompt(issues: ValidationIssue[]): string {
  if (issues.length === 0) return '';
  let prompt = 'Please fix these OnlyWorlds validation issues in the JSON:\n\n';
  issues.forEach((e, i) => {
    prompt += `${i + 1}. ${e.path}\n`;
    prompt += `   Issue: ${e.issue}\n`;
    prompt += `   Expected: ${e.expected}\n`;
    prompt += `   Fix: ${e.suggestion}\n\n`;
  });
  prompt += 'Once fixed, provide the complete corrected JSON.';
  return prompt;
}
