# Atlas: The Shell

**Updated**: 2026-09-29 (split from DESIGN.md).
**Job**: the three-pane shell, the rooms, the state shape, the routes and the context pane. The state and route sections are regenerated from `src/core/state.ts` and `src/core/router.ts`; when they disagree with the code, the code wins and this file is the bug. The per-module file tree lives in `CODEMAP.md`, not here.

---

## Three panes

```
+----------+---------------------------------+-------------------------+
| 20%      | 51%                             | 29%                     |
| SIDEBAR  | MIDDLE                          | RIGHT                   |
|          | +-----------------------------+ |                         |
| [Worlds  | | home writing knowledge      | | [Context | Maps |      |
|  Elem]   | | charts pages data  [search] | |  <map tabs>]            |
|          | | room nav strip (40px)       | |                         |
| filter   | +-----------------------------+ | graph, map index, or a  |
| chips    | |                             | | Leaflet canvas per map  |
| search   | |   <room content>            | |                         |
| list     | |                             | |                         |
| (gear)   | |                             | |                         |
+----------+---------------------------------+-------------------------+
```

- **Ratios**: `DEFAULT_RATIOS = { sidebar: 0.20, middle: 0.51 }` (`src/layout/app-shell.ts`), the right pane takes the rest; persisted to `localStorage.atlas_shell_ratios_v2`; a stored 0.19 sidebar (the old default) upgrades to 0.20. Pane floors: sidebar 180, middle 280, right 240 px.
- **Sidebar**: two modes, Worlds and Elements (a toggle at the top; the footer gear is the one settings entrance). The mode is UI state, independent of the room (conv. 37). In the writing room the sidebar body shows the writing tree until the user picks another mode (conv. 40). **The type strip** over the element list (`renderFilters` in `src/sidebar/elements-sidebar.ts`) names its types by a setting (Titus, 2026-10-11): `editor_settings.type_strip_names`, Settings, Elements, "Type names in the sidebar": `icons` (the default, names on hover), `held` (the types the world holds named with counts, first, then a break and the rest as icons) or `all` (two columns); a muted chip keeps its strike on the icon; the tour keeps icons whatever the setting. **Who made it, and the room** (1.70): under the summary line a row offers "Made by" People or Agents, only in a synced world whose roster holds an agent seat, read from keel's `created_by` with the roster's kind, the seat and never the door (`src/core/made-by.ts`; the first write, where the element page's mark says the last); and "Hide the room" in any world that holds the parlor's room elements (`src/core/parlor-room.ts`: type and supertype pairs, the charter not among them; a supertype picked by its own chip still shows). The summary line says both after a dot; a filter that no longer applies counts as off.
- **Middle**: a flex column of the room nav strip (40px) and the room content. Renderers target `shell.middleContent`, never `shell.middle` (conv. 3, 31).
- **Right**: a tab bar whose first tab is the permanent Context tab, then the map index, then one closable tab per open map (Leaflet, with a lifecycle cache).

**The narrow-window layer** (conv. 89, `src/layout/narrow-layout.ts`): at 1100px and below the right pane becomes a drawer over the middle, at 820px and below the sidebar does too; one drawer at a time, with a scrim, Escape and hashchange dismissal. The drawer toggles live in the room nav strip (also in the no-world preview strip). Above 1100px none of it applies. **The phone tier** (560px and below): the strip keeps the drawer toggles, Home, Writing, More (a menu on `body` with Knowledge, Charts, Pages and Data, each row clicking the room's own hidden button) and search, all 40px; the label expander and the selected-element chip leave; an element's fields stack, a chart's card docks under the plot, the rooms' small buttons take 40px; none of it while touring (the tour's caps own the strip). The shell is `100dvh` (with `interactive-widget=resizes-content` in the viewport meta) so a phone's address bar or keyboard cannot scroll the strip out of reach. `tests/e2e/narrow-layout.spec.ts` (and `tests/e2e/tour-narrow.spec.ts` for the tour) are the width-aware specs.

## Rooms

A room is a top-level mode of the middle pane (`MiddleMode` in `src/core/state.ts`, mounted by `mountRoom` in `src/app.ts`). A room instance belongs to one world: the middle remounts when the active world changes, not only when the room kind does (conv. 109).

| Room (`MiddleMode`) | Route | Content | Doc |
|---|---|---|---|
| `welcome` | `#/` | First-launch doors (tour, set up a folder, open a world folder, example page); the grounded and no-world-open states; "Re-link OnlyWorlds folder" when a root is recoverable | DESIGN_TOUR, DESIGN_FOLDER |
| `home` | `#/w/<id>` | World home: identity, stats, charts preview, recent, quick actions. The default landing for an active world | DESIGN_HOME |
| `element` | `#/w/<id>/element/<eid>` | Schema-driven element detail | this file |
| `writing` | `#/w/<id>/writing[/<narrativeId>]` | Book, chapter, scene and draft authorship (any tier; ancestry derived from `parent_narrative`) | DESIGN_WRITING |
| `knowledge` | `#/w/<id>/knowledge[/<entryId>`, `/new`, `/knower/<id>]` | Knowledge entries: who knows what. Entries and Knowers tabs, a draft editor that persists nothing until create, TipTap prose, the known-view per knower | DESIGN_KNOWLEDGE |
| `timeline` (the **Charts** room) | `#/w/<id>/timeline[/<elementId>]` | Charts of the world along chosen axes (time first). The route key stays `timeline`; the title and nav read "Charts" | DESIGN_CHARTS |
| `share` (the **Pages** room) | `#/w/<id>/share[/<pageId>]` | Page list, block builder (heading, prose, element card, circle, collection, map, chart), themes, the payload-true preview, publish, republish and revoke. Legacy `/publish` URLs alias here | DESIGN_SHARING |
| `import` (the **Data** room) | `#/w/<id>/import` | Bring in (full-world or loose JSON, as a new world or a merge, with validation) and take out (keel export envelope, by-type subset) | DESIGN_IMPORT |
| `settings` | `#/w/<id>/settings[/<tab>]`, `#/settings[/<tab>]` | Atlas-wide tabs `general`, `onlyworlds`, `storage`, `elements`, `maps`; per-world tabs `world`, `writing`, `context` (labelled "Web") | conv. 64, 65 |

`#/demo` is not a room: it mounts the view-only example page (Sikelia) as a full-viewport overlay above the shell (`src/demo/demo-view.ts`); its three links in the app were removed, and the route still answers for old links. The old `search` and `templates` rooms were deleted; their URLs land on home.

**Room-stable world switch** (`activateWorld` in `src/sidebar/worlds-sidebar.ts`): activating another world keeps the current room KIND at its landing level. Writing, knowledge, charts, pages and data follow to the new world; settings keeps its tab; element and map routes fall to home (their ids are world-bound). The instance still remounts (conv. 109); a Data room payload is carried across on purpose so a loaded file can be merged into the world you click.

**The room nav strip** (`src/middle/room-nav.ts`): Home, Writing, Knowledge, Charts, Pages, Data, then a field-shaped search pill anchored right (it opens the command palette), plus the drawer toggles below 1100px. With no world it renders a labelled PREVIEW of the same rooms (`aria-disabled`, tooltips say they open once a world exists). The selected-element chip sits at its right edge while an element is selected (conv. 45). Settings is not on the strip; the sidebar gear is its door.

**Element selection** lives in the element room: selecting an element navigates to `#/w/<id>/element/<eid>`, whose compact header band carries the element's actions (delete, add child, map and pin chips, favorites). **Esc** clears the selection and goes home when no modal, popover or placement is active, except in the writing, knowledge, pages and data rooms, which own their keyboards (conv. 32, 46; `src/core/hotkeys.ts`).

**Room headers, the two-tier rule** (conv. 80):
- A **room landing** (home, knowledge list, pages list, charts, settings, data, writing with no narrative) opens with `.atlas-room-header`: a 22px `<h1>` in `--atlas-text` plus an optional subtitle, with the primary action in an `.atlas-room-actions` row below. Section headings inside are sentence case.
- **One named entity** (element, knowledge entry, page, knower, an open narrative) opens with the compact 36px `.atlas-middle-header` band: back, kind icon, a 15px click-to-edit title, actions (conv. 41). The title IS the name; there is no separate Name field. The knowledge and pages rooms use the shared `makeEditableTitle` (`src/middle/editable-title.ts`); the element header keeps its own inline rename (`startInlineNameEdit`).

Rule of thumb: a big title means you are in a room; a compact band means you are looking at one thing. Cyan is for accents and links, never headings.

**Search**: the command palette (`src/ui/command-palette.ts`, a lazy chunk), opened by Ctrl/Cmd+K, `/`, or the strip's search pill. Ranked tiers: name prefix, name substring, alias, supertype and subtype, description with snippet; rooms by name (an element name prefix outranks a room). "See all" hands the query to the elements sidebar filter. **One search language**: the sidebar filter and the palette share `src/core/element-search.ts`, so "see all" is always a superset of the palette's 12. The palette excludes pins and markers; the sidebar mutes them by default (muted types, `src/core/type-mutes.ts`) and shows them when filtered to.

## State shape (`src/core/state.ts`)

One observable store: UI reads `getState()`, writes through `patchSlice()`, and every subscriber fires on every change (conv. 1). The slices:

```ts
interface AppState {
  registry: WorldsRegistry;                               // localStorage-persisted (src/registry/registry.ts)
  styles: WorldStyles;                                    // the active world's style rules (.atlas/styles.json); outlives data refreshes
  atlasRoot: AtlasRootRef | null;                         // the home folder
  atlasRootRecoverable: AtlasRootRecoverableRef | null;   // orphan root handle after a localStorage wipe
  active: ActiveWorldRef | null;                          // { worldId, meta (world.json snapshot), opened }
  middleMode: MiddleMode;                                 // welcome | home | settings | element | timeline | writing | knowledge | share | import
  data: DataState;                                        // { elements (all 22 types), loading?, loadingProgress? }
  ui: UiState;
  sync: SyncSummaryState;                                 // { byWorld, activeSync, activeConflictsCount }
  accountWorlds: AccountWorldsState;                      // { status, rows, fetchedWithToken?, error?, opening }
  busy: boolean;                                          // reserved, unused
}

interface UiState {
  sidebarMode: 'worlds' | 'elements';
  selectedElementId: string | null;
  elementFilters: Set<ElementType>;                       // empty = show all
  mutedTypes: Set<ElementType>;                           // out of "show all", in when filtered to; pin + marker by default
  madeBy: 'people' | 'agents' | null;                    // the list's Made by filter; per world, cleared on a switch
  hideRoom: boolean;                                      // the list hides the parlor's room; per world, cleared on a switch
  search: string;
  rightTabs: RightTabRef[];                               // context | map-index | map; context kept at index 0 by the lifecycle
  rightActiveIndex: number;
  pinPlacement: { elementId: string } | null;
  zoneEditing: { zoneId: string; mapId: string } | null;
  sidebarWritingOverride: boolean;                        // in-session only
  knowledgeLens: { knowerId: string } | null;             // dims the sidebar to one knower's knowledge; in-session
  castAssign: { kind: 'protagonist' | 'nexus' } | null;   // the home ghost card's assign mode; in-session
}
```

`data.loading` must be read by every empty state: "empty" and "still loading" are different truths. The initial `rightTabs` is `[{ kind: 'map-index' }]`; `context-tab-lifecycle.ts` prepends the Context tab once a world is active.

**Where preferences live** (conv. 7): app-level UI prefs (`sidebarMode`, `defaultCreateType`) in `localStorage.atlas_ui_prefs` (`src/core/ui-prefs.ts`, load-merge-save); navigation (active world, selection, open map, room) in the URL hash; per-world choices on the registry entry (and the four in `.atlas/world-prefs.json`, conv. 112). The full list is in `ATLAS_FIELDS.md`.

## Routes (`src/core/router.ts`)

Hash-based, so no server rewrites (Cloudflare Pages friendly). `parseHash` returns a `Route` with `mode` (`welcome`, `demo`, `try-demo`, `home`, `settings`, `elements`, `element`, `map`, `timeline`, `writing`, `knowledge`, `share`, `import`) and the ids that mode carries.

| Hash | Route | Middle shows |
|---|---|---|
| `#/` (or empty) | `welcome` | the welcome panel |
| `#/demo` | `demo` | the example page overlay above whatever the middle resolves to |
| `#/try-demo` | `try-demo` | an action, not a place (1.18.1): `app.ts` replaces the hash with `#/` and runs the "try a demo world" door once (the onlyworlds.com home page's "explore Moppetopia") |
| `#/join/<code>` | none | an action (1.22): `core/join-capture.ts` takes the code out of the address bar before anything else, then the join door runs once (`setup/join-door.ts`; keel's `/join` page's Open in Atlas) |
| `#/open/<world id>` | none | an action (1.49): `core/open-capture.ts` takes the id out the same way, then `setup/open-door.ts` opens that world once: the copy here, or the signed-in account's row after an Open, or it waits for the sign-in (a world page's Open in Atlas on onlyworlds.com). A pasted OnlyWorlds address reaches the same door (1.97, `core/open-address.ts`): in Search, or outside a text field |
| `#/settings[/<tab>]` | `settings`, no world | settings with only atlas-wide tabs live |
| `#/w/<id>` | `home` | home (the default for an active world) |
| `#/w/<id>/element/<eid>` | `element` | element detail |
| `#/w/<id>/writing[/<narrativeId>]` | `writing` | the writing room; the legacy long form `/writing/book/<b>[/chapter/<c>[/scene/<s>]]` still parses to the deepest id |
| `#/w/<id>/knowledge[/new`, `/<entryId>`, `/knower/<knowerId>]` | `knowledge` | the list, the draft editor, an entry, a known-view |
| `#/w/<id>/timeline[/<elementId>]` | `timeline` | the Charts room, focused on an element when one is given |
| `#/w/<id>/share[/<pageId>]` (alias `/publish`) | `share` | the Pages list or builder |
| `#/w/<id>/import` | `import` | the Data room |
| `#/w/<id>/settings[/<tab>]` | `settings` | settings at that tab (default `onlyworlds`) |
| `#/w/<id>/map/<mapId>[/element/<eid>]` | `map` | opens the map tab on the right; the middle shows the element when the URL carries one, else home |
| `#/w/<id>/elements` | `elements` | home (a legacy alias; sidebar mode is UI state, never a route) |
| `#/w/<id>/search`, `/templates`, anything unknown | `home` | home |

Settings tab ids: `general`, `onlyworlds`, `storage`, `elements`, `maps`, `world`, `writing`, `context`, grouped by scope in `SETTINGS_TAB_GROUPS`. Legacy keys alias through `LEGACY_SETTINGS_TABS` (`identity`, `account`, `about` to `onlyworlds`; `atlas`, `sync` to `storage`; `editing` to `elements`); add an entry there when a key is renamed.

Deep-link helpers: `worldHash(worldId)` and its alias `homeHash`, `elementHash(worldId, elementId)`, `elementsHash(worldId)`, `writingHash(worldId, narrativeId?)`, `knowledgeHash(worldId, knowledgeId?)`, `knowledgeKnowerHash(worldId, knowerId)`, `timelineHash(worldId, elementId?)`, `shareHash(worldId, pageId?)`, `importHash(worldId)`, `settingsHash(worldId | null, tab?)`, `mapHash(worldId, mapId, elementId?)`. The writing icon restores the last narrative through `writingHashForNarrative` (`src/middle/writing-helpers.ts`), which emits the short form (conv. 44). After a re-key, `rekeyRouteHash` (`src/sync/rekey-route.ts`) rewrites every id a route carries.

## The context pane

The right pane's Context tab is a tool-global surface: a graph plus a details area, derived from the URL.

**Tabs**: index 0 is `context` (permanent, never closed), then `map-index` (maps overview), then one `map` tab per open map. `src/tabs/right/context-tab-lifecycle.ts` keeps the invariant on boot and on every tick (conv. 58).

**Subject per route** (`resolveSubject` in `src/tabs/right/context-tab.ts`):

| Route | Subject | Details |
|---|---|---|
| `/writing/<narrativeId>` | the narrative | Cast and Potentials (`context-pane-lists.ts`) |
| `/writing` (landing) | the most recently edited writing narrative | element preview, captioned |
| `/element/<id>` | the element | the preview card (`context-pane-preview.ts`), which follows the node clicked in the graph |
| `/timeline/<id>` | the focused element | element preview |
| `/timeline` (landing) | the most connected dated element (the chart's anchor metric) | element preview, captioned |
| `/knowledge/<entryId>`, `/knowledge/knower/<id>` | the entry or the knower | element preview |
| `/knowledge` (list) | the most widely held entry | element preview, captioned |
| `/share/<pageId>` | the page's first carded element | element preview, captioned |
| home, settings, data, a map route, the pages list, a page with no cards, an empty writing or knowledge world | none | empty state with route-specific copy |

A subject change through the URL re-mounts the graph; in-pane clicks (recenter, select) stay pane-local. The subject is never stored on the tab ref.

**The graph** (`src/tabs/right/context-pane-graph.ts`, no library):
- Subject-centred force-directed layout (a synchronous sim, so positions are stable). Each step moves a node at most `maxStep` (without the cap two nodes passing close flung a third far out, and the fit to the pane shrank everything else into one knot); the final collision pass (`relaxLayout`) keeps nodes `collisionMinDist` apart and keeps a slot under the centre clear for the subject's label (`centerLabelSlotFor`). The slot is sized for a pane at scale 0.75 first, then again from the fit this pane gives (`fitScale`, the projection's own), never below the scale where `collisionMinDist` still keeps 36 px nodes apart (a wide web fit smaller and the label ran over a node; flooring stops the bigger slot spreading the web into touching rims).
- Labels (`graph-labels.ts`, the map's label rule): each label takes the first clear side of its node (below, right, left, above, then the corners) or waits for hover; the subject and the selection always print, on their least crowded side; then the most connected. Measured on every paint, since zoom, pan and resize move the nodes under them. It replaced T-CX2's count budget, which hid by degree alone.
- Pins and markers are links, not nodes (conv. 138): `buildWebLinks` reads a pin as a two-way link between its map and the place it marks, and a zone's markers as one link between the map and the zone, with the count in the zone's tooltip ("16 markers on the map"). A pin or marker missing an end draws nothing; a link INTO one is dropped; one that is the subject keeps its own links. Moppetopia's Space Map at depth 2 went from 73 nodes (67 pins and markers, 83 pairs touching) to 31, with nothing touching at 1000 and 1440. A label-less node is still an obstacle to the label pass.
- Ring 1 is the UNION of outgoing links and incoming ones (both from `buildWebLinks`, whose outgoing read is `collectDirectNeighbors`). Outgoing covers multi-links and single-link fields through a generic id-shaped scan, double-gated by element lookup; `parent_narrative` is excluded (tree, not web). A node that only links TO the subject is a backlink: a muted ring, settled below the centre, an arrowhead into the centre, and an "N link here" legend.
- Click recenters (with a breadcrumb stack: `[Home] › [Recent] › current`); Ctrl/Cmd+click navigates; the mouse back button pops the breadcrumb over the pane and falls through to browser history outside it (conv. 61).
- Free zoom and pan, double-click resets, a fit button when transformed; hover fades non-connected nodes; a right-click menu (open as element, copy id, add to story in writing).
- Hop depth 1 to 4 with per-ring caps (conv. 62), default derived from the tier; type filter chips; lock-layout mode (filters hide by CSS without re-running the sim, conv. 60); optional edge colouring by type.
- **Through a lens** (1.105, `src/core/web-lens.ts`): the toolbar's Lens chip lists the world's lenses (`isLens`, a proposed one left out, templates marked) and keeps the choice per world as `context_lens` (rekeyed with the rest; never written to the world). With one chosen the graph is in lens mode (`renderLens`): its nodes are exactly the lens's kept from `resolveLens` (the first 60, in the reading's order), its edges `worldGraph`'s with the lens, read as the owner over every element held; the anchors are seeded at the middle and nothing is the centre; a press selects (on a route with no subject it opens the element's page), and the hop pill, the type chips, the lock and back are gone or inert. A line under it says what the lens keeps and the cut by reason; a template, an unreadable lens and an empty one each have their own line. Keep a lens on <name> (in the list when no lens is chosen, on an element the person opened, never hidden, proposed, a room element, a lens or one kept outside the key's view, never in a view-only world, the tour, the demo or Moppetopia) writes one Construct, supertype Lens, the element in its type's anchor field, then reads through it; a lens already exactly that is chosen instead. A lens's own page has Read this lens; See <name>'s world and Home's picture read through no lens. An Escape that closes the list is marked (`core/escape-mark.ts`), and the drawer, the preview, the tour's flyout and deselect-to-home step aside.
- Prefs flow one way, registry to orchestrator to graph to toolbar (conv. 59). Per-world registry fields: `context_filters_off`, `context_hop_depth`, `context_lock_layout`, `context_edge_color`.
- Colours: `ELEMENT_TYPE_COLORS` in `src/core/constants.ts` is derived from `elementColor()` in `src/core/element-colors.ts` (the family carries the hue, the icon carries the type).

**Modules** (`src/tabs/right/`): `context-tab.ts` (orchestrator: route to subject, one `onSelect`, `syncPrefsToGraph`), `context-tab-lifecycle.ts` (the index-0 invariant), `context-pane-graph.ts`, `graph-labels.ts` (the label pass, pure), `context-pane-toolbar.ts` (type chips, lock, hop pill), `context-pane-lists.ts` (writing Cast and Potentials), `context-pane-preview.ts` (the preview card: "Linked from" counts the story's links only, then a Pins line and a Markers line, one entry per zone, from `src/core/spatial-backlinks.ts`, conv. 136).
