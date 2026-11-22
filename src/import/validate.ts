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

import { knownFieldsFor, relationFieldsFor, scalarKindsFor } from '../editor/field-schema';
import { isExtensionField, SERVER_AUTHOR_FIELDS, SERVER_MARK_FIELDS, SPATIAL_TYPES } from '../core/constants';
import { typeName } from '../core/type-words';
import { ALL_ELEMENT_TYPES, type Element, type ElementType } from '../core/types';
import { isUuid, normName } from './normalize';
import type { ParseResult, RawRecord, ValidationIssue } from './types';
const SPATIAL_SAFE = new Set(['x', 'y', 'z', 'order', 'element_type']);
// Server bookkeeping stamps. Files in an api-linked world carry these, so
// atlas's OWN export round-trips through here — flagging them produced 45
// bogus "unknown field" warnings on a clean export (Titus's smoke).
// `change_seq` is the keel v2 addition, present on every element in the
// world-export envelope — without it a 36-element import shows "36 things to
// check", one per element (2026-07-23). Reconcile strips them all; the
// validator's job is only to not cry wolf.
const SERVER_STAMPS = new Set<string>(['created_at', 'updated_at', 'change_seq', ...SERVER_AUTHOR_FIELDS, ...SERVER_MARK_FIELDS]);
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
    const scalars = scalarKindsFor(type);
    const label = typeName(type, { world: null });

    records.forEach((rec, i) => {
      const path = `${cap(type)}[${i}]`;

      // Pins and markers are UNNAMED BY DESIGN (atlas creates them with an
      // empty name) — requiring a name here silently dropped every unnamed
      // spatial artifact on re-import, breaking export→import round-trips
      // (found via the bundled sample world).
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
              issues.push(cardinalityIssue(path, k, v, 'A single element name or id (string)'));
            } else if (typeof v === 'string' && v.trim() && !isUuid(v) && target && !nameExists(target, v)) {
              issues.push(missingRefIssue(path, k, v, target));
            }
          } else {
            if (v !== undefined && v !== null && !Array.isArray(v)) {
              issues.push(cardinalityIssue(path, k, v, 'An array of element names or ids'));
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

        // A text or number field holding the wrong kind of value is said here, before anything is
        // added: the file keeps whatever the import writes, and only a lint would ever say it.
        const kind = scalars.get(k);
        if (kind) {
          const fault = scalarFault(kind, v);
          if (fault) issues.push(scalarIssue(path, k, v, kind, fault, elementWords(rec, label, i)));
          continue;
        }

        // Extension-namespace fields (atlas_/x_/shadow_) are legal custom
        // data — keel v2 round-trips them; never cry wolf on them.
        // Envelope imports (spec §8c) MUST ignore unknown element fields — a
        // future additive bump ships fields this build's schema doesn't know,
        // and warning on them is crying wolf about valid data (they are kept,
        // not dropped, on the envelope path). Hand-pasted JSON keeps the warn.
        if (parsed.envelope === true) continue;
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

/**
 * What is wrong with a scalar value, or null when the import can take it. A number field takes a number or
 * a numeric string (normalize turns "12" into 12, as onlyworlds.com writes every scalar), an integer field a
 * whole one; "" and null are an unset field. A text field takes a string, or a number keel keeps as text;
 * an object, a list or a true/false is no text.
 */
function scalarFault(kind: 'text' | 'integer' | 'number', v: unknown): 'whole' | 'number' | 'text' | null {
  if (v === null || v === undefined) return null;
  if (kind === 'text') return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? null : 'text';
  if (v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 'number';
  return kind === 'integer' && !Number.isInteger(n) ? 'whole' : null;
}

/** The element as the review names it: its own name, or its type and place in the import. */
function elementWords(rec: RawRecord, label: string, i: number): string {
  return typeof rec.name === 'string' && rec.name.trim() ? `"${rec.name.trim()}"` : `${cap(label)} ${i + 1}`;
}

function scalarIssue(
  path: string, field: string, value: unknown, kind: 'text' | 'integer' | 'number',
  fault: 'whole' | 'number' | 'text', who: string,
): ValidationIssue {
  const shown = typeof value === 'string' ? `"${value}"` : Array.isArray(value) ? 'a list' : typeof value === 'object' ? 'a group of fields' : String(value);
  const takes = kind === 'text' ? 'text' : fault === 'whole' || kind === 'integer' ? 'a whole number' : 'a number';
  return {
    path: `${path}.${field}`,
    field,
    value,
    issue: `${who}: "${field}" takes ${takes}, and here it holds ${shown}`,
    expected: kind === 'text' ? 'A string of text' : kind === 'integer' ? 'A whole number, like 12' : 'A number, like 1.5',
    suggestion: kind === 'text'
      ? `Write "${field}" as one string of text.`
      : `Write "${field}" as ${takes}, or move the words into a text field such as "description".`,
  };
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
