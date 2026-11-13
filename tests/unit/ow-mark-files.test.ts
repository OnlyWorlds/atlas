/**
 * Atlas's own OnlyWorlds mark is three raster files in `public/`: `owlogo.png`
 * (512, the footer button, the welcome panel's hover line and the installed
 * app's icon), `favicon.png` (72) and `favicon.ico` (16, 32, 48). Since 1.124.0
 * they are the true-curves globe, the same drawing as the SDK's Waymark mark
 * (exact arcs for the ring, the parallels, the meridians and the W, in place of
 * the old traced outline), rendered in the brand ink #37c1f0 on transparency.
 * The bytes are pinned so a swap back to the traced drawing, or a redraw, is a
 * decision; the sizes are pinned because every place that shows them sizes to them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const pub = (name: string): Buffer => readFileSync(resolve(__dirname, '../../public', name));
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const pngSize = (b: Buffer): [number, number] => [b.readUInt32BE(16), b.readUInt32BE(20)];

describe('the OnlyWorlds mark Atlas ships', () => {
  it('is the true-curves drawing, byte for byte', () => {
    expect(sha(pub('owlogo.png'))).toBe('4c73635eba785599a2272e69ed8a7bddb5df148b7f2d6b39dec527d3b597f392');
    expect(sha(pub('favicon.png'))).toBe('53a064b3c83dfc556c397801cb3912b78fc67891a650e09d1c87afca3e437e28');
    expect(sha(pub('favicon.ico'))).toBe('af727549631cb171c67cddbc82011388e519156fdf3f6ceb7635771cb0ecc226');
  });

  it('keeps its sizes', () => {
    expect(pngSize(pub('owlogo.png'))).toEqual([512, 512]);
    expect(pngSize(pub('favicon.png'))).toEqual([72, 72]);
    const ico = pub('favicon.ico');
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16] || 256).sort((a, b) => a - b);
    expect(sizes).toEqual([16, 32, 48]);
  });
});
