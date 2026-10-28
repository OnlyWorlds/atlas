/**
 * The download progress line (1.17, contract §2.2; d-1000 built as the walk
 * page's lean, moved to the saving in 1.98.1): a big world being saved into
 * this browser says it takes a while, and every dialog that downloads a world
 * uses the one line for both phases.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIG_BROWSER_DOWNLOAD, progressLine } from '../../src/ui/download-progress';

describe('progressLine', () => {
  it('counts elements while they download, files while they are saved', () => {
    expect(progressLine({ phase: 'write', done: 47, total: 310 }, 'browser')).toBe('Downloading 47 of 310 elements…');
    expect(progressLine({ phase: 'land', done: 47, total: 312 }, 'browser')).toBe('Saving 47 of 312 files in this browser…');
    expect(progressLine({ phase: 'land', done: 312, total: 312 }, 'browser')).toBe('Opening the world…');
  });

  it('says it takes a while only for a big world being saved into this browser', () => {
    expect(progressLine({ phase: 'land', done: 47, total: 4771 }, 'browser')).toBe('Saving 47 of 4771 files in this browser… A world this size takes a while in this browser.');
    expect(progressLine({ phase: 'write', done: 47, total: 4771 }, 'browser')).toBe('Downloading 47 of 4771 elements…');
    expect(progressLine({ phase: 'write', done: 47, total: 4771 }, 'folder')).toBe('Downloading 47 of 4771 elements…');
    expect(progressLine({ phase: 'land', done: 1, total: BIG_BROWSER_DOWNLOAD }, 'browser')).toBe(`Saving 1 of ${BIG_BROWSER_DOWNLOAD} files in this browser…`);
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
