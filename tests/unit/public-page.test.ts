/**
 * A world's public page address from keel's `GET /world` (Skeld
 * 2026-10-23): `/w/<slug>`, else `/w/<world id>`, only when its owner
 * turned it on. keel's body as served, 2026-10-23: `public_page: { on, ... }`
 * beside `slug` (null until set).
 */
import { describe, it, expect } from 'vitest';
import { publicPageUrl } from '../../src/core/public-page';

const id = '068e012b-52a9-79bf-8000-26bb67891425';
const off = { on: false, palette: null, hero: '', sections: [], pin: null, index: false };

describe('publicPageUrl', () => {
  it('a page that is on: by its slug, else by the world id', () => {
    expect(publicPageUrl({ id, slug: 'the-abbey', public_page: { ...off, on: true } })).toBe('https://www.onlyworlds.com/w/the-abbey');
    expect(publicPageUrl({ id, slug: null, public_page: { ...off, on: true } })).toBe(`https://www.onlyworlds.com/w/${id}`);
    expect(publicPageUrl({ id, slug: '  ', public_page: { ...off, on: true } })).toBe(`https://www.onlyworlds.com/w/${id}`);
  });

  it('off, absent, or not the boolean: no address', () => {
    expect(publicPageUrl({ id, slug: 'the-abbey', public_page: off })).toBeNull();
    expect(publicPageUrl({ id, slug: 'the-abbey' })).toBeNull();
    expect(publicPageUrl({ id, public_page: { on: 'true' } })).toBeNull();
    expect(publicPageUrl({ id, public_page: null })).toBeNull();
    expect(publicPageUrl(null)).toBeNull();
  });

  it("a slug is one path segment, whatever it holds", () => {
    expect(publicPageUrl({ id, slug: 'a/b c', public_page: { on: true } })).toBe('https://www.onlyworlds.com/w/a%2Fb%20c');
  });
});
