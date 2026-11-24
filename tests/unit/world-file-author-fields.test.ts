/**
 * A world file leaves out who and which tool wrote each element (`created_by`,
 * `changed_by`, `changed_via`, `changed_client`, `doors`), as an export does
 * (export-no-author-fields.test.ts): the SDK's writer leaves them out by
 * default, and that must hold for every element file it carries, not only the
 * ones its folder reader would take as an element. A foreign folder can hold
 * two files with one id, or a file whose extension is written in capitals:
 * both are still copied into the file, so both are still stripped.
 */
import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync } from 'fflate';
import { zipWorld } from '../../src/store/world-file';
import { SERVER_AUTHOR_FIELDS } from '../../src/core/constants';

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b2';
const C = '00000000-0000-4000-8000-0000000000c3';
const author = {
  created_by: 'm-1', changed_by: 'm-2', changed_via: 'mcp', changed_client: 'lantern',
  doors: { lantern: '2026-10-29T12:00:00Z' },
};
const file = (path: string, body: object) => ({ path, data: strToU8(JSON.stringify(body)) });

describe('a world file leaves the author fields out of every element file it carries', () => {
  it('a plain element, both files of one id, and a .JSON file', () => {
    const zip = zipWorld([
      file('world.json', { id: 'w-1', name: 'Twins' }),
      file(`elements/location/${C}.json`, { id: C, type: 'location', name: 'Plain', ...author }),
      file(`elements/character/${A}.json`, { id: A, type: 'character', name: 'Ada', ...author }),
      file(`elements/character/${A}-copy.json`, { id: A, type: 'character', name: 'Ada again', ...author }),
      file(`elements/character/${B}.JSON`, { id: B, type: 'character', name: 'Capitals', ...author }),
    ], 'twins');
    const out = unzipSync(zip);
    const carried = Object.keys(out).filter(p => p.includes('/elements/')).sort();
    expect(carried).toHaveLength(4);
    for (const path of carried) {
      const body = JSON.parse(new TextDecoder().decode(out[path])) as Record<string, unknown>;
      expect(typeof body.name, path).toBe('string');
      for (const f of SERVER_AUTHOR_FIELDS) expect(body, `${path} ${f}`).not.toHaveProperty(f);
    }
  });
});
