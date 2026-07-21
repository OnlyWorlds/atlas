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
 * is DERIVED from the world (`src/tour/tour-view.ts`), never stored. Every
 * step below is single-phase today; the rework's gated beats add phase b/c.
 *
 * Acts: 1 elements & linking · 2 maps · 3 writing · 4 time · 5 yours.
 * The engine treats the last defined step as the finale.
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
  /** Hands-on steps: the real gesture OR Next does it for you (watch-mode). */
  handsOn?: 'create-world' | 'create-consul' | 'place-pin' | 'setup-folder';
}

export const TOUR_STEPS: readonly TourStep[] = [
  // ---------------------------------------------------------------- Act 1
  // (The standalone intro step was CUT in S298 — Freek's round: the tour
  // opens on the create-world beat directly; its body carries the framing.)
  {
    id: 'the-world',
    act: 1,
    unlocks: ['shell'],
    phases: [{
      id: 'a',
      body:
        'Atlas creates a folder per world. For the novel Hyperion, we will create a world of the same name.' ,
      meta: 'This is the real create dialog. Normally you would name the world and it would become a folder; the tour world stays in your browser.',
    }],
    handsOn: 'create-world',
  },
  {
    id: 'the-consul',
    act: 1,
    phases: [{
      id: 'a',
      body:
        'Every world starts with someone. The Consul is this sentence’s ' +
        'character: create him and he becomes your first element.',
      // (The "real element dialog, locked to the tour's script this once…" meta
      // was cut S301, Captain's round — the dialog speaks for itself.)
    }],
    spans: [{ from: 2, to: 2, type: 'character', ref: 'character:The Consul' }],
    handsOn: 'create-consul',
  },
  {
    id: 'the-hegemony',
    act: 1,
    phases: [{
      id: 'a',
      body:
        'Organizations are elements too: the Hegemony is an institution. ' +
        'It just appeared in the left sidebar, where every element of a world lives, filterable by type.',
    }],
    spans: [{ from: 0, to: 1, type: 'institution' }],
    reveal: ['institution:The Hegemony'],
    route: { kind: 'element', ref: 'institution:The Hegemony' },
  },
  {
    id: 'the-title',
    act: 1,
    phases: [{
      id: 'a',
      body:
        '“Consul” is not just a name: it is a title, its own element, ' +
        'connecting a person to an institution. Small distinctions like this are what let tools understand your world.',
    }],
    spans: [{ from: 2, to: 2, type: 'title' }],
    reveal: ['title:Consul of the Hegemony'],
    route: { kind: 'element', ref: 'title:Consul of the Hegemony' },
  },
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
        'The Web tab in the right pane draws this as a live graph around whatever you ' +
        'are looking at: click any node to travel. And when you want to go further, the ' +
        'Knowledge room tracks which characters KNOW each fact, so what the reader knows ' +
        'and what the villain knows can differ.' +
        '\n\n' +
        'Tools across the OnlyWorlds ecosystem read these same links.',
    }],
    reveal: [],
    route: { kind: 'element', ref: 'character:The Consul' },
  },
  // ---------------------------------------------------------------- Act 2
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
        'a new pane just opened on the right to hold it. Zoom, pan, and drop things onto it.',
    }],
    reveal: ['map:Hyperion'],
    route: { kind: 'map', ref: 'map:Hyperion' },
  },
  {
    id: 'the-pin',
    act: 2,
    phases: [{
      id: 'a',
      body:
        'Pins place elements on maps. Click the highlighted pin button on the ' +
        'Consul, then click the map where his balcony seat should sit.',
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
    }],
    handsOn: 'place-pin',
    spans: [{ from: 3, to: 3, type: 'pin', ref: "pin:The Consul's balcony seat" }],
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
        'Zones are drawn regions: The Swamps are traced right onto the map. ' +
        'The saurian things live there: two creatures, their species, and one bellowing pack, all linked to the zone.',
    }],
    spans: [
      { from: 27, to: 27, type: 'creature' },
      { from: 32, to: 34, type: 'zone' },
    ],
    reveal: [
      'zone:The Swamps',
      'marker:The Swamps - Point 0', 'marker:The Swamps - Point 1', 'marker:The Swamps - Point 2',
      'marker:The Swamps - Point 3', 'marker:The Swamps - Point 4', 'marker:The Swamps - Point 5',
      'marker:The Swamps - Point 6', 'marker:The Swamps - Point 7', 'marker:The Swamps - Point 8',
      'creature:Great Green Saurian', 'creature:Greater Green Saurian',
      'species:Saurians', 'collective:Saurian Pack',
    ],
    route: { kind: 'map', ref: 'map:Hyperion' },
  },
  // ---------------------------------------------------------------- Act 3
  {
    id: 'the-writing',
    act: 3,
    unlocks: ['writing'],
    phases: [{
      id: 'a',
      body:
        'The Writing room holds books, chapters, and scenes. Here is Chapter 1 ' +
        'of Hyperion: the sentence itself, where every colored chip is a link into the world you just built. ' +
        'Your own writing links the same way: type @ and pick.',
    }],
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
        'below. Events carry dates, and dates are where time begins.',
    }],
    spans: [
      { from: 12, to: 12, type: 'event' },
      { from: 29, to: 31, type: 'event' },
    ],
    reveal: [
      'event:The Primal Performance', 'event:The Raging of the Beasts',
      'character:Rachmaninov', "construct:Rachmaninov's Prelude",
    ],
    route: { kind: 'element', ref: 'event:The Primal Performance' },
  },
  // ---------------------------------------------------------------- Act 4
  {
    id: 'the-chart',
    act: 4,
    unlocks: ['charts'],
    phases: [{
      id: 'a',
      body:
        'The Charts room lays your elements out on time: the two events sit at ' +
        'years 7 and 12. Zoom out and the world’s whole span appears, with a gold line marking the now: year 15.',
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
    }],
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
        'The rest arrives at once: a composer, a piano maker, an ability, a trait, ' +
        'a language, a phenomenon. One sentence, thirty-six elements, all linked. The sidebar holds them all.',
    }],
    spans: [
      { from: 13, to: 13, type: 'character' },
      { from: 14, to: 17, type: 'construct' },
    ],
    reveal: [
      'character:Steinway', 'construct:Steinway Piano', 'ability:Piano Playing',
      'trait:Swamp Rage', 'language:Western Musical Notation', 'phenomenon:Piano Music',
      'narrative:Story of the old piano',
    ],
    route: { kind: 'elements' },
  },
  {
    id: 'where-it-lives',
    act: 5,
    phases: [{
      id: 'a',
      body:
        'Every element is a small file. This world sits in browser storage, but a ' +
        'real atlas world is a folder of plain files on your computer: yours to keep, back up, or open in any tool.',
      deeper:
        'The folder IS the world: one JSON file per element, sorted into type folders, ' +
        'readable by any program. No export step, no lock-in, and it all works offline. ' +
        'Rename the folder, put it in a git repo, sync it with Dropbox: atlas does not ' +
        'mind, because the files are the truth and atlas is just a good pair of hands on them.' +
        '\n\n' +
        'The Web tab on the right is drawing the whole link web of those files live: ' +
        'click any node to travel the graph.' +
        '\n\n' +
        'Delete atlas tomorrow and your world is still sitting there, plain and ' +
        'portable, which is the whole point.',
    }],
    route: { kind: 'element', ref: 'character:The Consul' },
    webTab: true,
  },
  {
    id: 'online',
    act: 5,
    phases: [{
      id: 'a',
      body:
        'This world also lives on onlyworlds.com, under the public demo key ' +
        '0000000000. Any OnlyWorlds tool can open it: atlas syncs your own worlds the same way once you link a free account.',
      deeper:
        'OnlyWorlds is an open format: 22 element types, one schema, free accounts that ' +
        'store worlds online. Link an account and atlas syncs your folder with the API ' +
        'both ways: edit on this machine, pull on another, share a read key so a friend ' +
        'can browse without touching anything.' +
        '\n\n' +
        'The same world can then open in other tools: a mobile editor, an Obsidian ' +
        'vault, games and viewers people build on the schema.',
    }],
  },
  {
    id: 'finale',
    act: 5,
    phases: [{
      id: 'a',
      body:
        'That is the tour: when it ends, this world folds away. Your own worlds ' +
        'live in a folder you choose. Pick one and start building, or finish here.',
      meta: 'The tour world leaves nothing behind: no folder, no files. Replay it anytime from settings.',
    }],
    handsOn: 'setup-folder',
  },
];

/** Steps grouped for the act label ("Elements · Step 1 of 18"). */
export const TOUR_ACT_NAMES: Record<number, string> = {
  1: 'Elements',
  2: 'Maps',
  3: 'Writing',
  4: 'Time',
  5: 'Your world',
};

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
