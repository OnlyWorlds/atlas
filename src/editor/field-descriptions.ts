/**
 * Human-readable field descriptions per element type.
 *
 * Source: `OnlyWorlds/toolkit/knowledge/schema-reference.md` (last audited 2026-03-17
 * against live API + SDK 2.2.x). The SDK's `FIELD_SCHEMA` exports only type +
 * required; this dictionary fills in the prose so atlas can show field hints
 * on hover.
 *
 * Lookup: `getFieldDescription(elementType, fieldName)` checks the type-specific
 * map first, then falls back to the shared base map. Returns `undefined` for
 * unknown fields (UI surfaces no tooltip in that case).
 *
 * When adding a new field upstream: copy the description here. Stale entries
 * are harmless — they just won't show up since the SDK schema is authoritative.
 */

import type { ElementType } from '../core/types';

type FieldMap = Readonly<Record<string, string>>;

const BASE: FieldMap = {
  name: "Element's name",
  description: 'Details about the element',
  image_url: 'URL to an image representing the element',
  supertype: 'Top level category',
  subtype: 'Sub level category',
};

const ABILITY: FieldMap = {
  activation: 'Method or conditions for activation',
  duration: 'How long it remains active',
  potency: 'Relative force or power level (0-100)',
  range: 'Effective reach or distance',
  effects: 'Resulting phenomena when used',
  challenges: 'Difficulties in mastering or using',
  talents: 'Traits that enhance performance',
  requisites: 'Requirements to use',
  prevalence: 'How widely known or practiced',
  tradition: 'System it operates within',
  source: 'Phenomenon that enables it',
  locus: 'Where most strongly rooted',
  instruments: 'Required tools or items',
  systems: 'Associated frameworks',
};

const CHARACTER: FieldMap = {
  physicality: 'Visible physical features and attributes',
  mentality: 'Mindset, emotional tone, thinking style',
  height: 'Physical height',
  weight: 'Physical weight',
  species: 'Species/race belonged to',
  traits: 'Notable characteristics',
  abilities: 'Skills and powers they can perform',
  background: 'History, upbringing, formative experiences',
  motivations: 'Core desires, goals, driving values',
  birth_date: 'When born',
  birthplace: 'Where born',
  languages: 'Languages they speak',
  reputation: 'Current standing or how they’re known',
  location: 'Current/present location',
  objects: 'Key items they own',
  institutions: 'Affiliated organizations',
  charisma: 'Personality scale 0-100',
  coercion: 'Personality scale 0-100',
  competence: 'Personality scale 0-100',
  compassion: 'Personality scale 0-100',
  creativity: 'Personality scale 0-100',
  courage: 'Personality scale 0-100',
  family: 'Family groups by blood/adoption',
  friends: 'Close allies and companions',
  rivals: 'Active opponents or competitors',
  level: 'TTRPG level',
  hit_points: 'TTRPG hit points',
  STR: 'TTRPG strength',
  DEX: 'TTRPG dexterity',
  CON: 'TTRPG constitution',
  INT: 'TTRPG intelligence',
  WIS: 'TTRPG wisdom',
  CHA: 'TTRPG charisma',
};

const COLLECTIVE: FieldMap = {
  composition: 'Internal structure or demographic makeup',
  count: 'Number of members',
  formation_date: 'When formed',
  operator: 'Managing institution',
  equipment: 'Tools/gear used',
  activity: 'Primary behaviors or actions',
  disposition: 'Emotional control or volatility',
  state: 'Current condition or operational status',
  abilities: 'Shared abilities',
  symbolism: 'Unifying symbols/concepts',
  species: 'Types of beings in group',
  characters: 'Notable individual members',
  creatures: 'Associated creatures',
  phenomena: 'Influencing phenomena',
};

const CONSTRUCT: FieldMap = {
  rationale: 'How/why the system/concept functions',
  history: 'Historical development and context',
  status: 'Present condition or operational status',
  reach: 'Geographic/cultural/political extent',
  start_date: 'When established',
  end_date: 'When ceased',
  founder: 'Who conceived it',
  custodian: 'Organization maintaining it',
  characters: 'Involved characters',
  objects: 'Involved objects',
  locations: 'Involved locations',
  species: 'Involved species',
  creatures: 'Involved creatures',
  institutions: 'Involved institutions',
  traits: 'Involved traits',
  collectives: 'Involved collectives',
  zones: 'Involved zones',
  abilities: 'Involved abilities',
  phenomena: 'Involved phenomena',
  languages: 'Involved languages',
  families: 'Involved families',
  relations: 'Involved relations',
  titles: 'Involved titles',
  constructs: 'Related constructs',
  events: 'Related events',
  narratives: 'Related narratives',
};

const CREATURE: FieldMap = {
  appearance: 'Visual description',
  weight: 'Physical mass',
  height: 'Physical size',
  species: 'What type of being',
  habits: 'Typical behaviors and recurring actions',
  demeanor: 'Emotional tone or attitude conveyed',
  traits: 'Influencing characteristics',
  abilities: 'Powers it can perform',
  languages: 'Communication methods',
  status: 'Current situation or classification',
  birth_date: 'When born/created',
  location: 'Current location',
  zone: 'Inhabited region',
  challenge_rating: 'TTRPG challenge rating',
  hit_points: 'TTRPG hit points',
  armor_class: 'TTRPG armor class',
  speed: 'TTRPG speed',
  actions: 'Combat abilities',
};

const EVENT: FieldMap = {
  history: 'Historical context and background',
  challenges: 'Adversity faced during event',
  consequences: 'Factual outcomes',
  start_date: 'When began',
  end_date: 'When concluded',
  triggers: 'Events that caused this',
  characters: 'Involved characters',
  objects: 'Involved objects',
  locations: 'Involved locations',
  species: 'Involved species',
  creatures: 'Involved creatures',
  institutions: 'Involved institutions',
  traits: 'Involved traits',
  collectives: 'Involved collectives',
  zones: 'Involved zones',
  abilities: 'Involved abilities',
  phenomena: 'Involved phenomena',
  languages: 'Involved languages',
  families: 'Involved families',
  relations: 'Involved relations',
  titles: 'Involved titles',
  constructs: 'Involved constructs',
};

const FAMILY: FieldMap = {
  spirit: 'Core values or shared ethos',
  history: 'Background or origin story',
  traditions: 'Cultural practices',
  traits: 'Common family traits',
  abilities: 'Family abilities/talents',
  languages: 'Associated languages',
  ancestors: 'Notable forebears',
  reputation: 'Current social/political standing',
  estates: 'Owned/governed locations',
  governs: 'Administered institutions',
  heirlooms: 'Inherited artifacts',
  creatures: 'Family creatures/pets',
};

const INSTITUTION: FieldMap = {
  doctrine: 'Core belief, mission, or purpose',
  founding_date: 'When established',
  parent_institution: 'Governing body',
  zones: 'Controlled areas',
  objects: 'Owned objects',
  creatures: 'Controlled creatures',
  status: 'Current political/cultural standing',
  allies: 'Cooperating institutions',
  adversaries: 'Opposing institutions',
  constructs: 'Created/maintained systems',
};

const LANGUAGE: FieldMap = {
  phonology: 'Sound systems and pronunciation',
  grammar: 'Syntax and morphology rules',
  lexicon: 'Vocabulary principles or word lists',
  writing: 'Script or notation system',
  classification: 'Linguistic group',
  status: 'Current vitality or dominance',
  spread: 'Where spoken',
  dialects: 'Variant languages',
};

const LAW: FieldMap = {
  declaration: 'Formal wording of the law',
  purpose: 'Intent or justification',
  date: 'When established',
  parent_law: 'Derived from what law',
  penalties: 'Violation consequences',
  author: 'Creating institution',
  locations: 'Where enforced',
  zones: 'Specific areas where enforced',
  prohibitions: 'What’s forbidden',
  adjudicators: 'Who interprets',
  enforcers: 'Who enforces',
};

const LOCATION: FieldMap = {
  form: 'Visual and environmental aspects',
  function: 'Main use or purpose',
  founding_date: 'When established',
  parent_location: 'Containing location',
  populations: 'Residing groups',
  political_climate: 'Political structure and dynamics',
  primary_power: 'Controlling institution',
  governing_title: 'Ruling figure’s title',
  secondary_powers: 'Other influential powers',
  zone: 'Associated zone',
  rival: 'Rival location',
  partner: 'Allied location',
  customs: 'Cultural practices and festivals',
  founders: 'Who founded it',
  cults: 'Religious constructs',
  delicacies: 'Local foods',
  extraction_methods: 'Resource gathering techniques',
  extraction_goods: 'Raw materials gathered',
  industry_methods: 'Manufacturing techniques',
  industry_goods: 'Manufactured products',
  infrastructure: 'Roads, ports, transport systems',
  extraction_markets: 'Where raw materials go',
  industry_markets: 'Where products go',
  currencies: 'Recognized trade media',
  architecture: 'Built environment design',
  buildings: 'Notable structures',
  building_methods: 'Construction techniques',
  defensibility: 'Natural and constructed defenses',
  elevation: 'Height relative to terrain',
  fighters: 'Defending force types',
  defensive_objects: 'Defense installations',
};

const MAP: FieldMap = {
  background_color: 'Fallback canvas color (atlas auto-extracts an edge color from the image when one is set)',
  hierarchy: 'Sibling ordering within a parent_map group or among co-located maps. Lower comes first; ties broken alphabetically.',
  width: 'Width in pixels',
  height: 'Height in pixels',
  depth: 'Depth in pixels (reserved, unused)',
  parent_map: 'The map this one sits under, in the maps list and for the up arrow at its top. Left empty, Atlas places it under the map of its location’s parent location.',
  location: 'The location this map shows. Its pin on another map opens this one: click the pin, then Open.',
};

const MARKER: FieldMap = {
  map: 'Map it’s placed on',
  zone: 'Zone it defines',
  x: 'X coordinate',
  y: 'Y coordinate',
  z: 'Z coordinate',
  order: 'Position in sequence',
};

const NARRATIVE: FieldMap = {
  story: 'The narrative content from a perspective',
  consequences: 'Outcomes or legacy',
  // The standard's 00.32.02 (Skeld 2026-10-20, 2026-10-20): a Narrative's dates
  // are when it is told, not the span it recounts (that lives on its events).
  start_date: 'When it is first told or recorded',
  end_date: 'When it stops being told, empty while still told',
  order: 'Position in parent sequence',
  parent_narrative: 'Containing narrative',
  protagonist: 'Primary character',
  antagonist: 'Opposing character',
  narrator: 'Who’s telling it',
  conservator: 'Preserving institution',
  events: 'Involved events',
  characters: 'Involved characters',
  objects: 'Involved objects',
  locations: 'Involved locations',
  species: 'Involved species',
  creatures: 'Involved creatures',
  institutions: 'Involved institutions',
  traits: 'Involved traits',
  collectives: 'Involved collectives',
  zones: 'Involved zones',
  abilities: 'Involved abilities',
  phenomena: 'Involved phenomena',
  languages: 'Involved languages',
  families: 'Involved families',
  relations: 'Involved relations',
  titles: 'Involved titles',
  constructs: 'Involved constructs',
  laws: 'Involved laws',
};

const OBJECT: FieldMap = {
  aesthetics: 'Appearance and visual presentation',
  weight: 'Physical mass',
  amount: 'Number of identical units',
  parent_object: 'Larger containing object',
  materials: 'What it’s made from',
  technology: 'How it works/operates',
  utility: 'Intended purpose or primary use',
  effects: 'Triggered phenomena',
  abilities: 'Abilities it grants',
  consumes: 'What’s depleted on use',
  origins: 'Background or history',
  location: 'Current location',
  language: 'Required language to use',
  affinities: 'Enhancing traits',
};

const PHENOMENON: FieldMap = {
  expression: 'How it manifests in the world',
  effects: 'Primary outcomes or changes caused',
  duration: 'How long it lasts',
  catalysts: 'Objects that initiate it',
  empowerments: 'Related abilities',
  mythology: 'Cultural or narrative meaning',
  system: 'Broader phenomenon it’s part of',
  triggers: 'Activation mechanisms',
  wielders: 'Who controls it',
  environments: 'Where it occurs',
};

const PIN: FieldMap = {
  map: 'Map it’s placed on',
  element_type: 'Type of element being pinned',
  element_id: 'The element being marked',
  x: 'X coordinate',
  y: 'Y coordinate',
  z: 'Z coordinate',
};

const RELATION: FieldMap = {
  background: 'History and origin of relationship',
  start_date: 'When began',
  end_date: 'When ended',
  intensity: 'Relationship strength (0-100)',
  actor: 'Primary defining character',
  events: 'Related events',
  characters: 'Involved characters',
  objects: 'Involved objects',
  locations: 'Involved locations',
  species: 'Involved species',
  creatures: 'Involved creatures',
  institutions: 'Involved institutions',
  traits: 'Involved traits',
  collectives: 'Involved collectives',
  zones: 'Involved zones',
  abilities: 'Involved abilities',
  phenomena: 'Involved phenomena',
  languages: 'Involved languages',
  families: 'Involved families',
  titles: 'Involved titles',
  constructs: 'Involved constructs',
  narratives: 'Involved narratives',
};

const SPECIES: FieldMap = {
  appearance: 'Typical physical features',
  life_span: 'Average life expectancy',
  weight: 'Average adult weight',
  nourishment: 'Food sources',
  reproduction: 'Reproductive methods',
  adaptations: 'Special abilities',
  instincts: 'Innate behavioral drives',
  sociality: 'Social behavior patterns',
  temperament: 'Overall behavioral disposition',
  communication: 'Interaction methods',
  aggression: 'General aggressiveness (0-100)',
  traits: 'Associated behavioral patterns',
  role: 'Ecological or cultural function',
  parent_species: 'If subspecies',
  locations: 'Habitat locations',
  zones: 'Habitat zones',
  affinities: 'Associated phenomena',
};

const TITLE: FieldMap = {
  authority: 'Rights or powers granted by title',
  eligibility: 'Conditions for holding',
  grant_date: 'When granted',
  revoke_date: 'When ended',
  issuer: 'Who creates the title',
  body: 'Organization it functions within',
  superior_title: 'Higher authority',
  holders: 'Current/past holders',
  symbols: 'Authorizing objects',
  status: 'Current state or condition',
  history: 'Origin, evolution, significance',
  characters: 'Involved characters',
  institutions: 'Involved institutions',
  families: 'Involved families',
  zones: 'Involved zones',
  locations: 'Involved locations',
  objects: 'Involved objects',
  constructs: 'Involved constructs',
  laws: 'Involved laws',
  collectives: 'Involved collectives',
  creatures: 'Involved creatures',
  phenomena: 'Involved phenomena',
  species: 'Involved species',
  languages: 'Involved languages',
};

const TRAIT: FieldMap = {
  social_effects: 'Social relationships and interaction effects',
  physical_effects: 'Physical changes or enhancements',
  functional_effects: 'Performance or aptitude effects',
  personality_effects: 'Temperament or mental state effects',
  behaviour_effects: 'Visible behavioral patterns',
  charisma: 'Modifier (-100 to 100)',
  coercion: 'Modifier (-100 to 100)',
  competence: 'Modifier (-100 to 100)',
  compassion: 'Modifier (-100 to 100)',
  creativity: 'Modifier (-100 to 100)',
  courage: 'Modifier (-100 to 100)',
  significance: 'Societal, symbolic, or systemic presence',
  anti_trait: 'Opposing trait',
  empowered_abilities: 'Strengthened abilities',
};

const ZONE: FieldMap = {
  role: 'Functional purpose of the zone',
  shape: 'polygon for an area, line for a path; anything else draws an area',
  start_date: 'When becomes relevant',
  end_date: 'When ceases meaning',
  phenomena: 'Affecting phenomena',
  linked_zones: 'Associated zones',
  context: 'Historical and key knowledge',
  populations: 'Residing groups',
  titles: 'Managing titles',
  principles: 'Governing mechanics',
};

const BY_TYPE: Readonly<Record<ElementType, FieldMap>> = {
  ability: ABILITY,
  character: CHARACTER,
  collective: COLLECTIVE,
  construct: CONSTRUCT,
  creature: CREATURE,
  event: EVENT,
  family: FAMILY,
  institution: INSTITUTION,
  language: LANGUAGE,
  law: LAW,
  location: LOCATION,
  map: MAP,
  marker: MARKER,
  narrative: NARRATIVE,
  object: OBJECT,
  phenomenon: PHENOMENON,
  pin: PIN,
  relation: RELATION,
  species: SPECIES,
  title: TITLE,
  trait: TRAIT,
  zone: ZONE,
};

/**
 * Resolve a human description for `<type>.<field>`. Falls back to the shared
 * base fields when the type-specific map doesn't carry it. Returns `undefined`
 * for unknown fields so the UI can skip rendering a tooltip in those cases.
 */
export function getFieldDescription(type: ElementType, fieldName: string): string | undefined {
  return BY_TYPE[type]?.[fieldName] ?? BASE[fieldName];
}
