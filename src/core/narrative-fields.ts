/**
 * Multi-link "Involves" relation fields on Narrative (per SDK
 * ELEMENT_SECTIONS.narrative "Involves" section). One field per element type.
 *
 * Consumers:
 *   - writing workspace: convention #50 UNION-on-save walks this map to decide
 *     where each prose-derived UUID lands (`middle/writing-workspace-derive.ts`)
 *   - knowledge room: resolves a subject's about-field, and derives
 *     `ABOUT_FIELDS` (`core/knowledge.ts` — which excludes `collectives`,
 *     reinterpreted as held-by for knowledge entries)
 *
 * Lives in core/ (not middle/) so schema-shaped consumers can import it
 * without pulling in UI modules.
 */

import type { ElementType } from './types';

export const NARRATIVE_RELATION_FIELDS: Record<ElementType, string | null> = {
  character: 'characters',
  location: 'locations',
  event: 'events',
  object: 'objects',
  species: 'species',
  creature: 'creatures',
  institution: 'institutions',
  trait: 'traits',
  collective: 'collectives',
  zone: 'zones',
  ability: 'abilities',
  phenomenon: 'phenomena',
  language: 'languages',
  family: 'families',
  relation: 'relations',
  title: 'titles',
  construct: 'constructs',
  law: 'laws',
  // Not relation targets from Narrative (no multi-link field):
  narrative: null,
  map: null,
  pin: null,
  marker: null,
};
