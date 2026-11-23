/**
 * A reply pasted with its code blocks. A `~~~` fence is read as a backtick fence is. With more than one
 * block, the one block that parses as JSON is read; when none or several do, the review says so in one
 * line, never a missing comma. The reader stays linear in the text's length.
 */
import { describe, it, expect } from 'vitest';
import { jsonTextOf, parsePayload } from '../../src/import/parse';
import { jsonFaultLine } from '../../src/middle/import-room';

const body = '{"Character": [{"name": "Aralia"}]}';
const loads = (t: string) => parsePayload(JSON.parse(jsonTextOf(t))).ok;
const SEVERAL = 'The reply holds more than one code block, and Atlas cannot tell which one is the world. Paste only the JSON.';

/** The line the review shows for text that does not parse, as the pasted box says it. */
const faultOf = (pasted: string): string => {
  const text = jsonTextOf(pasted);
  try { JSON.parse(text); } catch (err) { return jsonFaultLine('Not valid JSON', text, err); }
  return '';
};

describe('a ~~~ fence', () => {
  it('is read as a backtick fence is', () => {
    expect(loads('~~~json\n' + body + '\n~~~')).toBe(true);
    expect(loads('~~~\r\n' + body + '\r\n~~~\r\n')).toBe(true);
    expect(loads('Here is your world:\n\n~~~json\n' + body + '\n~~~\n\nMore?')).toBe(true);
  });

  it('a fault inside it is reported at its line in the pasted text', () => {
    expect(faultOf('Sure:\n~~~json\n{\n  "Character": [{"name": "A",}]\n}\n~~~')).toMatch(/line 4/);
  });

  it('closes only on its own mark: a backtick fence inside it is its text', () => {
    const inner = '{"Character": [{"name": "A", "description": "```"}]}';
    expect(jsonTextOf('~~~json\n' + inner + '\n~~~')).toBe('\n' + inner + '\n');
  });
});

describe('more than one code block', () => {
  it('reads the one block that parses as JSON', () => {
    expect(loads('```json\n' + body + '\n```\nand\n```\nmore\n```')).toBe(true);
    expect(loads('```bash\nnpm i\n```\n\n~~~json\n' + body + '\n~~~')).toBe(true);
    // A mark left open after the world is a block that does not parse.
    expect(loads('```json\n' + body + '\n```\n\n```')).toBe(true);
  });

  it('keeps a fault\'s line the pasted text\'s own when it reads one block', () => {
    const pasted = 'A:\n```\nnot json\n```\nB:\n```json\n' + body + '\n```';
    const read = jsonTextOf(pasted);
    const linesBefore = (t: string) => t.slice(0, t.indexOf('{')).split('\n').length;
    expect(read.trim()).toBe(body);
    expect(linesBefore(read)).toBe(linesBefore(pasted));
  });

  it('says so in one line when none or several parse', () => {
    expect(faultOf('```json\n' + body + '\n```\nand\n```json\n' + body + '\n```')).toBe(SEVERAL);
    expect(faultOf('```\nnot json\n```\n~~~\nnor this\n~~~')).toBe(SEVERAL);
  });

  it('one block that does not parse, or one never closed, keeps its own words', () => {
    expect(faultOf('```json\n{"Character": [{"name": "A",}]}\n```')).toMatch(/^Not valid JSON near line 2, column \d+\. Check for a missing comma, quote, or bracket\.$/);
    expect(faultOf('```json\n' + body)).toContain('code block marks');
  });
});

describe('the reader stays linear in the text\'s length', () => {
  it('a large paste of many fences', () => {
    const many = ('```json\n' + body + '\n```\n').repeat(50_000);
    const mixed = '```\nx\n```\n~~~\ny\n~~~\n'.repeat(50_000);
    const marks = '```\n~~~\n'.repeat(200_000);
    const t0 = performance.now();
    expect(jsonTextOf(many)).toBe(many);
    expect(jsonTextOf(mixed)).toBe(mixed);
    jsonTextOf(marks);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
