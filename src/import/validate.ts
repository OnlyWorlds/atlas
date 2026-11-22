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

import { knownFieldsFor, polymorphicPairFor, relationFieldsFor, scalarKindsFor, type RelationField } from '../editor/field-schema';
import { isExtensionField, SERVER_AUTHOR_FIELDS, SERVER_MARK_FIELDS, SPATIAL_TYPES } from '../core/constants';
import { typeName } from '../core/type-words';
import { fieldLabel } from '@onlyworlds/sdk';
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
  // The types a name was made as, so a Fix can steer to a link that holds instead of asking for a twin.
  const typesNamed = (n: string): ElementType[] => ALL_ELEMENT_TYPES.filter(t => nameExists(t, n));

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
          const missing = (at: string, name: string, t: ElementType) =>
            missingRefIssue(at, k, name, t, typesNamed(name), relationFieldsFor(type), rel.target === null);
          if (rel.kind === 'single') {
            if (v !== null && v !== '' && typeof v !== 'string') {
              issues.push(cardinalityIssue(path, k, v, 'A single element name or id (string)'));
            } else if (typeof v === 'string' && v.trim() && !isUuid(v) && target && !nameExists(target, v)) {
              issues.push(missing(`${path}.${k}`, v, target));
            } else if (typeof v === 'string' && v.trim() && !isUuid(v) && !target && rel.target === null) {
              // A link to any type found by name needs the type beside it; without one the import drops it.
              issues.push(untypedLinkIssue(path, k, v, rec[k.replace(/_id$/, '_type')], typesNamed(v)));
            }
          } else {
            if (v !== undefined && v !== null && !Array.isArray(v)) {
              issues.push(cardinalityIssue(path, k, v, 'An array of element names or ids'));
            } else if (Array.isArray(v)) {
              v.forEach((item, j) => {
                if (typeof item === 'string' && item.trim() && !isUuid(item) && target && !nameExists(target, item)) {
                  issues.push(missing(`${path}.${k}[${j}]`, item, target));
                }
              });
            }
          }
          continue;
        }

        // The editor's name for a link the wire writes as two keys (a Pin's "element").
        const pair = polymorphicPairFor(type, k);
        if (pair) {
          const named = typeof v === 'string' && v.trim() ? v.trim() : null;
          const found = named ? typesNamed(named) : [];
          issues.push({
            path: `${path}.${k}`,
            field: k,
            value: v,
            issue: `${cap(label)} writes "${k}" as two fields, "${pair.typeField}" and "${pair.idField}"`,
            expected: `"${pair.typeField}": an element type, and "${pair.idField}": that element's name`,
            // A literal value only where it is known; never a placeholder an AI would paste as written.
            suggestion: named && found.length === 1
              ? `Replace "${k}" with "${pair.typeField}": "${cap(found[0])}" and "${pair.idField}": "${named}".`
              : named && found.length === 0
                // A name made nowhere: the two keys alone would still drop the link.
                ? `"${named}" is not in the import or the world: add it as an element first, then replace "${k}" with "${pair.typeField}", that element's type, and "${pair.idField}": "${named}".`
                : `Replace "${k}" with "${pair.typeField}", the element's type (${found.length ? found.map(cap).join(' or ') : 'like "Character"'}), and "${pair.idField}", its name${named ? ` ("${named}")` : ''}.`,
          });
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
          issues.push(unknownFieldIssue(path, k, v, type, label));
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
  const shown = typeof value === 'string' ? `"${value}"`
    : typeof value === 'boolean' ? `${value}, a yes or no`
    : Array.isArray(value) ? 'a list' : typeof value === 'object' ? 'a group of fields' : String(value);
  const takes = kind === 'text' ? 'text' : fault === 'whole' || kind === 'integer' ? 'a whole number' : 'a number';
  return {
    path: `${path}.${field}`,
    field,
    value,
    // The path already names the key; the line names the field once, as the editor labels it.
    issue: `${who}: ${fieldLabel(field)} takes ${takes}; here it holds ${shown}`,
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

/**
 * `path` is the link's whole path: `Character[1].birthplace`, or in a list `Character[1].rivals[1]`.
 * When the name was made as another type (a group made as a Collective, named in an Event's
 * "characters"), the Fix says so and names this element's field that takes that type, never "add a
 * Character", which would make a twin of what the reply already made.
 */
function missingRefIssue(
  path: string, field: string, value: string, target: ElementType,
  madeAs: ElementType[], rels: RelationField[], polymorphic: boolean,
): ValidationIssue {
  const expected = `An existing ${target} name/id, or include ${aType(target)} named "${value}" in the import`;
  if (madeAs.length) {
    // A link to any type (a Pin's element_id) keeps its name: only the type beside it is wrong.
    if (polymorphic) {
      const typeField = field.replace(/_id$/, '_type');
      const t = madeAs.length === 1 ? cap(madeAs[0]) : null;
      return {
        path,
        field,
        value,
        issue: `"${value}" is ${madeAs.length === 1 ? aType(madeAs[0]) : `made as ${madeAs.map(aType).join(' and as ')}`}, and "${typeField}" says ${cap(target)}`,
        // Expected is copied beside the Fix: it must not ask for the twin the Fix rules out.
        expected: `"${typeField}" naming the type "${value}" was made as`,
        suggestion: t
          ? `Set "${typeField}" to "${t}" and keep "${field}": "${value}".`
          : `Set "${typeField}" to the type "${value}" was made as (${madeAs.map(cap).join(' or ')}) and keep "${field}": "${value}".`,
      };
    }
    // The first type the name was made as that this element has a field for; else the first.
    const other = madeAs.find(t => rels.some(r => r.target === t)) ?? madeAs[0];
    const takers = rels.filter(r => r.target === other && r.schemaField !== field).map(r => `"${r.schemaField}"`);
    const where = takers.length ? `link it in ${takers.join(' or ')} instead` : `remove it from "${field}"`;
    return {
      path,
      field,
      value,
      issue: `"${value}" is ${aType(other)}, and "${field}" takes ${aType(target)}`,
      expected: `Only ${cap(target)} names in "${field}"`,
      suggestion: `"${value}" is ${aType(other)}: ${where}. No new ${cap(target)} is needed.`,
    };
  }
  return {
    path,
    field,
    value,
    issue: `"${value}" not found in the import or the existing world`,
    expected,
    suggestion: `Add ${aType(target)}: {"name": "${value}", ...}`,
  };
}

/**
 * A link to any type (a Pin's "element_id") named with no type beside it, or with a type that is no
 * element type (onlyworlds.com's old exports wrote a number there): the import cannot find it.
 */
function untypedLinkIssue(path: string, field: string, value: string, given: unknown, madeAs: ElementType[]): ValidationIssue {
  const typeField = field.replace(/_id$/, '_type');
  const stated = typeof given === 'string' && given.trim() ? given.trim() : null;
  return {
    path: `${path}.${typeField}`,
    field: typeField,
    value: given,
    issue: stated
      ? `"${field}" names "${value}", and "${typeField}" holds "${stated}", which is no element type`
      : `"${field}" names "${value}", and no "${typeField}" says what type it is`,
    expected: 'An element type, like "Character"',
    suggestion: madeAs.length === 1
      ? `"${typeField}": "${cap(madeAs[0])}"`
      : madeAs.length
        ? `Set "${typeField}" to the type of the element "${value}" (${madeAs.map(cap).join(' or ')}).`
        // A name made nowhere: a type alone would still drop the link.
        : `"${value}" is not in the import or the world: add it as an element first, then set "${typeField}" to that element's type.`,
  };
}

/** "a Character", "an Institution": the article a type's name takes. */
function aType(t: ElementType): string {
  const n = cap(t);
  return `${/^[AEIOU]/.test(n) ? 'an' : 'a'} ${n}`;
}

/** A list of names as a sentence: "A", "A and B", "A, B and C". */
function andList(xs: string[]): string {
  return xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/**
 * An unknown field. Its Fix names the types that do have the field, so the move is plain; an empty one
 * is only removed, since there is nothing in it to keep.
 */
function unknownFieldIssue(path: string, field: string, value: unknown, type: ElementType, label: string): ValidationIssue {
  const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
  const owners = ALL_ELEMENT_TYPES.filter(t => t !== type && knownFieldsFor(t).has(field)).map(cap);
  const has = owners.length === 0 ? ''
    : ` (${owners.length > 3 ? `${owners.slice(0, 3).join(', ')} and others` : andList(owners)} ${owners.length === 1 ? 'has' : 'have'} that field, not ${cap(label)})`;
  // A key that carries the field list's own mark (#age) is kept as a custom field without it.
  const custom = `x_${field.replace(/^#/, '').replace(/>{1,2}[A-Za-z]+$/, '')}`;
  return {
    path: `${path}.${field}`,
    field,
    value,
    issue: `Unknown field "${field}" for ${label}`,
    expected: 'A valid OnlyWorlds field name',
    suggestion: empty
      ? `Remove "${field}": it is empty, and ${cap(label)} has no such field${has}.`
      : `Remove "${field}", check the spelling, or rename it to "${custom}" to keep it as a custom field${has}.`,
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
