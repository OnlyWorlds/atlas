/**
 * World styles (S356): the rule model behind `.atlas/styles.json`.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveStyle, upsertRule, removeRule, findRule, ruleKey, groupByKind, kindLabel,
  styleValueHint, styleRowHint, parseWorldStyles, type StyleRule,
} from '../../src/core/world-styles';
import type { Element } from '../../src/core/types';

const zone = (supertype?: string, subtype?: string, extra: Record<string, unknown> = {}): Element =>
  ({ id: 'z', type: 'zone', name: 'z', supertype, subtype, ...extra } as unknown as Element);

const RULES: StyleRule[] = [
  { type: 'zone', supertype: 'Line', color: '#111111', weight: 1 },
  { type: 'zone', supertype: 'Line', subtype: 'River', color: '#3b82f6', weight: 3 },
  { type: 'zone', subtype: 'Route', dash: 'dashed' },
  { type: 'location', supertype: 'Settlement', color: '#00ff00' },
];

describe('resolveStyle', () => {
  it('layers the subtype rule over the supertype rule, field by field', () => {
    expect(resolveStyle(RULES, zone('Line', 'River'))).toEqual({ color: '#3b82f6', weight: 3, source: 'subtype' });
    // A route gets the Line colour and weight, and the Route dash.
    expect(resolveStyle(RULES, zone('Line', 'Route'))).toEqual({ color: '#111111', weight: 1, dash: 'dashed', source: 'supertype' });
    expect(resolveStyle(RULES, zone('Line', 'Road'))).toEqual({ color: '#111111', weight: 1, source: 'supertype' });
  });

  it('matches trimmed and case-insensitively (taxonomy is user text)', () => {
    expect(resolveStyle(RULES, zone(' line ', 'RIVER')).color).toBe('#3b82f6');
  });

  it('is type-scoped and empty for an untyped element', () => {
    expect(resolveStyle(RULES, { type: 'zone', supertype: 'Settlement' })).toEqual({});
    expect(resolveStyle(RULES, zone())).toEqual({});
    expect(resolveStyle(RULES, { type: 'location', supertype: 'Settlement' }).color).toBe('#00ff00');
  });
});

describe('upsertRule / removeRule / findRule', () => {
  it('replaces by key, trims the taxonomy, drops blank fields, and removes a rule left with no visual', () => {
    let rules = upsertRule([], { type: 'zone', supertype: ' Line ', subtype: 'River', color: '#3b82f6' });
    expect(rules).toEqual([{ type: 'zone', supertype: 'Line', subtype: 'River', color: '#3b82f6' }]);
    rules = upsertRule(rules, { type: 'zone', supertype: 'line', subtype: 'RIVER', color: '#ff0000', weight: 2 });
    expect(rules).toHaveLength(1);
    expect(rules[0].color).toBe('#ff0000');
    expect(findRule(rules, { type: 'zone', supertype: 'LINE', subtype: 'river' })).toBe(rules[0]);
    rules = upsertRule(rules, { type: 'zone', supertype: 'Line', subtype: 'River' });
    expect(rules).toEqual([]);
  });

  it('a rule without any taxonomy is never stored', () => {
    expect(ruleKey({ type: 'zone' })).toBe(ruleKey({ type: 'zone', supertype: '  ' }));
    expect(removeRule(RULES, ruleKey({ type: 'zone', subtype: 'route' }))).toHaveLength(3);
  });
});

describe('groupByKind', () => {
  it('one row per (supertype, subtype) pair, display text as first seen, the unkinded last', () => {
    const kinds = groupByKind([
      zone('Line', 'River'), zone(), zone('line', 'river'), zone('Polygon', 'Chora'), zone('Region'),
    ]);
    expect(kinds.map(k => kindLabel(k))).toEqual(['Line · River', 'Polygon · Chora', 'Region', '(no kind)']);
    expect(kinds[0].members).toHaveLength(2);
  });
});

describe('styleValueHint / styleRowHint', () => {
  it('lights the field whose value the rule names, and the row with the most specific colour', () => {
    const river = zone('Line', 'River');
    expect(styleValueHint(RULES, river, 'supertype')?.color).toBe('#111111');
    expect(styleValueHint(RULES, river, 'subtype')?.color).toBe('#3b82f6');
    expect(styleRowHint(RULES, river)?.color).toBe('#3b82f6');
    // A Route has a subtype rule with no colour: the row falls back to the supertype colour.
    expect(styleValueHint(RULES, zone('Line', 'Route'), 'subtype')).toBeNull();
    expect(styleRowHint(RULES, zone('Line', 'Route'))?.color).toBe('#111111');
    expect(styleRowHint(RULES, zone('Region'))).toBeNull();
  });
});

describe('parseWorldStyles', () => {
  it('reads a well-formed file and turns anything malformed into no rules', () => {
    expect(parseWorldStyles({ version: 1, rules: RULES }).rules).toHaveLength(4);
    expect(parseWorldStyles(null).rules).toEqual([]);
    expect(parseWorldStyles({ rules: 'nope' }).rules).toEqual([]);
    expect(parseWorldStyles({ rules: [{ color: '#fff' }, { type: 'zone' }, { type: 'zone', supertype: 'X', color: '#000' }] }).rules).toHaveLength(1);
  });
});
