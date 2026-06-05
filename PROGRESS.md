# Atlas — Progress Log

Operational state. Architecture in **DESIGN.md** (+ `DESIGN_MAPS.md`, `DESIGN_ZONES.md`, `DESIGN_WRITING.md`). Sync lessons in **SYNC_NOTES.md**. Session-by-session history archived to `docs-archive/PROGRESS-history.md`.

---

## CURRENT STATE (handover snapshot, 2026-05-25 session 234 close)

**Session 234** = Knowledge + Sharing **design** (two new docs + Build Map below) + **Knowledge phase-1 build**: K1 (room skeleton) · K2 (in-room detail + held-by editor) · K4-core (known-view scan functions + 15 unit tests). Atlas-only, pure-local. **728 vitest + 127 Playwright + typecheck + build green.** Full entry below the Build Map. Knowledge build continues at K3 (writing-editor embed) — collaborative. Pre-234 snapshot follows.



**Session 233 (maintenance: settings split + map-tab re-trim + small feature + flake fix):** settings-panel.ts 1175→210 (orchestrator) + 6 per-tab modules (`settings-{account,storage,editing,world,writing,context}.ts`); new `updateWorldEntry` registry helper (DRY, +2 unit tests); **default new-element type** feature (`ui-prefs.defaultCreateType`, surfaced in Settings → Editing, +1 e2e); map-tab.ts 806→388 via 3 extracted modules (`map-tab-interactions` 335, toolbar-wiring folded into `map-tab-toolbar` 233, `map-tab-stale` 40); fixed the historic suite-only **split-test flake** (DOM-selection cursor placement, verified 6× stress). DESIGN conventions #65, #66 added. **713 vitest + 127 Playwright + typecheck + build green.** No behavior changes except the new default-create-type feature.

**Session 232 (maintenance/reorg):** writing-workspace.ts split 1286→647 into 4 modules; focus-mode mouse exit; settings reorg to 6 scope-grouped tabs (account/storage/editing · world/writing/context, legacy keys alias); element-detail refs tier-split + "<Field> of" grouping toggle. 711 vitest + 126 Playwright + typecheck green. Full session-232 entry below; the session-231 context-pane state follows it.

The right-pane writing-context tab from session 229 was promoted to a **tool-global Context tab** — permanent leftmost tab, route-driven content, breadcrumb-based graph navigation, type-filter + hop toolbar (1-4 hops with per-ring caps), free zoom/pan with cursor-anchored wheel + drag, fit-to-view button, optional element-type edge coloring, lock-layout setting, right-click node menu, mouse-back button intercept, and a Settings → Context page. **711 vitest green + 126 Playwright green.** Typecheck clean. Production build clean.

**Pane structure** (top to bottom):
```
[toolbar: type-filter chips · lock icon · hop pill 1/2/3/4]
[graph: subject-centered, click recenters, breadcrumb trail at top, fit-to-view button when zoomed]
[details: writing → Cast + Potentials; element → preview; other → empty state]
```

**Route-driven subject** (single source of truth — see convention #58):
- `/writing/<narrativeId>` → subject = narrative; details = Cast + Potentials lists
- `/element/<elementId>` → subject = element; details = element preview card
- Anything else (home, timeline, settings, map, search) → empty state with helpful copy

**Per-world prefs** (registry — written by toolbar OR settings page, propagated via single-direction sync — see convention #59):
- `context_filters_off?: ElementType[]` — hidden type chips
- `context_hop_depth?: 1 | 2 | 3 | 4` — explicit hop, absent = tier-derived (scene/draft → 2, chapter/book → 1, non-narrative → 2)
- `context_lock_layout?: boolean` — when on, filter toggles hide via CSS without sim re-run (no node jumping)
- `context_edge_color?: boolean` — tint edges by non-center node's element type at 0.45 alpha

**Per-ring caps for multi-hop graphs**: ring 1 (cast) uncapped, ring 2 = 12 (chapter 6 / book 4), ring 3 = 8, ring 4 = 6. Keeps dense worlds visually digestible.

**Featured/Planned/Potentials model** (writing-mode lists, session 230 lock):
- **Featured** = element id in narrative's link field AND present in prose. Sorted to top, filled cyan dot.
- **Planned** = in field but NOT in prose. Outlined cyan ring, faded.
- **Potentials** = NOT in field; surfaced via 1-hop adjacency from cast or sibling-narrative cast.
- Invariant: prose ⊆ field, always (Convention #50 UNION-on-save).

**Bundle impact** (session 231 close):
- Main JS gzipped: ~163 KB
- Writing-workspace chunk gzipped: ~150 KB
- Conventions list: 1-63 (DESIGN.md 1-46 + 58-63 added session 231; DESIGN_WRITING.md 47-57 unchanged)
- Atlas-local fields list (`ATLAS_LOCAL_EXTENSION_FIELDS`) unchanged from session 230

---

## Knowledge + Sharing — Build Map (session 234)

Designed session 234 (`DESIGN_KNOWLEDGE.md` + `DESIGN_SHARING.md`). Build order: **Knowledge first (atlas-only, no blockers), then Sharing (needs Anchor's Django backend + a new viewer tool).** Bout-level near-term; coarser downstream (firms with Anchor).

**Critical path**: Knowledge phase 1 (atlas) → define atlas↔backend *page contract* with Anchor → parallel { Anchor: Django backend · Temper: viewer tool + atlas share-room/block-builder } → integrate → Circle block (needs Knowledge).

### Track A — Knowledge (atlas-only, pure-local, buildable NOW, no blockers)
- **K1 — Room skeleton**: `knowledge` route + `knowledgeHash` + parse + room-nav icon + `MiddleMode 'knowledge'`; `isKnowledgeNarrative()` classifier (subtype === 'knowledge'); bare room = list of knowledge entries + empty state + "new knowledge entry" (creates a Narrative w/ `subtype:'knowledge'`). Pokeable.
- **K2 — Entry detail + held-by**: select entry → detail; **held-by** editor (narrator = solo Character · collectives = Circles · conservator = Institution, via pickers); about-links display.
- **K3 — Authoring**: embed the writing-workspace editor component for knowledge prose so @-mentions populate the about-links.
- **K4 — Known-view + knowers sidebar**: `whatDoesXKnow(knowerId)` + `knownViewOfElement(elementId, knowerId)` scans; sidebar filtered to knowers; pick knower → known-view.
- **K5 — Graph + circles + lens**: context-graph "knowledge mode" (wiring surface, drag-to-assign); "+ new Circle" (creates a Collective, opt `subtype:'circle'`); known-view "lens"; react-to-atlas-selection.
- **K6 — (phase 1.5)**: element-detail "known by: [circles]" surfacing.

### Track B — Sharing, atlas-side (partly buildable now; publish blocked on backend)
- **S1 — Share room shell**: rename `publish`→`share` route; page list/gallery (empty until backend); World Showcase slot.
- **S2 — Block builder UI**: single-column stack + ~8 blocks + per-block layout menu — *prototypable locally with no backend* (renders from local config).
- **S3 — Theme tokens UI**: the ~6 tokens + live preview.
- **S4 — Publish flow**: POST → backend, return URL/slug. **BLOCKED on Anchor contract.**
- **S5 — Circle block**: needs Track A done.

### Track C — Viewer tool (new deployed tool, phase 2 — Temper)
- New tool scaffold → `show.onlyworlds.com` (subdomain TBD). CF: `_redirects /* /index.html 200`, `_routes.json` (exclude `/assets/*`), Pages Function for OG-meta injection (unfurls).
- Lift atlas renderers (element-detail, leaflet map, narrative reading, context graph) into portable/shared form.
- Path-based routing; fetch page snapshot by id/slug; render the block model.

### Track D — ow.com / Anchor backend (Django, phase 2 — Anchor, against our contract)
- New page/showcase model: world, owner, **unique slug**, intent, composition/blocks payload, theme tokens, **snapshot payload**, live-vs-snapshot flag, view_count, published_at, revoked.
- Endpoints: POST publish · GET public (no auth, cached) · PATCH republish · DELETE revoke · slug-uniqueness check · list-by-world. Quota enforcement. Snapshot-freeze at publish.
- **The atlas↔backend contract is the coordination artifact** — define once Knowledge lands + we lock S-track page storage.

**Status:** Track A — **K1 + K2 + K4-core shipped (session 234)**. Next: K3 (writing-editor embed), K4-UI (known-view render + knowers sidebar), K5 (graph mode + circles + lens) — all collaborative.

---

## Session 234 (2026-05-25) — Knowledge + Sharing design; Knowledge phase-1 build (K1, K2, K4-core)

Long design conversation → two new docs (`DESIGN_KNOWLEDGE.md` + `DESIGN_SHARING.md`; `DESIGN_PUBLISHING.md` superseded to a pointer) + the Build Map above. Then three autonomous build bouts on the Knowledge foundation (atlas-only, pure-local), each typecheck+build gated, full suite at close.

- **K1 — Knowledge room skeleton**: `knowledge` route (`#/w/<id>/knowledge[/<id>]`) + `knowledgeHash` + parse; `MiddleMode 'knowledge'`; room-nav icon (`psychology`, between Writing & Timeline); `src/core/knowledge.ts` (`KNOWLEDGE_SUBTYPE`, `isKnowledgeNarrative`, `listKnowledgeEntries`, `heldByOf`/`heldByCount`); `src/middle/knowledge-room.ts` — list of entries + "+ new knowledge entry" (mints a narrative w/ `subtype:'knowledge'`) + held-by summary + empty state.
- **K2 — In-room editor (draft flow + held-by)**: three views — list (`/knowledge`), **draft** (`/knowledge/new`, in-memory, NOTHING persists until "create"), editor (`/knowledge/<id>`). In-room authoring surface: name input + **prose textarea** (`story`; rich @-mention prose deferred to K3) + **held-by** editor (Character via `narrator` single · Circles via `collectives` multi — **two channels only**) via `pickElement(restrictToType)`. About chips read-only (`aboutIdsOf`, excludes `collectives`). Build-once + surgical refresh (held-by/about re-render on same-view ticks; name/prose inputs never clobbered → focus/typing survive background sync). Saved-entry name/prose save on blur; held-by writes immediate.
- **K4-core — Known-view scans + tests**: `isKnowerType` (character|collective), `circleMembers`, `characterKnowsEntry`, `knowledgeHeldBy` (dispatch: character = narrator|circle-member, collective = direct holder), `elementsKnownAboutBy`. +14 unit tests (`tests/unit/knowledge.test.ts`) covering direct/inherited holding, non-knowers, about-exclusion of collectives. +2 e2e (`tests/e2e/knowledge.spec.ts`): empty state + draft-no-premature-save.

**Captain feedback iteration 1 (same session):** (a) nav icon `psychology`→**`menu_book`** (open book); (b) **dropped the conservator/institution held-by channel** — redundant with Circles; an institution holds via a Circle of its members (model + scans + tests + docs updated); (c) **draft create flow** replaces auto-create-then-edit (premature-save + jump was jarring); (d) **in-room prose textarea** replaces "bounce to element-detail" (kept a small "all fields →" link); (e) **empty-state layout fixed** (was centered + two-column via `atlas-pane-empty`; now top-anchored stacked block).

**Captain feedback iteration 2 (same session):** (a) **held-by/about chips → cyan pills** (were drab gray blocks); (b) **id-swap migration for `/knowledge/<id>`** — the "create bounces to overview" was the push reassigning the entry's id on api-linked worlds; `handleIdSwap` (sync-attach) now migrates the knowledge route like it does `/element` and `/map`; (c) **About is now linkable in-room** — a "+ add subject" picker writes the subject to its matching `Involves` field via `NARRATIVE_RELATION_FIELDS` (collectives rejected — they're holders); works in draft (stored on `draft.aboutIds`, grouped into fields on create) + saved. Exported `ABOUT_FIELDS` from `core/knowledge`. Verified in-browser (Playwright): empty block top-anchored + stacked; draft persists nothing until create (`count===0`); chips computed `rgba(34,211,238,*)` cyan pill; create lands on the **saved entry** (not list) with `narrator`/`collectives`/`locations`(subject) all persisted; collective rejected as a subject.

**Deferred (collaborative — coupled / feel-sensitive):** K3 (rich @-mention prose in-room + about-population), K4-UI (known-view render + knowers-filtered sidebar), K5 (graph knowledge-mode + "+ new circle" + known-view lens), K6 (element-detail "known by" surfacing).

**727 vitest + 129 Playwright + typecheck + production build green.** No behavior changes outside the new room. Conventions #67–72 (in `DESIGN_KNOWLEDGE.md`; conservator dropped). Not committed (Captain's hand).

### Smoke checklist (Captain — pending visual test)
1. **Room + nav**: open a world → **Knowledge** open-book icon between Writing and Timeline → empty state sits cleanly under the header.
2. **Draft flow**: "+ new knowledge entry" → draft editor (URL `/knowledge/new`). Fill name + prose, set Character/Circles — **nothing is saved yet** (no sync countdown). **cancel** → list still empty. **create** → persists once, opens the saved entry.
3. **Held-by**: Character (narrator, single) + Circles (collectives, multi). No Institution row. Chips link out; × removes.
4. **Saved-entry edit**: name/prose save on blur (no jarring re-render while typing); held-by edits apply immediately; **About "+ add subject"** picks any element (not a collective — those are holders) and links it as a subject; chips are cyan pills, click to open, × to remove; "all fields →" opens the full editor.
5. **List**: entries show "held by N"; back link + nav return to list.

---

## Session 233 (2026-05-25) — Maintenance: settings split, map-tab re-trim, default-create-type, flake fix

Captain framed another maintenance session ("stable, longterm, clean codebase; if stuff can be fixed or done better, take time first") and went autonomous for the arc. The codebase audit found it well-tended — no TODO/FIXME litter, 2 intentional `@deprecated`, modest `as any` (TipTap/SDK interop), deliberate forensic console logging. So the work was structural hardening + one greenlit feature, not cleanup-of-rot. Five bouts, each typecheck + targeted e2e gated; full suite at the end.

### Bout 1 — Settings split + `updateWorldEntry` DRY (convention #65)
`settings-panel.ts` 1175 → 210 lines (pure orchestrator: rail, last-tab restore, dispatch). Six per-tab modules: `settings-account.ts`, `settings-storage.ts` (device + sync), `settings-editing.ts` (field-mode + maps), `settings-world.ts`, `settings-writing.ts`, `settings-context.ts`. Flat `settings-*.ts` files match the `writing-workspace-*`/`map-tab-*` precedent (identical import depth). Cleaner than the s232 writing-workspace split — these were already standalone `renderXTab`/`wireXTab` pairs, not closure-bound. New `updateWorldEntry(reg, worldId, patch)` registry helper absorbs the inline `findIndex` + `worlds.map` boilerplate that had drifted into the context/writing wire handlers (+2 registry unit tests). Public surface (`mountSettingsPanel`) unchanged → `app.ts` untouched. 21 settings e2e green.

### Bout 2 — Default new-element type (convention #66)
`ui-prefs.defaultCreateType` (localStorage, default 'character'). ElementCreateModal preselects it when opened without an explicit `initialType` (sidebar +, home, hotkey, writing inline-create, map contextual). Surfaced as a "Default new-element type" dropdown in Settings → Editing. Guard in `buildModal`: re-validates the preselected type against the effective (post-`excludeTypes`) set, so an excluded default (e.g. 'map' in the map contextual flow) falls back to the first offered type. Fixed `setSidebarModePref` to load-merge-save (was clobbering — now both prefs survive). +1 phase4-elements e2e.

### Bout 3 — map-tab.ts re-trim (806 → 388)
The s212 split (858→470) had re-accreted to 806 — one giant `mountMapTab` closure. Extracted three modules via verbatim lifts: `map-tab-interactions.ts` (335 — all the `manager.on`/`container` gesture handlers behind a deps object: map-click, pin click/hover/contextmenu, contextual create, hotkeys, drag-drop), toolbar wiring folded into `map-tab-toolbar.ts` (now 233, holds `wireCanvasToolbar` + `wireZonesDropdown`), `map-tab-stale.ts` (40, the cross-world stale-pane). Reconciled ~15 now-dead imports + removed a vestigial `void isEditing` suppression block. Lifecycle (manager init, background, camera restore, zone-overlay creation) stays in mount. 9 phase5-maps e2e green; typecheck guarantees the closure captures survived.

### Bout 4 — Split-test flake fixed (the s230/231 follow-up #5)
Reproduced under `--repeat-each` stress: the test positioned the cursor with 28 rapid `ArrowLeft` presses, but in a contenteditable under load Playwright "occasionally moves focus instead of dispatching to ProseMirror" (the autolink test already documents this for Tab) — leaving the cursor at doc-end where `openSplitDialog` *correctly* bails ("nothing after the cursor"). The app was never wrong; the test's caret positioning was brittle. Fixed by setting the selection via the DOM Selection API (focus + `range` to end of first paragraph + `selectionchange` nudge to ProseMirror's DOMObserver) — deterministic, focus-safe. Verified 6× stress: 18/18.

### Bout 5 — Docs + full suite
DESIGN conventions #64 (settings scope-grouping) updated — per-tab split no longer "pending"; #65 (per-tab module pattern + `updateWorldEntry`) and #66 (`defaultCreateType` in ui-prefs) added. Full suite: **713 vitest + 127 Playwright + typecheck + production build green.**

### Smoke checklist (Captain — pending visual test)
1. **Settings — every tab renders + persists**: Account (email/PIN); Storage (folder + sync toggles/cadence/policy/debounce); Editing (field-edit mode radios, refs-grouping toggle, confirm-delete toggle, **new** default-create-type dropdown, map-label toggles); World (rename, online/unlink actions, delete flows); Writing (tier labels + migration, font, spellcheck); Context (hop/lock/edge-color). Legacy deep-links (`#/w/<id>/settings/identity` etc.) still resolve.
2. **Default create type**: set it in Settings → Editing → open "New element" via sidebar +, home button, and Ctrl+K hotkey — all preselect your chosen type. Map right-click contextual create with default = 'map' falls back gracefully (no broken grid).
3. **Map tab (the re-trim — exercise every gesture)**: open a map; toolbar (settings cog, zones/pins visibility toggles, fit, draw-polygon, draw-line, zones dropdown); left-click pin placement (with element selected); pin click → element nav; pin hover → tooltip; pin right-click → ghost pins; right-click empty map → contextual create + Place existing; **F/Z/L hotkeys** in canvas; **drag element from sidebar → drop on map**; stale tab (open map, switch worlds → "map from another world" pane + close).
4. **Writing split**: open a narrative, type two paragraphs, cursor between them, Ctrl+Shift+D → split modal → confirm.

## Session 232 (2026-05-25) — Maintenance: writing-workspace split, settings reorg, element-detail refs

Captain framed a maintenance session ("stable, longterm, clean codebase; if stuff can be fixed or done better, take time for that first"). Three workstreams, all behavior-preserving / additive, validated per bout (typecheck + targeted e2e each, full vitest + writing/settings e2e at the end).

### Writing-workspace.ts split (1286 → 647 lines)
Extracted into 4 single-concern modules, each declaring deps explicitly (pure fns or a `deps`-object factory — convention #37 testable-seams):
- `writing-workspace-mention-items.ts` — @-picker scoring (pure, no closure deps)
- `writing-workspace-word-count.ts` — ambient word-count widget (factory over root + editor accessor)
- `writing-workspace-sticky-bar.ts` — breadcrumb + date + action buttons + view-mode toggle (factory)
- `writing-workspace-context-menu.ts` — right-click menu + inline-create + split + unlink-chip (factory; owns its listeners + `destroy()`)
Save controller deliberately left in place (most coupled to mount-local mutable state — `pendingSnapshot`/`mountedForId`/`lastSavedMarkdown`). 711 vitest + 33 writing e2e green.

### Focus-mode exit affordance
Focus mode hides the sticky bar (which holds the focus button), so only Esc exited. Added a floating cyan focus icon (`.atlas-writing-focus-exit`, top-right) created on `document.body` while focus mode is on; shared `exitFocusMode()` keeps Esc + button in sync; torn down on unmount.

### Settings reorg (8 tabs → 6, scope-grouped)
- Rail grouped via `SETTINGS_TAB_GROUPS` (router.ts): **Atlas** (account, storage, editing) + **This world** (world, writing, context), each with an icon+label header.
- `identity`→`account`; `atlas`+`sync` merged → **storage** ("On this device" folder section + sync section); new **editing** tab (field-edit mode + map header-label toggles); **about** dropped → version/links footer in the rail.
- Route keys renamed; `parseSettingsTab` maps legacy keys (identity/atlas/sync/maps/about) so old deep-links + stored last-tab resolve.
- Recomposed in-place: reuses `renderSyncTab`/`renderMapsTab`/`wireSyncTab`/`wireMapsTab` verbatim; intricate world-tab logic untouched. **NOT yet split into per-tab modules** (deferred). e2e updated (phase2-ui, phase35-settings).

### Element-detail "Referenced by" / "Mentioned in" + delete confirm
- Category labels title-cased ("Narratives", "Locations").
- "Mentioned in" narratives grouped by writing tier (Books/Chapters/Scenes/Drafts; non-tree → "Narratives").
- New `editor_settings.refs_group_by_field` (Editing tab, default off): groups "Referenced by" as SINGULAR "<Field> of" ("Rival of", "Friend of" — not "Friends of"; we view one element) via `humanizeFieldName` + `singularizeLabel`. Live-updates via the registry-slice subscription.
- New `editor_settings.confirm_before_delete` (Editing tab, default on): gates the element-delete `window.confirm` (which still surfaces the cascade count); off lets power users skip it.

### Deferred to next session
1. **Settings-panel per-tab module split** — the hygiene match to the writing-workspace split (settings-panel.ts is ~1180 lines).
2. **Default element create type** — Captain greenlit, but `ui.defaultCreateType` is unbuilt (DESIGN doc only) → a small feature, not just a toggle. (confirm-before-delete shipped this session.)
3. Minor DESIGN.md settings tab-key text refresh (router is source of truth; descriptive text lags).
4. Decide whether settings scope-grouping / the deps-factory extraction earn a formal DESIGN.md convention (currently craft-level).

### Smoke checklist (Captain — pending visual test)
1. **Writing room**: open narrative → sticky bar (breadcrumb/date/actions); type → word count + goal; @-picker; right-click (create / split / unlink / link-to); Ctrl+Shift+E + Ctrl+F; focus mode → top-right cyan icon exits (+ Esc); reading mode; view-mode toggle on a parent narrative.
2. **Settings**: rail shows Atlas / This world groups w/ icons; Storage = folder + sync controls; Editing = field-mode radios + map-label toggles + refs-grouping toggle; version footer; world/writing/context greyed without a world.
3. **Element detail**: "Mentioned in" split by tier; "Referenced by" capitalized; flip Editing → refs-grouping → labels become "<Field> of".

---

## Session 231 (2026-05-24) — Context pane goes tool-global: 6-bout arc

Captain framed the session: take the writing-context pane shipped in 229, broaden it into a tool-global Context tab that lives in the right pane alongside Maps. Six bouts of design conversation + autonomous build + checkpoint validation between each.

### Bouts shipped

| # | Bout | Net LOC | Tests added |
|---|------|---------|-------------|
| 1 | Structural refactor: `writing-context` → `context` kind, route-driven content, permanent leftmost tab, no auto-open | ~140 | 4 e2e |
| 2 | Element route content (graph + preview); empty-state copy for unfocused routes; preview narrative→subject + mode refactor | ~120 | (existing) |
| 3 | Recent-centers breadcrumb (replaces back pill); mouse-back button intercept; right-click node menu (Open / Copy ID / Add to story) | ~250 | 3 e2e |
| 4 | Toolbar: type-filter chips + lock-icon + 1/2-hop pill; per-world persistence via new registry fields | ~280 | 3 e2e |
| 5 | Free zoom/pan (wheel + drag) with cursor-anchored zoom; fit-to-view button; Settings → Context page | ~220 | 2 e2e |
| 6 | Edge type coloring + hop expansion to 1/2/3/4 with per-ring caps; one-direction prefs sync refactor | ~200 | 2 e2e |

Plus inter-bout fixes:
- **Mouse-back STILL did browser back**: moved listeners from `root` to `window` capture phase + added `mouseup` (browser fires nav on mouseup) + `auxclick`. preventDefault on all three. Always intercepts inside pane, never outside.
- **Center node off-center bug**: CSS center node is 44×44 but JS positioned all nodes using `NODE_DIAMETER = 36`. Added `CENTER_NODE_DIAMETER` + `diameterFor(n)` helper used in initial paint AND resize re-projection.
- **Lock-layout setting**: when on, filter toggles hide via CSS without sim re-run. Surviving nodes don't jump. Toolbar lock icon + Settings checkbox.
- **Lock-layout 4px wobble**: spurious `setHiddenTypes(empty)` on lock toggle was re-running the sim. Diff-aware syncPrefsToGraph only calls setters for fields that actually changed; `setLockLayout` sequenced first so subsequent setters see the new flag.

### New modules

- `src/tabs/right/context-tab.ts` (~270) — orchestrator: route → subject derivation, unified `onSelect`, one-direction prefs sync, mouse-back intercept
- `src/tabs/right/context-tab-lifecycle.ts` (~50) — ensures permanent context tab at index 0 per active world
- `src/tabs/right/context-pane-toolbar.ts` (~150) — type chips + lock icon + hop pill (4 segments)

### Renamed / removed

- `src/tabs/right/writing-context-tab.ts` → replaced by `context-tab.ts`
- `src/tabs/right/writing-context-lifecycle.ts` → replaced by `context-tab-lifecycle.ts`

### Touched modules

- `src/core/types.ts` — `RightTabRef` kind `writing-context` → `context` (no narrativeId on ref); new registry fields `context_filters_off`, `context_hop_depth` (widened 1-4), `context_lock_layout`, `context_edge_color`; `writing_context_auto_open` marked @deprecated
- `src/core/constants.ts` — `ELEMENT_TYPE_COLORS` map added (palette from dcc-viewer / element-viewer-trial)
- `src/core/router.ts` — `SettingsTab` adds `'context'`
- `src/tabs/right/context-pane-graph.ts` — major rewrite: rings-based hop computation, edge coloring, dynamic setters (`setHiddenTypes`/`setHopDepth`/`setLockLayout`/`setEdgeColor`), `goBack()`, breadcrumb render, right-click node menu, free zoom/pan (`userScale`/`userTx`/`userTy` on top of base fit projection), fit-to-view button, per-paint listener stacking bug fixed (handlers attached once at mount)
- `src/tabs/right/context-pane-preview.ts` — `narrative` → `subject` + new `mode: 'writing' | 'element'`; Featured + add-to-story gate on writing mode; "open in detail" hides when previewing self in element mode
- `src/tabs/right/context-pane-lists.ts` — unchanged (writing-mode only)
- `src/tabs/right/right-pane.ts` — dispatch on `context` kind; tab button styling
- `src/tabs/right/right-tabs-persistence.ts` — context tab is permanent (no strip-on-save); migration prepends if missing on load; legacy `writing-context` entries dropped silently
- `src/registry/registry.ts` — per-world snapshot loader drops legacy entries
- `src/middle/settings-panel.ts` — new `renderContextTab` + `wireContextTab` with hop depth dropdown (Auto/1/2/3/4), lock layout checkbox, edge-color checkbox
- `src/styles/atlas.css` — toolbar styles (chips, lock, hop pill, right cluster); breadcrumb trail styles (replaces back pill); right-click menu styles; fit-to-view button styles
- `src/app.ts` — wires renamed lifecycle

### New e2e specs

`tests/e2e/context-pane.spec.ts` (15 tests):
- Context tab permanent leftmost on fresh boot
- Element route shows graph + preview (no lists, "open in detail" hidden for self)
- Element route: clicking a neighbor swaps preview + reveals "open in detail"
- Home route shows empty state copy
- Breadcrumb appears after recenter; home chip returns to subject
- Right-click node opens menu (Open as element / Copy ID); Esc closes; "Add to story" hidden in element mode
- Right-click "Add to story" appears in writing mode for non-subject nodes
- Type chip toggles hide that type; chip persists with `is-off`; re-enable returns nodes
- Hop toggle 1-hop hides 2-hop neighbors
- Hop preference persists in registry
- Lock layout: surviving nodes do NOT move when a type is hidden
- Zoom: wheel reveals fit-to-view button; click resets
- Hop: 3-hop reveals a node two rings out from the subject
- Settings: Context tab renders + persists hop depth
- Settings: edge coloring toggle persists and routes back to graph

### Tests + bundle

- vitest: 711 (unchanged — graph refactor was integration-tested via e2e)
- Playwright: 110 → 126 (+15 context-pane specs + 1 existing context-pane spec updated for no-auto-open)
- Typecheck clean
- Production build clean

### Architectural patterns codified (DESIGN.md conventions #58-63)

- **#58**: Context tab is permanent + route-driven (route is the focus source of truth)
- **#59**: One-direction prefs flow (registry → orchestrator → graph → toolbar); toolbar callbacks only persist
- **#60**: Diff-aware sync (only call setters for fields that changed; setLockLayout first)
- **#61**: Window-level capture-phase listeners for mouse buttons that trigger browser defaults
- **#62**: Generalized ring computation with per-ring caps for multi-hop graphs
- **#63**: CSS vs JS coupling lesson — CENTER_NODE_DIAMETER constant must match `.is-center` CSS width/height

### Lessons (durable)

- **Per-paint listener stacking is a real category of bug.** The old graph code added a `click` handler to `target` inside `paint()`, which runs on every renderForCenter call. After N recenters, N handlers all fired on deselect. Moved to mount-time so each handler lives once. Add it to the convention list of things to grep for: never `addEventListener` inside a function that's called more than once per mount.
- **`preventDefault` on `mousedown` is not enough for mouse-back.** Chrome fires history nav on `mouseup`; some browsers use `auxclick`. Listen on all three at window-level capture phase. Inside-pane check via `root.contains(e.target)` keeps it scoped.
- **CSS-JS coupling needs a code-level reminder.** When CSS sets a different size for a special variant of an element (e.g. `.is-center { width: 44px }` overriding `width: 36px`), the JS positioning code MUST be aware. Add a comment in the constant ("CENTER_NODE_DIAMETER MUST match CSS") so the next person who tweaks one tweaks both.
- **Spurious "no-op" setter calls are not no-ops if they trigger re-renders.** `setHiddenTypes(same set)` would have been fine if it just compared and bailed — but it called `renderForCenter` (full sim). Always include a "did anything change?" guard at the call site OR inside the setter when the setter has side effects beyond state mutation.
- **One-direction state flow scales.** Toolbar callbacks went from "persist + apply to graph + refresh toolbar" to "persist, subscriber handles the rest." Less coupling, no duplicate-update races, settings page edits propagate to the toolbar without extra wiring.

### Open follow-ups

1. **Skeld smoke against AtlasMoppetopia** — exercise hop=3/4 + edge coloring against realistic cast sizes (~20+ per scene).
2. **Density slider** — Captain mentioned earlier; per-ring caps tunable beyond tier defaults. Defer until felt.
3. **Edge type coloring v2** — when Relation subtypes get their own palette, color edges by relation type (rivalry red, friendship green) rather than node type.
4. **2-hop visualization at scale** — when cast > 30 + 2-hop adjacents, the layout sim might want auto-scaling rest distance.
5. **Pre-existing Playwright `split` test flake** — passes in isolation, intermittent in suite. Pre-dates this session; worth tracking but not blocking.

---

## Session 230 (2026-05-24) — Context pane polish + chip lifecycle + reading-mode redesign

Refinement bout on the writing-context pane work. Captain's punch list converged on bug fixes (refresh recovery, preview clipping, alias label survival), graph polish (labels, hover-fade, recenter, ResizeObserver, tier density), and behavior changes (Featured/Planned/Potentials clarified, right-click unlink, backspace-on-chip unlinks first, reading mode hides the whole right pane).

### Big batches

**Graph**:
- Click recenters on any node (back-pill returns to narrative-centered view); Ctrl/Cmd+click navigates to that element.
- Hover-fade non-connected nodes (CSS-driven via per-node neighbor set).
- ResizeObserver re-projects layout (no sim re-run) when right pane is dragged.
- Tier-aware density: scene/draft cap 12 + 1-hop; chapter cap 6, direct only; book cap 4, direct only.
- Labels show full names (CSS handles ellipsis at 140px max-width).
- Native browser tooltip = name + description excerpt (200 chars).

**Featured/Planned/Potentials**:
- Cast rows mark Featured (filled cyan dot, sorted to top, full opacity) vs Planned (outlined ring, faded).
- Potentials column renamed from "Suggested" — reads more openly.
- `syncChipLabels` now treats canonical name OR any alias as a valid surface form (aliases survive).

**Chip lifecycle**:
- Backspace on the right edge of a chip → replaces chip with its label as text; subsequent Backspace deletes characters.
- Right-click on chip → "Unlink {label}" menu item. Replaces chip with text; if no other mention of the id remains in prose (chip OR name/alias text match), also removes id from narrative's link field.
- Right-click on autolink hint → "Link to {name}" — mouse alternative to Tab.

**Reading mode redesign**:
- Hides entire right pane via `.atlas-shell:has(.atlas-writing-workspace.is-reading-mode)` projection. Sidebar stays.
- Disables autolink hint underlines; mutes element chips to plain white underline (no cyan).
- No font override (writer's chosen font carries through).
- Esc exits both reading mode and focus mode.

**Spellcheck**:
- Per-world `writing_spellcheck` toggle in Settings → Writing (default true). Applied to contenteditable via `spellcheck` attr on every render.
- Autolink hint spans always carry `spellcheck="false"` so proper-noun element names don't get squiggle-lined.

**Bug fixes**:
- Refresh-while-context-tab-open: tab now subscribes BEFORE narrative-found check; recovers when elements arrive after mount (showed "Loading narrative…" empty state during boot window).
- Preview action buttons clipping: preview-host is now position:absolute with inset:0 over the lists area, giving the card a definite height so header + scrollable body + fixed-footer actions lay out correctly.
- Trailing-space-after-chip: dropped the `{type: 'text', text: ' '}` insert across all chip-insertion paths (Tab autolink, @ picker, add-to-cast selection-wrap, inline-create).
- Selection-as-alias label clobbered: syncChipLabels now preserves alias labels.

**Behavioral changes**:
- "+ add to story" button hides when Featured (already in prose); shown for Planned + Potentials; no-selection inserts chip at cursor (no separate Planned-only path); selection wraps as chip + creates alias.
- Preview closes after "+ add to story" click — lists return to view.
- Compiled view sections collapsible: chevron toggles fold/unfold; title navigates. Tier-specific icons.
- Element images dropped from preview (didn't lay out well at preview width).

**Top bar of context pane removed** — graph extends to the top edge. Tier selector was disabled (v2 feature) and label was redundant with the tab name.

### Touched modules

- `src/tabs/right/context-pane-graph.ts` — major rewrite for recenter + hover-fade + ResizeObserver + tier density + label improvements
- `src/tabs/right/context-pane-preview.ts` — absolute positioning fix + drop images + close-after-add + Featured detection (text-match aware)
- `src/tabs/right/context-pane-lists.ts` — Featured/Planned visuals + Potentials rename
- `src/tabs/right/writing-context-tab.ts` — boot-order recovery + chip-click-selection listener + drop top strip
- `src/middle/writing-workspace.ts` — chip right-click unlink handler + autolink right-click + spellcheck apply + Esc-exits-reading + chip-click dispatcher
- `src/middle/writing-workspace-add-to-cast.ts` — no-selection path now inserts chip (Planned-only field-write removed)
- `src/middle/writing-workspace-element-chip.ts` — Backspace handler unlinks
- `src/middle/writing-workspace-editor.ts` — syncChipLabels takes surface (name + aliases) instead of just name
- `src/middle/writing-workspace-autolink.ts` — exposes `findAutolinkCandidateAt` + `convertAutolinkAt` for the right-click menu; spellcheck=false on decorations
- `src/middle/writing-compiled.ts` — collapsible sections + tier-specific icons
- `src/middle/settings-panel.ts` — spellcheck toggle
- `src/core/types.ts` — `writing_spellcheck` on WorldRegistryEntry
- `src/styles/atlas.css` — all the visual changes above
- `tests/e2e/writing-workspace.spec.ts` — add-to-cast no-selection test rewritten for new semantic

### Tests + bundle

- vitest: 711 passing (unchanged)
- Playwright: 110 of 111 passing; "split: divides current narrative at cursor" intermittently flakes when run after autolink tests but passes consistently in isolation — known pre-existing brittleness, not regression from this bout
- Typecheck clean
- Production build clean

### Lessons

- **TypeScript JSDoc + angle brackets in comments**: `<id>` inside backticks within a JSDoc block tripped TypeScript's parser into "Type expected" errors at unrelated lines downstream. Lesson: prefer plain `//` comments for inline syntax examples; reserve JSDoc for stable doc surfaces.
- **`position: absolute; inset: 0` beats flex-sibling for slide-in overlays**: when a preview card needs a definite height to constrain its scrollable body + fixed footer, absolute positioning against a `position: relative` parent guarantees the geometry. Flex-sibling layouts can let nested content push the footer off-screen.
- **Alias-preserving label sync**: any "rename propagation" sweep that walks the document needs to know about ALL valid surface forms, not just the canonical name. Aliases are a feature of the chip system; the sync pass was clobbering them.
- **Tier-aware visual rules**: graphs at scene level want richness (1-hop adjacency); graphs at chapter/book level want clarity (direct relations only, smaller cap). One-size-fits-all caps don't work.

### Open follow-ups (next session)

1. **Global context pane** (big refactor) — make the context pane available outside writing mode. In element view: graph centered on selected element + element preview below. In other rooms: empty state or hide. Discussion thread open with Captain.
2. **Graph v2 features** queued in DESIGN_WRITING.md: hierarchical tier-zoom (book → chapter → scene drill-down), zoom + pan, filter by element type, search/highlight.
3. **Compiled view editable** — v2 feature, requires range tracking from compiled text → source child for edit routing.

---

## Session 229 (2026-05-23) — Writing-room redesign + Context pane + Compiled view

After a deep design conversation with Captain about writer flows (drafting / contextual exploration / metadata editing) and the world-first vs story-first writer archetypes, agreed to: (1) make the writing room prose-pure, (2) move cast / details / references into a right-pane Context tab, (3) add a graph-central context layout, (4) support compiled view for parent narratives.

Executed 12 of 14 tasks autonomously. Code refactor first (foundation), then UI tightening, then context pane build, then compiled view. File split (#2) partial — extracted add-to-cast handler; deeper split deferred.

### Code quality fixes (foundation)

1. **Over-rendering in `refreshNonEditorSurfaces`** — guarded by el + elements ref identity. UI-only state ticks no longer trigger 6 DOM replacements. Massive reduction in churn during typing.
2. **Stale `(el as any).atlas_aliases` cast dropped** — was a leftover from Bout 1 of session 228.
3. **Cast-strip width fix** — `width: 760px` → `max-width: 760px` (later moot since cast strip moved to context pane, but the fix locked in the responsive-layout principle).

### UI tightening

4. **Sticky bar below header** — combines breadcrumb + date + action icons (focus, reading, open-as-element) in one row. Brighter, more legible. View-mode toggle joins it for parent narratives.
5. **Ambient word count corner** — bottom-right floating widget, always visible. Footer entirely dropped.

### Context pane (right pane, writing mode only)

6. **`writing-context` tab kind** added to `RightTabRef`. Lifecycle module hooks hash changes to insert/remove the ephemeral tab.
7. **Pane shell**: top strip + graph + below-graph (lists or preview).
8. **Force-directed graph** ported from cos-browser. Pure physics, no library, ~290 lines including DOM/canvas layer.
9. **Cast + Suggested lists** with mention counts, "why" tags, per-narrative dismissals.
10. **Element preview slide-in** that snaps snug against graph bottom when active. Backlinks folded in as "Appears in: …".

### Cross-cutting

11. **Add-to-cast unified with aliases** — selection becomes alias automatically. One source of truth for alternate names.
12. **Compiled view** for parent narratives — read-only assembly + clickable child markers. Mini markdown renderer keeps the bundle lean.
13. **Removed old cast/details/refs** from writing room. Files deleted: `writing-workspace-cast-strip.ts`. Functions removed: `renderDetailsDisclosure`, `renderReferencesDisclosure`.

### New / touched modules

- `src/middle/writing-compiled.ts` (295) — compiled view + mini markdown renderer + tree assembly
- `src/middle/writing-workspace-add-to-cast.ts` (130) — extracted handler with alias logic
- `src/tabs/right/writing-context-tab.ts` (171) — orchestrator for the pane shell
- `src/tabs/right/writing-context-lifecycle.ts` (113) — hash-driven tab insert/remove
- `src/tabs/right/context-pane-graph.ts` (293) — force-directed sim
- `src/tabs/right/context-pane-lists.ts` (333) — Cast + Suggested
- `src/tabs/right/context-pane-preview.ts` (214) — slide-in element preview
- `tests/unit/writing-compiled.test.ts` (18 tests) — locks in tree assembly + markdown rendering

### Test count growth

- Vitest: 693 → 711 (+18 for writing-compiled unit tests)
- Playwright: 110 → 110 (1 spec rewritten for context pane; reading-mode spec passes after fixing Esc-exits-reading + sticky-bar visibility)

### Lessons (durable, added this session)

- **Reading mode must keep the exit affordance accessible.** Hiding the sticky bar in reading mode trapped the user. Fix: keep the bar visible (fade the breadcrumb half), keep action icons crisp, AND wire Esc as an alternate exit. Same rule applies to focus mode (already worked because it had Esc; now also has an icon).
- **`display: none` between siblings + slot-snug overlay > absolute-positioned overlay.** The element preview replaces the lists by toggling display between them — no z-index fight, no scroll position loss, no layout shift, perfect seam against the graph's bottom edge. Cleaner than overlay positioning.
- **Pure-physics force sims port cleanly between tools.** The cos-browser pattern (synchronous run + canvas edges + DOM nodes) adapted to atlas in ~290 lines including layout fitting. No dependency added. Sub-50ms simulation cost for typical cast sizes (< 30 nodes).
- **Mini markdown renderer beats hauling in a parser.** ~80 lines covers paragraphs / headings / lists / blockquotes / bold / italic / code / links / chips. Not perfect coverage but matches what narrative prose contains. Adding markdown-it would have been ~30 KB minified.
- **Aliases as the single source of truth for "alternate names" is the right call.** Captain's intuition (add-to-cast on selection creates an alias) collapsed two parallel mechanisms into one. Autolink + @ picker both already consume aliases. The selection-becomes-alias path means writers don't have to open an aliases editor manually for the common case.

### Open follow-ups

1. **Deeper file split for `writing-workspace.ts`** — still ~1090 lines. Sticky-bar renderer (~150 lines) and context-menu (~80 lines) are the next natural extractions. Defer until the surfaces settle.
2. **Compiled view: editable mode** — v2 feature. Range tracking from compiled text back to source child + edit-routing. Needs its own design conversation.
3. **Context pane: tier zoom** — selector in the top strip is rendered but `disabled`. v2: at chapter level, graph shows scene clusters; at book level, chapter clusters.
4. **Context pane: relation-type coloring** — currently all edges are cyan. Red for rivalry/conflict, etc. — needs Relation element schema lookup.
5. **DESIGN_WRITING.md** — update with v3 compiled-view section + context-pane architecture. (Updated minimally this session; full pass next time.)
6. **Smoke-test against AtlasMoppetopia** — exercise the context pane against Skeld's real-world data. Should confirm graph layout works at realistic cast sizes (~20 characters per scene typical).
7. **Reading + focus mode chrome rules** — verify the new "keep sticky bar visible" rule doesn't make reading-mode feel too busy. May need to further fade the bar's chrome or add a small "thin strip" mode.

---

## Session 228 (2026-05-20) — ARCHIVED

Writing v2 batch (10 autonomous bouts: backlinks polish, word goal, find/replace, font picker, character cast strip, inline element creation, split-into-sibling, autolink, TipTap code-split). Convention #53 added. See `docs-archive/PROGRESS-history.md` for the full entry.

---

## Session 227 (2026-05-20) — ARCHIVED

Writing workspace v1 + v1.5 polish. TipTap chosen, two-representation storage (`story` markdown + `atlas_richtext_json`), conventions #47-52 added. See `docs-archive/PROGRESS-history.md` for the full entry.

---

## Items dropped (don't re-add without fresh design conversation)

Per-world conflict policy override, email per-world, zone-targets-map, cross-element pin rendering, map subtype visual filter, map locking via URL, "maps within" inverse search perf, picker keyboard shortcut, pin coord council motion (already in schema), snap-to-existing-vertex for pins (only relevant for markers, already done), repair pre-migration server markers, hotkey undo/redo. Also dropped during session 231 context-pane work: search/highlight-by-name in graph (less load-bearing than other v2 features; hover already shows names); hierarchical tier-zoom drill-down (replaced by click-to-recenter which gives drill-down for free).

---

Earlier sessions (197-228) archived to [`docs-archive/PROGRESS-history.md`](docs-archive/PROGRESS-history.md) — Phase 3.5+ sync hardening, zone subsystem, hotkeys MVP, slug-prefix filenames, map camera persistence, rooms model + decoupling (session 223), writing system redesign + offline (session 224), sidebar takeover + drag-reorder (session 224 continued), stewardship pass (225), polish day with chip + decay ring (226), writing workspace v1 (227), writing v2 batch (228). Architectural rules from those sessions live in DESIGN.md conventions; sync lessons in SYNC_NOTES.md; writing-specific patterns in DESIGN_WRITING.md.
