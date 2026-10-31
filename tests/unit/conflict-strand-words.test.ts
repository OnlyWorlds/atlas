/**
 * The conflict review's words for a contested strand (the contract's S9; the code gate's C8): the row is
 * named "The world's strand", and each side by the story its mark names.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { patchSlice } from '../../src/core/state';
import type { Element } from '../../src/core/types';
import { metaFieldWord, strandStoryWord } from '../../src/ui/conflict-review-modal';

afterEach(() => patchSlice('data', { elements: [] } as never));

describe('the strand in the conflict review', () => {
  it('names the key in words, and leaves any other key as it is', () => {
    expect(metaFieldWord('x_strand')).toBe("The world's strand");
    expect(metaFieldWord('x_names')).toBe("The world's words for the types");
    expect(metaFieldWord('x_other')).toBe('x_other');
  });

  it('names each side by its story: one this copy holds, one it does not, and none', () => {
    patchSlice('data', { elements: [{ id: 'n1', type: 'narrative', name: ' The Long Road ' } as unknown as Element] } as never);
    expect(strandStoryWord({ narrative: 'n1', event: null, location: null })).toBe('The Long Road');
    expect(strandStoryWord({ narrative: 'n9', event: null, location: null })).toBe('a story not in this copy');
    expect(strandStoryWord(undefined)).toBe('no strand');
    expect(strandStoryWord('n1')).toBe('no strand');
  });
});
