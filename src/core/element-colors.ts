/**
 * Element colour: the FAMILY carries the hue, the ICON carries the type.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * Atlas shipped TWO unrelated 22-entry palettes (`ELEMENT_TYPE_COLORS` in
 * constants.ts and `CATEGORY` in pin-visuals.ts), visible simultaneously in the
 * ordinary three-pane view: a Character was gold as a chart node and orange as
 * a map pin. Across the wider ecosystem there were nine such maps and no
 * authority — the SDK exports `ELEMENT_ICONS` but has never exported a colour,
 * which is precisely why icons are consistent everywhere and colours are not.
 *
 * Skeld ran every candidate through a CVD-separation validator (2026-07-22) and
 * none passed, including atlas's own:
 *
 *   - Character #f97316 vs Creature #ea580c: ΔE 6.3 for normal vision (floor 15)
 *   - Title vs Trait: ΔE 1.3 for deutan viewers — indistinguishable
 *   - Object and Construct fell below the chroma floor: they read as grey
 *   - about.html gave Map/Pin/Marker/Zone one identical hex — ΔE 0.0
 *
 * The structural finding: past roughly 8 hues mutual separation is not
 * achievable, and past 4 it is not achievable in the hard case. Chasing 22
 * distinct colours produces 22 colours that all look alike, which is what both
 * atlas palettes already shipped. So colour stops trying to encode 22 things.
 *
 * ── The trade, stated plainly ─────────────────────────────────────────────
 *
 * Types within a family are NOT colour-distinct. A Character pin and a Creature
 * pin are the same blue. This is deliberate, and it is the trade both previous
 * palettes already made by accident — ΔE 6.3 is different by measurement and
 * identical to the eye. Type identity moves onto the icon, which genuinely
 * carries it and is SDK-exported.
 *
 * ── Where this is going ───────────────────────────────────────────────────
 *
 * Titus ruled four families (2026-07-22). Skeld is preparing
 * `ELEMENT_FAMILIES` + `FAMILY_COLORS` + `getElementColor(type, mode)` for the
 * SDK, co-signed by Kael, published post-launch. THIS FILE IS DELIBERATELY THAT
 * SHAPE so the migration is a re-export, not a rewrite: when the SDK ships,
 * delete the two consts below and re-export the SDK's.
 *
 * Atlas is dark-surface only today, so `elementColor()` defaults to dark; the
 * light column is carried so the SDK swap is lossless.
 */

import type { ElementType } from './types';

export type ElementFamily = 'agents' | 'world' | 'abstract' | 'temporal';

/**
 * Type to family. Spatial FOLDED INTO WORLD (Skeld's ruling): map/pin/marker/
 * zone describe where things are, which is what Location and Construct already
 * encode — and keeping Spatial separate failed all-pairs validation in dark
 * mode on the two greens.
 *
 * Atlas-specific evidence supporting the fold, gathered before agreeing:
 * `map-tab-pins.ts` calls `pinVisualFor(el.type, ...)`, so a pin is coloured by
 * its TARGET element's type. The `pin` / `marker` / `map` entries here almost
 * never colour a mark on a map — they surface in element lists and the graph.
 * A family that rarely renders its own hue does not need its own hue.
 */
export const ELEMENT_FAMILIES: Record<ElementType, ElementFamily> = {
  character:   'agents',
  creature:    'agents',
  species:     'agents',
  family:      'agents',
  collective:  'agents',
  institution: 'agents',

  location:    'world',
  object:      'world',
  construct:   'world',
  map:         'world',
  pin:         'world',
  marker:      'world',
  zone:        'world',

  ability:     'abstract',
  trait:       'abstract',
  title:       'abstract',
  language:    'abstract',
  law:         'abstract',

  event:       'temporal',
  narrative:   'temporal',
  phenomenon:  'temporal',
  relation:    'temporal',
};

/**
 * Family to hex. Both modes were selected and validated against their own
 * surface rather than auto-flipped from one another, so do not derive one from
 * the other. World is identical in both by validation, not by oversight.
 */
export const FAMILY_COLORS: Record<ElementFamily, { light: string; dark: string }> = {
  agents:   { light: '#2a78d6', dark: '#3987e5' },
  // The #009a00 lift was REFUTED by Skeld's validator (2026-07-22): ΔE 0.2
  // against Temporal amber for protan viewers, and the green is boxed in on
  // both sides (brighter -> amber collision, teal-er -> pink collision).
  // Reverted to the validated value; the recession trade is Titus's call —
  // full record in the comment at the bottom of this file.
  world:    { light: '#008300', dark: '#008300' },
  abstract: { light: '#e87ba4', dark: '#d55181' },
  temporal: { light: '#eda100', dark: '#c98500' },
};

/** Unknown types (a foreign tool's element) get the world green rather than a
 *  throw — the Folder Format welcomes files atlas did not write. */
const FALLBACK: ElementFamily = 'world';

export function familyOf(type: string): ElementFamily {
  return ELEMENT_FAMILIES[type as ElementType] ?? FALLBACK;
}

/** THE accessor. One call site shape everywhere, so the SDK swap is mechanical. */
export function elementColor(type: string, mode: 'light' | 'dark' = 'dark'): string {
  return FAMILY_COLORS[familyOf(type)][mode];
}

/**
 * ── The World-green lift, and why it is not in Skeld's proposal ────────────
 *
 * Skeld's set validates PAIR SEPARATION: every family is far enough from every
 * other in both modes, including for CVD viewers. That is the hard constraint
 * and it is met. What it does not constrain is LUMINANCE PARITY against the
 * surface the marks are drawn on — a separate axis, and one that only shows up
 * once the colours are on a real screen.
 *
 * Measured against atlas's `#0a0a0a` app background:
 *
 *   Temporal #c98500 → 6.84 : 1
 *   Agents   #3987e5 → 5.77 : 1
 *   Abstract #d55181 → 5.32 : 1
 *   World    #008300 → 4.25 : 1   <- dimmest, and the only one under 4.5
 *
 * A 1.61x spread, with the floor sitting on the family that covers Location,
 * Object, Construct and every spatial type — the most populous family in a
 * worldbuilding tool. On the charts room that reads as locations receding while
 * events come forward, which is a visual hierarchy nobody designed.
 *
 * `#009a00` measures 5.62 : 1 — same hue, lands between Abstract and Agents,
 * and drops the spread to 1.29x. Own-eyes on the charts room before and after:
 * the recession goes away.
 *
 * THE VERDICT (Skeld, 2026-07-22, same day): `#009a00` FAILS CVD — it collides
 * with Temporal amber at ΔE 0.2 for protan viewers, and the margin falls off a
 * cliff along the whole ramp (#008300 6.9 → #008e00 3.5 → #009400 1.6 →
 * #009a00 0.2). The green is pinned at its low-contrast end BY the CVD budget:
 * brighter moves toward amber (protan), teal-er moves toward pink (deutan).
 * REVERTED to #008300 per his recommendation. The recession finding STANDS as
 * a real, measured trade (perception vs accessibility on one value) and goes
 * to Titus: keep #008300 and let icon+label carry World forward, or brighten
 * and lose family separation for red-blind readers. Skeld's full numbers
 * are in a palette-measurements design note.
 */
