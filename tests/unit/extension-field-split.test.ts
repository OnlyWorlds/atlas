/**
 * atlas-extension field split — constants lock (gate 10.3, v2 port).
 *
 * ATLAS_LOCAL_EXTENSION_FIELDS used to be the single strip/preserve list.
 * It's now the concatenation of two lists with different pull semantics
 * (see core/constants.ts policy comment): ATLAS_LOCAL_ONLY_FIELDS (always
 * preserved from local) and ATLAS_WIRE_EXTENSION_FIELDS (server wins when
 * present). This locks the shape of that split so a future edit to either
 * list forces a conscious look here instead of silently drifting.
 */

import { describe, it, expect } from 'vitest';
import {
  ATLAS_LOCAL_ONLY_FIELDS,
  ATLAS_WIRE_EXTENSION_FIELDS,
  ATLAS_LOCAL_EXTENSION_FIELDS,
} from '../../src/core/constants';

describe('atlas-extension field split (gate 10.3)', () => {
  it('ATLAS_LOCAL_EXTENSION_FIELDS is exactly LOCAL_ONLY followed by WIRE', () => {
    expect(ATLAS_LOCAL_EXTENSION_FIELDS).toEqual([
      ...ATLAS_LOCAL_ONLY_FIELDS,
      ...ATLAS_WIRE_EXTENSION_FIELDS,
    ]);
  });

  it('the two split lists are disjoint', () => {
    const localOnly = new Set<string>(ATLAS_LOCAL_ONLY_FIELDS);
    const overlap = ATLAS_WIRE_EXTENSION_FIELDS.filter(field => localOnly.has(field));
    expect(overlap).toEqual([]);
  });

  it('the WIRE list is exactly the four zone visual extension fields', () => {
    expect([...ATLAS_WIRE_EXTENSION_FIELDS].sort()).toEqual(
      ['atlas_color', 'atlas_label_visible', 'atlas_opacity', 'atlas_shape'].sort()
    );
  });
});
