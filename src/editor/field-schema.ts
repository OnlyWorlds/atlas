/**
 * Schema helpers — resolve field info and section layout for an element type.
 *
 * The SDK (v2.2.2+) ships FIELD_SCHEMA + ELEMENT_SECTIONS. This file is a thin
 * adapter that:
 *   - exposes unified types for what field widgets need
 *   - defines the "Base" section (name/description/supertype/subtype/image_url)
 *     which lives OUTSIDE the SDK's section array
 *   - resolves a field's widget kind from its schema type
 */

import { FIELD_SCHEMA, ELEMENT_SECTIONS } from '@onlyworlds/sdk';
import type { ElementType } from '../core/types';

export type WidgetKind = 'text-short' | 'text-long' | 'number' | 'single-link' | 'multi-link';

export interface FieldMeta {
  name: string;
  widget: WidgetKind;
  target?: ElementType;      // for link fields, the target type
  required?: boolean;
}

export interface SectionLayout {
  name: string;
  order: number;
  fields: FieldMeta[];
}

/** Always-visible base fields (same for every element type).
 *
 * `atlas_aliases` is an atlas-local extension (stripped on API push) that
 * holds alternate names for linking from prose (see DESIGN_WRITING.md §Aliases,
 * convention #49). Rendered as a text-short with comma-separated input;
 * the array ↔ CSV conversion lives in element-detail-fields.ts.
 */
const BASE_FIELDS: Array<{ name: string; widget: WidgetKind; required?: boolean }> = [
  { name: 'name', widget: 'text-short', required: true },
  { name: 'description', widget: 'text-long' },
  { name: 'supertype', widget: 'text-short' },
  { name: 'subtype', widget: 'text-short' },
  { name: 'image_url', widget: 'text-short' },
  // atlas_aliases moved to its own trailing "Aliases" section (Titus):
  // it is an atlas convenience, not an OnlyWorlds base field, and it sat in
  // Base implying otherwise. See sectionsFor.
];

/** Field names that should use a short text input even when type is `text`. */
const SHORT_TEXT_FIELDS = new Set(['name', 'supertype', 'subtype', 'image_url']);

/** A standard field the schema types `integer`: OnlyWorlds stores a number that is not whole there cut, so editors take only whole ones. */
export function isIntegerField(type: ElementType, fieldName: string): boolean {
  const fields = (FIELD_SCHEMA as Record<string, Record<string, { type?: string } | undefined> | undefined>)[type];
  return fields?.[fieldName]?.type === 'integer';
}

function resolveWidget(fieldName: string, rawType: string | undefined): WidgetKind {
  if (rawType === 'single_link') return 'single-link';
  if (rawType === 'multi_link') return 'multi-link';
  if (rawType === 'number' || rawType === 'integer') return 'number';
  // default: text
  if (SHORT_TEXT_FIELDS.has(fieldName)) return 'text-short';
  return 'text-long';
}

/**
 * Return the section layout for an element type:
 *   - "Base" section always first with name/desc/supertype/subtype/image_url
 *   - Then the SDK's ELEMENT_SECTIONS for that type (Constitution, Origins, etc.)
 */
export function sectionsFor(type: ElementType): SectionLayout[] {
  const typeSchema = (FIELD_SCHEMA as any)[type] ?? {};
  const typeSections = (ELEMENT_SECTIONS as any)[type] ?? [];

  const base: SectionLayout = {
    name: 'Base',
    order: 0,
    fields: BASE_FIELDS.map(f => ({
      name: f.name,
      widget: f.widget,
      required: f.required,
    })),
  };

  const schemaSections: SectionLayout[] = (typeSections as Array<{ name: string; order: number; fields: string[] }>)
    .map(section => ({
      name: section.name,
      order: section.order,
      fields: section.fields.map(fieldName => {
        const meta = typeSchema[fieldName] as { type?: string; target?: string } | undefined;
        return {
          name: fieldName,
          widget: resolveWidget(fieldName, meta?.type),
          target: meta?.target as ElementType | undefined,
        };
      }),
    }));

  // Aliases trail the schema sections (directly above the custom-fields
  // section, which element-detail renders after these) — an atlas-local
  // linking convenience, deliberately NOT presented as an OnlyWorlds field.
  const aliases: SectionLayout = {
    name: 'Aliases',
    order: 999,
    fields: [{ name: 'atlas_aliases', widget: 'text-short' }],
  };

  return [base, ...schemaSections.sort((a, b) => a.order - b.order), aliases];
}

/**
 * A message's words are its story (the message profile; the views file's message row leads with
 * `story`): on a message's page the story row moves up from its schema section to stand right after
 * the description in Base, the page's head. Every other row keeps its section and order, and a
 * section left with no rows is dropped. Sections without a Base or a story come back unchanged.
 */
export function withMessageLead(sections: SectionLayout[]): SectionLayout[] {
  const base = sections.find(s => s.name === 'Base');
  const from = sections.find(s => s !== base && s.fields.some(f => f.name === 'story'));
  if (!base || !from) return sections;
  const story = from.fields.find(f => f.name === 'story')!;
  const at = base.fields.findIndex(f => f.name === 'description') + 1;
  return sections
    .map(s => {
      if (s === base) return { ...s, fields: [...s.fields.slice(0, at), story, ...s.fields.slice(at)] };
      if (s === from) return { ...s, fields: s.fields.filter(f => f !== story) };
      return s;
    })
    .filter(s => s.fields.length > 0);
}

/** Known field names across this element type (base + schema). */
export function knownFieldsFor(type: ElementType): Set<string> {
  const names = new Set<string>(BASE_FIELDS.map(f => f.name));
  // Not in BASE_FIELDS (it renders in its own trailing section),
  // but still a known atlas field — never a user custom field.
  names.add('atlas_aliases');
  const schema = (FIELD_SCHEMA as any)[type];
  if (schema) for (const k of Object.keys(schema)) names.add(k);
  return names;
}

/** A relation field of an element type, with both naming conventions. */
export interface RelationField {
  /**
   * SDK FIELD_SCHEMA name = the BARE name used in OnlyWorlds API/export JSON and
   * in atlas's disk shape for content/zone/map (`birthplace`, `map`, `linked_zones`).
   */
  schemaField: string;
  /**
   * Atlas on-disk field name. Same as `schemaField` for content/zone/map; pin
   * and marker carry the `_id` / `_ids` suffix atlas stores (`map_id`, `zone_id`).
   * Pin's `element_id` already has the suffix in the schema, so it's unchanged.
   */
  diskField: string;
  kind: 'single' | 'multi';
  /** Target element type, or null when polymorphic (pin.element_id → uses element_type). */
  target: ElementType | null;
}

/**
 * Spatial types whose disk shape suffixes relation fields with _id / _ids.
 *
 * ⚠ THIS IS A GENERATOR, NOT A TABLE (census 2026-07-28). It does not rename
 * two known fields — it suffixes EVERY link field on these two types, present
 * and future. The day the Council adds a link field to pin or marker, atlas
 * will silently invent a private `_id` disk name for it that no other
 * implementation writes, with nobody having decided that. Folder-format §5
 * already rules the disk names should be bare schema names (ruled
 * 2026-07-13, unbuilt): write-bare, read-accept-both forever, open-time tidy
 * converges old files. Until that lands this set is an open tap, and it fires
 * on schema growth rather than on anything atlas does.
 */
const WIRE_SHAPE_TYPES = new Set<ElementType>(['pin', 'marker']);

/**
 * Relation fields for an element type. Single source of relation introspection
 * — derived from the SDK FIELD_SCHEMA `target`, never guessed from the field
 * name (DESIGN_IMPORT.md convention #84). `schemaField` is the incoming
 * (OW JSON) name; `diskField` is what atlas stores.
 */
export function relationFieldsFor(type: ElementType): RelationField[] {
  const schema = (FIELD_SCHEMA as any)[type];
  if (!schema) return [];
  const wire = WIRE_SHAPE_TYPES.has(type);
  const out: RelationField[] = [];
  for (const [name, raw] of Object.entries(schema)) {
    const meta = raw as { type?: string; target?: string };
    if (meta?.type !== 'single_link' && meta?.type !== 'multi_link') continue;
    const kind: 'single' | 'multi' = meta.type === 'multi_link' ? 'multi' : 'single';
    let diskField = name;
    if (wire && !name.endsWith('_id') && !name.endsWith('_ids')) {
      diskField = kind === 'multi' ? `${name}_ids` : `${name}_id`;
    }
    const target = meta.target && meta.target !== 'any' ? (meta.target as ElementType) : null;
    out.push({ schemaField: name, diskField, kind, target });
  }
  return out;
}

/**
 * A section field that the wire writes as two keys: the editor's `element` on a Pin is the schema's
 * `element_id` (a link to any type) with `element_type` beside it. Returns the two wire keys, or null when
 * the section name is a plain schema field. The import instruction and the review both read this, so a
 * reply that follows the instruction is one the review takes.
 */
export function polymorphicPairFor(type: ElementType, sectionField: string): { idField: string; typeField: string } | null {
  const schema = (FIELD_SCHEMA as any)[type];
  if (!schema || schema[sectionField]) return null;
  const idField = `${sectionField}_id`;
  const typeField = `${sectionField}_type`;
  const rel = relationFieldsFor(type).find(r => r.schemaField === idField);
  if (!rel || rel.kind !== 'single' || rel.target !== null || !schema[typeField]) return null;
  return { idField, typeField };
}

/** Field names whose SDK schema type is numeric (number / integer). */
export function numberFieldsFor(type: ElementType): Set<string> {
  const schema = (FIELD_SCHEMA as any)[type];
  const out = new Set<string>();
  if (!schema) return out;
  for (const [name, raw] of Object.entries(schema)) {
    const t = (raw as { type?: string })?.type;
    if (t === 'number' || t === 'integer') out.add(name);
  }
  return out;
}

/** The schema's scalar fields of a type by kind: `text`, `integer` or `number`. */
export function scalarKindsFor(type: ElementType): Map<string, 'text' | 'integer' | 'number'> {
  const schema = (FIELD_SCHEMA as any)[type];
  const out = new Map<string, 'text' | 'integer' | 'number'>();
  if (!schema) return out;
  for (const [name, raw] of Object.entries(schema)) {
    const t = (raw as { type?: string })?.type;
    if (t === 'text') out.set(name, 'text');
    else if (t === 'integer') out.set(name, 'integer');
    else if (t === 'number') out.set(name, 'number');
  }
  return out;
}
