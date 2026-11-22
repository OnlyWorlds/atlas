/**
 * The Data room's review says what the import does with three cases it used to pass over: a link by id
 * to an element of another type has its own line, saying the link is kept as written; an unknown field
 * names its element type as the type's name; and the note says what an "element_type" that names no
 * element type does. The note spells the type Pin one way.
 */
import { describe, it, expect } from 'vitest';
import { importIssuesHtml } from '../../src/middle/import-room';
import { parsePayload } from '../../src/import/parse';
import { reconcile } from '../../src/import/reconcile';
import { validatePayload } from '../../src/import/validate';
import type { Element } from '../../src/core/types';

const ADA = '068e5012-d77c-799d-8000-95548fbae78d';
const GUILD = '068e5012-d77c-799d-8000-0000000000ee';
const genId = () => { let n = 0; return () => `068e5012-d77c-799d-8000-${String(++n).padStart(12, '0')}`; };

describe('a link by id to an element of another type', () => {
  const payload = {
    Character: [{ name: 'Cy', birthplace: GUILD, friends: [GUILD, ADA] }, { id: ADA, name: 'Ada' }],
    Collective: [{ id: GUILD, name: 'The Guild' }],
  };

  it('has a line in the review, which says the link is kept as written', () => {
    const issues = validatePayload(parsePayload(payload));
    const single = issues.find(i => i.path === 'Character[0].birthplace');
    expect(single?.issue).toBe(`"${GUILD}" is a Collective, and Birthplace takes a Location. The link is kept as written.`);
    const listed = issues.find(i => i.path === 'Character[0].friends[0]');
    expect(listed?.issue).toBe(`"${GUILD}" is a Collective, and Friends takes a Character. The link is kept as written.`);
    // An id of the type the field takes has no line.
    expect(issues.find(i => i.path === 'Character[0].friends[1]')).toBeUndefined();
  });

  it('reads the type of an element already in the world', () => {
    const world = [{ id: GUILD, type: 'collective', name: 'The Guild' }] as unknown as Element[];
    const issues = validatePayload(parsePayload({ Character: [{ name: 'Cy', birthplace: GUILD }] }), world);
    expect(issues.find(i => i.path === 'Character[0].birthplace')?.issue)
      .toBe(`"${GUILD}" is a Collective, and Birthplace takes a Location. The link is kept as written.`);
  });

  it('an id neither the import nor the world holds has no line', () => {
    const issues = validatePayload(parsePayload({ Character: [{ name: 'Cy', birthplace: '068e5012-d77c-799d-8000-0000000000ff' }] }));
    expect(issues.find(i => i.path === 'Character[0].birthplace')).toBeUndefined();
  });

  it('is kept as written by the import, as the line says', () => {
    const cy = reconcile(parsePayload(payload), [], { genId: genId() }).creates.find(c => c.data.name === 'Cy')!.data;
    expect(cy.birthplace_id ?? cy.birthplace).toBe(GUILD);
    expect(cy.friends).toEqual([GUILD, ADA]);
  });
});

describe('an unknown field', () => {
  it('names its element type as the type\'s name', () => {
    const issues = validatePayload(parsePayload({ Location: [{ name: 'Vale', colour: 'green' }] }));
    expect(issues.find(i => i.field === 'colour')?.issue).toBe('Unknown field "colour" for Location');
  });
});

const NOTE_ELEMENT = 'A Pin\'s "element" is not read: the Pin keeps the link in its "element_id", and a Pin with only "element" comes in with no element.';
const NOTE_BAD_TYPE = 'A Pin whose "element_type" names no element type is read as one with none.';

describe('the note under the review', () => {
  const note = () => {
    const box = document.createElement('div');
    box.innerHTML = importIssuesHtml([{ path: 'Pin[0].element_type', field: 'element_type', value: '7', issue: 'x', expected: 'y', suggestion: 'z' }]);
    return box.querySelector('.atlas-import-issues-note')!.textContent!;
  };

  it('spells the type Pin one way', () => {
    expect(note()).toContain(NOTE_ELEMENT);
    expect(note()).not.toMatch(/\bpins?\b/);
  });

  it('says what an "element_type" that names no element type does', () => {
    expect(note()).toContain(NOTE_BAD_TYPE);
  });

  // Held to the import: an "element_type" of no type gives the same Pin as none.
  it('a Pin whose "element_type" names no type comes in as one with none', () => {
    const make = (extra: Record<string, unknown>) => reconcile(parsePayload({
      Character: [{ id: ADA, name: 'Ada' }],
      Map: [{ name: 'Realm' }],
      Pin: [
        { name: 'By name', map: 'Realm', element_id: 'Ada', ...extra },
        { name: 'By id', map: 'Realm', element_id: ADA, ...extra },
        { name: 'By unknown id', map: 'Realm', element_id: '068e5012-d77c-799d-8000-0000000000ff', ...extra },
      ],
    }), [], { genId: genId() }).creates.filter(c => c.type === 'pin').map(c => c.data);
    const none = make({});
    const bad = make({ element_type: '7' });
    expect(bad).toEqual(none);
    expect(bad.map(p => [p.element_id, p.element_type])).toEqual([
      [undefined, undefined], [ADA, 'character'], ['068e5012-d77c-799d-8000-0000000000ff', undefined],
    ]);
    // The review's line for it.
    const issues = validatePayload(parsePayload({ Character: [{ name: 'Ada' }], Map: [{ name: 'Realm' }], Pin: [{ map: 'Realm', element_id: 'Ada', element_type: '7' }] }));
    expect(issues.some(i => i.issue === '"element_id" names "Ada", and "element_type" holds "7", which is no element type')).toBe(true);
  });
});
