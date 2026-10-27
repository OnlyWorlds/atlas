/**
 * The folder format's one file order (§4 with §3's collision tie-break and the archive's OW-13): names
 * compared by Unicode code point, on every platform. JavaScript's `<` compares UTF-16 code units, which
 * disagrees with code point order above U+FFFF (a surrogate sorts below U+E000 to U+FFFF), so this
 * walks code points.
 */
export function codePointCompare(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(i)!;
    if (ca !== cb) return ca < cb ? -1 : 1;
    // A code point above U+FFFF spans two units; both strings agree here, so skip its second unit.
    if (ca > 0xffff) i++;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}
