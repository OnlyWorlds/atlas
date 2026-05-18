/**
 * Camera-state persistence (U2): zoom + pan preserved per map across reloads.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { saveCameraState, getCameraState, clearCameraState } from '../../src/core/map-camera-persist';
import { MAP_CAMERA_STATE_KEY } from '../../src/core/constants';

beforeEach(() => {
  localStorage.removeItem(MAP_CAMERA_STATE_KEY);
});

describe('map-camera-persist', () => {
  it('returns null when no state has ever been saved', () => {
    expect(getCameraState('map-1')).toBeNull();
  });

  it('roundtrips a save → get', () => {
    saveCameraState('map-1', { center: [12.34, 56.78], zoom: 2 });
    const got = getCameraState('map-1');
    expect(got?.center).toEqual([12.34, 56.78]);
    expect(got?.zoom).toBe(2);
  });

  it('isolates per mapId', () => {
    saveCameraState('a', { center: [1, 2], zoom: 0 });
    saveCameraState('b', { center: [5, 6], zoom: 3 });
    expect(getCameraState('a')?.center).toEqual([1, 2]);
    expect(getCameraState('b')?.center).toEqual([5, 6]);
  });

  it('overwrites prior state on re-save', () => {
    saveCameraState('m', { center: [1, 1], zoom: 0 });
    saveCameraState('m', { center: [2, 2], zoom: 1 });
    expect(getCameraState('m')?.center).toEqual([2, 2]);
    expect(getCameraState('m')?.zoom).toBe(1);
  });

  it('clearCameraState drops only the named map', () => {
    saveCameraState('a', { center: [1, 2], zoom: 0 });
    saveCameraState('b', { center: [5, 6], zoom: 3 });
    clearCameraState('a');
    expect(getCameraState('a')).toBeNull();
    expect(getCameraState('b')?.center).toEqual([5, 6]);
  });

  it('rejects non-finite values silently (does not corrupt the slot)', () => {
    saveCameraState('m', { center: [1, 1], zoom: 0 });
    // NaN center component — should not overwrite the prior good state.
    saveCameraState('m', { center: [Number.NaN, 2], zoom: 1 });
    expect(getCameraState('m')?.center).toEqual([1, 1]);
    expect(getCameraState('m')?.zoom).toBe(0);
  });

  it('returns null on corrupted JSON', () => {
    localStorage.setItem(MAP_CAMERA_STATE_KEY, '{not json');
    expect(getCameraState('m')).toBeNull();
  });

  it('returns null on a partially-corrupted entry (wrong shape)', () => {
    localStorage.setItem(
      MAP_CAMERA_STATE_KEY,
      JSON.stringify({ m: { center: 'wat', zoom: 1 } }),
    );
    expect(getCameraState('m')).toBeNull();
  });
});
