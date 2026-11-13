/**
 * The folder format's one file order (§4 with §3's collision tie-break and the archive's OW-13): names
 * compared by Unicode code point, on every platform. JavaScript's `<` compares UTF-16 code units, which
 * disagrees with code point order above U+FFFF (a surrogate sorts below U+E000 to U+FFFF). One comparator
 * serves the file order and every id tie: `compareCodePoints` in `core/code-point.ts`.
 */
export { compareCodePoints as codePointCompare } from '../core/code-point';
