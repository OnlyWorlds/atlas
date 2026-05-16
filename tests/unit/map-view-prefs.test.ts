/**
 * map-view-prefs — storage + effective-prefs merge contract.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FACTORY_DEFAULTS,
  getAtlasDefaults,
  setAtlasDefaults,
  resetAtlasDefaults,
  getMapOverride,
  setMapOverride,
  resetMapOverride,
  getEffectiveMapPrefs,
  saveMapPrefsAsDefault,
  getAllMapOverrides,
} from '../../src/core/map-view-prefs';

beforeEach(() => {
  localStorage.clear();
});

describe('atlas defaults', () => {
  it('returns FACTORY_DEFAULTS when nothing in storage', () => {
    expect(getAtlasDefaults()).toEqual(FACTORY_DEFAULTS);
  });

  it('setAtlasDefaults merges into storage', () => {
    setAtlasDefaults({ pin_style: 'pin-shape' });
    expect(getAtlasDefaults().pin_style).toBe('pin-shape');
    // Other fields untouched.
    expect(getAtlasDefaults().pin_labels).toBe(FACTORY_DEFAULTS.pin_labels);
  });

  it('successive setAtlasDefaults calls accumulate', () => {
    setAtlasDefaults({ pin_style: 'round-icon' });
    setAtlasDefaults({ show_grid: true, grid_spacing: 200 });
    const d = getAtlasDefaults();
    expect(d.pin_style).toBe('round-icon');
    expect(d.show_grid).toBe(true);
    expect(d.grid_spacing).toBe(200);
  });

  it('resetAtlasDefaults returns to factory', () => {
    setAtlasDefaults({ pin_style: 'pin-shape', show_grid: true });
    resetAtlasDefaults();
    expect(getAtlasDefaults()).toEqual(FACTORY_DEFAULTS);
  });

  it('partial JSON in storage falls back to factory for missing fields', () => {
    localStorage.setItem('atlas_map_view_defaults', JSON.stringify({ pin_style: 'pin-shape' }));
    const d = getAtlasDefaults();
    expect(d.pin_style).toBe('pin-shape');
    expect(d.pin_labels).toBe(FACTORY_DEFAULTS.pin_labels);
    expect(d.grid_spacing).toBe(FACTORY_DEFAULTS.grid_spacing);
  });

  it('corrupt JSON in storage falls back to factory', () => {
    localStorage.setItem('atlas_map_view_defaults', '{not valid json');
    expect(getAtlasDefaults()).toEqual(FACTORY_DEFAULTS);
  });
});

describe('per-map overrides', () => {
  it('null when no override set', () => {
    expect(getMapOverride('map-1')).toBeNull();
  });

  it('setMapOverride writes a partial', () => {
    setMapOverride('map-1', { show_grid: true });
    expect(getMapOverride('map-1')).toEqual({ show_grid: true });
  });

  it('successive setMapOverride calls accumulate', () => {
    setMapOverride('map-1', { show_grid: true });
    setMapOverride('map-1', { lock_pin_drag: true });
    expect(getMapOverride('map-1')).toEqual({ show_grid: true, lock_pin_drag: true });
  });

  it('setMapOverride with undefined removes that field from the override', () => {
    setMapOverride('map-1', { show_grid: true, lock_pin_drag: true });
    setMapOverride('map-1', { show_grid: undefined });
    expect(getMapOverride('map-1')).toEqual({ lock_pin_drag: true });
  });

  it('removing the last field clears the map entry entirely', () => {
    setMapOverride('map-1', { show_grid: true });
    setMapOverride('map-1', { show_grid: undefined });
    expect(getMapOverride('map-1')).toBeNull();
    expect(getAllMapOverrides()).toEqual({});
  });

  it('resetMapOverride clears the entry', () => {
    setMapOverride('map-1', { show_grid: true });
    resetMapOverride('map-1');
    expect(getMapOverride('map-1')).toBeNull();
  });

  it('per-map overrides are independent per map', () => {
    setMapOverride('map-1', { show_grid: true });
    setMapOverride('map-2', { lock_pin_drag: true });
    expect(getMapOverride('map-1')).toEqual({ show_grid: true });
    expect(getMapOverride('map-2')).toEqual({ lock_pin_drag: true });
  });
});

describe('getEffectiveMapPrefs', () => {
  it('falls back through factory → atlas-defaults → per-map override', () => {
    setAtlasDefaults({ pin_style: 'round-icon', grid_spacing: 200 });
    setMapOverride('map-1', { show_grid: true });

    const eff = getEffectiveMapPrefs('map-1');
    expect(eff.pin_style).toBe('round-icon'); // from atlas defaults
    expect(eff.grid_spacing).toBe(200);        // from atlas defaults
    expect(eff.show_grid).toBe(true);          // from per-map
    expect(eff.pin_labels).toBe(FACTORY_DEFAULTS.pin_labels); // from factory
  });

  it('per-map override wins over atlas default for the same field', () => {
    setAtlasDefaults({ pin_style: 'round-icon' });
    setMapOverride('map-1', { pin_style: 'pin-shape' });
    expect(getEffectiveMapPrefs('map-1').pin_style).toBe('pin-shape');
  });

  it('returns factory defaults when nothing is set anywhere', () => {
    expect(getEffectiveMapPrefs('any-map')).toEqual(FACTORY_DEFAULTS);
  });
});

describe('saveMapPrefsAsDefault', () => {
  it('promotes effective prefs to atlas defaults and clears the override', () => {
    setAtlasDefaults({ pin_style: 'round-icon' });
    setMapOverride('map-1', { show_grid: true, grid_spacing: 200 });

    saveMapPrefsAsDefault('map-1');

    // New atlas defaults reflect the promoted prefs (atlas default + override).
    const d = getAtlasDefaults();
    expect(d.pin_style).toBe('round-icon');
    expect(d.show_grid).toBe(true);
    expect(d.grid_spacing).toBe(200);

    // Map-1's override is cleared (defaults ARE its prefs now).
    expect(getMapOverride('map-1')).toBeNull();

    // Effective prefs for map-1 unchanged from before — same values, just sourced differently.
    expect(getEffectiveMapPrefs('map-1').show_grid).toBe(true);
    expect(getEffectiveMapPrefs('map-1').grid_spacing).toBe(200);
  });

  it('other maps inherit new defaults unless they have their own overrides', () => {
    setMapOverride('map-1', { show_grid: true });
    setMapOverride('map-2', { show_grid: false }); // explicit override

    saveMapPrefsAsDefault('map-1');

    expect(getEffectiveMapPrefs('map-1').show_grid).toBe(true);  // matches new default
    expect(getEffectiveMapPrefs('map-2').show_grid).toBe(false); // own override preserved
    expect(getEffectiveMapPrefs('map-3').show_grid).toBe(true);  // inherits new default
  });
});
