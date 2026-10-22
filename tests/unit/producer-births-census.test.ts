/**
 * Every world.json Atlas gives birth to says who made it (folder spec §4.2,
 * v0.3.14). A birth is a `writeWorldMeta` call that names the world's `id`;
 * each one must carry a producer line (or build it: `linkedWorldMeta`,
 * `importedProducer`). The count is pinned, so a scan that finds nothing
 * cannot pass, and a new birth has to be counted here on purpose.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '../../src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** The text of each `writeWorldMeta(...)` call's arguments, by balanced parentheses. */
function calls(text: string): string[] {
  const out: string[] = [];
  for (let i = text.indexOf('writeWorldMeta('); i >= 0; i = text.indexOf('writeWorldMeta(', i + 1)) {
    let depth = 0;
    let j = i + 'writeWorldMeta'.length;
    for (; j < text.length; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')' && --depth === 0) break;
    }
    out.push(text.slice(i, j + 1));
  }
  return out;
}

describe('every birth names its producer', () => {
  const births: Array<{ file: string; call: string }> = [];
  for (const f of files(SRC)) {
    if (f.includes(join('src', 'store'))) continue; // the stores define it
    for (const call of calls(readFileSync(f, 'utf8'))) {
      if (/\bid:/.test(call) || call.includes('linkedWorldMeta(')) births.push({ file: relative(SRC, f), call });
    }
  }

  it('finds the births Atlas has (pinned)', () => {
    expect(births.map(b => b.file).sort()).toEqual([
      'setup/atlas-root-flow.ts', 'setup/atlas-root-flow.ts', 'setup/atlas-root-flow.ts',
      'setup/atlas-root-flow.ts', 'setup/atlas-root-flow.ts',
      'setup/bring-down-again.ts', 'setup/demo-copy.ts', 'tour/tour-world.ts',
    ].map(p => p.split('/').join(sep)));
  });

  it('each carries a line', () => {
    const missing = births.filter(b => !/producer|importedProducer|linkedWorldMeta\(/.test(b.call));
    expect(missing).toEqual([]);
  });
});
