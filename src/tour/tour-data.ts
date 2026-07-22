/**
 * The guided tour's content: the Hyperion sentence + the step script.
 *
 * The tour turns the opening sentence of *Hyperion* by Dan Simmons into
 * OnlyWorlds elements, teaching atlas's rooms along the way (Freek's concept,
 * 2026-07-19; the v2 progressive build-up is Captain's design round 2). The
 * world data is the baked demo bundle `src/demo/hyperion-world.json` (from
 * OnlyWorlds demo key 0000000000); steps reference bundle elements by
 * `"type:Name"` so re-bakes don't break the script.
 *
 * Sentence channels:
 *   - cumulative FILL: words parsed by any step up to the current one carry
 *     their element-type color
 *   - GHOST GLYPHS: every span's end word carries an inline element-type icon,
 *     pre-spaced from step 0 (dim ghost) and LIT when its step is reached —
 *     zero reflow, and the ghosts promise what's coming (Skeld's
 *     sentence-is-the-progress-bar, ow.com vignette grammar). A span carrying
 *     a `ref` lights on that element's EXISTENCE instead (the per-mint pop).
 *
 * Steps carry NO titles (Captain's cut, v2.1): the act label orients, a
 * hairline divides sentence from explainer, the body speaks for itself.
 *
 * PHASES (S301): a step's narration is a list of phases, and which one speaks
 * is DERIVED from the world (`src/tour/tour-view.ts`), never stored. Most steps
 * are single-phase; the scripted objects run and the pin's soft correction use
 * b/c/d phases, and their `when` predicates are PREFIX-nested (each a
 * refinement of the one before) so `resolvePhase` never breaks early.
 *
 * Order (S303 rework): opener (the sentence centre-stage) · elements (world,
 * consul, hegemony+title) · maps (planet, map+zone, pin, swamps) · objects &
 * links · writing · time · yours. Maps come before the objects so the pin's
 * "sat" lights in reading order and the pin can land in the already-drawn zone.
 * The engine treats the last defined step as the finale; step 0 has no world.
 */

import type { ElementType } from '../core/types';
import type { TourPhase } from './tour-view';

export const TOUR_SENTENCE: readonly string[] =
  ('The Hegemony Consul sat on the balcony of his ebony spaceship and played ' +
   "Rachmaninov's Prelude in C-sharp Minor on an ancient but well-maintained " +
   'Steinway while great, green, saurian things surged and bellowed in the swamps below.').split(' ');

/** The opener's eyebrow line (step 1 only — steps carry no titles). */

/** The standard cite — book and year, no mortality claims (Skeld's check). */
export const TOUR_ATTRIBUTION = 'Hyperion, Dan Simmons (1989)';
export const TOUR_ATTRIBUTION_URL = 'https://en.wikipedia.org/wiki/Hyperion_(Simmons_novel)';

/** Inclusive word-index range painted with an element type's color. */
export interface TourSpan {
  from: number;
  to: number;
  type: ElementType;
  /**
   * Bundle ref ("object:Ebony Spaceship") whose EXISTENCE lights this span's
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
   * The step's narration, in order. The engine shows the last phase whose
   * `when` holds AND all earlier phases' `when` hold too (prefix semantics —
   * see tour-view.ts). Minimum one; a single-phase step behaves exactly as a
   * plain body/meta/deeper step did.
   */
  phases: TourPhase[];
  /** Words this step parses (cumulative fill + active highlight + a lit glyph at each span's end). */
  spans?: TourSpan[];
  /** Bundle elements ("type:Name") revealed when this step is entered. */
  reveal?: string[];
  /**
   * Ordered bundle refs the USER mints, one per click of the app's real `+`
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
    // combined map/element route) — the pin beat needs the element's header
    // visible so its real +pin button shows.
    | { kind: 'map'; ref: string; elementRef?: string }
    | { kind: 'writing'; ref: string }
    | { kind: 'chart' };
  /** Switch the right pane to the Web (context) tab on step enter. */
  webTab?: boolean;
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
   * inside this zone (the soft correction — Captain's ruling). The pin can be
   * dropped anywhere (never refused); Next appears only once it is over the
   * zone, and a wrong drop is dragged onto it, which teaches dragging pins.
   * The phase copy narrates the correction; this drives whether Next shows.
   */
  placeInZone?: { pinRef: string; zoneRef: string };
}

/** The pin the balcony-seat beat places, and the zone it must land inside. */
export const TOUR_PIN_REF = "pin:The Consul's balcony seat";
export const TOUR_SWAMPS_ZONE_REF = 'zone:The Swamps';

/** The chapter the writing beat links (baked chip-free — see the-writing). */
export const TOUR_CHAPTER_REF = 'narrative:Chapter 1';
/**
 * How many of the sentence's phrases can be linked AT THE WRITING BEAT.
 *
 * The sentence carries nine linkable surface forms, but `character:Rachmaninov`
 * and `construct:Rachmaninov's Prelude` are not revealed until `deep-time`,
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
  // Copy is Captain's shorter variant and rides his copy pass.
  {
    id: 'the-sentence',
    act: 1,
    phases: [{
      id: 'a',
      body:
        'The opening sentence of Hyperion (1989) by the late Dan Simmons.' +
        '\n\n' +
        'What elements do you see that should have a name in this world?',
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
        'Each world needs a folder. Click in the top left to create one for our sentence.' ,
      meta: 'Normally this would create a local folder, but the tour world stays in your browser.',
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
          'The Consul seems pre-eminent in this tiny world. Create him in the sidebar.',
        // (The "real element dialog, locked to the tour's script this once…" meta
        // was cut S301, Captain's round — the dialog speaks for itself.)
      },
      {
        // The step used to keep asking for a deed already done (Captain, S306):
        // after the create, Next appeared but the copy still read "Create him
        // in the sidebar". Every other hands-on beat acknowledges its gesture.
        id: 'b',
        when: (w) => w.hasRef('character:The Consul'),
        body:
          'There he is: your first element, and the first word of the sentence ' +
          'with a name behind it.',
      },
    ],
    spans: [{ from: 2, to: 2, type: 'character', ref: 'character:The Consul' }],
    handsOn: 'create-consul',
    // ROUTED, as of S307. This step used to carry no route at all: going
    // FORWARD it looked right only because creating an element navigates to
    // it as a side effect. Going BACK there is no create, so nothing
    // navigated and the middle pane kept showing whatever a LATER step had
    // opened — the narrator talking about the Consul over the institution's
    // page. Captain saw it as the tour "jumping between the Consul and home",
    // because which surface you landed on depended on the path you took.
    //
    // A step's route is a promise about what you are looking at; it must not
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
        'Two more elements: the Hegemony is an institution, an organization in ' +
        'the world, and “Consul” is a title, its own element, connecting him to ' +
        'it. Both just appeared in the left sidebar, where every element lives, ' +
        'filterable by type.',
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
    route: { kind: 'element', ref: 'institution:The Hegemony' },
  },
  // ---------------------------------------------------------------- Act 2 (maps)
  // Locations and the map now come BEFORE the objects (S303 rework): this lights
  // "sat" (the pin, word 3) in reading order ahead of "balcony" and "spaceship",
  // and it lets the pin beat's soft correction land the seat over the swamps —
  // which requires the zone to already be on the map, so the zone reveals here.
  {
    id: 'the-planet',
    act: 2,
    unlocks: ['rightpane'],
    phases: [{
      id: 'a',
      body:
        'What is below the balcony? A world. Locations hold the places of your ' +
        'setting, and they nest: a city sits on a continent, a continent on a planet.',
    }],
    spans: [{ from: 35, to: 35, type: 'location' }],
    reveal: ['location:Planet Hyperion'],
    route: { kind: 'element', ref: 'location:Planet Hyperion' },
  },
  {
    id: 'the-map',
    act: 2,
    phases: [{
      id: 'a',
      body:
        'A map is an element that carries an image: this one shows Hyperion, and ' +
        'a new pane just opened on the right to hold it. Regions can be traced ' +
        'onto it too: the swamps are a zone, drawn right there.',
      // Captain, S307: the step said a map "carries an image" and never said
      // where that image comes from, which is the first question anyone has
      // about their OWN map. Both routes below are verified against the real
      // controls (map-create-modal's URL field + the local-file row added in
      // S253), because copy naming a control is a behavioural claim.
      deeper:
        'Your own maps take an image two ways: paste a URL, or choose a file ' +
        'from your computer. A chosen file is copied into the world folder ' +
        'and never uploaded anywhere, so the map keeps working offline and ' +
        'travels with the folder. You can also make a map with no image at ' +
        'all and draw on the blank canvas, then add the art later.',
    }],
    // The swamps zone (and its markers) reveal WITH the map — the pin beat's
    // soft correction needs the region present to test the drop against, and
    // the geography reads as one thing. The living things stay for the-swamps.
    spans: [{ from: 32, to: 34, type: 'zone' }],
    reveal: [
      'map:Hyperion',
      'zone:The Swamps',
      'marker:The Swamps - Point 0', 'marker:The Swamps - Point 1', 'marker:The Swamps - Point 2',
      'marker:The Swamps - Point 3', 'marker:The Swamps - Point 4', 'marker:The Swamps - Point 5',
      'marker:The Swamps - Point 6', 'marker:The Swamps - Point 7', 'marker:The Swamps - Point 8',
    ],
    route: { kind: 'map', ref: 'map:Hyperion' },
  },
  {
    id: 'the-pin',
    act: 2,
    // The soft correction (Captain's ruling): place anywhere, Next appears only
    // once the pin is over the swamps; a wrong drop is dragged onto them, which
    // teaches dragging pins. `placeInZone` drives the gate; the phases narrate.
    placeInZone: { pinRef: TOUR_PIN_REF, zoneRef: TOUR_SWAMPS_ZONE_REF },
    phases: [
      {
        id: 'a',
        body:
          'Pins place elements on maps. Click the highlighted pin button on the ' +
          'Consul, then click the swamps below to set his balcony seat over them.',
        deeper:
          'A sharp eye notices the pin holds the Consul, not his spaceship: a pin ' +
          'records where an ELEMENT is, and the schema has no field yet that says a ' +
          'character is aboard a vehicle. So we know where the Consul sat, and the ' +
          'ship is wherever he is.' +
          '\n\n' +
          'That kind of gap is not fixed by one tool inventing a field: the ' +
          'OnlyWorlds schema grows through council motions, public proposals anyone ' +
          'can raise and argue. A motion to give characters a vehicle or equipment ' +
          'field would close exactly this gap, for every tool at once.',
      },
      {
        // Placed, but the gate (pinInZone) has not passed — the correction.
        // `when: hasRef` is a PREFIX of phase c's `hasRef && pinInZone`, so a
        // good drop resolves straight to c and a wrong one holds here.
        id: 'b',
        when: (w) => w.hasRef(TOUR_PIN_REF),
        body:
          'The seat is on the map. If it is not over the swamps, drag the pin onto ' +
          'them: he is looking down at the saurians below, so the seat sits above ' +
          'the zone.',
      },
      {
        id: 'c',
        when: (w) => w.hasRef(TOUR_PIN_REF) && w.pinInZone(TOUR_PIN_REF, TOUR_SWAMPS_ZONE_REF),
        body:
          'Placed. His balcony seat sits over the swamps, and the pin holds the ' +
          'Consul’s identity: click it any time to travel back to him.',
      },
    ],
    handsOn: 'place-pin',
    spans: [{ from: 3, to: 3, type: 'pin', ref: TOUR_PIN_REF }],
    reveal: [],
    // Map open (right) + the Consul selected (middle) so his +pin button shows.
    route: { kind: 'map', ref: 'map:Hyperion', elementRef: 'character:The Consul' },
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
        'The saurian things live in those swamps: two creatures, their species, ' +
        'and one bellowing pack, all linked to the swamps zone on the map.',
    }],
    spans: [
      { from: 27, to: 27, type: 'creature' },
    ],
    reveal: [
      'creature:Great Green Saurian', 'creature:Greater Green Saurian',
      'species:Saurians', 'collective:Saurian Pack',
    ],
    route: { kind: 'map', ref: 'map:Hyperion' },
  },
  // ------------------------------------------------------- Act 1 (objects & links)
  // Objects and linking now follow the maps act (S303 rework) so the pin lights
  // "sat" before these light "balcony" / "spaceship".
  {
    id: 'objects',
    act: 1,
    // The first scripted RUN: the user mints these three with the app's own +,
    // one per click, and Next waits for all of them. Copy here is provisional
    // and rides Captain's copy pass.
    creates: ['object:Ebony Spaceship', 'object:Spaceship Balcony', "object:The Consul's Steinway"],
    phases: [
      {
        id: 'a',
        body:
          'Three objects sit in this sentence. Add them yourself: the + above the ' +
          'element list adds the next one, starting with the ebony spaceship.',
      },
      {
        id: 'b',
        when: (w) => w.hasRef('object:Ebony Spaceship'),
        body:
          'The spaceship is in the world, and it is already on the Consul: his ' +
          'Possessions hold it. Add the balcony next.',
      },
      {
        id: 'c',
        when: (w) => w.hasRef('object:Spaceship Balcony'),
        body:
          'The balcony’s “parent object” is the spaceship: objects nest in objects, ' +
          'the same way locations nest in locations. One more, the Steinway.',
      },
      {
        id: 'd',
        when: (w) => w.hasRef("object:The Consul's Steinway"),
        body:
          'Three objects, each linked as it arrived. The balcony rides along inside ' +
          'the ship, which is why the Consul’s Possessions hold two of the three.',
      },
    ],
    spans: [
      { from: 6, to: 6, type: 'object', ref: 'object:Spaceship Balcony' },
      { from: 9, to: 10, type: 'object', ref: 'object:Ebony Spaceship' },
      { from: 23, to: 23, type: 'object', ref: "object:The Consul's Steinway" },
    ],
    // NOT routed at an object it creates (gate R7): the step would open on the
    // app's "Element not found in this world" card with the dock underneath
    // telling the user to make it. The Consul is the right surface anyway —
    // his Possessions fill in as each object lands.
    route: { kind: 'element', ref: 'character:The Consul' },
  },
  {
    id: 'linking',
    act: 1,
    phases: [{
      id: 'a',
      body:
        'Back on the Consul’s page: his Possessions now hold the spaceship and the ' +
        'Steinway (the balcony rides along inside the ship), his ' +
        'Affiliations hold the Hegemony, and Referenced-by at the bottom shows his title pointing back at him. ' +
        'Click any chip to travel. This web of links is the heart of OnlyWorlds.',
      deeper:
        'Links are what make a world more than a pile of notes. Every element type ' +
        'has typed link fields (a character has abilities, objects, family; a title has ' +
        'an issuer and holders), and every link is two-way: set it on one side and the ' +
        'other side shows it under Referenced-by automatically.' +
        '\n\n' +
        // The Web tab used to be named here (S304 gate, banked LOW): it stays
        // HIDDEN until `where-it-lives` five steps later, which introduces it
        // properly against the folder. Naming a tab the user cannot see yet is
        // a promise the chrome does not keep.
        'When you want to go further, the Knowledge room tracks which characters KNOW ' +
        'each fact, so what the reader knows and what the villain knows can differ.' +
        '\n\n' +
        'Tools across the OnlyWorlds ecosystem read these same links.',
    }],
    reveal: [],
    route: { kind: 'element', ref: 'character:The Consul' },
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
    // Only SEVEN of the sentence's nine phrases are linkable HERE: Rachmaninov
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
          'The Writing room holds your long-form work: books, chapters, scenes. ' +
          'This is Chapter 1 of Hyperion, the sentence itself, and it is plain text. ' +
          'Atlas already recognises the names it knows: click inside a dotted word, ' +
          'then press Tab to turn it into a link. Try a few.',
        deeper:
          'Chips are live: click one to travel to its element, and the link shows on ' +
          'the other side too, under Referenced-by.' +
          '\n\n' +
          'The words in your prose rarely match an element’s full name. Atlas already ' +
          'knows “Steinway” is one of the names the Consul’s piano goes by, which is ' +
          'why it recognised the word at all. In your own writing, linking a phrase ' +
          'that is not an element’s name records it as an alias on that element: your ' +
          'prose keeps reading exactly as you wrote it, and the next mention is ' +
          'recognised on its own.' +
          '\n\n' +
          'Right-click a selection to choose the element yourself. The tree on the ' +
          'left holds tiers you name (Book, Chapter, Scene) plus a flexible Draft that ' +
          'floats beside them.',
      },
      {
        id: 'b',
        when: (w) => w.chipCount(TOUR_CHAPTER_REF) >= 1,
        // Points at the LINK-ALL corner button (top-right of the prose panel,
        // `refreshLinkAllWidget`), not the tree's right-click menu: it is in
        // the page the user is already looking at and it carries the count.
        // Found while chasing Captain's Tab report — the affordance was there
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
          'Every name this world knows so far is wired into the sentence. ' +
          'Rachmaninov and his Prelude are still to come, and the same Tab will ' +
          'catch them when they arrive.',
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
        'The sentence holds two events: a performance, and the raging it stirs ' +
        'below. They carry the same date, because he plays while they surge. ' +
        'Dates are where time begins.',
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
    // The world's clock arrives UNSET (the bundle ships no `time_current`), so
    // the "set now time" button is really there to be pressed. Setting it is
    // what makes the gold line appear and what gives the Consul's open-ended
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
          'The Charts room lays your elements out on time. Both events sit on ' +
          'the same moment, so they stack in one place. This world has no now ' +
          'yet: set it with the highlighted button.',
        meta: 'Atlas suggests a point and you can drag the line afterwards. A world without a now still charts.',
        advanceWhen: (w) => w.nowIsSet,
      },
      {
        id: 'b',
        when: (w) => w.nowIsSet,
        body:
          'The gold line is now, and the Consul’s title now draws as a span: it ' +
          'starts when the title was granted and runs to the present. Its soft ' +
          'end means no end is recorded, so as far as this world knows he holds ' +
          'it still.',
        deeper:
        'The chart is a live view, not a picture: scroll to zoom from whole eras down ' +
        'to single days, drag any element’s dot to re-date it, and drag undated elements ' +
        'in from the rail to give them their first date. Save any arrangement as a named ' +
        'chart and it remembers its window, its cast, and its lens.' +
        '\n\n' +
        'Worlds can also carry their own CALENDARS: name your months, eras, festival ' +
        'days and week, and every date in atlas speaks that language: "11 Greening, ' +
        'Year 454" instead of a bare number.' +
        '\n\n' +
        'A world with no dates at all still charts: time begins whenever you give ' +
        'something a year.',
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
        'Watch the axis stretch to hold them. Scroll to zoom back in on the ' +
        'present, and the strip below keeps the whole span in view.',
      meta: 'Old Earth and PC are this world’s own eras, named by a calendar element the chart reads.',
      deeper:
        'A world can name its own time. Eras are the coarsest layer: a name, a ' +
        'direction, and the point they pivot on. Old Earth counts backwards ' +
        'towards that pivot and PC counts forwards from it, so a date can be ' +
        'read in the language the world uses rather than as a bare number.' +
        '\n\n' +
        'Calendars can go further than eras: name your months, your week, your ' +
        'festival days, and every date in atlas speaks that language.' +
        '\n\n' +
        'Nothing here claims a conversion between Earth’s calendar and this ' +
        'one. The books never state it, so the tour does not invent it: the two ' +
        'eras simply share a line.',
    }],
    spans: [
      { from: 13, to: 13, type: 'character' },
      { from: 14, to: 17, type: 'construct' },
    ],
    reveal: ['character:Rachmaninov', "construct:Rachmaninov's Prelude"],
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
        'The rest arrives at once: a piano maker, an ability, a trait, ' +
        'a language, a phenomenon. One sentence, a whole small world, all linked. The sidebar holds them all.',
    }],
    // The Rachmaninov spans moved to the deep-time step, where those two
    // elements are now revealed — a span's glyph and its element should light
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
    // Web tab's only introduction (`webTab`), which lived on the cut step.
    id: 'yours-to-keep',
    act: 5,
    phases: [{
      id: 'a',
      body:
        'Every element is a small file. A real atlas world is a folder of plain files ' +
        'on your computer, yours to keep and open in any tool, and it can also live on ' +
        'onlyworlds.com so other tools can read it.',
      deeper:
        'The folder IS the world: one JSON file per element, sorted into type folders, ' +
        'readable by any program. No export step, no lock-in, and it all works offline. ' +
        'Rename the folder, put it in a git repo, sync it with Dropbox: atlas does not ' +
        'mind, because the files are the truth and atlas is just a good pair of hands on them. ' +
        'Delete atlas tomorrow and your world is still sitting there.' +
        '\n\n' +
        'The Web tab on the right is drawing the whole link web of those files live: ' +
        'click any node to travel the graph.' +
        '\n\n' +
        'OnlyWorlds is an open format: 22 element types, one schema, free accounts that ' +
        'store worlds online. This world sits there too, under the public demo key ' +
        '0000000000. Link an account and atlas syncs your folder with the API both ways: ' +
        'edit on this machine, pull on another, share a read key so a friend can browse ' +
        'without touching anything. The same world then opens in other tools: a mobile ' +
        'editor, an Obsidian vault, games and viewers people build on the schema.',
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
        'That is the tour: when it ends, this world folds away. Your own worlds ' +
        'live in a folder you choose, and they stay yours.',
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
