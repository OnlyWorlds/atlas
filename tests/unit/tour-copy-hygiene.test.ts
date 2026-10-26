/**
 * Tour copy hygiene: mechanical text defects that survive every eye
 * because they live at string-concatenation seams. Three of Skeld's launch
 * blockers were this class ("top,and", "is,as", a swallowed sentence break);
 * the survivor found live was ",the" in the yours-to-keep step. The scan
 * locks the CLASS across every body/meta/deeper string, so a future segment
 * join that drops its space fails loudly with the step and offending text
 * named.
 */
import { describe, it, expect } from 'vitest';
import { TOUR_STEPS } from '../../src/tour/tour-data';

interface CopyPiece {
  where: string;
  text: string;
}

function allCopy(): CopyPiece[] {
  const out: CopyPiece[] = [];
  for (const step of TOUR_STEPS) {
    for (const phase of step.phases) {
      out.push({ where: `${step.id}/${phase.id} body`, text: phase.body });
      if (phase.meta) out.push({ where: `${step.id}/${phase.id} meta`, text: phase.meta });
      if (phase.deeper) out.push({ where: `${step.id}/${phase.id} deeper`, text: phase.deeper });
      if (phase.touchBody) out.push({ where: `${step.id}/${phase.id} touchBody`, text: phase.touchBody });
      if (phase.touchDeeper) out.push({ where: `${step.id}/${phase.id} touchDeeper`, text: phase.touchDeeper });
    }
  }
  return out;
}

describe('tour copy hygiene', () => {
  it('no comma glued to the next word (concat-seam class)', () => {
    // ",word" — allow ",\n" and digits (numbers like 1,000 never appear, but
    // keep the check to letters so it cannot false-positive on them).
    const bad = allCopy().filter(p => /,[A-Za-z]/.test(p.text));
    expect(
      bad.map(p => `${p.where}: …${p.text.match(/.{0,30},[A-Za-z].{0,20}/)?.[0]}…`),
    ).toEqual([]);
  });

  it('no period glued to a following capital (lost sentence break class)', () => {
    // "word.Word" — markdown links contain ".com/..." etc, so restrict to
    // letter-period-capital and exempt url-ish contexts (no slashes/dots near).
    const bad = allCopy().filter(p => /[a-z]\.[A-Z]/.test(p.text.replace(/\[[^\]]*\]\([^)]*\)/g, 'LINK')));
    expect(
      bad.map(p => `${p.where}: …${p.text.match(/.{0,30}[a-z]\.[A-Z].{0,20}/)?.[0]}…`),
    ).toEqual([]);
  });

  it('no double spaces inside copy', () => {
    const bad = allCopy().filter(p => /[^\n] {2,}/.test(p.text));
    expect(
      bad.map(p => `${p.where}: …${p.text.match(/.{0,30} {2,}.{0,20}/)?.[0]}…`),
    ).toEqual([]);
  });
});
