/**
 * The account's PIN has one name in every sentence a person reads: the World PIN (1.125.3), the name
 * onlyworlds.com gives it in Account settings. A person met "World PIN", "your OnlyWorlds PIN", "your
 * PIN" and "the PIN" for the same four digits. Two short labels keep the bare word: the pill's and the
 * keepsafe's action Add PIN, and the world list's state chip no PIN. A seat secret is not the World PIN
 * and keeps its own words. keel's PIN wall counts "different World PINs" (or, not known whose, "World
 * PINs or seat secrets"), and no line says "PINs" alone (tests/unit/pin-wall-names.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { keyRefusalPill } from '../../src/sync/world-key-lines';
import { pinCheckWaitLine } from '../../src/sync/rate-wait';

const SRC = join(__dirname, '..', '..', 'src');

/** Every string literal in src, comments, console lines and the changelog left out, with where it is. */
function literals(): Array<{ at: string; lit: string }> {
  const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) ? [p] : [];
  });
  const STRINGS = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;
  const out: Array<{ at: string; lit: string }> = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split(sep).join('/');
    if (rel === 'changelog/changelog.data.ts') continue;
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(\/\/|\/\*|\*)/.test(line) || /console\./.test(line)) return;
      for (const lit of line.match(STRINGS) ?? []) out.push({ at: `${rel}:${i + 1}`, lit });
    });
  }
  return out;
}

/**
 * A bare PIN, once the two labels that keep it are taken out: Add PIN wherever it is named (a sentence
 * may say to press it), and no PIN as the chip's own literal.
 */
function bare(lit: string): boolean {
  const body = lit.slice(1, -1);
  if (body === 'no PIN') return false;
  return /(?<!World )\bPIN\b/.test(body.replace(/\bAdd PIN\b/g, '').replace(/'no PIN'/g, ''));
}

describe('the World PIN by one name', () => {
  // Where the code cannot know whose `API-Pin` it was, the line names both, "the World PIN or seat
  // secret" (1.125.5): no line keeps the old neutral "PIN" (tests/unit/seat-credential-words.test.ts).
  it('no sentence a person reads names the account PIN any other way', () => {
    expect(literals().filter(({ lit }) => bare(lit)).map(h => `${h.at} ${h.lit}`)).toEqual([]);
  });

  // "Check the World PIN": the determiner does not turn inside a line that says "this world's key or the
  // World PIN". And the seat's credential has one spelling, "seat secret", in every line a person reads.
  it('no line says "Check your World PIN", and none says "seat\'s secret"', () => {
    const hits = literals().filter(({ lit }) => /\b[Cc]heck your World PIN\b|then your World PIN\b|seat(?:\\?'|’)s secret/.test(lit));
    expect(hits.map(h => `${h.at} ${h.lit}`)).toEqual([]);
    // Each name the census reads, as it is written in code (an escaped quote included).
    expect(/seat(?:\\?'|’)s secret/.test("'OnlyWorlds did not accept this seat\\'s secret.'")).toBe(true);
    expect(/seat(?:\\?'|’)s secret/.test('`this seat secret`')).toBe(false);
  });

  it('the instrument sees the old words and lets the two labels be', () => {
    expect(bare("'Atlas needs your OnlyWorlds PIN to upload a picture.'")).toBe(true);
    expect(bare("'Check your PIN in Settings.'")).toBe(true);
    expect(bare("`OnlyWorlds did not accept the key or PIN.`")).toBe(true);
    expect(bare('"<span>PIN</span>"')).toBe(true);
    expect(bare("'Add PIN'")).toBe(false);
    expect(bare("'no PIN'")).toBe(false);
    expect(bare("'<button data-action=\"keepsafe-add-pin\">Add PIN</button>'")).toBe(false);
    expect(bare("' Its changes stay here until you add your World PIN: press Add PIN at the bottom.'")).toBe(false);
    expect(bare("`${seatWaits ? 'not syncing' : 'no PIN'}`")).toBe(false);
    expect(bare("'Its changes stay here until you add your PIN: press Add PIN at the bottom.'")).toBe(true);
    expect(bare("'Check your World PIN in Settings.'")).toBe(false);
    expect(bare("'OnlyWorlds refused too many different World PINs for this world.'")).toBe(false);
  });

  // The pill's press, which opens Settings, OnlyWorlds, is named in tests/integration/pin-wall.test.ts.
  it('the pill\'s refused-PIN title says the World PIN and where to check it', () => {
    expect(keyRefusalPill('pin')).toBe('OnlyWorlds did not accept this World PIN. Check it in Settings, OnlyWorlds');
  });

  it('Settings\' check inside a wait says the World PIN is not checked yet, never that it is kept here', () => {
    for (const wall of [true, false]) {
      const line = pinCheckWaitLine(wall, 60_000);
      expect(line).toContain('This World PIN is not checked by OnlyWorlds yet;');
      expect(line).not.toContain('kept here');
    }
  });
});
