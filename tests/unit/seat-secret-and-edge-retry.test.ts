/**
 * The two changes riding 1.17, guarded.
 *
 * - The PIN prompt takes the four-digit account PIN and names a seat secret
 *   (`ow_s_`, keel accounts/agents.py) to refuse it; it refuses
 *   anything else with its line.
 * - The map edge colour retries a failed http(s) read once under
 *   `atlas-pixels=1`, past the header-less copy the overlay's plain <img>
 *   cached (media.onlyworlds.com, Boss 2026-10-09); other schemes never retry.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PinPromptModal } from '../../src/ui/pin-prompt-modal';
import { extractEdgeColor } from '../../src/tabs/right/edge-color';

const SECRET = 'ow_s_' + 'aB3-_x'.repeat(5) + 'Zq'; // 32 after the prefix

function submit(value: string): void {
  const input = document.querySelector<HTMLInputElement>('input[name="pin"]')!;
  input.value = value;
  document.querySelector('form[data-form="pin-prompt"]')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

// The prompt's one caller asks for the ACCOUNT PIN, saved for every
// account world; a seat secret there became `registry.pin` (an R1 breach the
// gate found), so the prompt now names a seat secret and refuses it.
describe('the PIN prompt takes the account PIN, never a seat secret', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it.each([['1234'], [' 1234 ']])('accepts %j', async (value) => {
    const p = new PinPromptModal().prompt('Opening the world.');
    submit(value);
    expect(await p).toBe(value.trim());
  });

  async function refused(value: string): Promise<string | null> {
    const p = new PinPromptModal().prompt('Opening the world.');
    submit(value);
    const err = document.querySelector<HTMLElement>('[data-role="error"]')!;
    expect(err.hidden).toBe(false);
    const line = err.textContent;
    document.querySelector<HTMLElement>('[data-action="cancel"]')!.click();
    expect(await p).toBeNull();
    return line;
  }

  it.each([[SECRET], [`  ${SECRET}  `]])('refuses the seat secret %j by name', async (value) => {
    expect(await refused(value)).toBe('That is a seat secret, which opens one world. Here Atlas needs your account PIN: four digits.');
  });

  it.each([['12345'], ['abcd'], ['ow_s_short'], ['ow_x_' + 'a'.repeat(32)], ['ow_s_' + 'a'.repeat(31) + '!']])(
    'refuses %j with its line', async (value) => {
      expect(await refused(value)).toBe('The PIN is four digits.');
    });

  it('lets a whole secret into the field, so it is named rather than cut', async () => {
    const p = new PinPromptModal().prompt('Opening the world.');
    const input = document.querySelector<HTMLInputElement>('input[name="pin"]')!;
    expect(input.maxLength).toBeGreaterThanOrEqual(SECRET.length);
    expect(input.getAttribute('inputmode')).toBeNull();
    document.querySelector<HTMLElement>('[data-action="cancel"]')!.click();
    expect(await p).toBeNull();
  });
});

describe('the edge colour retries once past a cached header-less copy', () => {
  const RealImage = globalThis.Image;
  let srcs: string[];
  let failFirst: number;

  beforeEach(() => {
    srcs = [];
    failFirst = 0;
    class FakeImage {
      crossOrigin: string | null = null;
      src = '';
      naturalWidth = 0; // under 8: extractEdgeColor stops before any canvas
      naturalHeight = 0;
      decode(): Promise<void> {
        srcs.push(this.src);
        return srcs.length <= failFirst ? Promise.reject(new Error('cors')) : Promise.resolve();
      }
    }
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(console, 'warn').mockImplementation(() => {}); // the expected "extraction failed"
  });
  afterEach(() => { vi.stubGlobal('Image', RealImage); vi.restoreAllMocks(); });

  it('a failed https read tries again under atlas-pixels=1', async () => {
    failFirst = 1;
    await extractEdgeColor('https://media.onlyworlds.com/maps/space.webp');
    expect(srcs).toEqual([
      'https://media.onlyworlds.com/maps/space.webp',
      'https://media.onlyworlds.com/maps/space.webp?atlas-pixels=1',
    ]);
  });

  it('a url with a query joins it with &', async () => {
    failFirst = 1;
    await extractEdgeColor('https://example.com/m.png?v=2');
    expect(srcs[1]).toBe('https://example.com/m.png?v=2&atlas-pixels=1');
  });

  it('a read that works the first time loads once', async () => {
    await extractEdgeColor('https://example.com/m.png');
    expect(srcs).toEqual(['https://example.com/m.png']);
  });

  it('retries only once, and returns null when both fail', async () => {
    failFirst = 5;
    expect(await extractEdgeColor('https://example.com/m.png')).toBeNull();
    expect(srcs).toHaveLength(2);
  });

  it.each([['blob:http://localhost/abc'], ['data:image/png;base64,AAAA']])('never retries %s', async (url) => {
    failFirst = 5;
    expect(await extractEdgeColor(url)).toBeNull();
    expect(srcs).toEqual([url]);
  });
});
