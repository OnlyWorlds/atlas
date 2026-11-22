/**
 * The copy-button instruction and the review must agree: a reply that follows the instruction to the
 * letter meets no complaint from the review, and each Fix the review writes for the user's AI steers
 * to something the import keeps. Cases from a blind press of the instruction on twelve replies.
 */

import { describe, it, expect } from 'vitest';
import { buildSchemaDigest, buildConvertNotesPrompt, jsonErrorWhere } from '../../src/middle/import-room';
import { jsonTextOf, parsePayload } from '../../src/import/parse';
import { validatePayload } from '../../src/import/validate';
import { knownFieldsFor } from '../../src/editor/field-schema';
import { ALL_ELEMENT_TYPES } from '../../src/core/types';

const review = (data: unknown) => validatePayload(parsePayload(data));

describe('every field the instruction lists is a field the review takes', () => {
  const lines = buildSchemaDigest().split('\n');
  for (const line of lines) {
    const [Type, rest] = line.split(': ');
    it(`${Type}: each listed field, written as listed, raises no "unknown field"`, () => {
      const rec: Record<string, unknown> = { name: `A ${Type}` };
      for (const item of rest.split(', ')) {
        const key = item.replace(/^#/, '').replace(/>{1,2}.*$/, '');
        rec[key] = item.startsWith('#') ? 1 : item.includes('>>') ? [] : '';
      }
      const unknown = review({ [Type]: [rec] }).filter(i => /Unknown field/.test(i.issue));
      expect(unknown.map(i => i.field)).toEqual([]);
    });
  }
});

describe("a Pin's place, as the instruction teaches it", () => {
  const world = { Map: [{ name: 'The Coast' }], Character: [{ name: 'Aralia' }] };

  it('the instruction names the two keys the review reads, not the editor\'s "element"', () => {
    const pin = buildSchemaDigest().split('\n').find(l => l.startsWith('Pin: '))!;
    expect(pin).toContain('element_type');
    expect(pin).toContain('element_id>');
    expect(pin.split(', ')).not.toContain('element');
  });

  it('a Pin written with element_type and element_id by name is clean', () => {
    const issues = review({ ...world, Pin: [{ map: 'The Coast', element_type: 'Character', element_id: 'Aralia', x: 1, y: 2 }] });
    expect(issues).toEqual([]);
  });

  it('a Pin written with "element" gets a Fix naming element_type and element_id', () => {
    const issues = review({ ...world, Pin: [{ map: 'The Coast', element: 'Aralia', x: 1, y: 2 }] });
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestion).toContain('"element_type"');
    expect(issues[0].suggestion).toContain('"element_id": "Aralia"');
  });

  it('a Pin naming its element with no element_type is said, since the import cannot find it', () => {
    const issues = review({ ...world, Pin: [{ map: 'The Coast', element_id: 'Aralia', x: 1, y: 2 }] });
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('element_type');
    expect(issues[0].suggestion).toContain('"element_type": "Character"');
  });
});

describe("a Fix never loses the link it is about", () => {
  const world = { Map: [{ name: 'The Coast' }], Location: [{ name: 'Vallaki' }], Character: [{ name: 'Aralia' }] };

  it('a Pin whose element_type is wrong is told to change the type and keep the name, never to drop the link or move it to map', () => {
    for (const name of ['Vallaki', 'The Coast']) {
      const issues = review({ ...world, Pin: [{ map: 'The Coast', element_type: 'Character', element_id: name, x: 1, y: 2 }] });
      expect(issues).toHaveLength(1);
      const want = name === 'Vallaki' ? 'Location' : 'Map';
      expect(issues[0].suggestion).toBe(`Set "element_type" to "${want}" and keep "element_id": "${name}".`);
    }
  });

  it('an element_type that is no type (an old export wrote a number) is said as such', () => {
    const issues = review({ ...world, Pin: [{ map: 'The Coast', element_type: '7', element_id: 'Aralia', x: 1, y: 2 }] });
    expect(issues).toHaveLength(1);
    expect(issues[0].issue).toContain('holds "7", which is no element type');
    expect(issues[0].suggestion).toBe('"element_type": "Character"');
  });

  it('a name already in the world is not said to be "in this import"', () => {
    const existing = [{ id: '0193f1a2-0000-7000-8000-00000000aa01', type: 'collective', name: 'The Guard' }] as never[];
    const issues = validatePayload(parsePayload({ Event: [{ name: 'The Watch', characters: ['The Guard'] }] }), existing);
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestion).not.toContain('in this import');
    expect(issues[0].suggestion).toContain('"collectives"');
  });

  it('types take their article: an Institution, an Object', () => {
    const issues = review({ Institution: [{ name: 'The Crown' }], Event: [{ name: 'The Ball', characters: ['The Crown'] }] });
    expect(issues[0].issue).toBe('"The Crown" is an Institution, and "characters" takes a Character');
    expect(review({ Character: [{ name: 'A', objects: ['Lamp'] }] })[0].suggestion).toMatch(/^Add an Object:/);
  });

  it('a Pin\'s "element" with an unknown target gives no placeholder in quotes to paste', () => {
    const issues = review({ ...world, Pin: [{ map: 'The Coast', element: 'Nobody', x: 1, y: 2 }] });
    expect(issues[0].suggestion).not.toContain('"its type"');
    expect(issues[0].suggestion).not.toContain('"its name"');
  });

  it('a Pin naming an element made nowhere is told to add it first: a type alone would still drop the link', () => {
    for (const pin of [{ element_id: 'Zed' }, { element_id: 'Zed', element_type: 'NPC' }, { element: 'Zed' }]) {
      const issues = review({ ...world, Pin: [{ map: 'The Coast', x: 1, y: 2, ...pin }] });
      expect(issues).toHaveLength(1);
      expect(issues[0].suggestion).toContain('add it as an element first');
    }
    // With a true type beside it, the plain "add" Fix already keeps the link.
    const typed = review({ ...world, Pin: [{ map: 'The Coast', x: 1, y: 2, element_type: 'Character', element_id: 'Zed' }] });
    expect(typed[0].suggestion).toMatch(/^Add a Character:/);
  });

  it('Expected never asks for the twin its Fix rules out', () => {
    const made = review({ Collective: [{ name: 'The Guard' }], Event: [{ name: 'The Watch', characters: ['The Guard'] }] });
    expect(made[0].expected).not.toMatch(/include|named "The Guard"/);
    const pin = review({ ...world, Pin: [{ map: 'The Coast', element_type: 'Character', element_id: 'Vallaki', x: 1, y: 2 }] });
    expect(pin[0].expected).not.toMatch(/include/);
  });

  it('a marked key the type lacks is kept as a custom field without its mark', () => {
    const issues = review({ Character: [{ name: 'A', '#age': 30 }] });
    expect(issues[0].suggestion).toContain('"x_age"');
  });
});

describe('a name made as another type', () => {
  it('a Collective named in an Event\'s characters: the Fix names the Collective and the field that takes it, never a new Character', () => {
    const issues = review({
      Collective: [{ name: 'The Twelve Princesses' }],
      Event: [{ name: 'The Failed Watches', characters: ['The Twelve Princesses'] }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestion).not.toMatch(/Add a character/i);
    expect(issues[0].suggestion).toContain('Collective');
    expect(issues[0].suggestion).toContain('"collectives"');
  });

  it('a name made nowhere still asks for the element to be added', () => {
    const issues = review({ Event: [{ name: 'The Ball', characters: ['The Soldier'] }] });
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestion).toMatch(/Add a character/i);
  });
});

describe('a reply pasted with its code fence', () => {
  const body = '{"Character": [{"name": "Aralia"}]}';
  const loads = (t: string) => parsePayload(JSON.parse(jsonTextOf(t))).ok;

  it('loads with a json fence, a bare fence, Windows line ends, and words around one fence', () => {
    expect(loads('```json\n' + body + '\n```')).toBe(true);
    expect(loads('```\n' + body + '\n```\n')).toBe(true);
    expect(loads('```json\r\n' + body + '\r\n```\r\n')).toBe(true);
    expect(loads('Here is your world:\n\n```json\n' + body + '\n```\n\nLet me know if you want more.')).toBe(true);
  });

  it('leaves bare JSON alone, a fence inside a value included', () => {
    const withFence = '{"Character": [{"name": "A", "description": "```js\\ncode\\n```"}]}';
    expect(jsonTextOf(withFence)).toBe(withFence);
    expect(jsonTextOf('  ' + body + '\n')).toBe('  ' + body + '\n');
  });

  it('guesses nothing when there are two fences, or one never closed', () => {
    const two = '```json\n' + body + '\n```\nand\n```json\n' + body + '\n```';
    expect(jsonTextOf(two)).toBe(two);
    const open = '```json\n' + body;
    expect(jsonTextOf(open)).toBe(open);
  });

  it('a fault inside the fence is reported at its line in the pasted text', () => {
    const pasted = 'Sure:\n```json\n{\n  "Character": [{"name": "A",}]\n}\n```';
    const text = jsonTextOf(pasted);
    let where = '';
    try { JSON.parse(text); } catch (err) { where = jsonErrorWhere(text, err); }
    expect(where).toMatch(/line 4/);
  });

  it('stays quick on a large paste full of backticks', () => {
    const big = '`'.repeat(1_000_000) + '\n```json\n' + body + '\n```';
    const t0 = performance.now();
    jsonTextOf(big);
    jsonTextOf('```'.repeat(300_000));
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('the instruction asks for no code block', () => {
    expect(buildConvertNotesPrompt()).toContain('no code block');
  });
});

describe("the list's own marks written into a key", () => {
  it('"#count" is read as count, by the review and by the import alike', () => {
    const parsed = parsePayload({ Collective: [{ name: 'The Twelve Princesses', '#count': 12 }] });
    expect(validatePayload(parsed)).toEqual([]);
    const rec = parsed.ok ? parsed.byType.get('collective')![0] : {};
    expect(rec.count).toBe(12);
    expect('#count' in rec).toBe(false);
  });

  it('"location>Location" is read as location', () => {
    const parsed = parsePayload({ Location: [{ name: 'Vallaki' }], Character: [{ name: 'Aralia', 'location>Location': 'Vallaki' }] });
    expect(validatePayload(parsed)).toEqual([]);
  });

  it('a mark on a key the type does not have is left for the review to say', () => {
    const issues = review({ Character: [{ name: 'Aralia', '#age': 30 }] });
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('#age');
  });

  it('a mark never overwrites the bare key written beside it', () => {
    const parsed = parsePayload({ Collective: [{ name: 'X', count: 3, '#count': 12 }] });
    const rec = parsed.ok ? parsed.byType.get('collective')![0] : {};
    expect(rec.count).toBe(3);
  });
});

describe('an unknown field', () => {
  it('names the types that do have it', () => {
    const owners = ALL_ELEMENT_TYPES.filter(t => knownFieldsFor(t).has('aesthetics'));
    expect(owners.length).toBeGreaterThan(0);
    expect(knownFieldsFor('location').has('aesthetics')).toBe(false);
    const issues = review({ Location: [{ name: 'The bog', aesthetics: 'Treacherous' }] });
    expect(issues).toHaveLength(1);
    const cap = owners[0].charAt(0).toUpperCase() + owners[0].slice(1);
    expect(issues[0].suggestion).toContain(cap);
  });

  it('an empty one is simply removed', () => {
    const issues = review({ Object: [{ name: "Anna's lorgnette", owner: null }] });
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestion).toMatch(/^Remove "owner"/);
    expect(issues[0].suggestion).not.toContain('x_owner');
  });

  it('the instruction names no invented field as an example (a reply wrote the one it named)', () => {
    const p = buildConvertNotesPrompt();
    expect(p).not.toContain('Object.owner');
    expect(p).not.toContain('Character.age');
  });
});
