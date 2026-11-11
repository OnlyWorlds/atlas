/**
 * A message's words are its story: on a message's page the story row stands right after the
 * description, in the page's head (the views file's message row; the message profile).
 */
import { describe, expect, it } from 'vitest';
import { sectionsFor, withMessageLead } from '../../src/editor/field-schema';

const names = (s: ReturnType<typeof sectionsFor>) => s.map(x => [x.name, x.fields.map(f => f.name)] as const);

describe('withMessageLead', () => {
  it('moves story right after description in Base, and nowhere else', () => {
    const plain = sectionsFor('narrative');
    const led = withMessageLead(plain);
    const base = led.find(s => s.name === 'Base')!.fields.map(f => f.name);
    expect(base.slice(0, 3)).toEqual(['name', 'description', 'story']);
    expect(led.flatMap(s => s.fields.map(f => f.name)).filter(n => n === 'story')).toHaveLength(1);
    // Every other row keeps its place: removing story from both gives the same layout.
    const without = (s: ReturnType<typeof sectionsFor>) =>
      names(s).map(([n, f]) => [n, f.filter(x => x !== 'story')] as const).filter(([, f]) => f.length > 0);
    expect(without(led)).toEqual(without(plain));
    // The row keeps its widget.
    expect(led[0].fields.find(f => f.name === 'story')!.widget).toBe(plain.flatMap(s => s.fields).find(f => f.name === 'story')!.widget);
  });

  it('leaves a layout with no story unchanged', () => {
    const character = sectionsFor('character');
    expect(withMessageLead(character)).toBe(character);
  });

  it('puts story first when the description row was filtered out', () => {
    const noDesc = sectionsFor('narrative').map(s => s.name === 'Base' ? { ...s, fields: s.fields.filter(f => f.name !== 'description') } : s);
    expect(withMessageLead(noDesc)[0].fields[0].name).not.toBe('description');
    expect(withMessageLead(noDesc)[0].fields.map(f => f.name)).toContain('story');
  });
});
