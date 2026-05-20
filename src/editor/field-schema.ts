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
  { name: 'atlas_aliases', widget: 'text-short' },
];

/** Field names that should use a short text input even when type is `text`. */
const SHORT_TEXT_FIELDS = new Set(['name', 'supertype', 'subtype', 'image_url']);

function resolveWidget(fieldName: string, rawType: string | undefined): WidgetKind {
  if (rawType === 'single_link') return 'single-link';
  if (rawType === 'multi_link') return 'multi-link';
  if (rawType === 'number' || rawType === 'integer' || rawType === 'integer_max') return 'number';
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

  return [base, ...schemaSections.sort((a, b) => a.order - b.order)];
}

/** Known field names across this element type (base + schema). */
export function knownFieldsFor(type: ElementType): Set<string> {
  const names = new Set<string>(BASE_FIELDS.map(f => f.name));
  const schema = (FIELD_SCHEMA as any)[type];
  if (schema) for (const k of Object.keys(schema)) names.add(k);
  return names;
}
