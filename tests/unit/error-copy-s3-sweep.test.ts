/**
 * S369 error-copy sweep, builder S3 (writing, knowledge, pages, charts,
 * import, context pane): the behaviour changes that are more than wording.
 *
 *   - pasted JSON says WHERE it broke, never the engine's message;
 *   - the aliases modal says why it stayed open (it was silent);
 *   - the writing-create modal words a failure, never `err.message`;
 *   - the Potentials empty line says what potentials are.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { jsonErrorWhere, CLIPBOARD_BLOCKED } from '../../src/middle/import-room';
import { AliasesEditModal } from '../../src/ui/aliases-edit-modal';
import { WritingCreateModal } from '../../src/ui/writing-create-modal';
import { mountContextLists } from '../../src/tabs/right/context-pane-lists';
import { PlainError } from '../../src/core/plain-error';
import { markProblemShown } from '../../src/core/problems';
import type { Element } from '../../src/core/types';

const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('jsonErrorWhere: the place, never the message', () => {
  const text = '{\n  "a": 1\n  "b": 2\n}';

  it('turns a V8 position into a line and column', () => {
    const err = new SyntaxError(`Expected ',' or '}' after property value in JSON at position 13`);
    expect(jsonErrorWhere(text, err)).toBe(' near line 3, column 3');
  });

  it('uses a line and column the engine already gave (Firefox, newer V8)', () => {
    const ff = new SyntaxError('JSON.parse: expected \',\' or \'}\' after property value in object at line 3 column 3 of the JSON data');
    expect(jsonErrorWhere(text, ff)).toBe(' near line 3, column 3');
    const v8 = new SyntaxError(`Expected ',' or '}' after property value in JSON at position 13 (line 3 column 3)`);
    expect(jsonErrorWhere(text, v8)).toBe(' near line 3, column 3');
  });

  it('says nothing when the browser gave no place, or the error is not a parse error', () => {
    expect(jsonErrorWhere(text, new SyntaxError('JSON Parse error: Unexpected identifier "b"'))).toBe('');
    expect(jsonErrorWhere(text, new Error('at position 4'))).toBe('');
    expect(jsonErrorWhere(text, 'nope')).toBe('');
  });

  it('the real parse error of this browser gives a place or nothing, and never its own words', () => {
    let err: unknown;
    try { JSON.parse(text); } catch (e) { err = e; }
    const where = jsonErrorWhere(text, err);
    expect(where === '' || /^ near line \d+, column \d+$/.test(where)).toBe(true);
  });

  it('the clipboard sentence is plain copy', () => {
    expect(CLIPBOARD_BLOCKED).not.toMatch(/—|console|NotAllowed|permission to change/);
  });
});

describe('aliases modal: a failed save says so and stays open', () => {
  const open = (onSave: () => Promise<void>) => {
    new AliasesEditModal({ elementName: 'Ada', current: ['the Countess'], onSave }).open();
    document.querySelector<HTMLButtonElement>('[data-modal="aliases-edit"] [data-role="save"]')!.click();
  };
  const errorLine = () => document.querySelector<HTMLElement>('[data-modal="aliases-edit"] [data-role="error"]')!;

  it('words an unexpected failure, without the raw text', async () => {
    open(() => Promise.reject(new DOMException('raw browser words', 'InvalidModificationError')));
    await flush();
    expect(document.querySelector('[data-modal="aliases-edit"]')).not.toBeNull();
    expect(errorLine().hidden).toBe(false);
    expect(errorLine().textContent).toContain('saving the aliases');
    expect(errorLine().textContent).not.toContain('raw browser words');
  });

  it('only says what it means here when the caller already toasted the reason', async () => {
    const err = new Error('raw');
    markProblemShown(err);
    open(() => Promise.reject(err));
    await flush();
    expect(errorLine().textContent).toBe('The aliases were not saved. Your rows are still here, so you can save again.');
  });

  it('closes on success', async () => {
    open(() => Promise.resolve());
    await flush();
    expect(document.querySelector('[data-modal="aliases-edit"]')).toBeNull();
  });
});

describe('writing-create modal: an inline worded line', () => {
  it('a refusal passes through; anything else is worded', async () => {
    new WritingCreateModal({ label: 'Book', onCreate: () => Promise.reject(new PlainError('This world is not open. Open it from the sidebar, then try again.')) }).open();
    document.querySelector<HTMLButtonElement>('[data-modal="writing-create"] [data-action="create"]')!.click();
    await flush();
    const line = document.querySelector<HTMLElement>('[data-modal="writing-create"] [data-role="error"]')!;
    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe('This world is not open. Open it from the sidebar, then try again.');

    document.body.innerHTML = '';
    new WritingCreateModal({ label: 'Book', onCreate: () => Promise.reject(new TypeError('x is undefined')) }).open();
    document.querySelector<HTMLButtonElement>('[data-modal="writing-create"] [data-action="create"]')!.click();
    await flush();
    const line2 = document.querySelector<HTMLElement>('[data-modal="writing-create"] [data-role="error"]')!;
    expect(line2.textContent).toContain('creating the narrative');
    expect(line2.textContent).not.toContain('x is undefined');
  });
});

describe('context pane Potentials', () => {
  it('the header says potentials are names in the text and links in the world (#24)', () => {
    const host = document.createElement('div');
    const narrative = { id: 'n1', type: 'narrative', name: 'Scene one' } as unknown as Element;
    mountContextLists({ host, narrative, onSelect: () => {} });
    const empty = host.querySelector('.atlas-context-pane-list-suggested .atlas-context-pane-empty')!;
    expect(empty.textContent).toBe('No potentials yet.');
    const header = host.querySelector<HTMLElement>('.atlas-context-pane-list-suggested .atlas-context-pane-list-header')!;
    expect(header.title).toMatch(/names but does not link/);
    expect(header.title).toMatch(/linked to your cast/);
  });
});
