/**
 * Legacy time-field seed parse (2B §1): defensive against years of free-text
 * junk. Never invents structure — a step word only from an unambiguous
 * "equivalent = 1" pair; everything else becomes description prose.
 */
import { describe, it, expect } from 'vitest';
import { parseLegacySeed } from '../../src/core/calendar-seed';

describe('parseLegacySeed', () => {
  it('absent/empty fields = no offer', () => {
    expect(parseLegacySeed(undefined).present).toBe(false);
    expect(parseLegacySeed({}).present).toBe(false);
    expect(parseLegacySeed({ time_format_names: [], time_format_equivalents: [] }).present).toBe(false);
  });

  it('the plugin default (words in BOTH lists) offers but derives no step word', () => {
    // The real-world dominant case: names and equivalents both hold unit words.
    const words = ['Eon', 'Era', 'Period', 'Epoch', 'Age', 'Year', 'Month', 'Day'];
    const seed = parseLegacySeed({ time_format_names: words, time_format_equivalents: words });
    expect(seed.present).toBe(true);
    expect(seed.stepName).toBe(null);
    expect(seed.description).toContain('Eon');
    expect(seed.description).toContain('old time fields');
  });

  it('numeric equivalents: the "= 1" pair names the step, all pairs become prose', () => {
    const seed = parseLegacySeed({
      time_format_names: ['Day', 'Week', 'Month', 'Year'],
      time_format_equivalents: ['1', '7', '30', '365'],
    });
    expect(seed.stepName).toBe('day');
    expect(seed.description).toContain('Day = 1');
    expect(seed.description).toContain('Year = 365');
  });

  it('survives junk: non-arrays, non-strings, mismatched lengths, huge entries', () => {
    expect(parseLegacySeed({ time_format_names: 'a string' as never }).present).toBe(false);
    const seed = parseLegacySeed({
      time_format_names: ['Turn', 42 as never, null as never],
      time_format_equivalents: ['1', 'x', 'orphan-word'],
    });
    expect(seed.present).toBe(true);
    expect(seed.stepName).toBe('turn');
    expect(seed.description).toContain('orphan-word'); // nothing silently lost
    const long = parseLegacySeed({ time_format_names: ['y'.repeat(500)] });
    expect(long.description.length).toBeLessThan(300);
  });

  it('equivalents-only content still offers (the field pair is half-filled in the wild)', () => {
    const seed = parseLegacySeed({ time_format_equivalents: ['moon', 'tide'] });
    expect(seed.present).toBe(true);
    expect(seed.stepName).toBe(null);
    expect(seed.description).toContain('moon');
  });

  it('equivalents stored as whole numbers name the step the same way (keel ca181a3)', () => {
    const seed = parseLegacySeed({
      time_format_names: ['Day', 'Week', 'Month', 'Year'],
      time_format_equivalents: [1, 7, 30, 365],
    });
    expect(seed.stepName).toBe('day');
    expect(seed.description).toContain('Year = 365');
  });
});
