/**
 * Full page opens a blob: tab, which resolves no relative address: each url()
 * in the copied stylesheet is made whole against the sheet it came from
 * (the "pe" icon). The e2e that presses Full page is share.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { withWholeUrls } from '../../src/middle/preview-css';

const SHEET = 'https://atlas.example/assets/main-x.css';

describe('withWholeUrls', () => {
  it('a root-relative font, as both engines serialize it', () => {
    expect(withWholeUrls('src: url("/assets/icons.woff2") format("woff2");', SHEET))
      .toBe('src: url("https://atlas.example/assets/icons.woff2") format("woff2");');
  });

  it('relative to the sheet, single-quoted and bare', () => {
    expect(withWholeUrls("a{background:url('img/a.png')}", SHEET)).toBe('a{background:url("https://atlas.example/assets/img/a.png")}');
    expect(withWholeUrls('a{background:url(../b.png)}', SHEET)).toBe('a{background:url("https://atlas.example/b.png")}');
  });

  it('leaves whole addresses, data, blobs and fragments as written', () => {
    for (const css of [
      'a{b:url("https://cdn.example/x.woff2")}',
      'a{b:url("data:image/svg+xml,%3Csvg%3E")}',
      'a{b:url(data:image/png;base64,AAAA)}',
      'a{b:url("blob:https://atlas.example/1")}',
      'a{filter:url("#glow")}',
      'a{b:url("")}',
    ]) expect(withWholeUrls(css, SHEET)).toBe(css);
  });

  // Not string-aware: a `content: "url(/x)"` would be rewritten too. The app's
  // sheets hold none (grep of src/styles and material-symbols, 2026-11-24).
  it('every url() in a rule', () => {
    const css = '@font-face{src:url("/a.woff2") format("woff2"),url("/a.woff") format("woff")}';
    const out = withWholeUrls(css, SHEET);
    expect(out).toContain('url("https://atlas.example/a.woff2")');
    expect(out).toContain('url("https://atlas.example/a.woff")');
  });

  it('a quote in an address stays inside the quotes', () => {
    expect(withWholeUrls("a{b:url('/x\"y.png')}", SHEET)).toBe('a{b:url("https://atlas.example/x%22y.png")}');
  });

  it('a long run with no closing bracket stays linear', () => {
    const css = 'url(' + 'a'.repeat(200_000);
    const t = performance.now();
    expect(withWholeUrls(css, SHEET)).toBe(css);
    expect(performance.now() - t).toBeLessThan(500);
  });
});
