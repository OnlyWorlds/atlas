/**
 * World units (standard 00.31.00, Keel #146, Atlas #149): three free-text
 * labels on the World saying what the world's numbers are counted in. Labels
 * only: nothing converts, a world's own unit ('hands', 'leagues') shows as
 * written, and a world without units shows bare numbers.
 *
 * The nine fields come from the standard's own descriptions
 * (`schema/*.yaml` "in the world's ... unit (World ..._unit)"). Map width and
 * height are pixels and stay bare.
 */

import type { WorldMeta } from './types';

export type WorldUnitField = 'length_unit' | 'mass_unit' | 'distance_unit';

export const WORLD_UNIT_FIELDS: readonly WorldUnitField[] = ['length_unit', 'mass_unit', 'distance_unit'];

/** Keel's column cap (core/world_api.py `_TEXT_MAX`); keel trims before it checks. */
export const WORLD_UNIT_MAX_LENGTH = 64;

/** element type → field → the World unit it is counted in. */
const FIELD_UNITS: Readonly<Record<string, Readonly<Record<string, WorldUnitField>>>> = {
  ability: { range: 'distance_unit' },
  character: { height: 'length_unit', weight: 'mass_unit' },
  creature: { height: 'length_unit', weight: 'mass_unit', speed: 'distance_unit' },
  location: { elevation: 'distance_unit' },
  object: { weight: 'mass_unit' },
  species: { weight: 'mass_unit' },
};

/** Creature speed is "distance_unit per round" in the standard. */
const PER_ROUND = new Set(['creature.speed']);

/** Which World unit a field is counted in, or null for a field without one. */
export function unitFieldFor(type: string, field: string): WorldUnitField | null {
  return FIELD_UNITS[type]?.[field] ?? null;
}

/**
 * The label to print after a field's number in this world ("cm", "km/round"),
 * or '' when the field has no unit or the world has not named it.
 */
export function unitLabelFor(type: string, field: string, meta: Partial<WorldMeta> | null | undefined): string {
  const which = unitFieldFor(type, field);
  if (!which || !meta) return '';
  const raw = (meta as Record<string, unknown>)[which];
  const unit = typeof raw === 'string' ? raw.trim() : '';
  if (!unit) return '';
  return PER_ROUND.has(`${type}.${field}`) ? `${unit}/round` : unit;
}
