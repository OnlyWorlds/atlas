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

describe('role rules and role kinds (S362)', () => {
  const ROLE_RULES: StyleRule[] = [
    ...RULES,
    { type: 'zone', supertype: 'Line', subtype: 'River', role: 'major river', weight: 5, color: '#1d4ed8' },
  ];

  it('a role rule wins over the subtype rule, field by field, only for its role', () => {
    const major = resolveStyle(ROLE_RULES, zone('Line', 'River', { role: 'Major River ' }));
    expect(major).toMatchObject({ color: '#1d4ed8', weight: 5, source: 'role' });
    const minor = resolveStyle(ROLE_RULES, zone('Line', 'River', { role: 'minor stream' }));
    expect(minor).toMatchObject({ color: '#3b82f6', weight: 3, source: 'subtype' });
  });

  it('role rules have their own key and never answer for the plain kind', () => {
    const plain = { type: 'zone' as const, supertype: 'Line', subtype: 'River' };
    expect(ruleKey({ ...plain, role: 'major river' })).not.toBe(ruleKey(plain));
    expect(findRule(ROLE_RULES, plain)?.color).toBe('#3b82f6');
    expect(styleRowHint(ROLE_RULES, zone('Line', 'River', { role: 'major river' }))?.color).toBe('#3b82f6');
  });

  it('upsert and parse keep the role; a role-only rule survives parsing', () => {
    const next = upsertRule([], { type: 'zone', supertype: 'Line', subtype: 'River', role: ' river ', color: '#00ff00' });
    expect(next[0].role).toBe('river');
    expect(parseWorldStyles({ rules: [{ type: 'zone', role: 'road', color: '#222222' }] }).rules).toEqual([{ type: 'zone', role: 'road', color: '#222222' }]);
  });

  it('byRole splits a kind whose members share roles, and keeps a kind of distinct roles whole', () => {
    const rivers = [
      zone('Line', 'River', { id: 'a', role: 'major river' }), zone('Line', 'River', { id: 'b', role: 'major river' }),
      zone('Line', 'River', { id: 'c', role: 'minor stream' }), zone('Line', 'River', { id: 'd' }),
    ];
    const chorai = [zone('Polygon', 'Chora', { id: 'e', role: 'the territory of Gela' }), zone('Polygon', 'Chora', { id: 'f', role: 'the territory of Enna' })];
    const kinds = groupByKind([...rivers, ...chorai], { byRole: true });
    expect(kinds.map(k => kindLabel(k))).toEqual([
      'Line · River', 'Line · River · major river', 'Line · River · minor stream', 'Polygon · Chora',
    ]);
    // the no-role members keep the pre-S362 key (a kind hidden before stays hidden)
    expect(kinds[0].key).toBe(groupByKind(rivers)[0].key);
    expect(kinds[0].members.map(z => z.id)).toEqual(['d']);
    // without byRole nothing changes
    expect(groupByKind([...rivers, ...chorai]).length).toBe(2);
  });
});
