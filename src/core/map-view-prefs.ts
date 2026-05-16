/**
 * Map visual prefs storage and effective-prefs computation.
 *
 * Two localStorage slices:
 *   - atlas_map_view_defaults: MapViewPrefs (atlas-global defaults)
 *   - atlas_map_view_prefs: Record<mapId, Partial<MapViewPrefs>> (per-map overrides)
 *
 * `getEffectiveMapPrefs(mapId)` merges atlas-global defaults with the per-map
 * partial override and returns the effective object — every field guaranteed
 * to have a value (never undefined).
 *
 * See DESIGN_MAPS.md §11 for the user-facing surface.
 */

import { MAP_VIEW_PREFS_DEFAULTS_KEY, MAP_VIEW_PREFS_BY_MAP_KEY } from './constants';

export type PinStyle = 'icon' | 'round-icon' | 'pin-shape';
export type PinLabels = 'always' | 'hover' | 'threshold' | 'never';
export type PinTint = 'type-color' | 'accent' | 'muted';
export type ZoneLabels = 'always' | 'hover' | 'never';
export type GridSpacing = 50 | 100 | 200;

export interface MapViewPrefs {
  pin_style: PinStyle;
  pin_labels: PinLabels;
  pin_label_threshold: number;
  pin_tint: PinTint;
  show_grid: boolean;
  grid_spacing: GridSpacing;
  lock_pin_drag: boolean;
  zone_fill_opacity: number;
  zone_labels: ZoneLabels;
}

/**
 * Atlas factory defaults. Used as the starting point when neither user
 * defaults nor per-map overrides exist for a field.
 */
export const FACTORY_DEFAULTS: MapViewPrefs = {
  pin_style: 'icon',
  pin_labels: 'hover',
  pin_label_threshold: 6,
  pin_tint: 'type-color',
  show_grid: false,
  grid_spacing: 100,
  lock_pin_drag: false,
  zone_fill_opacity: 0.4,
  zone_labels: 'hover',
};

/**
 * Read atlas-global defaults from localStorage. Missing fields fall back to
 * FACTORY_DEFAULTS so the return is always a complete MapViewPrefs.
 */
export function getAtlasDefaults(): MapViewPrefs {
  const raw = readJson(MAP_VIEW_PREFS_DEFAULTS_KEY) as Partial<MapViewPrefs> | null;
  return { ...FACTORY_DEFAULTS, ...(raw ?? {}) };
}

/**
 * Write atlas-global defaults. Partial patch merges into existing storage.
 */
export function setAtlasDefaults(patch: Partial<MapViewPrefs>): void {
  const current = getAtlasDefaults();
  const next = { ...current, ...patch };
  writeJson(MAP_VIEW_PREFS_DEFAULTS_KEY, next);
}

/**
 * Reset atlas-global defaults to factory values. The per-map overrides
 * remain untouched — caller must explicitly clear those if desired.
 */
export function resetAtlasDefaults(): void {
  writeJson(MAP_VIEW_PREFS_DEFAULTS_KEY, FACTORY_DEFAULTS);
}

/**
 * Read all per-map overrides as a (mapId → partial) record.
 */
export function getAllMapOverrides(): Record<string, Partial<MapViewPrefs>> {
  return (readJson(MAP_VIEW_PREFS_BY_MAP_KEY) as Record<string, Partial<MapViewPrefs>> | null) ?? {};
}

/**
 * Read the per-map override for a single map (or null if none exists).
 */
export function getMapOverride(mapId: string): Partial<MapViewPrefs> | null {
  return getAllMapOverrides()[mapId] ?? null;
}

/**
 * Patch the per-map override for a map. Empty patch is a no-op; setting a
 * field to undefined removes it from the override (so the effective value
 * falls back to atlas-default).
 */
export function setMapOverride(mapId: string, patch: Partial<MapViewPrefs>): void {
  const all = getAllMapOverrides();
  const existing = all[mapId] ?? {};
  const merged: Partial<MapViewPrefs> = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete (merged as Record<string, unknown>)[k];
    else (merged as Record<string, unknown>)[k] = v;
  }
  if (Object.keys(merged).length === 0) {
    // No remaining overrides — drop the map's entry entirely.
    delete all[mapId];
  } else {
    all[mapId] = merged;
  }
  writeJson(MAP_VIEW_PREFS_BY_MAP_KEY, all);
}

/**
 * Clear the per-map override entirely. Effective prefs collapse to defaults.
 */
export function resetMapOverride(mapId: string): void {
  const all = getAllMapOverrides();
  if (!(mapId in all)) return;
  delete all[mapId];
  writeJson(MAP_VIEW_PREFS_BY_MAP_KEY, all);
}

/**
 * Compute effective prefs for a map by merging factory defaults + atlas
 * global defaults + per-map override (in that order; later wins).
 */
export function getEffectiveMapPrefs(mapId: string): MapViewPrefs {
  return {
    ...FACTORY_DEFAULTS,
    ...getAtlasDefaults(),
    ...(getMapOverride(mapId) ?? {}),
  };
}

/**
 * "Save current map's effective prefs as the atlas-wide defaults."
 *
 * Reads the effective prefs for the source map and writes them to atlas
 * defaults. The source map's per-map override is then cleared since its
 * preferences ARE the new defaults — no override needed. Other maps that
 * had no override now reflect the new defaults; maps with overrides keep
 * those overrides.
 */
export function saveMapPrefsAsDefault(mapId: string): void {
  const effective = getEffectiveMapPrefs(mapId);
  writeJson(MAP_VIEW_PREFS_DEFAULTS_KEY, effective);
  resetMapOverride(mapId);
}

// ----- internal localStorage helpers -----

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private-mode failure — silent fail. Prefs are advisory; the
    // canvas still renders with factory defaults if storage isn't available.
  }
}
