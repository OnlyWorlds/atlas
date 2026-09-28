/**
 * World styles (S356): how a world wants its KINDS drawn.
 *
 * A kind is a (type, supertype, subtype) taxonomy value; a rule attaches a
 * visual to one. Born for zones on Sikelia, where 113 rivers, 192 routes and
 * 14 chorai were the same cyan and the map was one colour with no legend.
 * The rules are the world's, not the map's or the browser's: they live in
 * `.atlas/styles.json` beside charts and tombstones (one file, one concern,
 * tool-private per the Folder Format ruling), so they travel with the
 * folder and its git.
 *
 * Resolution, most specific wins per field:
 *   element's own atlas_* field  >  role rule  >  subtype rule  >  supertype rule
 * A role rule (S362) names a zone's `role` (the schema's "operational
 * function or intent"): Sikelia's rivers are one subtype in three roles
 * (major river, river, minor stream) and its route segments carry the name
 * of the road they belong to. It also names the supertype/subtype it was
 * made under, and all of them must match.
 * A subtype rule is one that names a subtype (it may also name the
 * supertype, and then both must match); a supertype rule names only the
 * supertype. Taxonomy values are user text, so matching is trimmed and
 * case-insensitive (the knowledge/page predicates already read them that
 * way).
 *
 * Pure module: no DOM, no state. The state slice and the store plumbing
 * live with the callers.
 */

import type { Element, ElementType } from './types';
import { isHexColour } from './dom-utils';

export const WORLD_STYLES_VERSION = 1;

export type LineDash = 'solid' | 'dashed' | 'dotted';

export interface StyleRule {
  type: ElementType;
  /** Matched trimmed + case-insensitively; absent = any supertype. */
  supertype?: string;
  /** Matched trimmed + case-insensitively; absent = the supertype-level rule. */
  subtype?: string;
  /** Zones: the `role` value, matched like the taxonomy; absent = any role (S362). */
  role?: string;
  /** Hex colour, e.g. "#3b82f6". Zones: stroke + fill. Every type: the taxonomy swatch. */
  color?: string;
  /** Zones: polygon fill opacity, 0..1. */
  fill_opacity?: number;
  /** Zones: stroke width in px (selected/hovered add one). */
  weight?: number;
  /** Zones: stroke pattern. */
  dash?: LineDash;
  /** Zones: the density layer labels these kinds in the pin tier instead of after every pin. */
  label_priority?: boolean;
}

export interface WorldStyles {
  version: number;
  rules: StyleRule[];
}

export const EMPTY_STYLES: WorldStyles = { version: WORLD_STYLES_VERSION, rules: [] };

/** The resolved visual for one element (every field optional: absent = default). */
export interface ResolvedStyle {
  color?: string;
  fill_opacity?: number;
  weight?: number;
  dash?: LineDash;
  label_priority?: boolean;
  /** Which rule supplied the colour (for the "inherits from" line). */
  source?: 'role' | 'subtype' | 'supertype';
}

export function normKey(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/** Identity of a rule: type + its taxonomy keys, normalised. */
export function ruleKey(r: Pick<StyleRule, 'type' | 'supertype' | 'subtype' | 'role'>): string {
  const base = `${r.type}␟${normKey(r.supertype)}␟${normKey(r.subtype)}`;
  // Keys without a role are unchanged, so kinds hidden or tuned before S362 keep their key.
  return normKey(r.role) ? `${base}␟${normKey(r.role)}` : base;
}

type Styled = { type: string; supertype?: unknown; subtype?: unknown; role?: unknown };

function matches(rule: StyleRule, el: Styled): boolean {
  if (rule.type !== el.type) return false;
  const rs = normKey(rule.supertype);
  const rb = normKey(rule.subtype);
  const rr = normKey(rule.role);
  if (rs && rs !== normKey(el.supertype)) return false;
  if (rb && rb !== normKey(el.subtype)) return false;
  if (rr && rr !== normKey(el.role)) return false;
  return Boolean(rs || rb || rr);
}

const isRoleRule = (r: StyleRule): boolean => Boolean(normKey(r.role));

const VISUAL_FIELDS = ['color', 'fill_opacity', 'weight', 'dash', 'label_priority'] as const;

/**
 * Merge the rules that apply to an element: supertype-level first, then the
 * subtype-level rule over it, field by field. An element with no taxonomy
 * resolves to nothing.
 */
export function resolveStyle(rules: readonly StyleRule[], el: Styled): ResolvedStyle {
  const out: ResolvedStyle = {};
  const superRule = rules.find(r => !isRoleRule(r) && !normKey(r.subtype) && matches(r, el));
  const subRule = rules.find(r => !isRoleRule(r) && normKey(r.subtype) && matches(r, el));
  const roleRule = rules.find(r => isRoleRule(r) && matches(r, el));
  for (const rule of [superRule, subRule, roleRule]) {
    if (!rule) continue;
    for (const f of VISUAL_FIELDS) {
      const v = rule[f];
      if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[f] = v;
    }
    if (rule.color) out.source = rule === roleRule ? 'role' : rule === subRule ? 'subtype' : 'supertype';
  }
  return out;
}

/** Insert or replace the rule with the same key. Blank fields are dropped; a rule left with no visual is removed. */
export function upsertRule(rules: readonly StyleRule[], rule: StyleRule): StyleRule[] {
  const cleaned: StyleRule = { type: rule.type };
  if (normKey(rule.supertype)) cleaned.supertype = rule.supertype!.trim();
  if (normKey(rule.subtype)) cleaned.subtype = rule.subtype!.trim();
  if (normKey(rule.role)) cleaned.role = rule.role!.trim();
  for (const f of VISUAL_FIELDS) {
    const v = rule[f];
    if (v !== undefined && v !== null && v !== '') (cleaned as unknown as Record<string, unknown>)[f] = v;
  }
  const key = ruleKey(cleaned);
  const rest = rules.filter(r => ruleKey(r) !== key);
  const hasVisual = VISUAL_FIELDS.some(f => cleaned[f] !== undefined);
  return hasVisual ? [...rest, cleaned] : rest;
}

export function removeRule(rules: readonly StyleRule[], key: string): StyleRule[] {
  return rules.filter(r => ruleKey(r) !== key);
}

export function findRule(rules: readonly StyleRule[], probe: Pick<StyleRule, 'type' | 'supertype' | 'subtype' | 'role'>): StyleRule | undefined {
  const key = ruleKey(probe);
  return rules.find(r => ruleKey(r) === key);
}

/**
 * A kind as the zone panel shows it: one row per distinct (supertype,
 * subtype) pair among the given elements, display text as first seen,
 * members in input order. Elements with no taxonomy at all fall into one
 * unlabelled kind at the end.
 */
export interface Kind<T> {
  key: string;
  supertype: string;
  subtype: string;
  /** Set when the kind was split by role (`groupByKind(.., { byRole: true })`). */
  role?: string;
  members: T[];
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * `byRole` (zones, S362): a (supertype, subtype) group whose members SHARE
 * roles splits into one kind per role, so "River" becomes major river / river
 * / minor stream and a road's segments group under the road's name. A group
 * where every role is distinct (14 chorai, each "the territory of X") stays
 * whole: a row per zone would be a list, not a kind. Members with no role
 * keep the unsplit key, so a kind hidden or tuned before S362 is the same kind.
 */
export function groupByKind<T extends { type: ElementType; supertype?: unknown; subtype?: unknown; role?: unknown }>(
  elements: readonly T[],
  opts: { byRole?: boolean } = {},
): Kind<T>[] {
  const kinds = new Map<string, Kind<T>>();
  for (const el of elements) {
    const s = text(el.supertype);
    const b = text(el.subtype);
    const key = `${normKey(s)}␟${normKey(b)}`;
    let k = kinds.get(key);
    if (!k) { k = { key, supertype: s, subtype: b, members: [] }; kinds.set(key, k); }
    k.members.push(el);
  }
  let out = [...kinds.values()];
  if (opts.byRole) {
    out = out.flatMap(k => {
      const roles = new Map<string, T[]>();
      for (const el of k.members) {
        const r = normKey(el.role);
        const list = roles.get(r);
        if (list) list.push(el); else roles.set(r, [el]);
      }
      const named = [...roles.keys()].filter(Boolean);
      const withRole = k.members.filter(el => normKey(el.role)).length;
      if (named.length === 0 || named.length === withRole) return [k];
      return [...roles.entries()].map(([r, members]) => (r
        ? { key: `${k.key}␟${r}`, supertype: k.supertype, subtype: k.subtype, role: text(members[0].role), members }
        : { ...k, members }));
    });
  }
  out.sort((a, b) => {
    const ae = !a.supertype && !a.subtype;
    const be = !b.supertype && !b.subtype;
    if (ae !== be) return ae ? 1 : -1;
    return (a.supertype + a.subtype).localeCompare(b.supertype + b.subtype)
      || (a.role ?? '').localeCompare(b.role ?? '');
  });
  return out;
}

/** The kind's display text: "River" · "Line · River" · "Line · River · major river" · "(no kind)". */
export function kindLabel(k: { supertype: string; subtype: string; role?: string }): string {
  const base = k.supertype && k.subtype ? `${k.supertype} · ${k.subtype}` : (k.supertype || k.subtype || '(no kind)');
  return k.role ? `${base} · ${k.role}` : base;
}

/**
 * Colour hint for a taxonomy VALUE as shown in element detail and sidebar
 * rows: the rule that names this field's value (a supertype rule for the
 * supertype field, a subtype rule for the subtype field). Null when no rule
 * carries a colour for it.
 */
export function styleValueHint(rules: readonly StyleRule[], el: Element, field: 'supertype' | 'subtype'): { color: string; title: string } | null {
  const raw = (el as Record<string, unknown>)[field];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = raw.trim();
  const rule = field === 'subtype'
    ? rules.find(r => !isRoleRule(r) && normKey(r.subtype) && matches(r, el))
    : rules.find(r => !isRoleRule(r) && !normKey(r.subtype) && matches(r, el));
  if (!rule?.color) return null;
  return { color: rule.color, title: `"${value}" has a world style: ${rule.color}` };
}

/** The row-level swatch: the most specific coloured rule for the element. */
export function styleRowHint(rules: readonly StyleRule[], el: Element): { color: string; title: string } | null {
  return styleValueHint(rules, el, 'subtype') ?? styleValueHint(rules, el, 'supertype');
}

/** Parse a `styles.json` payload defensively; anything malformed becomes empty. */
export function parseWorldStyles(raw: unknown): WorldStyles {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STYLES, rules: [] };
  const rules = (raw as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) return { ...EMPTY_STYLES, rules: [] };
  const out: StyleRule[] = [];
  for (const r of rules) {
    if (!r || typeof r !== 'object' || typeof (r as StyleRule).type !== 'string') continue;
    const src = r as Record<string, unknown>;
    const rule: StyleRule = { type: src.type as ElementType };
    if (typeof src.supertype === 'string') rule.supertype = src.supertype;
    if (typeof src.subtype === 'string') rule.subtype = src.subtype;
    if (typeof src.role === 'string') rule.role = src.role;
    if (!normKey(rule.supertype) && !normKey(rule.subtype) && !normKey(rule.role)) continue;
    // styles.json travels with the folder, so every visual is untrusted: a
    // colour reaches `style="background:…"` and `value="…"` (S360: a CSS
    // declaration list or a quote there was UI redress or a script breakout).
    // Keep only the shapes atlas writes; drop the rest, keep the rule.
    if (isHexColour(src.color)) rule.color = src.color;
    if (typeof src.fill_opacity === 'number' && Number.isFinite(src.fill_opacity)) rule.fill_opacity = Math.min(1, Math.max(0, src.fill_opacity));
    if (typeof src.weight === 'number' && Number.isFinite(src.weight)) rule.weight = Math.min(20, Math.max(0, src.weight));
    if (src.dash === 'solid' || src.dash === 'dashed' || src.dash === 'dotted') rule.dash = src.dash;
    if (typeof src.label_priority === 'boolean') rule.label_priority = src.label_priority;
    out.push(rule);
  }
  return { version: WORLD_STYLES_VERSION, rules: out };
}
