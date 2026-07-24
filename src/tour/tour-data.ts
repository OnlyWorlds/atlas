/**
 * The guided tour’s content: the Hyperion sentence + the step script.
 *
 * The tour turns the opening sentence of *Hyperion* by Dan Simmons into
 * OnlyWorlds elements, teaching atlas’s rooms along the way (Freek’s concept,
 * 2026-07-19; the v2 progressive build-up is Captain’s design round 2). The
 * world data is the baked demo bundle `src/demo/hyperion-world.json` (from
 * OnlyWorlds demo key 0000000000); steps reference bundle elements by
 * `"type:Name"` so re-bakes don’t break the script.
 *
 * Sentence channels:
 *   - cumulative FILL: words parsed by any step up to the current one carry
 *     their element-type color
 *   - GHOST GLYPHS: every span’s end word carries an inline element-type icon,
 *     pre-spaced from step 0 (dim ghost) and LIT when its step is reached —
 *     zero reflow, and the ghosts promise what’s coming (Skeld’s
 *     sentence-is-the-progress-bar, ow.com vignette grammar). A span carrying
 *     a `ref` lights on that element’s EXISTENCE instead (the per-mint pop).
 *
 * Steps carry NO titles (Captain’s cut, v2.1): the act label orients, a
 * hairline divides sentence from explainer, the body speaks for itself.
 *
 * PHASES (S301): a step’s narration is a list of phases, and which one speaks
 * is DERIVED from the world (`src/tour/tour-view.ts`), never stored. Most steps
 * are single-phase; the scripted objects run and the pin’s soft correction use
 * b/c/d phases, and their `when` predicates are PREFIX-nested (each a
 * refinement of the one before) so `resolvePhase` never breaks early.
 *
 * Order (S303 rework): opener (the sentence centre-stage) · elements (world,
 * consul, hegemony+title) · maps (planet, map+zone, pin, swamps) · objects &
 * links · writing · time · yours. Maps come before the objects so the pin’s
 * "sat" lights in reading order and the pin can land in the already-drawn zone.
 * The engine treats the last defined step as the finale; step 0 has no world.
 */

import type { ElementType } from '../core/types';
import type { TourPhase } from './tour-view';

export const TOUR_SENTENCE: readonly string[] =
  ('The Hegemony Consul sat on the balcony of his ebony spaceship and played ' +
   "Rachmaninov’s Prelude in C-sharp Minor on an ancient but well-maintained " +
   'Steinway while great, green, saurian things surged and bellowed in the swamps below.').split(' ');

/** The opener’s eyebrow line (step 1 only — steps carry no titles). */

/** The standard cite — book and year. (S308: the "no mortality claims"
 *  annotation was removed — it wasn’t Captain’s rule, and the opener’s own copy
 *  says "the late Dan Simmons", which is correct: he died 21 Feb 2026.) */
export const TOUR_ATTRIBUTION = 'Hyperion, Dan Simmons (1989)';
// Percent-encoded parens: the copy link token `[text](url)` ends its URL at
// the first `)`, so a raw-paren wiki URL would truncate (tour-bar COPY_LINK_RE).
export const TOUR_ATTRIBUTION_URL = 'https://en.wikipedia.org/wiki/Hyperion_%28Simmons_novel%29';

/** Inclusive word-index range painted with an element type’s color. */
export interface TourSpan {
  from: number;
  to: number;
  type: ElementType;
  /**
   * Bundle ref ("object:Ebony Spaceship") whose EXISTENCE lights this span’s
   * glyph. Absent = the step-keyed rule (lit once its step is reached).
   *
   * This is what lets a `creates` step pop one glyph per mint instead of
   * lighting all three the moment the step opens, and it collapses the two
   * hard-coded hands-on names that used to live in `buildSentence` into one
   * predicate shared by the consul, the pin and every scripted create.
   */
  ref?: string;
}

/**
 * A piece of app chrome the progressive build-up turns on. Capabilities are
 * CUMULATIVE and declared per step (`unlocks`), replacing the old ordinal
 * `data-tour-stage` number: that number was computed from `step.act`, so the
 * coming act restructure (locations before objects) would have flipped the
 * right pane on then off as the step order crossed act boundaries. A
 * capability, once unlocked, stays unlocked regardless of what order the steps
 * that follow are in.
 *
 *   shell     — the app shell is visible at all (else the bare centred opener)
 *   rightpane — the right pane + its divider (the maps act)
 *   writing   — the Writing room icon in the nav strip
 *   charts    — the Charts room icon
 *   allrooms  — the remaining icons (knowledge, pages, import, expander)
 */
export type TourCapability = 'shell' | 'rightpane' | 'writing' | 'charts' | 'allrooms';

/** Every capability, for stamping + teardown (a type has no runtime members). */
export const TOUR_CAPABILITIES: readonly TourCapability[] =
  ['shell', 'rightpane', 'writing', 'charts', 'allrooms'];

export interface TourStep {
  id: string;
  act: number;
  /** App chrome this step turns on (cumulative). See TourCapability. */
  unlocks?: TourCapability[];
  /**
   * The step’s narration, in order. The engine shows the last phase whose
   * `when` holds AND all earlier phases' `when` hold too (prefix semantics —
   * see tour-view.ts). Minimum one; a single-phase step behaves exactly as a
   * plain body/meta/deeper step did.
   */
  phases: TourPhase[];
  /** Words this step parses (cumulative fill + active highlight + a lit glyph at each span’s end). */
  spans?: TourSpan[];
  /** Bundle elements ("type:Name") revealed when this step is entered. */
  reveal?: string[];
  /**
   * Ordered bundle refs the USER mints, one per click of the app’s real `+`
   * (the scripted create door). Never auto-revealed on their own step; they
   * backfill once the tour moves strictly past, exactly like `handsOn`.
   */
  creates?: string[];
  /** Where atlas navigates on step enter. */
  route?:
    | { kind: 'home' }
    | { kind: 'elements' }
    | { kind: 'element'; ref: string }
    // `elementRef` opens the map AND selects an element in the middle (the
    // combined map/element route) — the pin beat needs the element’s header
    // visible so its real +pin button shows.
    | { kind: 'map'; ref: string; elementRef?: string }
    | { kind: 'writing'; ref: string }
    | { kind: 'chart' };
  /** Switch the right pane to the Web (context) tab on step enter. */
  webTab?: boolean;
  /**
   * Scroll the named element-detail section into view on step enter (S309):
   * the linking payoff narrates the World section and Referenced by, which sit
   * BELOW the tour dock at default scroll — a step whose subject is off-screen
   * teaches nothing. Matches `.atlas-detail-section[data-section="<name>"]`.
   */
  scrollToSection?: string;
  /**
   * Field rows the step's copy narrates get a subtle highlight while the step
   * is live (Captain, S316): each entry matches `.atlas-field[data-field=X]`
   * — the row attribute every field renders — or, prefixed `section:`, an
   * `.atlas-detail-section[data-section=X]` (for "Referenced by", which is a
   * section, not a field). Applied via one injected style tag (tour-bar), so
   * detail re-renders can never wipe it. Names must be [A-Za-z0-9_ -] only.
   */
  highlightFields?: string[];
  /**
   * Hands-on steps. The create beats and `set-now` are SINGLE ROUTE: the real
   * gesture is the only way forward, and no watch-mode Next is rendered (two
   * forward controls at a hands-on beat read as a fork — Captain, S298). Each
   * kind needs its own branch in `tour-bar`'s forward gate; a kind with no
   * bundle ref that falls through to the default is un-advanceable forever.
   */
  handsOn?: 'create-world' | 'create-consul' | 'place-pin' | 'set-now' | 'setup-folder' | 'link-word';
  /**
   * For a `place-pin` step: the forward gate ALSO requires the pin to sit
   * inside this zone (the soft correction — Captain’s ruling). The pin can be
   * dropped anywhere (never refused); Next appears only once it is over the
   * zone, and a wrong drop is dragged onto it, which teaches dragging pins.
   * The phase copy narrates the correction; this drives whether Next shows.
   */
  placeInZone?: { pinRef: string; zoneRef: string };
}

/** The pin the balcony-seat beat places, and the zone it must land inside.
 *  (S312: the spatial layer is Captain's live rebuild — map "Unnamed planet",
 *  zone "Swamps" — the unnamed-world resolution, hyperion.txt L307.) */
export const TOUR_PIN_REF = "pin:The Consul’s balcony seat";
export const TOUR_SWAMPS_ZONE_REF = 'zone:Swamps';
export const TOUR_MAP_REF = 'map:Unnamed planet';

/** The chapter the writing beat links (baked chip-free — see the-writing). */
export const TOUR_CHAPTER_REF = 'narrative:Chapter 1';

// The quiet-element list lives in tour-flag (the static-import-safe module —
// the elements sidebar needs it without pulling the lazy tour chunk);
// re-exported here so tour code and tests keep one import surface.
export { isQuietRef, TOUR_QUIET_REFS, TOUR_QUIET_TYPES } from './tour-flag';
import { isQuietRef } from './tour-flag';

/**
 * The preview stack's refs for step `stepIndex` (Captain, S316): what the
 * NEXT click of Next brings into the world — the FOLLOWING step's `reveal`
 * and `creates` lists, minus the quiet machinery above. "It is what you are
 * about to create." Hands-on elements (the consul, the pin, the linked word)
 * are never previewed: the gesture is its own preview, and the copy names it.
 * The last step previews nothing.
 */
export function previewRefsFor(stepIndex: number): string[] {
  const next = TOUR_STEPS[stepIndex + 1];
  if (!next) return [];
  return [...(next.creates ?? []), ...(next.reveal ?? [])].filter(r => !isQuietRef(r));
}
/**
 * How many of the sentence’s phrases can be linked AT THE WRITING BEAT.
 *
 * The sentence carries nine linkable surface forms, but `character:Rachmaninov`
 * and `construct:Rachmaninov’s Prelude` are not revealed until `deep-time`,
 * three steps later, so autolink cannot resolve them here. Seven is therefore
 * "everything this world currently knows", and the phase-c copy says exactly
 * that. A unit test recomputes this from the bundle + the reveal order, so a
 * re-bake or a reveal move fails loudly instead of stranding phase c.
 */
export const TOUR_WRITING_LINKABLE = 7;

export const TOUR_STEPS: readonly TourStep[] = [
  // ---------------------------------------------------------------- Opener
  // Step 0 (S303 rework): the sentence centre-stage on black, then it hands
  // off into the dock on "Begin". No `unlocks` at all, so
  // `:not(.atlas-tour-cap-shell)` hides the shell behind the big sentence.
  // Copy is Captain’s shorter variant and rides his copy pass.
  {
    id: 'the-sentence',
    act: 1,
    phases: [{
      id: 'a',
      // S312: the book link is INLINE on the word (Captain's ask) — the copy
      // token pass renders [text](url) safely, so the separate extras link
      // is retired.
      body:
        'The opening sentence of the novel [Hyperion](' + TOUR_ATTRIBUTION_URL + ') by the late Dan Simmons.',
    }],
  },
  // ---------------------------------------------------------------- Act 1
  {
    id: 'the-world',
    act: 1,
    unlocks: ['shell'],
    phases: [{
      id: 'a',
      body:
        'In Atlas, worlds are folders on your local drive that contain any number of elements. Let’s make a world that can capture this sentence.' +
        '\n\nClick the **create local world** icon in the top left. We’ll call it Hyperion after the novel.',
      meta: 'Normally this would create a folder on your drive, but this tour world is stored temporarily in your browser.',
    }],
    handsOn: 'create-world',
  },
  {
    id: 'the-consul',
    act: 1,
    phases: [
      {
        id: 'a',
        body:
          'Worlds are made of elements, and this Consul seems pre-eminent.\nClick the highlighted **+** to create him as a character.',
        // (The "real element dialog, locked to the tour’s script this once…" meta
        // was cut S301, Captain’s round — the dialog speaks for itself.)
      },
      {
        // The step used to keep asking for a deed already done (Captain, S306):
        // after the create, Next appeared but the copy still read "Create him
        // in the sidebar". Every other hands-on beat acknowledges its gesture.
        id: 'b',
        when: (w) => w.hasRef('character:The Consul'),
        body:
          'Here we see the Consul’s page, with empty fields through which you can define him.' +
          '\nAll elements share a set of \'base\' fields that you see at the top, ' + 
          'and each category has a set of specialized fields.\nEmpty fields are hidden during this tour for easier navigation.' + 
          '\n' + 
          '\nSo how do we model the diplomatic standing this character has? We can write something in their *description* field.' +
          '\nBut this Hegemony sounds like it deserves its own element. We\'ll create one for it, and for the title it bestowed.',  
      },
    ],
    spans: [{ from: 2, to: 2, type: 'character', ref: 'character:The Consul' }],
    handsOn: 'create-consul',
    // ROUTED, as of S307. This step used to carry no route at all: going
    // FORWARD it looked right only because creating an element navigates to
    // it as a side effect. Going BACK there is no create, so nothing
    // navigated and the middle pane kept showing whatever a LATER step had
    // opened — the narrator talking about the Consul over the institution’s
    // page. Captain saw it as the tour "jumping between the Consul and home",
    // because which surface you landed on depended on the path you took.
    //
    // A step’s route is a promise about what you are looking at; it must not
    // be a side effect of a gesture that only happens once.
    route: { kind: 'element', ref: 'character:The Consul' },
  },
  {
    // MERGED (S303 rework): the institution and the title were two steps; a
    // title is just a name of the institution beat here — one step reveals
    // both and teaches the distinction. Routes to the Hegemony (a rich element
    // page); the title rides the sidebar and the copy.
    id: 'the-hegemony',
    act: 1,
    phases: [{
      id: 'a',
      body:
        'The Hegemony is an institution: a category that represents any kind of organized body.' +
        '\n\nTitle is another category. Here\'s one that was issued by the Hegemony and is held by our character, as seen through its *issuer* and *holders* fields.' +
        '\nThis creates a traceable link between the Consul and the Hegemony.' ,
      meta: 'There are two types of link fields: single-link (like *issuer*) and multi-link, which can hold any number (like *holders*).',

 
    }],
    // One word per element, in reading order (Captain, S306): "The" carries the
    // TITLE, "Hegemony" the institution, and "Consul" is left alone so the
    // character colour it earned on the previous step survives. `fillMap`
    // walks steps in order and later spans overwrite earlier ones, so a title
    // span on word 2 here used to repaint the Consul away from his own colour.
    spans: [
      { from: 0, to: 0, type: 'title' },
      { from: 1, to: 1, type: 'institution' },
    ],
    reveal: ['institution:The Hegemony', 'title:Consul of the Hegemony'],
    // Routes to the TITLE, scrolled to its Mandate section (Captain, S311):
    // grant date, issuer, holders — the clearest link cluster in the young
    // world, and the copy teaches issued-by/held-by against exactly those
    // rows. (It routed to the institution before; the Hegemony's page is
    // richer prose but its links sit below the dock at default scroll.)
    route: { kind: 'element', ref: 'title:Consul of the Hegemony' },
    scrollToSection: 'Mandate',
    // The copy teaches issued-by/held-by against exactly these rows (S316).
    highlightFields: ['issuer', 'holders'],
  },
  // ---------------------------------------------------------------- Act 2 (maps)
  // Locations and the map now come BEFORE the objects (S303 rework): this lights
  // "sat" (the pin, word 3) in reading order ahead of "balcony" and "spaceship",
  // and it lets the pin beat’s soft correction land the seat over the swamps —
  // which requires the zone to already be on the map, so the zone reveals here.
  {
    id: 'the-planet',
    act: 2,
    // `unlocks: ['rightpane']` MOVED to `the-map` (S308). It sat here, so the
    // largest single piece of chrome in the whole build-up slid in during a
    // pure elements beat with no narration, and the NEXT step then said "a new
    // pane just opened on the right" about something that had opened a step
    // earlier. The tour’s promise is that the workspace builds itself around
    // you and the narrator names each piece AS it arrives; this was the one
    // place that promise ran a beat behind. Nothing between the two steps reads
    // the capability, and `the-map` is the step that actually needs it (its
    // route opens a map tab, which lives in the right pane).
    phases: [{
      id: 'a',
      body:
        'The Consul is above what sounds like a planet. So we\'ll create a location for it: any physical place in a world that can be named or, in this case, unnamed.' +
        '\n\nWe\'ve assigned it in the Consul\'s *location* field: the planet\'s page now lists him under Referenced by.',
          meta: 'Locations can be nested: a city on a continent on a planet.',
    }],
    spans: [{ from: 35, to: 35, type: 'location' }],
    reveal: ['location:Unnamed Planet'],
    route: { kind: 'element', ref: 'location:Unnamed Planet' },
    // The copy narrates the *location* assignment and the Referenced-by
    // payoff; the planet's page shows the latter (S316).
    highlightFields: ['section:Referenced by'],
  },
  {
    id: 'the-map',
    act: 2,
    unlocks: ['rightpane'],
    phases: [{
      id: 'a',
      body:
        'Maps are elements that act as 2d or 3d canvases onto which you can place other elements.' +
        '\nThey take a pre-existing image and let you place pins on it, for specific elements, or markers, which combine into zones.' +
        '\n\nThis map shows part of the unnamed planet, with the swamps laid on top as a zone.' ,
      meta: 'Zones are physical boundaries of natural or cultural significance. Two drawing shapes: polygons (e.g. swamps, territories) and lines (e.g. roads, rivers).',

      // Captain, S307: the step said a map "carries an image" and never said
      // where that image comes from, which is the first question anyone has
      // about their OWN map. Both routes below are verified against the real
      // controls (map-create-modal’s URL field + the local-file row added in
      // S253), because copy naming a control is a behavioural claim. 
    }],
    // The swamps zone (and its markers) reveal WITH the map — the pin beat’s
    // soft correction needs the region present to test the drop against, and
    // the geography reads as one thing. The living things stay for the-swamps.
    // Span starts at "the" (33), not "in" (32): the zone is the swamps, the
    // preposition stays plain (Captain, S316).
    spans: [{ from: 33, to: 34, type: 'zone' }],
    reveal: [
      TOUR_MAP_REF,
      TOUR_SWAMPS_ZONE_REF,
      'marker:Swamps - Point 0', 'marker:Swamps - Point 1', 'marker:Swamps - Point 2',
      'marker:Swamps - Point 3', 'marker:Swamps - Point 4', 'marker:Swamps - Point 5',
    ],
    route: { kind: 'map', ref: TOUR_MAP_REF },
  },
  {
    id: 'the-pin',
    act: 2,
    // The soft correction (Captain’s ruling): place anywhere, Next appears only
    // once the pin is over the swamps; a wrong drop is dragged onto them, which
    // teaches dragging pins. `placeInZone` drives the gate; the phases narrate.
    placeInZone: { pinRef: TOUR_PIN_REF, zoneRef: TOUR_SWAMPS_ZONE_REF },
    phases: [
      {
        id: 'a',
        body:
          'Let\'s place the Consul on the map using a pin.' +
          '\nClick the **+ pin** icon opposite the Consul\'s name, then click on the map to place him.\nPut him somewhere over the swamps, per canon.',
  
        deeper:
          'So why not create a pin for the spaceship, instead? ' +
          'There would be no certainty, then, of where the Consul is, ' +
          'as there is currently no field that says ' +
          '\'this character is in this object\'.' +
          '\n\n' +
          'Unlike, for example, if we pinned a city on the map, and linked that city in the Consul\'s ' +
          '*location* field; this lets us infer with certainty that the Consul is at the same place as that city\'s pin.' +
          '\n\nThis is a limitation of the language as it is now. For [cases like this](https://council.onlyworlds.com/#/chamber/character/3b6bdcff-06a7-4c26-be60-497b042d4763), ' +
          'the council is a place to discuss, vote, then act to improve the language.',
      },
      {
        // Placed, but the gate (pinInZone) has not passed — the correction.
        // `when: hasRef` is a PREFIX of phase c’s `hasRef && pinInZone`, so a
        // good drop resolves straight to c and a wrong one holds here.
        id: 'b',
        when: (w) => w.hasRef(TOUR_PIN_REF),
        body:
          'Drag the pin onto the zone, so that the Consul can observe the saurians below.',
      },
      {
        id: 'c',
        when: (w) => w.hasRef(TOUR_PIN_REF) && w.pinInZone(TOUR_PIN_REF, TOUR_SWAMPS_ZONE_REF),
        body:
          'Placed. Click the pin any time to select the Consul again.' ,
      },
    ],
    handsOn: 'place-pin',
    spans: [{ from: 3, to: 3, type: 'pin', ref: TOUR_PIN_REF }],
    reveal: [],
    // Map open (right) + the Consul selected (middle) so his +pin button shows.
    route: { kind: 'map', ref: TOUR_MAP_REF, elementRef: 'character:The Consul' },
  },
  {
    id: 'the-swamps',
    act: 2,
    phases: [{
      id: 'a',
      body:
        // "the zone you traced onto the map" was wrong (Captain, S306): the
        // Swamps zone is REVEALED with the map at the previous beat, the user
        // never draws it. Copy must not credit the reader with a gesture the
        // tour performed for them.
        // S308: "all linked to the swamps zone" was false for two of the four
        // elements this step reveals, and schema-impossible for one — a
        // collective has no zone field, so the old copy implied a link the
        // model cannot express. Narrowed to what is true and checkable.
        'There are saurian things below, so we created two creatures, one of which must inevitably be greater than the other.' +
        '\nPhysical bodies can be grouped into collectives; one was created to represent the pack of them.'  +
        '\nSpecies capture a cultural or, in this case, biological classification.'  ,
          }],
    spans: [
      { from: 27, to: 27, type: 'creature' },
    ],
    reveal: [
      'creature:Great Green Saurian', 'creature:Greater Green Saurian',
      'species:Saurians', 'collective:Pack of Bellowing Saurians',
    ],
    route: { kind: 'map', ref: TOUR_MAP_REF },
  },
  // ------------------------------------------------------- Act 1 (objects & links)
  // Objects and linking now follow the maps act (S303 rework) so the pin lights
  // "sat" before these light "balcony" / "spaceship".
  {
    id: 'objects',
    act: 1,
    // The first scripted RUN: the user mints these three with the app’s own +,
    // one per click, and Next waits for all of them. Copy here is provisional
    // and rides Captain’s copy pass.
    creates: ['object:Ebony Spaceship', 'object:Spaceship Balcony', "object:The Consul’s Steinway"],
    phases: [
      {
        id: 'a',
        body:
          'Three objects sit in the sentence, with particular relations: the balcony is part of the spaceship, and the piano is inside the ship.' +
          '\nWe can model this situation by setting the spaceship as the *parent object* of the balcony and piano.'+
          '\nClick the **create element** button three more times to set this up.',
      },
      {
        id: 'b',
        when: (w) => w.hasRef('object:Ebony Spaceship'),
        body:
          'The spaceship is in the world, and it is already on the Consul: it is linked in his objects field.' +
          '\nAdd the balcony next.',
      },
      {
        id: 'c',
        when: (w) => w.hasRef('object:Spaceship Balcony'),
        body:
          'The balcony’s *parent object* is the spaceship: objects nest in objects, ' +
          'the same way locations nest in locations. One more click for the piano.',
      },
      {
        id: 'd',
        when: (w) => w.hasRef("object:The Consul’s Steinway"),
        body:
          'Three objects that are now linked to each other and their owner. Let’s carry on.',
   
 
      },
    ],
    spans: [
      { from: 6, to: 6, type: 'object', ref: 'object:Spaceship Balcony' },
      { from: 9, to: 10, type: 'object', ref: 'object:Ebony Spaceship' },
      { from: 23, to: 23, type: 'object', ref: "object:The Consul’s Steinway" },
    ],
    // NOT routed at an object it creates (gate R7): the step would open on the
    // app’s "Element not found in this world" card with the dock underneath
    // telling the user to make it. The Consul is the right surface anyway —
    // his Objects fill in as each object lands.
    route: { kind: 'element', ref: 'character:The Consul' },
    // Per-mint navigation opens each new object's page; the copy teaches
    // *parent object* there (S316).
    highlightFields: ['parent_object'],
  },
  {
    id: 'linking',
    act: 1,
    phases: [{
      id: 'a',
      body:
        'Back to the Consul: a man of the world, clearly, going by his many links.\nClick any chip to travel to that element.' ,
 
    }],
    reveal: [],
    route: { kind: 'element', ref: 'character:The Consul' },
    // The payoff this step narrates (World section, Referenced by) sits below
    // the dock at default scroll — bring the subject on screen (S309).
    scrollToSection: 'World',
  },
  // ---------------------------------------------------------------- Act 3
  {
    id: 'the-writing',
    act: 3,
    unlocks: ['writing'],
    // HANDS-ON (S306): the chapter is baked as PLAIN prose (no ow:// chips) and
    // the user links the sentence themselves. Every surface form in it carries a
    // baked alias, so autolink underlines each one it can resolve.
    //
    // Only SEVEN of the sentence’s nine phrases are linkable HERE: Rachmaninov
    // and his Prelude are not revealed until `deep-time`, three steps later. The
    // phase-c copy says so rather than promising a fully linked sentence, and
    // TOUR_WRITING_LINKABLE locks the number so a reveal change fails loudly.
    phases: [
      {
        id: 'a',
        body:
          // "hover a dotted word" was WRONG and cost Captain a live confusion
          // (S306): `handleKeyDown` promotes the decoration containing the
          // CURSOR, so hovering does nothing and Tab just moves focus out of
          // the editor. The gesture is click-then-Tab.
          'The writing room is where you write and organize long-form stories.' +
          '\nStories organize in three customizable tiers: Book, Chapter and Scene by default.' +
          '\nWorld elements can be linked while you write. Try clicking one of the blue underlined words, or hovering one and pressing Tab.',
 
   
      },
      {
        id: 'b',
        when: (w) => w.chipCount(TOUR_CHAPTER_REF) >= 1,
        // Points at the LINK-ALL corner button (top-right of the prose panel,
        // `refreshLinkAllWidget`), not the tree’s right-click menu: it is in
        // the page the user is already looking at and it carries the count.
        // Found while chasing Captain’s Tab report — the affordance was there
        // the whole time and the copy was sending people to a context menu.
        body:
          'That word is a chip now, pointing at the element itself. Keep going by ' +
          'hand, or use the link button in the top right of the page to catch the ' +
          'rest at once.',
      },
      {
        id: 'c',
        when: (w) => w.chipCount(TOUR_CHAPTER_REF) >= TOUR_WRITING_LINKABLE,
        body:
          'You can unlink elements, or create new ones, by selecting and right-clicking.'  +
          '\nThe writing room uses layered narrative elements to organize these stories and the links within them.' , 
      },
    ],
    handsOn: 'link-word',
    reveal: ['narrative:Hyperion', 'narrative:Chapter 1'],
    route: { kind: 'writing', ref: 'narrative:Chapter 1' },
  },
  {
    id: 'the-events',
    act: 3,
    phases: [{
      id: 'a',
      body:
        'Events are your world\'s temporal anchors. The sentence holds two that are clearly linked: the Consul\'s performance, and the raging it stirs ' +
        'below.\n'  ,
    }],
    spans: [
      { from: 12, to: 12, type: 'event' },
      { from: 29, to: 31, type: 'event' },
    ],
    // Rachmaninov and his Prelude moved OUT of this step (S305): they carry the
    // Old Earth dates, and revealing them here would put centuries of deep time
    // on the axis before the chart has taught what the axis is.
    reveal: ['event:The Primal Performance', 'event:The Raging of the Beasts'],
    route: { kind: 'element', ref: 'event:The Primal Performance' },
  },
  // ---------------------------------------------------------------- Act 4
  {
    id: 'the-chart',
    act: 4,
    unlocks: ['charts'],
    // The world’s clock arrives UNSET (the bundle ships no `time_current`), so
    // the "set now time" button is really there to be pressed. Setting it is
    // what makes the gold line appear and what gives the Consul’s open-ended
    // title an end to run to: one click, and two things the room can do become
    // visible at once.
    handsOn: 'set-now',
    // The calendar element itself: the eras it names are read from here, and it
    // has to be on disk before the axis can speak them.
    reveal: ['construct:Hegemony Standard'],
    phases: [
      {
        id: 'a',
        body:
          'The Charts room makes your elements navigable across time.\nBoth events sit on ' +
          'the same moment, as you see above.\nYou can set a \'now\' time for your world; try it with the highlighted **set now time** button.',
        advanceWhen: (w) => w.nowIsSet,
      },
      {
        id: 'b',
        when: (w) => w.nowIsSet,
        body:
          'The gold line marks the now, and the Consul’s title draws as a span: it ' +
          'starts when the title was granted and runs to the present.\nIts soft ' +
          'end means no end is recorded, so as far as we know he holds ' +
          'it still.',
        deeper:
        'The chart is a live view, not a picture: scroll to zoom from whole eras down ' +
        'to single days, drag any element’s dot to re-date it, and drag undated elements ' +
        'in from the rail to give them their first date. Save any arrangement as a named ' +
        'chart and it remembers its window, its cast, and its lens.' +
        '\n\n' +
        'Worlds can also carry their own calendars: a way to name months, eras, festivals, basic time units.'+
        '\n\nClick the \'Hegemony Standard\' chip above the chart view to see one.',
   
   
      },
    ],
    route: { kind: 'chart' },
  },
  {
    // Deep time, and the eras that name it. Revealing Rachmaninov here rather
    // than with the events is deliberate: his date sits centuries back, and the
    // chart only teaches something once there is a present to measure it from.
    id: 'deep-time',
    act: 4,
    phases: [{
      id: 'a',
      body:
        'Rachmaninov and his prelude join the world, and they are old: both sit ' +
        'far back in the Old Earth era, centuries before anything else here. ' +
        '\nThe axis stretched out to hold them. You can scroll to zoom back in on the ' +
        'present.',
   
    }],
    spans: [
      { from: 13, to: 13, type: 'character' },
      { from: 14, to: 17, type: 'construct' },
    ],
    reveal: ['character:Rachmaninov', "construct:Rachmaninov’s Prelude"],
    route: { kind: 'chart' },
  },
  // ---------------------------------------------------------------- Act 5
  {
    id: 'the-rest',
    act: 5,
    unlocks: ['allrooms'],
    phases: [{
      id: 'a',
      body:
        'We can find more in the sentence: a piano-making character, a piano-related ability, a piano-related trait, ' +
        'a musical language, a piano-related phenomenon.'  ,
    }],
    // The Rachmaninov spans moved to the deep-time step, where those two
    // elements are now revealed — a span’s glyph and its element should light
    // on the same beat.
    spans: [],
    reveal: [
      'character:Mr. Steinway', 'construct:Steinway Piano', 'ability:Piano Playing',
      'trait:Swamp Rage', 'language:Western Musical Notation', 'phenomenon:Piano Music',
      'narrative:Story of the old piano',
    ],
    route: { kind: 'elements' },
  },
  {
    // MERGED (S306, Captain: "i do believe there are TWO final steps we can
    // remove"). `where-it-lives` and `online` were two soft beats saying
    // adjacent things — the files story and the OnlyWorlds story — right where
    // the tour should be closing. One step now carries both in a sentence
    // each, with the detail in the flyout for anyone who wants it. Keeps the
    // Web tab’s only introduction (`webTab`), which lived on the cut step.
    id: 'yours-to-keep',
    act: 5,
    phases: [{
      id: 'a',
      body:
        'Atlas is powered by OnlyWorlds, from which it gets the categories and their fields. You can use custom fields on top of these.' +
        '\nCreate a free OnlyWorlds account to sync your worlds online and into other applications.' +
        '\nManage and share them through world-specific keys that you can mint.' +
        '\nThis Hyperion world can be accessed at any time using the read-only key 0000000000.',
 
    }],
    route: { kind: 'element', ref: 'character:The Consul' },
    webTab: true,
  },
  {
    id: 'finale',
    act: 5,
    phases: [{
      id: 'a',
      // NO UNCONDITIONAL GESTURE HERE (S307). This used to end "Pick one and
      // start building, or finish here" — but the folder picker button is
      // gated on `hasFolderMode()`, and OPFS-only browsers (Safari 18.2+,
      // Firefox, which `main.ts` deliberately admits in tour-capable mode)
      // can complete all 17 steps and never see it. The code branched on the
      // capability; the sentence did not, so it instructed a control that was
      // not on screen. Same class as "hover a dotted word and press Tab"
      // (S306) — copy naming a control is a behavioural claim.
      // The buttons say what is available; the prose no longer guesses.
      body:
        'That\'s the tour. Each room\'s help icon in the footer has more.' +
        '\nQuestions, bugs and feature requests are welcome: through [Discord](https://discord.gg/twCjqvVBwb), ' +
        'the [feedback tracker](https://github.com/OnlyWorlds/feedback), or email at info@onlyworlds.com.',
      meta: 'The tour world leaves nothing behind. Replay it anytime from settings.',
    }],
    handsOn: 'setup-folder',
  },
];

// (TOUR_ACT_NAMES was deleted S304: the visible act label was cut in the Freek
// round and nothing consumed the map since. The reorder also broke its premise
// — act:1 steps like objects/linking now sit physically after the act:2 maps —
// so a revived consumer would render acts out of order. The `act` field on each
// step is now loose grouping metadata only, not rendered.)

/**
 * Every capability unlocked by steps 0..stepIndex — the progressive build-up,
 * cumulative. The bar stamps `atlas-tour-cap-<name>` on <body> for each, and
 * atlas.css hides chrome whose capability is not yet present.
 *
 * Replaced the ordinal `tourStageFor`: because that number was derived from
 * `step.act`, interleaving acts (the coming restructure puts locations and the
 * map before the objects) would have made it non-monotonic — the right pane
 * flipping on at a maps step, off at the next elements step. A capability set
 * only ever grows.
 */
export function capabilitiesUpTo(stepIndex: number): Set<TourCapability> {
  const caps = new Set<TourCapability>();
  const last = Math.min(Math.max(stepIndex, 0), TOUR_STEPS.length - 1);
  for (let i = 0; i <= last; i++) {
    for (const c of TOUR_STEPS[i].unlocks ?? []) caps.add(c);
  }
  return caps;
}
