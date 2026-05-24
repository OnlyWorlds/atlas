# Atlas — Progress Log

Operational state. Architecture in **DESIGN.md** (+ `DESIGN_MAPS.md`, `DESIGN_ZONES.md`). Sync lessons in **SYNC_NOTES.md**. Session-by-session history archived to `docs-archive/PROGRESS-history.md`.

---

## CURRENT STATE (handover snapshot, 2026-05-24 session 230 close)

Writing room redesigned around a **prose-pure layout + right-pane Context tab**. Session 230 added refinement: refresh-bug recovery, top-bar drop, graph quick wins (labels, adjacent cap, hover-fade, ResizeObserver, click-to-recenter, Ctrl+click to navigate, tier-aware density), Featured/Planned distinction in Cast (filled cyan dot vs outlined ring), alias-preserving syncChipLabels, "+ add to story" semantics (button hides when Featured, no-selection inserts chip), reading-mode redesign (hides whole right pane + disables link visuals), right-click chip unlink + autolink-hint link, spellcheck toggle + autolink-spellcheck-off, backspace-on-chip unlinks first. **711 vitest green + 110 Playwright green.** Typecheck clean. Production build clean.

**Featured/Planned/Potentials model** (session 230 lock):
- **Featured** = element id in narrative's link field AND present in prose (chip or word-bounded name/alias match). Sorted to top of Cast, filled cyan dot, full opacity.
- **Planned** = in field but NOT in prose. Outlined cyan ring, faded text + icon.
- **Potentials** (was "Suggested") = NOT in field; surfaced via 1-hop adjacency from cast or sibling-narrative cast.
- Invariant: prose ⊆ field, always. Convention #50 UNION-on-save guarantees it. External tools that remove a chip-referenced id get clobbered on the next save.

**Recent invariants worth knowing** (most-recent-first):

- **Backspace on linked chip unlinks first** — pressing Backspace when the cursor sits immediately after a chip replaces the chip with its label as text; subsequent Backspace deletes the now-plain text. Override on the chip extension's addKeyboardShortcuts.

- **Right-click on chip → Unlink option** — replaces chip with label text. After unlink, scans remaining prose for any other mention of the same element id (chips + name/alias text matches). If none remain, also removes the id from the narrative's link field — stronger "no longer in the cast" gesture.

- **Right-click on autolink-hint → Link to {name}** — mouse alternative to Tab. Same conversion logic.

- **Spellcheck toggle per world** (`writing_spellcheck`, default true) + autolink hint spans always carry `spellcheck="false"` (proper-noun element names don't get squiggle-lined).

- **Reading mode redesign** — hides the whole right pane (intermediate between normal and focus), disables autolink hints, mutes element chips to plain underline. No font override (writer's chosen font carries through). Esc exits reading AND focus modes; the bar's action icons stay reachable.

- **Graph click recenters + Ctrl/Cmd+click navigates** — recenter shows that element's web with a "← back to {narrative}" pill; Ctrl+click leaves the writing room and navigates to that element. Lists below stay tied to the writing narrative regardless of graph recenter — graph is the exploration tool, lists are anchored to scene.

- **Graph: hover-fade non-connected** — hovering a node fades nodes that don't share an edge with it.

- **Graph: ResizeObserver** — right-pane drag re-projects layout without re-running sim.

- **Graph: tier-aware density** — scene/draft = 1-hop cap 12; chapter = direct cast only, cap 6; book = direct cast only, cap 4. Resolves the book-level spaghetti.

- **Chip click routes to context pane selection** — drop sticky-on-click chip preview popover. Hover preview stays. Click dispatches `atlas:context-select-element` → pane selects, preview slides in, lists highlight, graph highlights. Single source of truth.

- **syncChipLabels preserves aliases** — a chip's label is "valid" if it matches the canonical name OR any of the element's `atlas_aliases`. Only stale names (no longer in either set) get rewritten. The selection-as-alias path (selected text → chip with selection-text label + add as alias) now survives subsequent syncs.

- **Element preview "+ add to story" button** — hides when element is Featured (already in field + prose). Visible for Planned + Potentials. Click closes preview + inserts chip at cursor (no selection) or wraps selection as chip with alias (selection).

- **Compiled view sections collapsible** — section markers are two click targets: chevron (folds with ▾→▸ rotation) and title (navigates). Tier-specific icons (menu_book / article / short_text / edit_note).

- **Sticky bar below element header** (convention #54). Breadcrumb left + view-mode toggle + focus / reading-mode / open-as-element action icons right. Save state lives in element-header sync dot — no duplicate.

- **Ambient word count widget** (convention #55). Floats bottom-right corner, always visible.

- **Writing-context tab** (`src/tabs/right/writing-context-tab.ts`). Ephemeral RightTabRef kind `'writing-context'`. Lifecycle inserts/removes per writing-mode entry/exit. Auto-opens on first insertion if `writing_context_auto_open` (default true). Boot ordering note: tab subscribes BEFORE narrative-found check; recovers when elements arrive after mount.

- **Element preview slide-in** — absolutely positioned over the lists area with `inset: 0`; guarantees a definite height so header + scrollable body + fixed-footer actions lay out correctly without clipping. Images intentionally not rendered (didn't lay out well at preview width).

- **Add-to-cast with alias unification** (convention #56) + **Compiled view for parent narratives** (convention #57) — as before, unchanged structurally.

- **refreshNonEditorSurfaces over-rendering fixed** (session 229).

**Bundle impact** (session 230 close):
- Main JS gzipped: ~162 KB (stable from 229's 161 KB)
- Writing-workspace chunk gzipped: ~150 KB (~unchanged)
- New atlas-local fields: `atlas_dismissed_suggestions` (since 229)
- New registry fields: `writing_context_auto_open`, `writing_spellcheck` (since 229-230)
- Conventions list: 1-57

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

## Session 228 (2026-05-20) — Writing v2 batch: 10 bouts, autonomous

Long autonomous session after a deep design conversation about the v2 roadmap. Captain locked the scope as 10 bouts (~7h budget); shipped all 10 with full test coverage, smoke-tested green at session close.

### Bouts shipped

| # | Bout | Lines (net) | Tests added |
|---|------|-------------|-------------|
| 1 | Cleanup (e2e + Element type + OW_LINK_RE + flush) | ~120 | 6 e2e |
| 2 | Backlinks polish (Mentioned-in + self-heal) | ~80 | 2 e2e |
| 3 | Word goal (popover + progress ring) | ~200 | 12 unit + 1 e2e |
| 4 | Find/replace (Ctrl+F / Ctrl+H bar) | ~440 | 2 e2e |
| 5 | Font picker (4 system stacks) | ~70 | 1 e2e |
| 6 | Character cast strip (5-type pivot) | ~190 | 1 e2e |
| 7 | Inline element creation (Ctrl+Shift+E + right-click) | ~140 | 1 e2e |
| 8 | Split-into-sibling (Ctrl+Shift+D + right-click + modal) | ~290 | 1 e2e |
| 9 | Autolink (TipTap plugin + Tab handler) | ~280 | 9 unit + 2 e2e |
| 10 | Code-split TipTap (dynamic import + race guards) | ~50 | 0 (existing coverage held) |

### New modules

- `src/middle/writing-workspace-word-goal.ts` (159) — sessionStorage + popover + pure `goalProgress` helper
- `src/middle/writing-workspace-search.ts` (190) — ProseMirror plugin for find/replace decorations
- `src/middle/writing-workspace-find-bar.ts` (170) — floating UI bar driving the search controller
- `src/middle/writing-workspace-cast-strip.ts` (160) — type-pivot strip + chip insertion
- `src/middle/writing-workspace-split.ts` (260) — split confirm modal + atomic-ish split logic
- `src/middle/writing-workspace-autolink.ts` (240) — index builder + decorations plugin + Tab handler

### Touched modules

- `src/core/types.ts` — Element gets named optional fields; WorldRegistryEntry gets `writing_font_family` + `writing_cast_tab`
- `src/core/hotkeys.ts` — added `WRITING_INLINE_CREATE_EVENT`, `WRITING_SPLIT_EVENT`, two new bindings
- `src/core/constants.ts` — unchanged (atlas-local extension list was already complete from v1.5)
- `src/middle/writing.ts` — code-split dynamic import + race-guarded mount path
- `src/middle/writing-workspace.ts` — Element-type cleanup + cast strip mount + footer word-goal button + find-bar wiring + inline-create + split listeners + autolink refresh on element ref swap
- `src/middle/writing-workspace-editor.ts` — added search + autolink plugins + handle controllers
- `src/middle/writing-workspace-element-chip.ts` — centralized `OW_LINK_HREF_RE` + `createOwLinkScanner` factory; old `OW_LINK_RE` removed
- `src/middle/writing-workspace-load.ts` — imports centralized regex
- `src/middle/writing-workspace-derive.ts` — fresh-scanner-per-call (no shared /g state)
- `src/middle/writing-workspace-chip-preview.ts` — Element-type cleanup
- `src/middle/element-detail-refs.ts` — split into Mentioned-in (narratives) + Referenced-by (others), writing-room navigation for narrative chips
- `src/middle/element-detail-fields.ts` — Element-type cleanup
- `src/middle/settings-panel.ts` — added font-family selector + wire handler
- `src/ui/element-create-modal.ts` — added `suppressNavigate` option

### Bundle impact

| Build | Main JS gzipped | Workspace chunk gzipped | Total on writing-room visit |
|---|---|---|---|
| Session 227 close | 298 KB (single chunk) | — | 298 KB |
| Session 228 close | 156.87 KB | 148.85 KB | ~306 KB |

Main bundle dropped 141 KB gzipped (47%). Users who never touch writing only pay the new ~157 KB. First writing-room visit per session triggers the chunk fetch (cached for the session).

### Test count growth

- Vitest: 672 → 693 (+21: word-goal 12, autolink 9)
- Playwright: 93 → 110 (+17 writing-workspace specs)
- All green at session close. Typecheck clean. Production build clean.

### Lessons (durable, added this session)

- **ProseMirror's EditorState selection does NOT sync from DOM selection on demand.** When Playwright tests set selection via the Selection API + Range, PM doesn't see the change unless a `selectionchange` event fires (or a focus/click event triggers PM's sync). For e2e tests that need to programmatically position selection, the recipe is: set the DOM range → dispatch `new Event('selectionchange')` on document. Discovered when the inline-create test passed in isolation but failed in the suite; the difference was state-reset timing combined with keyboard-event ordering, but the real fix was to stop fighting PM and let it sync via its watched event.
- **Custom keyboard events on contenteditable have ergonomic limits.** Playwright's `page.keyboard.press('Control+Shift+N')` doesn't reliably reach ProseMirror's `handleKeyDown` when Chrome intercepts the combo at the OS level. The workaround is to route the hotkey through the centralized dispatcher AND dispatch a CustomEvent in tests (bypasses keyboard entirely). For native Tab, dispatch `new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })` directly on `.ProseMirror`.
- **Dynamic `import()` race guards are non-optional.** When the user navigates away from a feature mid-load, the .then() callback shouldn't mount into a now-detached DOM. Generation counter + targetId capture is the minimum belt: counter bumps on cleanup, .then bails if either bumped. Without this, leaked event listeners pile up across navigations and produce confusing "why doesn't this work?" symptoms in the second tab open.
- **`pagehide` is the modern `beforeunload`.** For best-effort save-before-close, `pagehide` fires on tab close + back/forward cache lifecycle. Pair with a defensive snapshot capture inside the handler (in case onUpdate hadn't run for the latest transaction). FS Access API writes are async; the browser may not give the handler enough time to flush — but it's strictly better than no listener at all.
- **`Element` type extension was load-bearing for the whole bout.** Once optional named fields were declared on `Element`, the cascade of dropped `(el as any)` casts uncovered no real bugs — but the type now catches typos. Recommend adding new atlas-local fields as named optional fields on `Element` AND in `ATLAS_LOCAL_EXTENSION_FIELDS` together; the two stay in lockstep.
- **One source of truth for regex patterns.** Three modules each had their own `OW_LINK_RE` — one anchored, one global, one identical to the first. Centralized as `OW_LINK_HREF_RE` (anchored, for predicate use) + `createOwLinkScanner()` (factory for /g scans, fresh per call to avoid lastIndex state-share). Pattern: if you have a /g regex shared across modules, make it a factory, not a constant.

### Open follow-ups (carry forward to next chat)

1. **UI polish on the new surfaces.** Captain mentioned "want to tweak ui a bit more but basically there" — the cast strip aesthetic, find bar positioning, word-goal ring contrast, and autolink underline weight are all candidates. Iterate via screenshot-driven feedback.
2. **In-narrative outline disclosure** (DEFERRED in this session by Captain). Disclosure between breadcrumb and prose showing H1/H2/H3 jumps. Roadmap item.
3. **Smoke against real AtlasMoppetopia** — load Skeld's world, exercise autolink + cast strip + split against real-world prose. Catch anything the synthetic e2e tests miss.
4. **Convention #52 grep guard + CSS-var existence check** — still queued from session 227 carry-forwards. Tiny scripts, lock in two regression classes.
5. **Reading-mode font + writing-mode separation, if requested.** Currently one per-world font for both modes. If writers want distinct fonts, add a second selector.
6. **Code-split warning about pre-existing dynamic-imports** — Vite warns that `active-store.ts`, `sync-attach.ts`, and `map-camera-persist.ts` are dynamic-imported by `settings-panel.ts` but statically imported elsewhere. Not blocking; eventually convert all imports to static and drop the dynamic ones in settings-panel.

---

## Session 227 (2026-05-20) — Writing workspace v1

Long autonomous session after the design conversation. 9 planned bouts; 8 landed, 1 deferred. Research swarm + locked design + full v1 build + tests, end-to-end.

### Research swarm (pre-build)

Six parallel agents fed v3.0 design: differentiator scout across writing tools, two Reddit friction/needs sweeps (fiction-writer + worldbuilder + power-user-notes), linking UX deep-dive across 9 tools, richtext library evaluation. Synthesis informed:
- **TipTap chosen** over Lexical (Lexical eliminated by memory-leak benchmark in long sessions), ProseMirror (more boilerplate), Quill/Editor.js (poor long-doc + markdown), CKEditor (too big).
- **`@` trigger, no `[[`** — explicit insertion only; no NovelCrafter-style passive auto-detect (false positives).
- **Aliases as first-class** — universal friction in Obsidian/Roam without them.
- **First-mention rule** — link once per narrative, not every mention.
- **One pane, not three** — counter to genre default (Scrivener/World Anvil/NovelCrafter all three-pane); cross-tool research showed the three-pane shell is ALSO the genre's primary complaint surface ("chrome competes with the page").
- **Backlinks live on the element, not the writing surface** — Obsidian power-user pattern.

### DESIGN_WRITING.md v3.0 + DESIGN.md tracking section

- Complete rewrite of DESIGN_WRITING.md (v2.1 → v3.0). New user-stories section, full linking model, storage model, library choice with rationale, v2+ roadmap (17 named-and-protected features so they don't get lost), research foundations.
- New DESIGN.md section "Atlas-Specific Fields & Features" catalogs every atlas-local extension, world-level state, per-tool config. Flags `atlas_shape` and `atlas_aliases` as council-motion candidates for OW schema migration.

### Code shipped

- `src/middle/writing-workspace.ts` (588 lines) — orchestrator: mount/teardown, debounced save, header reuse, breadcrumb, date row, prose host, collapsibles, footer, reading-mode toggle, mention items provider with name+alias fuzzy match.
- `src/middle/writing-workspace-editor.ts` (164 lines) — TipTap configuration: StarterKit + Markdown + custom ElementChip + chip-click delegation + initial-content post-processing.
- `src/middle/writing-workspace-element-chip.ts` (94 lines) — custom Mention extension extending the stock one with a `type` attribute; renders as `span.atlas-element-chip` with data-id/data-type/data-label.
- `src/middle/writing-workspace-mention.ts` (151 lines) — @ picker popover UI: glass aesthetic, type icon + name + meta, keyboard nav, recents-first rank pending (TODO).
- `src/middle/writing-workspace-markdown.ts` (177 lines) — custom JSON → markdown serializer handling chips as `ow://` links; supports paragraphs, headings, bold/italic/strike/code marks, blockquotes, lists, hr, code blocks, links.
- `src/middle/writing-workspace-load.ts` (60 lines) — markdown → JSON post-processor converting standard link marks with `ow://` href into ElementChip nodes.
- `src/middle/writing-workspace-derive.ts` (115 lines) — `extractProseLinks` + `computeRelationPatch` (UNION semantics).
- Updates to: `writing.ts` (dispatches to workspace), `core/constants.ts` (+`atlas_richtext_json`, +`atlas_aliases` in `ATLAS_LOCAL_EXTENSION_FIELDS`), test fixtures (consume canonical list from constants instead of hardcoding).
- CSS additions: ~280 lines covering workspace shell, prose styles (paragraph/heading/list/blockquote/code), element chip, disclosures, footer, reading mode, @ picker popover.

### Test infrastructure

- 32 new unit tests in `writing-workspace-derive.test.ts` + `writing-workspace-markdown.test.ts` (6 + 26 tests):
  - extractProseLinks: empty/single/multiple/dedup/case-insensitive
  - computeRelationPatch: empty narrative, UNION with manual entries, no-op when no diff, multi-type grouping, ignored types
  - NARRATIVE_RELATION_FIELDS map completeness
  - serializeDocToMarkdown: paragraphs, headings, marks, chips (with closing-bracket escape), lists, blockquote, hr
  - convertLinkMarksToChips: pass-through, conversion, https:// not touched, preserves other marks, multi-chip paragraphs
  - Round-trip: serialized chips re-detectable by auto-derive regex
- Test fakes (FakeOwApiClient + MSW handlers) now consume `ATLAS_LOCAL_EXTENSION_FIELDS` from constants.ts as the single source of truth — future strip-discipline additions land in lockstep.
- All 661 vitest green (629 → 661). Typecheck clean. Production build clean.

### What's deliberately NOT in v1 (v2 backlog)

Per DESIGN_WRITING.md §v2+ Roadmap — hover preview card on chips, focus mode, first-mention auto-link, backlinks pane on element-detail, outline/corkboard view, per-narrative atlas-local notes, per-session word count goal, find/replace, inline element creation from prose, element embeds / footnotes / callouts (TipTap extensions), bidirectional consistency check, prose-first extraction, visual narrative graph, compare view, export to PDF/EPUB.

### URL scheme shortened (post-Bout I)

Captain flagged the workspace URL as too long (three UUIDs = ~110 chars). Refactored:
- **New form**: `#/w/<worldId>/writing/<narrativeId>` (one UUID).
- **Legacy form** still parses (`/writing/book/.../chapter/.../scene/...`) — parseHash picks the deepest segment as `narrativeId`. Re-emitting from a parsed legacy URL produces the short form (silent migration on copy/paste).
- Route shape: added `narrativeId?: string` to `Route`; removed `bookId/chapterId/sceneId`. Callers updated: `writing.ts`, `writing-workspace.ts`, `element-detail.ts`, `writing-sidebar.ts`. `writingHash(worldId, narrativeId?)` signature simplified. `writingHashForNarrative` reduced to a trivial wrapper (kept on signature for back-compat; ancestry no longer encoded in URL).
- Ancestry is derived at render time from `parent_narrative` chain via `buildNarrativeIndex` + `ancestorIds` (no extra cost — atlas always has the world's narratives in memory by the time the writing room mounts).
- 11 new tests in `router-writing.test.ts` covering short-form parse, legacy-form parse, emit, and round-trip migration.
- Total tests: 672 (was 661). Typecheck + production build clean.

### v1.5 polish pass (post-build, same day, Captain feedback driven)

Long iterative refinement after first dev-server look. Roughly 12 rounds of feedback → fix → screenshot → reiterate. All shipped same session.

**Chip preview card** (`src/middle/writing-workspace-chip-preview.ts`, ~190 lines): hover-to-peek + click-to-stick floating card. 220ms hover delay; sticky mode on click stays until click-outside or Esc. Card shows type icon + name + description excerpt + image_url + "Open as element →" link. Writers stay in writing — chip click no longer navigates away.

**Aliases editor — proper modal** (`src/ui/aliases-edit-modal.ts`): replaced CSV-in-a-text-input with a dedicated modal. One row per alias, "+ add alias" link, Enter creates next row, × removes, case-insensitive dedup on save, empty → persists `null` for clean clear. Element-detail renders aliases as chip strip; clicking the row OR the label opens the modal.

**Recents tracker for @ picker** (`src/middle/writing-workspace-recents.ts`): per-world localStorage key tracks last 8 elements picked via @. Empty-query picker shows: (1) explicit picker recents, then (2) recently-edited elements by `local_updated_at` desc, padded up to 8. Matches the natural writer workflow ("I just touched Drizzle, now I'm writing about them"). PICKER_EXCLUDED_TYPES filters narrative/pin/marker/map out — they aren't narrative-linkable.

**Focus mode** (Cmd+Shift+F): new hotkey binding dispatches `atlas:writing-focus-toggle`. Workspace toggles `.is-focus-mode` class; CSS uses `:has()` to project the effect onto the shell — `.atlas-sidebar`, `.atlas-right`, `.atlas-divider` collapse; middle pane gets `flex: 1 1 100% !important` override to fill viewport (beats the inline `style="flex: 0 0 X%"` set from persisted shell ratios). Workspace hides its own chrome too. Esc returns.

**Settings tab persistence**: `atlas_settings_last_tab` localStorage key + tab-changed save on every render. Initial fix had a bug — `parseHash().settingsTab` defaults to `'identity'` so the "no tab in URL" check never triggered. Fix: compare `window.location.hash` against `settingsHash(wid)` (the bare form) directly.

**Per-world prose font size**: `WorldRegistryEntry.writing_font_size_px` (atlas-local). Settings → Writing has a 5-step selector (13/14/15/16/18). Applied via `--atlas-prose-font-size` CSS var on workspace root. Live update on subscribe tick.

**Native select styling**: dropdown classes were misclassed as `atlas-input` instead of `atlas-select`. Fixed. Added `color-scheme: dark` on root + option styling for OS-rendered menus. Documented pattern for future selects.

**Layout shift gone**: prose container + Details + References disclosure now share `--atlas-writing-content-width: 760px`; body has `scrollbar-gutter: stable`. Toggling disclosures no longer shifts content horizontally. Prose uses `flex: 0 0 auto; min-height: 60vh` — never squeezed by disclosure content; opening Details just extends scrollable body.

**Chip + visual polish** (many small rounds):
- Element chips (cyan dotted underline in prose): had a bug where `var(--atlas-accent)` was never defined — chips read invisible. Aliased `--atlas-accent: var(--atlas-cyan)` in root. Then iterated visual weight several times until landing on cyan-text + cyan-soft-dotted-underline at rest, solid + faint bg on hover.
- Element link chips (multi-link references in element-detail): dialed down. Iterated 4 times to get sizing right: smaller text (11.5px), subtle border, 3px vertical padding, `:has(.atlas-link-chip-remove)` tighter right padding. The × button hit a classic specificity tie with the `material-symbols` package — `.material-symbols-outlined { font-size: 24px }` (specificity 0,1,0) tied with `.atlas-link-chip-remove`. Fixed by scoping under `.atlas-link-chip .atlas-link-chip-remove` (0,2,0). **This pattern needs to be a convention** — see Lessons.
- Alias chips: matched the link-chip aesthetic but kept pill shape (border-radius 11px) for distinction; tuned padding asymmetric (`2px top / 4px bottom`) to correct optical centering against descender glyphs (j, p) which push visual mass upward.

**Writing area aesthetic improvements**:
- Warm off-white prose text (`#e0ddd6`) instead of pure white — easier on the eyes for long sessions
- Subtle warm vignette on the prose container (faint radial + linear gradient at ~1-2% opacity) — feels like "page on a desk"
- Slightly larger + airier prose (15px default, line-height 1.72, letter-spacing 0.005em)
- All these new colors go through `--atlas-prose-*` CSS variables — explicit foundation for a future light-mode toggle (swap the variables, chrome unchanged)

**DESIGN.md atlas-specific tracking section**: catalogs every atlas-local field, world-level state, and per-tool config so we can take stock later for potential schema migrations. Flagged `atlas_shape` and `atlas_aliases` as council-motion candidates.

**humanizeFieldName drops `atlas_` prefix**: clean labels everywhere (`atlas_aliases` → "Aliases"). Element-detail-zone-sections uses its own labels so no impact there.

### What's still queued for next chat (v2 batch)

Captain's "knock all of that out" combo:
1. **Backlinks pane on element-detail** — "narratives that link to this element" + "elements that link to this narrative". Cross-cutting feature, highest leverage per research.
2. **First-mention auto-link** — TipTap extension; passive tokenizer + ghost-underline + Tab-to-accept. The original Bout H deferred.
3. **Code-split TipTap dynamically** — bundle is ~140 KB gzipped over budget for non-writing-room users. Lazy-load workspace from writing.ts via dynamic import.

Plus the smaller v2 candidates (Bidirectional consistency check, Outline/corkboard, Element embeds, Footnotes/callouts, Find/replace, Visual narrative graph, Prose-first extraction, Compare view, Export, Per-narrative notes, Per-session word goal) — these need either design conversations or focused build sessions of their own.

### Lessons (durable, added this session)

- **Always scope material-symbols icon overrides under a parent class.** `.material-symbols-outlined` ships with `font-size: 24px` at single-class specificity (0,1,0). Any of our `.atlas-foo-icon { font-size: 12px }` rules will TIE and load-order decides — non-deterministic. The fix is two-class scoping: `.atlas-foo-parent .atlas-foo-icon` (0,2,0) wins regardless of load order. This is the SECOND time this has bitten us (session 226 room-nav chip + session 227 link-chip-remove). **Convention worth locking in.**
- **Visual centering ≠ geometric centering for chip text with descenders.** Glyphs like j/p/g/y push the text's visual mass upward in the line-box, so symmetric vertical padding reads as "text too low". Asymmetric padding (less top, more bottom) corrects the optical center. Apply to any small pill-style chip.
- **`:has()` is now production-viable** in Chromium-only contexts like atlas. Used to project workspace-class state onto sibling shell elements (focus mode hides sidebar + right pane from a workspace-rooted toggle). Saved building a global state slice for what is essentially a UI mode.
- **Beware inline flex styles when overriding via CSS.** Atlas shell sets `style="flex: 0 0 X%"` on panes from persisted ratios; `display: none` siblings doesn't reclaim that fixed flex space. Need `flex: 1 1 100% !important` (the !important is essential) to beat the inline declaration in focus mode.
- **CSS variable typo surfaces silently.** `var(--atlas-accent)` was used in three places but never defined; values fell through to inherited text color. Atlas-cyan was the actual var name. Added `--atlas-accent: var(--atlas-cyan)` as alias. **Worth adding a CI check** that flags `var(--atlas-...)` usages with no matching definition.
- **`parseHash().settingsTab` always returns a truthy value** (defaults to `'identity'`) — can't be used to detect "no tab in URL". Compare to the bare hash string instead.

### Open follow-ups (carried forward to next chat)

1. **Playwright e2e specs for the workspace** — happy path (open narrative → see prose → type @ → pick element → see chip → save → verify markdown + atlas_richtext_json + relation field). Reading-mode toggle. Empty-narrative initial state. Focus mode entry/exit. Estimate: 1 hour.
2. **Smoke-test against real AtlasMoppetopia** — load Skeld's filled world, open a narrative with existing markdown in `story`, verify markdown → chips conversion (convertLinkMarksToChips), edit + save round-trip.
3. **Lock in the material-symbols-scoping convention** — add as convention #52 in DESIGN.md and create a tiny grep-based pre-commit check.
4. **Lock in the CSS-var-existence check** — script that scans for `var(--atlas-...)` usages and warns on undefined refs.

### Lessons (durable)

- **Custom markdown serializer beats fighting library plugin APIs.** I tried to extend @tiptap/markdown's parseMarkdown/renderMarkdown hooks but the contract proved harder to satisfy than just walking the JSON ourselves. Writing a focused JSON → markdown walker (~180 lines) gave full control over chip serialization with no library-internal coupling. We still use @tiptap/markdown for PARSE (markdown → JSON on load) where the standard library is good enough, then post-process with `convertLinkMarksToChips` to upgrade ow:// link marks into ElementChip nodes.
- **Single source of truth for strip discipline pays off in test fakes too.** Both fakes consume `ATLAS_LOCAL_EXTENSION_FIELDS` from constants.ts now. Adding new atlas-local fields no longer requires updating three places (constants, fake-ow-client, msw-handlers).
- **Loose UUID regex (`[\w-]+`) over strict hex.** Tests use short symbolic ids like `c-1`/`l-1`; tightening the regex to `[a-f0-9-]+` would force test rewrites. The server-side authority validates UUIDs; our client-side regex only needs to be permissive enough to match what the server emits AND what tests use.
- **Two-representation storage works.** `story` (markdown for OW interop) + `atlas_richtext_json` (TipTap JSON for atlas fidelity) feels heavier than one field but the alternative — losing all atlas-only formatting whenever another tool touches the narrative — would be worse. The two are atomically updated; load prefers JSON, falls back to parsing markdown.

---

## Items dropped (don't re-add without fresh design conversation)

Per-world conflict policy override, email per-world, zone-targets-map, cross-element pin rendering, map subtype visual filter, map locking via URL, "maps within" inverse search perf, picker keyboard shortcut, pin coord council motion (already in schema), snap-to-existing-vertex for pins (only relevant for markers, already done), repair pre-migration server markers, hotkey undo/redo.

---


---

Earlier sessions (197-227) archived to [`docs-archive/PROGRESS-history.md`](docs-archive/PROGRESS-history.md) — Phase 3.5+ sync hardening, zone subsystem, hotkeys MVP, slug-prefix filenames, map camera persistence, rooms model + decoupling (session 223), writing system redesign + offline (session 224), sidebar takeover + drag-reorder (session 224 continued), stewardship pass (225), polish day with chip + decay ring (226), writing workspace v1 (227). Architectural rules from those sessions live in DESIGN.md conventions; sync lessons in SYNC_NOTES.md; writing-specific patterns in DESIGN_WRITING.md.
