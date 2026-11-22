/**
 * The Data room's review, as a person reads it: each row leads with its line and the path follows as
 * the locator; the note under the list says what the import does with the cases it used to fold into
 * "an unknown field dropped" and "a broken link removed", and each of those sentences is held to what
 * the import does (parse, then reconcile); a missing link's expected value names the type as the
 * editor does.
 */
import { describe, it, expect } from 'vitest';
import { importIssuesHtml } from '../../src/middle/import-room';
import { parsePayload } from '../../src/import/parse';
import { reconcile } from '../../src/import/reconcile';
import { validatePayload } from '../../src/import/validate';
import type { ValidationIssue } from '../../src/import/types';

const ISSUE: ValidationIssue = {
  path: 'Character[0].birth_date', field: 'birth_date', value: 'spring',
  issue: '"Vera": Birth date takes a whole number; here it holds "spring"',
  expected: 'A whole number, like 12', suggestion: 'Write "birth_date" as a whole number.',
};

function review(issues: ValidationIssue[]): HTMLElement {
  const box = document.createElement('div');
  box.innerHTML = importIssuesHtml(issues);
  return box;
}

describe('a review row', () => {
  it('opens with the line a person reads, and the path follows it', () => {
    const li = review([ISSUE]).querySelector('.atlas-import-issue-list li')!;
    expect(li.firstElementChild?.className).toBe('atlas-import-issue-line');
    expect(li.firstElementChild?.textContent).toBe(ISSUE.issue);
    expect(li.lastElementChild?.tagName).toBe('CODE');
    expect(li.lastElementChild?.textContent).toBe('Character[0].birth_date');
    expect(li.textContent!.indexOf(ISSUE.issue)).toBeLessThan(li.textContent!.indexOf(ISSUE.path));
  });
});

const NOTE_ELEMENT = 'A Pin\'s "element" is not read as its link, so that pin comes in with no element.';
const NOTE_OTHER_TYPE = 'A link that names an element of another type is removed too.';
const NOTE_NO_TYPE = 'A Pin with no "element_type" loses a link written as a name; one written as an id is kept, and its type is filled in when the import or the world holds that element.';

describe('the note under the review', () => {
  it('names the three cases by name', () => {
    const note = review([ISSUE]).querySelector('.atlas-import-issues-note')!.textContent!;
    expect(note).toContain(NOTE_ELEMENT);
    expect(note).toContain(NOTE_OTHER_TYPE);
    expect(note).toContain(NOTE_NO_TYPE);
  });

  const ADA = '068e5012-d77c-799d-8000-95548fbae78d';
  const plan = () => reconcile(parsePayload({
    Character: [{ id: ADA, name: 'Ada', birthplace: 'The Guild', friends: ['The Guild', 'Bea'] }, { name: 'Bea' }],
    Collective: [{ name: 'The Guild' }],
    Map: [{ name: 'Realm' }],
    Pin: [
      { name: 'By element', map: 'Realm', element: 'Ada' },
      { name: 'By name, no type', map: 'Realm', element_id: 'Ada' },
      { name: 'By id, no type', map: 'Realm', element_id: ADA },
      { name: 'By unknown id, no type', map: 'Realm', element_id: '068e5012-d77c-799d-8000-0000000000ff' },
    ],
  }), [], { genId: (() => { let n = 0; return () => `068e5012-d77c-799d-8000-${String(++n).padStart(12, '0')}`; })() });
  const pin = (name: string) => plan().creates.find(c => c.type === 'pin' && c.data.name === name)!.data;

  it('a Pin\'s "element" is not its link: the pin has no element', () => {
    const p = pin('By element');
    expect(p.element_id).toBeUndefined();
    expect(p.element_type).toBeUndefined();
    expect(p.element).toBeUndefined();
  });

  it('a link naming an element of another type is removed, and the element itself still comes in', () => {
    const ada = plan().creates.find(c => c.data.name === 'Ada')!.data;
    expect(ada.birthplace_id ?? ada.birthplace).toBeUndefined();
    expect((ada.friends as string[]).length).toBe(1);
    expect(plan().creates.some(c => c.type === 'collective' && c.data.name === 'The Guild')).toBe(true);
  });

  it('a Pin with no "element_type": a name is removed, an id is kept and typed when the import holds it', () => {
    expect(pin('By name, no type').element_id).toBeUndefined();
    expect(pin('By id, no type').element_id).toBe(ADA);
    expect(pin('By id, no type').element_type).toBe('character');
    expect(pin('By unknown id, no type').element_id).toBe('068e5012-d77c-799d-8000-0000000000ff');
    expect(pin('By unknown id, no type').element_type).toBeUndefined();
  });
});

describe('a missing link\'s expected value', () => {
  it('names the type as the editor does, by name or id', () => {
    const issues = validatePayload(parsePayload({ Character: [{ name: 'Ada', birthplace: 'Nowhere' }] }));
    const miss = issues.find(i => i.path === 'Character[0].birthplace')!;
    expect(miss.expected).toBe('An existing Location, by name or id, or include a Location named "Nowhere" in the import');
  });
});
