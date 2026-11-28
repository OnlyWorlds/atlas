/**
 * A standard field the schema types `integer` takes a whole number only:
 * OnlyWorlds answers 2.5 with a 200 and stores 2, so the folder and the
 * online world would differ with no word said. Both editors refuse it with a
 * sentence and write nothing; a field with no such type keeps any number.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openFieldEditPopover, WHOLE_NUMBER_POINTER } from '../../src/ui/field-edit-popover';
import { openFieldEditInline } from '../../src/ui/field-edit-inline';
import { isIntegerField } from '../../src/editor/field-schema';

const enter = (target: Element) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

function popover(whole: boolean | undefined, typed: string) {
  const anchor = document.createElement('div');
  document.body.appendChild(anchor);
  const onSave = vi.fn();
  openFieldEditPopover({ anchor, label: 'Birth date', value: '7', widget: 'number', ...(whole === undefined ? {} : { whole }), onSave });
  const input = document.querySelector<HTMLInputElement>('.atlas-edit-popover input')!;
  input.value = typed;
  enter(input);
  return { onSave, error: () => document.querySelector('.atlas-edit-popover-error')?.textContent ?? '' };
}

function inline(whole: boolean | undefined, typed: string) {
  const anchor = document.createElement('div');
  anchor.className = 'atlas-field-value';
  document.body.appendChild(anchor);
  const onSave = vi.fn();
  const onCancel = vi.fn();
  openFieldEditInline({ anchor, value: '7', widget: 'number', mode: 'single', ...(whole === undefined ? {} : { whole }), onSave, onCancel });
  const input = document.querySelector<HTMLInputElement>('.atlas-field-inline-input')!;
  input.value = typed;
  enter(input);
  return { onSave, onCancel };
}

describe('a whole number in an integer field', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.body.innerHTML = '';
  });

  it('the schema says which fields are integer', () => {
    expect(isIntegerField('character', 'birth_date')).toBe(true);
    expect(isIntegerField('pin', 'x')).toBe(true);
    expect(isIntegerField('character', 'name')).toBe(false);
    expect(isIntegerField('character', 'x_power')).toBe(false);
  });

  it('the popover refuses 2.5 with a sentence and writes nothing; 12 is written', () => {
    const half = popover(true, '2.5');
    expect(half.onSave).not.toHaveBeenCalled();
    expect(half.error()).toBe(WHOLE_NUMBER_POINTER);
    document.body.innerHTML = '';
    const twelve = popover(true, '12');
    expect(twelve.onSave).toHaveBeenCalledWith(12);
  });

  it('the popover without whole keeps any number, as a custom field does', () => {
    expect(popover(undefined, '2.5').onSave).toHaveBeenCalledWith(2.5);
  });

  it('the inline editor refuses 2.5 and keeps the old value; 12 is written', () => {
    const half = inline(true, '2.5');
    expect(half.onSave).not.toHaveBeenCalled();
    expect(half.onCancel).toHaveBeenCalled();
    document.body.innerHTML = '';
    expect(inline(true, '12').onSave).toHaveBeenCalledWith(12);
    document.body.innerHTML = '';
    expect(inline(false, '2.5').onSave).toHaveBeenCalledWith(2.5);
  });
});
