/**
 * "Mentioned in" + "Referenced by" sections for element-detail.
 *
 * Lists every element whose links point back at the target: the links the
 * SDK's graph reader reads (the standard's typed link fields and the declared
 * `x_` links) and Atlas's own, named in core/world-links.ts (map space as Atlas
 * keeps it, a page's bound elements). An id in any other key is no reference
 * (conv. 184 and 185).
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
import { ELEMENT_ICONS } from '../core/constants';
import { typeName, typeNameStart } from '../core/type-words';
import { getTierForNarrative, getWritingLabels, type WritingTier } from './writing-helpers';
import { isKnowledgeNarrative, aboutIdsOf, heldByOf, knowersOfElement } from '../core/knowledge';
import { isPageNarrative } from '../core/sharing';
import { humanizeFieldName } from './element-detail-fields';
import { getEditorSettings } from '../registry/registry';
import { foldBacklinks, markerFoldLabel } from '../core/spatial-backlinks';
import { pageLore } from '../core/parlor-room';
import { incomingOf } from '../core/world-links';

/**
 * REF SECTION SPLITS (Titus): named sections that pull specific
 * incoming references OUT of the generic "Referenced by" bucket and render
 * ABOVE it, nicely grouped. The first case: a location's **Located here** —
 * elements whose `location` field points at this place, which indicates
 * physical presence. Only "real things" belong (characters first, then
 * creatures, then the rest of the order below); an event or construct
 * referencing a location is context, not presence, and stays in
 * Referenced by. A source that ALSO references the target through other
 * fields keeps its Referenced-by listing for those.
 *
 * Future splitoffs are ONE entry each: target page types, qualifying
 * incoming fields, member source types (the array doubles as display
 * order), and the header.
 */
interface RefSectionSplit {
  headerLabel: string;
  /** Element types whose DETAIL PAGE shows this section. */
  targetTypes: readonly ElementType[];
  /** Incoming field names that qualify a source for the section. */
  viaFields: readonly string[];
  /** Source types that belong; order here IS the display order. */
  sourceTypes: readonly ElementType[];
}

const REF_SECTION_SPLITS: readonly RefSectionSplit[] = [
  {
    headerLabel: 'Located here',
    targetTypes: ['location'],
    viaFields: ['location'],
    // The types the standard gives a `location` field (Collective has none: N3).
    sourceTypes: ['character', 'creature', 'object'],
  },
];

/** Where a ref chip navigates. Sections set a default; groups may override. */
type NavTarget = 'element' | 'writing' | 'knowledge-entry' | 'knowledge-knower' | 'share-page';

interface RefGroup {
  label: string;
  sources: Element[];
  /** Per-group navigation override (knowledge groups mix targets). */
  navigateTo?: NavTarget;
  /** Prebuilt chips in place of one per source (pins and markers, #171). */
  chips?: HTMLElement[];
}

/**
 * Render the incoming-references panel for an element. Returns null when
 * nothing references it.
 */
export function renderReferencedBy(el: Element): HTMLElement | null {
  const world = pageLore(el);
  const incoming = findIncomingReferences(el.id);
  if (incoming.length === 0) return null;

  // Knowledge entries and sharing pages are narratives, but their chips must
  // route to their own rooms (not the writing room) — partition both out
  // (K6 for knowledge; "Featured in" for pages). Pages reach this scan via
  // their flat `atlas_page_refs` mirror (the element-card bindings, DESIGN_
  // SHARING #75): one of Atlas's named links (core/world-links.ts), so a card-bound
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

  // Split sections — "Located here" and future kin — render ABOVE the
  // generic bucket. A qualified source leaves Referenced by unless it also
  // references the target through non-split fields.
  let remaining = others;
  // The fields a split section above already shows, by source id: Linked from
  // groups a source only under its other fields (N12, the 1.118.0 gate).
  const shownAbove = new Map<string, readonly string[]>();
  for (const split of REF_SECTION_SPLITS) {
    if (!split.targetTypes.includes(el.type)) continue;
    const qualified = remaining.filter(src =>
      split.sourceTypes.includes(src.type)
      && matchingFields(src, el.id, world).some(f => split.viaFields.includes(f)));
    if (qualified.length === 0) continue;
    for (const src of qualified) shownAbove.set(src.id, [...(shownAbove.get(src.id) ?? []), ...split.viaFields]);
    const groups: RefGroup[] = [];
    for (const type of split.sourceTypes) {
      const sources = qualified.filter(src => src.type === type);
      if (sources.length > 0) {
        // Same label style as the generic type grouping (titleCaseFirst).
        groups.push({ label: typeNameStart(type, { many: true }), sources });
      }
    }
    wrap.appendChild(buildSection({
      headerLabel: split.headerLabel,
      count: qualified.length,
      groups,
      navigateTo: 'element',
      sectionClass: 'atlas-detail-section atlas-detail-refs-split',
    }));
    // Keep a source in Referenced by only for its OTHER referencing fields.
    remaining = remaining.filter(src => {
      if (!qualified.includes(src)) return true;
      return matchingFields(src, el.id, world).some(f => !split.viaFields.includes(f));
    });
  }

  if (remaining.length > 0) {
    const groupByField = getEditorSettings(getState().registry).refs_group_by_field;
    // Pins and markers do not vote (#171): they leave the type or field
    // grouping and close the section, a pin named by its other end, markers
    // one chip per zone. A map's page listed 131 "(unnamed)" markers.
    const byId = new Map(getState().data.elements.map(e => [e.id, e] as const));
    const folded = foldBacklinks(remaining, el.id, byId);
    const groups = groupByField ? groupOthersByField(el.id, folded.story, world, shownAbove) : groupOthersByType(folded.story);
    if (folded.pins.length > 0) {
      groups.push({
        label: 'Pins',
        sources: [],
        chips: folded.pins.map(p => buildEntryChip(ELEMENT_ICONS.pin, p.label, `pin · id ${p.pin.id}`, p.navId)),
      });
    }
    if (folded.markers.length > 0) {
      groups.push({
        label: 'Markers',
        sources: [],
        chips: folded.markers.map(f => buildEntryChip(
          ELEMENT_ICONS.marker, markerFoldLabel(f), f.zoneId ? `zone · id ${f.zoneId}` : 'Markers with no zone', f.navId)),
      });
    }
    wrap.appendChild(buildSection({
      headerLabel: 'Linked from',
      count: remaining.length,
      groups,
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
      ? typeNameStart('narrative', { many: true })
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
    groups.push({ label: typeNameStart(type, { many: true }), sources });
  }
  return groups;
}

/**
 * Group incoming elements by the relationship field that points at the target,
 * labelled "<Field> of" (a Character whose `rival` is the target lands under
 * "Rival of"). A source referencing the target through multiple fields appears
 * under each, but never under a field a split section above already shows it
 * by. Fields that read the same ("location", "locations") share one group, each
 * source once. Alphabetical by label for a stable read.
 */
export function groupOthersByField(
  targetId: string,
  others: Element[],
  world: readonly Element[],
  shownAbove: ReadonlyMap<string, readonly string[]> = new Map(),
): RefGroup[] {
  const byLabel = new Map<string, Element[]>();
  for (const src of others) {
    const above = shownAbove.get(src.id) ?? [];
    for (const field of matchingFields(src, targetId, world)) {
      if (above.includes(field)) continue;
      const label = `${singularizeLabel(humanizeFieldName(field))} of`;
      const arr = byLabel.get(label) ?? [];
      if (!arr.includes(src)) arr.push(src);
      byLabel.set(label, arr);
    }
  }
  const groups: RefGroup[] = [];
  for (const [label, sources] of byLabel.entries()) groups.push({ label, sources });
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
    if (group.chips) {
      for (const chip of group.chips) chips.appendChild(chip);
    } else {
      const sorted = group.sources.slice().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
      for (const src of sorted) {
        chips.appendChild(buildRefChip(src, group.navigateTo ?? navigateTo));
      }
    }
    wrap.appendChild(chips);
    body.appendChild(wrap);
  }
  return section;
}

function buildRefChip(src: Element, navigateTo: NavTarget): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'atlas-link-chip';
  chip.title = `${typeName(src.type, { supertype: src.supertype })} · id ${src.id}`;
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

/** A chip that is not one element's own: a pin read as its other end, a zone's markers. */
function buildEntryChip(iconName: string, label: string, title: string, navId: string | null): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'atlas-link-chip';
  if (!navId) chip.classList.add('is-static');
  chip.title = title;
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined atlas-link-chip-icon';
  icon.textContent = iconName;
  chip.appendChild(icon);
  const name = document.createElement('span');
  name.textContent = label;
  chip.appendChild(name);
  if (navId) {
    chip.addEventListener('click', () => {
      const worldId = getState().active?.worldId;
      if (!worldId) return;
      patchSlice('ui', { ...getState().ui, selectedElementId: navId });
      navigate(elementHash(worldId, navId));
    });
  }
  return chip;
}

// ====== Scanning ======

/**
 * Every element id some OTHER element links to, from the shared reading (the
 * reader's links and Atlas's own, core/world-links.ts): an id absent from this
 * set is referenced by nothing (a "loose thread"). One reading per elements array.
 */
export function collectReferencedIds(elements: readonly Element[]): Set<string> {
  return new Set(incomingOf(elements).keys());
}

/**
 * Every element of the target's world (`pageLore`) that links to `targetId`, in
 * the world's order. Excludes the target itself.
 */
export function findIncomingReferences(targetId: string): Element[] {
  // A lore element's references leave the parlor's room out while it is
  // hidden (core/parlor-room.ts), and the reading aids; a room element's or an aid's page reads the whole world.
  const whole = getState().data.elements;
  const target = whole.find(e => e.id === targetId);
  const all = pageLore(target);
  const sources = incomingOf(all).get(targetId);
  if (!sources) return [];
  return all.filter(el => el.id !== targetId && sources.has(el.id));
}

/** True iff `el` links to `targetId` in `world`. */
export function refersTo(el: Element, targetId: string, world: readonly Element[]): boolean {
  return matchingFields(el, targetId, world).length > 0;
}

/** Every field of `el` that links it to `targetId` in `world`, the reader's first. */
function matchingFields(el: Element, targetId: string, world: readonly Element[]): string[] {
  return incomingOf(world).get(targetId)?.get(el.id) ?? [];
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
