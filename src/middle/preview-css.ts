/**
 * The stylesheet of a page opened on its own (Full page): every rule the app
 * holds, as text, with each relative `url()` made absolute against the sheet
 * it came from.
 *
 * The preview is a `blob:` document, which has no path of its own, so a
 * root-relative `url("/assets/…woff2")` resolves to nothing: the icon font
 * and Open Sans never load, and an icon draws as the first letters of its
 * ligature word ("pe" for person). A `<base>` cures Chromium only; Firefox
 * asks for no font under one, and asks for both once each address is whole
 * (measured on the live host, both engines).
 */

/** `url(…)` with its argument: quoted with ' or ", or bare. */
const URL_REF = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s][^)\s]*))\s*\)/g;

/** A reference that already names its own place, or none to resolve. */
function isWhole(ref: string): boolean {
  return ref === '' || ref.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(ref);
}

/** Each relative `url()` in `css` made absolute against `base`; the rest as written. */
export function withWholeUrls(css: string, base: string): string {
  return css.replace(URL_REF, (match, dq: string | undefined, sq: string | undefined, bare: string | undefined) => {
    const ref = dq ?? sq ?? bare ?? '';
    if (isWhole(ref)) return match;
    let whole: string;
    try {
      whole = new URL(ref, base).href;
    } catch {
      return match;
    }
    return `url("${whole.replace(/["\\\n]/g, c => (c === '\n' ? '\\a ' : `\\${c}`))}")`;
  });
}

/** Every rule of every readable stylesheet in `doc`, its addresses made whole. */
export function previewStyles(doc: Document): string {
  let css = '';
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRule[];
    try {
      rules = Array.from(sheet.cssRules);
    } catch {
      continue; // cross-origin: the caller copies its <link> instead
    }
    const base = sheet.href ?? doc.baseURI;
    for (const rule of rules) css += withWholeUrls(rule.cssText, base) + '\n';
  }
  return css;
}
