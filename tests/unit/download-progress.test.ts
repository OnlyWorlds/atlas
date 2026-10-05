/**
 * The download progress line (1.17, contract §2.2; d-1000 built as the walk
 * page's lean): a big world coming into this browser says it takes a while,
 * and every dialog that downloads a world uses the one line.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIG_BROWSER_DOWNLOAD, downloadingLine } from '../../src/ui/download-progress';

describe('downloadingLine', () => {
  it('says it takes a while only for a big world coming into this browser', () => {
    expect(downloadingLine(47, 4771, 'browser')).toBe('Downloading 47 of 4771 elements… A world this size takes a while in this browser.');
    expect(downloadingLine(47, 4771, 'folder')).toBe('Downloading 47 of 4771 elements…');
    expect(downloadingLine(1, BIG_BROWSER_DOWNLOAD, 'browser')).toBe(`Downloading 1 of ${BIG_BROWSER_DOWNLOAD} elements…`);
  });

  it('is the line in every dialog that downloads a world', () => {
    for (const file of ['sync/account-worlds.ts', 'ui/link-world-modal.ts', 'ui/view-world-modal.ts', 'ui/bring-down-again-modal.ts']) {
      const code = readFileSync(resolve(process.cwd(), 'src', file), 'utf8');
      expect(code, file).toContain('downloadingLine(p.done, p.total,');
      expect(code, file).not.toMatch(/`Downloading:? \$\{p\.done\}/);
    }
  });
});
