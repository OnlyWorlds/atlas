/**
 * The account's PIN has one name in every sentence a person reads: the World PIN (1.125.3), the name
 * onlyworlds.com gives it in Account settings. A person met "World PIN", "your OnlyWorlds PIN", "your
 * PIN" and "the PIN" for the same four digits. Two short labels keep the bare word: the pill's and the
 * keepsafe's action Add PIN, and the world list's state chip no PIN. A seat's secret is not the World PIN
 * and keeps its own words. "different PINs" and "takes PINs" (keel's PIN wall) count tries, not the PIN.
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
  it('no sentence a person reads names the account PIN any other way', () => {
    expect(literals().filter(({ lit }) => bare(lit)).map(h => `${h.at} ${h.lit}`)).toEqual([]);
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
    expect(bare("'OnlyWorlds refused too many different PINs for this world.'")).toBe(false);
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
