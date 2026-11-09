/**
 * One name for what the Pages room publishes (1.123.15). The room had named one
 * published thing four ways: a public page, a published page, a public link and a
 * public URL. "Public page" also names a world's own page on onlyworlds.com (the
 * one Settings links to, `settings-onlyworlds.ts`), so a share-room line saying it
 * read as that other page. What Atlas publishes is a published page; where it
 * lives is its address. This scan keeps the old names out of the files that speak
 * for Pages.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OLD = /public (page|link|url)/gi;
const FILES = [
  'src/middle/share-room.ts',
  'src/middle/share-page-render.ts',
  'src/sync/sharing-client.ts',
  'src/core/share-payload.ts',
  'src/ui/help-content.ts',
];

function hits(text: string): string[] {
  return text.split('\n').flatMap((line, i) => (line.match(OLD) ? [`${i + 1}: ${line.trim()}`] : []));
}

describe('the Pages room names a published page one way', () => {
  it('the scan finds each old name (a known positive)', () => {
    expect(hits("copy.title = 'Copy public link';\n'to a public URL'\nthe public page down")).toHaveLength(3);
  });

  for (const f of FILES) {
    it(`${f} says "published page" and "address", never public page, link or URL`, () => {
      expect(hits(readFileSync(resolve(__dirname, '../..', f), 'utf8'))).toEqual([]);
    });
  }
});
