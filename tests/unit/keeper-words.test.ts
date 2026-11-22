/**
 * Who may make a change only some may make is said one way (1.125.3): "the owner and co-builders" (keel's
 * `keeper_only`: a world's Charter Laws, the Objects a Law names, the charter mark; and the same pair for
 * the strand, a review mark and a world's pages). A world's details are keel's to take from the owner
 * alone, so those lines say "Only the world's owner can", a different fact said differently on purpose.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describeFailures } from '../../src/sync/sync-failure-copy';
import { READ_ONLY_LINE } from '../../src/middle/home-strand';

const SRC = join(__dirname, '..', '..', 'src');

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

/** The keeper pair said any other way than "the owner and co-builders". */
const OTHER = /\bowner or a co-builder\b|\bowner (?:or|and) (?:the |its )?co-builders?\b(?<!\bowner and co-builders)|world(?:\\'|')s owner and (?:its )?co-builders/i;

describe('the keeper case, one way', () => {
  it('no sentence a person reads names the owner and co-builders any other way', () => {
    expect(literals().filter(({ lit }) => OTHER.test(lit)).map(h => `${h.at} ${h.lit}`)).toEqual([]);
  });

  it('the instrument sees the old words and lets the ruled ones be', () => {
    expect(OTHER.test('The owner or a co-builder chooses the strand.')).toBe(true);
    expect(OTHER.test("only the world's owner and co-builders can change that element")).toBe(true);
    expect(OTHER.test("Only the world\\'s owner or a co-builder can publish")).toBe(true);
    expect(OTHER.test('only the owner and co-builders can change that element')).toBe(false);
    expect(OTHER.test("Only the world's owner can change its details on OnlyWorlds.")).toBe(false);
  });

  it('a keeper_only refusal and the strand say it', () => {
    const keeper = { element_id: 'a', type: 'law', operation: 'update', status: 403, code: 'keeper_only', message: '' } as never;
    expect(describeFailures([keeper])).toContain('only the owner and co-builders can change that element.');
    expect(READ_ONLY_LINE).toBe('The owner and co-builders choose the strand.');
  });

  it('a world\'s details stay the owner\'s alone', () => {
    const details = { element_id: 'w', type: 'world', operation: 'update', status: 403, code: 'owner_only', message: '' } as never;
    expect(describeFailures([details])).toContain('only its owner can change them on OnlyWorlds');
  });
});
