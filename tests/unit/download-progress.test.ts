/**
 * The download progress line (1.17, contract §2.2): every dialog that
 * downloads a world uses the one line for the download and the open. A
 * browser world's files land after it opens, counted on its home (#865), so
 * no dialog line says saving any more.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { progressLine } from '../../src/ui/download-progress';

describe('progressLine', () => {
  it('counts elements while they download, then says the world opens', () => {
    expect(progressLine({ phase: 'write', done: 47, total: 310 })).toBe('Downloading 47 of 310 elements…');
    expect(progressLine({ phase: 'open', done: 0, total: 0 })).toBe('Opening the world…');
    expect(progressLine({ phase: 'open', done: 12, total: 310 })).toBe('Opening the world… 12 of 310');
  });

  it('is the line in every dialog that downloads a world', () => {
    for (const file of ['sync/account-worlds.ts', 'ui/link-world-modal.ts', 'ui/view-world-modal.ts', 'ui/bring-down-again-modal.ts', 'ui/join-world-modal.ts']) {
      const code = readFileSync(resolve(process.cwd(), 'src', file), 'utf8');
      expect(code, file).toContain('progressLine(p');
      expect(code, file).not.toContain('downloadingLine');
      expect(code, file).not.toMatch(/`Downloading:? \$\{p\.done\}/);
    }
  });
});
