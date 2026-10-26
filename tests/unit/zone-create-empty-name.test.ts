/**
 * Zone create modal, empty name: Create with an empty name used to
 * do nothing and say nothing. It now says "Name is required", the same rule
 * and words as the element create modal, and the line clears on typing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { openZoneCreateModal } from '../../src/ui/zone-create-modal';

describe('zone create modal: empty name', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('says the name is required, clears on typing, then creates', async () => {
    const result = openZoneCreateModal({ shape: 'polygon', defaultName: '' });
    const name = document.querySelector<HTMLInputElement>('[data-role="zone-create-name"]')!;
    const error = document.querySelector<HTMLElement>('[data-role="zone-create-error"]')!;
    const create = document.querySelector<HTMLButtonElement>('[data-action="create"]')!;

    expect(error.hidden).toBe(true);
    create.click();
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('Name is required');
    expect(document.querySelector('[data-modal="zone-create"]')).not.toBeNull();

    name.value = 'North march';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    expect(error.hidden).toBe(true);

    create.click();
    await expect(result).resolves.toEqual({ name: 'North march', supertype: undefined, subtype: undefined });
  });
});
