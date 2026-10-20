/**
 * The landing doors must not RENAME themselves (S310).
 *
 * Both buttons on the welcome panel swap their label to a progress string
 * ("Picking…" / "Starting…") on click and restore it in a failure/cancel path.
 * Both restores used to hard-code a literal that had drifted from what the
 * markup renders:
 *
 *   rendered "set up a folder"   →  restored "Set up your OnlyWorlds folder"
 *   rendered "take the tour"     →  restored "Take the tour"
 *
 * So cancelling the folder picker — the single most likely thing to happen on
 * the first screen of the tool — silently renamed the door. This is a source
 * scan rather than a behaviour test because the failure mode is a STRING
 * RESTATED somewhere other than where it is rendered, which no render test
 * would catch until someone edited one of the two copies.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(__dirname, '../../src/middle/welcome-panel.ts'),
  'utf8',
);

describe('welcome-panel label restores', () => {
  it('restores captured labels, never restated literals', () => {
    // The restore assignments must read a captured variable.
    // (1.17: "set up a folder" left the landing, and its restore with it.)
    expect(source).toContain('tourBtn.textContent = tourLabel;');
  });

  it('does not hard-code a restore label that differs from the rendered one', () => {
    // These are the exact drifted literals that shipped. If either reappears
    // as an assignment, the rename bug is back.
    expect(source).not.toContain(`textContent = 'Set up your OnlyWorlds folder'`);
    expect(source).not.toContain(`textContent = 'Take the tour'`);
  });

  it('renders the door labels in sentence case (the Captain, h63 #8074: sentence case everywhere)', () => {
    for (const label of ["'Start a world'", "'Explore Moppetopia'", "'Open a world folder'", "'Other ways in'"]) expect(source).toContain(label);
  });

  it('the tour door has TWO labels, which is why capturing beats restating', () => {
    // `${tourDone ? 'replay the tour' : 'take the tour'}` — a hard-coded
    // restore could not be right for both, and the shipped one ("Take the
    // tour") was right for neither. A returning user who hit a launch error
    // would have watched "replay the tour" become "Take the tour".
    expect(source).toContain(`'Replay the tour'`);
    expect(source).toContain(`'Take the tour'`);
  });
});
