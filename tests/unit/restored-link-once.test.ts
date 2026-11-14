/**
 * restoredLinkPatch builds a list when the copy's own edits differ from keel's:
 * the copy's list, then the restored ids it lacks. Each element once (folder
 * format 0.3.24), even when keel's list, from before it kept each once, names
 * a restored id twice.
 */
import { describe, it, expect } from 'vitest';
import { restoredLinkPatch } from '../../src/store/scrub-links';
import type { Element } from '../../src/core/types';

const K = '00000000-0000-4000-8000-0000000000c1';
const X = '00000000-0000-4000-8000-0000000000c2';
const Y = '00000000-0000-4000-8000-0000000000c3';
const ch = (friends: string[]): Element => ({ id: '00000000-0000-4000-8000-0000000000a1', type: 'character', name: 'Ann', friends }) as unknown as Element;

describe('restoredLinkPatch: each element once', () => {
  it('a restored id keel names twice is appended once', () => {
    const patch = restoredLinkPatch(ch([X, Y]), ch([K, K, X]), new Set([K]));
    expect(patch).toEqual({ friends: [X, Y, K] });
  });

  it('where the rest agrees, keel\'s list comes back as served', () => {
    const patch = restoredLinkPatch(ch([X]), ch([K, K, X]), new Set([K]));
    expect(patch).toEqual({ friends: [K, K, X] });
  });
});
