/**
 * Serial 126 (SDK 4.163.0): a room or charter mark that is an empty list or
 * an empty object is no mark. Atlas reads both marks only through the SDK
 * (`isRoomElement`, `isCharterElement`), so this pins that Atlas's own
 * wrappers follow: on 4.162.0 the empty forms counted as marked.
 */
import { describe, it, expect } from 'vitest';
import type { Element } from '../../src/core/types';
import { isRoomElement } from '../../src/core/parlor-room';
import { isMarkedCharter, isReadingAid } from '../../src/core/charter';

const charter = (mark: unknown): Element =>
  ({ id: 'c1', type: 'law', name: 'House rules', supertype: 'Charter', x_charter_of: mark } as unknown as Element);
const room = (mark: unknown): Element =>
  ({ id: 'r1', type: 'event', name: 'A sitting', supertype: 'Sitting', x_room_of: mark } as unknown as Element);

describe('an empty mark is no mark (serial 126)', () => {
  for (const [label, mark] of [['an empty list', []], ['an empty object', {}]] as const) {
    it(`a Charter whose mark is ${label} is not marked`, () => {
      expect(isMarkedCharter(charter(mark))).toBe(false);
      expect(isReadingAid(charter(mark))).toBe(false);
    });
    it(`a room element whose mark is ${label} is lore`, () => {
      expect(isRoomElement(room(mark))).toBe(false);
    });
  }

  it('a real mark still counts (the control)', () => {
    expect(isMarkedCharter(charter('w1'))).toBe(true);
    expect(isRoomElement(room('w1'))).toBe(true);
  });
});
