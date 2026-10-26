/**
 * Legacy time-field seed (2B design §1): `time_format_names` /
 * `time_format_equivalents` are read ONCE to offer minting a world's first
 * calendar, then cleared on the world ("seed once" lives in the data, not in
 * client memory — Skeld's structural fix, Titus-blessed).
 *
 * These fields have held free-text junk for years — the OW plugin default
 * ships the same word list ("Eon".."Second") in BOTH fields. The parse is
 * therefore modest and never invents structure: it extracts a step word when
 * one pair clearly means "1 base unit", and preserves the whole vocabulary as
 * prose for the construct's description. Everything else the author builds by
 * hand in the builder, which is open in front of them when this seeds it.
 */

import { metaList } from './meta-list';

export interface LegacySeed {
  /** True when either legacy field carries content — gate 1 of the mint offer. */
  present: boolean;
  /** A step word confidently derived (a pair with equivalent = 1), else null. */
  stepName: string | null;
  /** The inherited vocabulary as description prose ('' when nothing usable). */
  description: string;
}

const MAX_ENTRIES = 24;
const MAX_ENTRY_LEN = 64;

function cleanList(v: unknown): string[] {
  return metaList(v)
    .map((s) => String(s).trim().slice(0, MAX_ENTRY_LEN))
    .filter((s) => s !== '')
    .slice(0, MAX_ENTRIES);
}

export function parseLegacySeed(meta: Record<string, unknown> | null | undefined): LegacySeed {
  const names = cleanList(meta?.['time_format_names']);
  const equivalents = cleanList(meta?.['time_format_equivalents']);
  const present = names.length > 0 || equivalents.length > 0;
  if (!present) return { present: false, stepName: null, description: '' };

  // Pair names with equivalents by index; either list may be shorter or junk.
  const pairs = names.map((name, i) => {
    const raw = equivalents[i];
    const n = raw != null && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : null;
    return { name, equivalent: n != null && Number.isFinite(n) && n > 0 ? n : null };
  });

  const unitPair = pairs.find((p) => p.equivalent === 1);
  const stepName = unitPair ? unitPair.name.toLowerCase() : null;

  const numbered = pairs.filter((p) => p.equivalent != null);
  const lines: string[] = [];
  if (numbered.length > 0) {
    lines.push('Inherited time units: '
      + numbered.map((p) => `${p.name} = ${p.equivalent}`).join(', ') + '.');
  }
  const words = pairs.filter((p) => p.equivalent == null).map((p) => p.name);
  const orphanEquivalents = equivalents.slice(names.length);
  const vocabulary = [...words, ...orphanEquivalents];
  if (vocabulary.length > 0) {
    lines.push('Inherited time words: ' + vocabulary.join(', ') + '.');
  }
  const description = lines.length > 0
    ? lines.join(' ') + ' (Moved here from the world’s old time fields when this calendar was minted.)'
    : '';

  return { present, stepName, description };
}
