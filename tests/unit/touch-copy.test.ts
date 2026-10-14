/**
 * #279: on a touch screen, no help line or tour step names a key, a
 * right-click, hover, dragging or dropping; with a mouse, the copy is as it
 * was. The touch side resolves every help room and every tour phase through
 * the same functions the overlay and the dock call.
 */
import { describe, expect, it } from 'vitest';
import { HELP_CONTENT, helpForRoom } from '../../src/ui/help-content';
import { TOUR_STEPS } from '../../src/tour/tour-data';
import { phaseCopy } from '../../src/tour/tour-view';

// A gesture only a mouse or a keyboard makes. "hovering over) the planet" is the
// Consul's story, not a gesture, so the word itself is matched, not its stem.
const MOUSE_OR_KEY = /right-?click|\bdrag|\bdrop\b|\bctrl\b|⌘|shift\s*\+|\bhover\b|\benter\b|\besc\b|double-click|\bscroll to\b|↑|↓/i;
// The Tab key, not the Web tab or the OnlyWorlds tab.
const TAB_KEY = /\bTAB\b|\bTab to\b|\+ ?Tab\b/;
const namesMouseOrKey = (text: string): boolean => MOUSE_OR_KEY.test(text) || TAB_KEY.test(text);

describe('help on a touch screen', () => {
  for (const mode of Object.keys(HELP_CONTENT)) {
    it(`${mode}: no line names a mouse or key gesture`, () => {
      const help = helpForRoom(mode, true)!;
      const bad = help.can.filter(namesMouseOrKey);
      expect(bad).toEqual([]);
      expect(help.can.length).toBeGreaterThan(0);
    });
  }

  it('with a mouse, every line is the one written for the mouse', () => {
    for (const [mode, raw] of Object.entries(HELP_CONTENT)) {
      const shown = helpForRoom(mode, false)!.can;
      const written = raw.can.map(l => (typeof l === 'string' ? l : l.mouse));
      expect(shown).toEqual(written);
    }
  });
});

describe('the tour on a touch screen', () => {
  for (const step of TOUR_STEPS) {
    for (const phase of step.phases) {
      it(`${step.id}/${phase.id}: body and more information name no mouse or key gesture`, () => {
        const { body, deeper } = phaseCopy(phase, true);
        expect(namesMouseOrKey(body), body).toBe(false);
        if (deeper) expect(namesMouseOrKey(deeper), deeper).toBe(false);
      });
    }
  }

  it('with a mouse, every phase reads as written', () => {
    for (const step of TOUR_STEPS) {
      for (const phase of step.phases) {
        expect(phaseCopy(phase, false)).toEqual({ body: phase.body, deeper: phase.deeper });
      }
    }
  });
});
