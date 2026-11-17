/**
 * A map drawn in its picture's measure (a size of 0 or below, a view-only map with none, a local picture with
 * none) keeps that measure across a reload in this browser, so it opens in the same frame and its saved camera
 * is not cleared by a frame flip. On 1.124.13 the measure lived only in memory: every load drew the square
 * first, then the measure, and the flip cleared the camera.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { drawnFrame, rememberPictureSize, _resetMeasuredForTests, _forgetSessionMeasuresForTests } from '../../src/tabs/right/map-frame';
import type { WorldMap } from '../../src/core/types';

const map = (extra: Record<string, unknown>) => ({ id: 'm1', type: 'map', name: 'M', width: 0, height: 0, ...extra }) as unknown as WorldMap;
const pic = 'https://media.example/p.png';

beforeEach(() => _resetMeasuredForTests());

describe('a picture measure kept in this browser', () => {
  it('is the frame after a reload, before the picture is measured again', () => {
    rememberPictureSize(map({ image_url: pic }), { w: 1600, h: 900 });
    _forgetSessionMeasuresForTests();
    expect(drawnFrame(map({ image_url: pic }))).toEqual({ w: 1600, h: 900 });
  });

  it('never stands for another picture', () => {
    rememberPictureSize(map({ image_url: pic }), { w: 1600, h: 900 });
    _forgetSessionMeasuresForTests();
    const other = drawnFrame(map({ image_url: 'https://media.example/q.png' }));
    expect(other).not.toEqual({ w: 1600, h: 900 });
  });

  it('a new measure of the same address replaces it', () => {
    rememberPictureSize(map({ image_url: pic }), { w: 1600, h: 900 });
    rememberPictureSize(map({ image_url: pic }), { w: 800, h: 600 });
    _forgetSessionMeasuresForTests();
    expect(drawnFrame(map({ image_url: pic }))).toEqual({ w: 800, h: 600 });
  });

  it('a written size above 0 still wins', () => {
    rememberPictureSize(map({ image_url: pic }), { w: 1600, h: 900 });
    _forgetSessionMeasuresForTests();
    expect(drawnFrame(map({ image_url: pic, width: 500, height: 400 }))).toEqual({ w: 500, h: 400 });
  });

  it('a store that will not parse, or a bad entry, is no measure', () => {
    localStorage.setItem('atlas_map_picture_measures', '{not json');
    expect(() => drawnFrame(map({ image_url: pic }))).not.toThrow();
    localStorage.setItem('atlas_map_picture_measures', JSON.stringify({ m1: { picture: `url:${pic}`, w: -3, h: 'x' } }));
    _forgetSessionMeasuresForTests();
    expect(drawnFrame(map({ image_url: pic }))).not.toEqual({ w: -3, h: 'x' });
  });

  it('keeps at most 300 maps, dropping the longest unmeasured', () => {
    for (let i = 0; i < 305; i++) rememberPictureSize({ ...map({ image_url: pic }), id: `m${i}` } as WorldMap, { w: 10 + i, h: 10 });
    const store = JSON.parse(localStorage.getItem('atlas_map_picture_measures')!) as Record<string, unknown>;
    expect(Object.keys(store)).toHaveLength(300);
    expect(store.m0).toBeUndefined();
    expect(store.m304).toBeDefined();
  });
});
