/**
 * pickMapImageSource — image precedence helper (DESIGN_MAPS.md §4).
 *
 * Rule: image_url wins when set. image_media_id is the atlas-local fallback
 * for when no URL exists. Both can be stored simultaneously; URL displays.
 */

import { describe, it, expect } from 'vitest';
import { pickMapImageSource } from '../../src/tabs/right/map-image-source';

describe('pickMapImageSource', () => {
  it('returns grid when neither field is set', () => {
    expect(pickMapImageSource({})).toEqual({ kind: 'grid' });
  });

  it('returns url when only image_url is set', () => {
    expect(pickMapImageSource({ image_url: 'https://example.com/map.png' })).toEqual({
      kind: 'url',
      url: 'https://example.com/map.png',
    });
  });

  it('returns local when only image_media_id is set', () => {
    expect(pickMapImageSource({ image_media_id: 'media-123' })).toEqual({
      kind: 'local',
      mediaId: 'media-123',
    });
  });

  it('image_url wins when both are set (the canonical-source rule)', () => {
    // This is the precedence inversion from Issue B. Pre-fix, image_media_id
    // would win here; post-fix, image_url does.
    expect(pickMapImageSource({
      image_url: 'https://example.com/map.png',
      image_media_id: 'media-123',
    })).toEqual({
      kind: 'url',
      url: 'https://example.com/map.png',
    });
  });

  it('empty-string image_url falls through to image_media_id', () => {
    expect(pickMapImageSource({
      image_url: '',
      image_media_id: 'media-fallback',
    })).toEqual({ kind: 'local', mediaId: 'media-fallback' });
  });

  it('whitespace-only image_url falls through to image_media_id', () => {
    expect(pickMapImageSource({
      image_url: '   ',
      image_media_id: 'media-fallback',
    })).toEqual({ kind: 'local', mediaId: 'media-fallback' });
  });

  it('whitespace-only image_url with no media falls through to grid', () => {
    expect(pickMapImageSource({ image_url: '\t\n  ' })).toEqual({ kind: 'grid' });
  });
});
