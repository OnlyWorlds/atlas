/**
 * Order two strings by Unicode code point, never by UTF-16 code unit: a
 * character above U+FFFF (two code units, the first in U+D800..U+DBFF) sorts
 * after every character in U+E000..U+FFFF, as its code point says. No folding:
 * 'B' (U+0042) comes before 'a' (U+0061). The one comparator for an id tie.
 */
export function compareCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(j)!;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  if (i < a.length) return 1;
  if (j < b.length) return -1;
  return 0;
}
