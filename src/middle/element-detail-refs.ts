/**
 * "Mentioned in" + "Referenced by" sections for element-detail.
 *
 * Scans `state.data.elements` for any element whose fields point back at the
 * target element's id. SDK-shape-agnostic (convention #5): walks all property
 * values whose item shape resembles an id (string, array of strings, array of
 * objects with an `id`, object with an `id`).
 *
 * Two sections:
 *   - "Mentioned in" — incoming narratives, grouped by writing tier (the
 *     world's Book / Chapter / Scene / Draft labels; narratives outside the
 *     writing tree fall under a generic "Narratives" group). Click routes to
 *     the writing room — the writer's intent ("what scenes is this character
 *     in?").
 *   - "Referenced by" — every other incoming element. Grouped by element type
 *     by default, or by the referencing relationship field ("Rival of…",
 *     "Birthplace of…") when `editor_settings.refs_group_by_field` is on.
 *
 * Auto-derive (convention #50) pushes every prose mention into the narrative's
 * relation fields on save, so this single reverse-scan catches prose-linked
 * AND manually-linked references uniformly. See DESIGN_WRITING.md.
 */

import { getState, patchSlice } from '../core/state';
import { navigate, elementHash, writingHash, knowledgeHash, knowledgeKnowerHash, shareHash } from '../core/router';
import type { Element, ElementType } from '../core/types';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';
import { getTierForNarrative, getWritingLabels, type WritingTier } from './writing-helpers';
import { isKnowledgeNarrative, aboutIdsOf, heldByOf, knowersOfElement } from '../core/knowledge';
import { isPageNarrative } from '../core/sharing';
import { humanizeFieldName } from './element-detail-fields';
import { getEditorSettings } from '../registry/registry';

/** Field names that never encode a relationship — skipped by the reverse scan. */
const META_KEYS = new Set(['id', 'name', 'description', 'type', 'local_updated_at', 'server_updated_at']);

/** Where a ref chip navigates. Sections set a default; groups may override. */
type NavTarget = 'element' | 'writing' | 'knowledge-entry' | 'knowledge-knower' | 'share-page';

interface RefGroup {
  label: string;
  sources: Element[];
  /** Per-group navigation override (knowledge groups mix targets). */
  navigateTo?: NavTarget;
}

/**
 * Render the incoming-references panel for an element. Returns null when
 * nothing references it.
 */
export function renderReferencedBy(el: Element): HTMLElement | null {
  const incoming = findIncomingReferences(el.id);
  if (incoming.length === 0) return null;

  // Knowledge entries and sharing pages are narratives, but their chips must
  // route to their own rooms (not the writing room) — partition both out
  // (K6 for knowledge; "Featured in" for pages). Pages reach this scan via
  // their flat `atlas_page_refs` mirror (the element-card bindings, DESIGN_
  // SHARING #75): the generic all-fields walk picks it up, so a card-bound
  // element lists its pages here with zero page-specific scan code. Page
  // prose never derives Involves fields (convention #76) — the mirror IS the
  // page→element link surface.
  const allNarratives = incoming.filter(src => src.type === 'narrative');
  const knowledgeEntries = allNarratives.filter(src => isKnowledgeNarrative(src));
  const pages = allNarratives.filter(src => isPageNarrative(src));
  const narratives = allNarratives.filter(src => !isKnowledgeNarrative(src) && !isPageNarrative(src));
  const others = incoming.filter(src => src.type !== 'narrative');

  const wrap = document.createElement('div');
  wrap.className = 'atlas-detail-refs-wrap';

  if (narratives.length > 0) {
    wrap.appendChild(buildSection({
      headerLabel: 'Mentioned in',
      count: narratives.length,
      groups: groupNarrativesByTier(narratives),
      navigateTo: 'writing',
      sectionClass: 'atlas-detail-section atlas-detail-refs-mentioned',
    }));
  }

  // Knowledge surfacing (K6): who knows about this element, via which entries
  // — and, for knower-typed elements, what they directly hold.
  if (knowledgeEntries.length > 0) {
    const elements = getState().data.elements;
    const subjectOf = knowledgeEntries.filter(k => aboutIdsOf(k).includes(el.id));
    const holds = knowledgeEntries.filter(k => {
      const h = heldByOf(k);
      return h.narrator === el.id || h.collectives.includes(el.id);
    });
    const knowers = knowersOfElement(el.id, elements);
    const kGroups: RefGroup[] = [];
    if (knowers.length > 0) kGroups.push({ label: 'Known by', sources: knowers, navigateTo: 'knowledge-knower' });
    if (subjectOf.length > 0) kGroups.push({ label: 'Subject of', sources: subjectOf, navigateTo: 'knowledge-entry' });
    if (holds.length > 0) kGroups.push({ label: 'Holds', sources: holds, navigateTo: 'knowledge-entry' });
    if (kGroups.length > 0) {
      wrap.appendChild(buildSection({
        headerLabel: 'Knowledge',
        count: knowledgeEntries.length,
        groups: kGroups,
        navigateTo: 'knowledge-entry',
        sectionClass: 'atlas-detail-section atlas-detail-refs-knowledge',
      }));
    }
  }

  if (pages.length > 0) {
    wrap.appendChild(buildSection({
      headerLabel: 'Featured in',
      count: pages.length,
      groups: [{ label: 'Pages', sources: pages }],
      navigateTo: 'share-page',
      sectionClass: 'atlas-detail-section atlas-detail-refs-pages',
    }));
  }

  if (others.length > 0) {
    const groupByField = getEditorSettings(getState().registry).refs_group_by_field;
    wrap.appendChild(buildSection({
      headerLabel: 'Referenced by',
      count: others.length,
      groups: groupByField ? groupOthersByField(el.id, others) : groupOthersByType(others),
      navigateTo: 'element',
      sectionClass: 'atlas-detail-section',
    }));
  }

  return wrap;
}

// ====== Grouping strategies ======

/** Group incoming narratives by writing tier; tree order l1→l4, then non-tree. */
function groupNarrativesByTier(narratives: Element[]): RefGroup[] {
  const worldId = getState().active?.worldId ?? null;
  const labels = worldId ? getWritingLabels(worldId) : null;
  const buckets = new Map<WritingTier | 'other', Element[]>();
  for (const n of narratives) {
    const tier = worldId ? getTierForNarrative(n, worldId) : null;
    const key: WritingTier | 'other' = tier ?? 'other';
    const arr = buckets.get(key) ?? [];
    arr.push(n);
    buckets.set(key, arr);
  }
  const order: Array<WritingTier | 'other'> = ['l1', 'l2', 'l3', 'l4', 'other'];
  const groups: RefGroup[] = [];
  for (const key of order) {
    const sources = buckets.get(key);
    if (!sources || sources.length === 0) continue;
    const label = key === 'other' || !labels || key === null
      ? titleCaseFirst(ELEMENT_LABELS.narrative?.plural ?? 'narratives')
      : pluralize(labels[key]);
    groups.push({ label, sources });
  }
  return groups;
}

/** Group incoming elements by element type (title-cased plural label). */
function groupOthersByType(others: Element[]): RefGroup[] {
  const byType = new Map<ElementType, Element[]>();
  for (const src of others) {
    const arr = byType.get(src.type) ?? [];
    arr.push(src);
    byType.set(src.type, arr);
  }
  const groups: RefGroup[] = [];
  for (const [type, sources] of byType.entries()) {
    groups.push({ label: titleCaseFirst(ELEMENT_LABELS[type]?.plural ?? type), sources });
  }
  return groups;
}

/**
 * Group incoming elements by the relationship field that points at the target,
 * labelled "<Field> of" (a Character whose `rival` is the target lands under
 * "Rival of"). A source referencing the target through multiple fields appears
 * under each. Alphabetical by label for a stable read.
 */
function groupOthersByField(targetId: string, others: Element[]): RefGroup[] {
  const byField = new Map<string, Element[]>();
  for (const src of others) {
    for (const field of matchingFields(src, targetId)) {
      const arr = byField.get(field) ?? [];
      arr.push(src);
      byField.set(field, arr);
    }
  }
  const groups: RefGroup[] = [];
  for (const [field, sources] of byField.entries()) {
    groups.push({ label: `${singularizeLabel(humanizeFieldName(field))} of`, sources });
  }
  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

// ====== Rendering ======

interface SectionOpts {
  headerLabel: string;
  count: number;
  groups: RefGroup[];
  navigateTo: NavTarget;
  sectionClass: string;
}

function buildSection(opts: SectionOpts): HTMLElement {
  const { headerLabel, count, groups, navigateTo, sectionClass } = opts;
  const section = document.createElement('div');
  section.className = sectionClass;
  // Same hook the field sections carry (element-detail-fields stamps
  // dataset.section) — lets the tour's field-highlight and scroll target
  // refs sections ("Referenced by") by name too.
  section.dataset.section = headerLabel;

  const header = document.createElement('div');
  header.className = 'atlas-detail-section-header no-toggle';
  header.innerHTML = `<span>${headerLabel}</span><span class="atlas-refs-count">${count}</span>`;
  section.appendChild(header);

  const body = document.createElement('div');
  body.className = 'atlas-detail-section-body atlas-detail-refs';
  section.appendChild(body);

  for (const group of groups) {
    const wrap = document.createElement('div');
    wrap.className = 'atlas-field';
    const label = document.createElement('div');
    label.className = 'atlas-field-label';
    label.textContent = group.label;
    wrap.appendChild(label);
    const chips = document.createElement('div');
    chips.className = 'atlas-link-row';
    const sorted = group.sources.slice().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    for (const src of sorted) {
      chips.appendChild(buildRefChip(src, group.navigateTo ?? navigateTo));
    }
    wrap.appendChild(chips);
    body.appendChild(wrap);
  }
  return section;
}

function buildRefChip(src: Element, navigateTo: NavTarget): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'atlas-link-chip';
  chip.title = `${src.type} · id ${src.id}`;
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined atlas-link-chip-icon';
  icon.textContent = ELEMENT_ICONS[src.type];
  chip.appendChild(icon);
  const name = document.createElement('span');
  name.textContent = src.name || '(unnamed)';
  chip.appendChild(name);
  chip.addEventListener('click', () => {
    const worldId = getState().active?.worldId;
    if (!worldId) return;
    if (navigateTo === 'writing') {
      // Don't mirror selectedElementId — writing room's URL is the source of
      // truth (convention #46). The global selection stays where it was.
      navigate(writingHash(worldId, src.id));
    } else if (navigateTo === 'knowledge-entry') {
      navigate(knowledgeHash(worldId, src.id));
    } else if (navigateTo === 'knowledge-knower') {
      navigate(knowledgeKnowerHash(worldId, src.id));
    } else if (navigateTo === 'share-page') {
      navigate(shareHash(worldId, src.id));
    } else {
      patchSlice('ui', { ...getState().ui, selectedElementId: src.id });
      navigate(elementHash(worldId, src.id));
    }
  });
  return chip;
}

// ====== Scanning ======

/**
 * Every element id referenced by SOME OTHER element, collected in one pass.
 * The inverse of findIncomingReferences done wholesale: an id absent from this
 * set is referenced by nothing (a "loose thread"). Shape-agnostic like the rest
 * of this module (convention #5); self-references don't count. Text-field
 * strings land in the set too, but they can't collide with a real id, so
 * membership tests (`has(el.id)`) stay correct. O(N · fields), not O(N²).
 */
export function collectReferencedIds(elements: readonly Element[]): Set<string> {
  const out = new Set<string>();
  for (const el of elements) {
    for (const [key, value] of Object.entries(el)) {
      if (META_KEYS.has(key)) continue;
      collectIdsFromValue(value, el.id, out);
    }
  }
  return out;
}

function collectIdsFromValue(value: unknown, selfId: string, out: Set<string>): void {
  if (typeof value === 'string') {
    if (value !== selfId) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') { if (item !== selfId) out.add(item); }
      else if (item && typeof item === 'object') {
        const id = (item as { id?: string }).id;
        if (id && id !== selfId) out.add(id);
      }
    }
    return;
  }
  if (value && typeof value === 'object') {
    const id = (value as { id?: string }).id;
    if (id && id !== selfId) out.add(id);
  }
}

/**
 * Find all elements in `state.data.elements` that reference `targetId` somewhere
 * in their field values. Excludes the target itself. Exported for unit testing.
 */
export function findIncomingReferences(targetId: string): Element[] {
  const all = getState().data.elements;
  const hits: Element[] = [];
  for (const el of all) {
    if (el.id === targetId) continue;
    if (refersTo(el, targetId)) hits.push(el);
  }
  return hits;
}

/** True iff any field on `el` references `targetId`. Exported for unit testing. */
export function refersTo(el: Element, targetId: string): boolean {
  for (const [key, value] of Object.entries(el)) {
    if (META_KEYS.has(key)) continue;
    if (valueRefersTo(value, targetId)) return true;
  }
  return false;
}

/** Every field name on `el` whose value references `targetId`. */
function matchingFields(el: Element, targetId: string): string[] {
  const fields: string[] = [];
  for (const [key, value] of Object.entries(el)) {
    if (META_KEYS.has(key)) continue;
    if (valueRefersTo(value, targetId)) fields.push(key);
  }
  return fields;
}

/** Whether a single field value (string / array / object) references `targetId`. */
function valueRefersTo(value: unknown, targetId: string): boolean {
  if (typeof value === 'string') return value === targetId;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item === targetId) return true;
      if (item && typeof item === 'object' && (item as { id?: string }).id === targetId) return true;
    }
    return false;
  }
  if (value && typeof value === 'object') {
    return (value as { id?: string }).id === targetId;
  }
  return false;
}

// ====== Small label helpers ======

function titleCaseFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Naive English pluralization — good enough for tier labels (Book → Books). */
function pluralize(s: string): string {
  if (/[^aeiou]y$/i.test(s)) return s.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(s)) return s + 'es';
  return s + 's';
}

/**
 * Singularize the last word of a "<Field> of" relationship label — we always
 * view ONE element, so it reads "Friend of Bob", not "Friends of Bob". The
 * field name on disk is plural for multi-links (`friends`, `rivals`); single-
 * links are already singular and pass through unchanged.
 */
function singularizeLabel(label: string): string {
  const parts = label.split(' ');
  parts[parts.length - 1] = singularizeWord(parts[parts.length - 1]);
  return parts.join(' ');
}

function singularizeWord(word: string): string {
  if (/(species|series)$/i.test(word)) return word;          // invariant plurals
  if (/ies$/i.test(word)) return word.slice(0, -3) + 'y';    // Abilities → Ability
  if (/(sses|shes|ches|xes|zes)$/i.test(word)) return word.slice(0, -2); // Boxes → Box
  if (/ss$/i.test(word)) return word;                         // Address stays
  if (/s$/i.test(word)) return word.slice(0, -1);             // Friends → Friend
  return word;
}
