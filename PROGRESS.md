# Atlas — Progress Log

Operational state. Architecture in **DESIGN.md** (+ `DESIGN_MAPS.md`, `DESIGN_ZONES.md`). Sync lessons in **SYNC_NOTES.md**. Session-by-session history archived to `docs-archive/PROGRESS-history.md`.

---

## CURRENT STATE (handover snapshot, 2026-05-20 session 227 close)

Tool has a working writing workspace v1 + v1.5 polish. **672 vitest green + 93 Playwright green.** Typecheck clean. Conventions list 1-52 (full text in DESIGN.md + DESIGN_WRITING.md). PWA + offline cache; bundle ~988 KB JS / 295 KB gzipped — +140 KB gzipped from TipTap/ProseMirror integration. Code-splitting deferred (see Open follow-ups).

**Writing workspace v1 landed** — new `src/middle/writing-workspace.ts` module replaces the schema-driven element-detail when route mode is `writing` AND an active narrative exists in the URL hierarchy (convention #51). TipTap richtext editor (StarterKit + Markdown + custom ElementChip extension). Layout: 36px header (reused element-detail-header.ts) → breadcrumb + date row → prose surface → collapsible Details (wraps element-detail-fields, story field filtered out) → collapsible References → footer (reading-mode toggle + word count + reading time + save state + open-as-element link). Storage: `atlas_richtext_json` (TipTap JSON, atlas-local) + `story` field (markdown serialization, OW interop) atomically updated on debounced save. Linking: `@` picker with fuzzy match on name + `atlas_aliases`, inserted as `[Display Name](ow://<type>/<uuid>)` markdown, rendered as cyan chip. Auto-derive: every save unions prose-mentioned UUIDs into Narrative's multi-link relation fields. Reading mode toggle via CSS class. **First-mention auto-link deferred to v2** (deliberate scope guard).

**Recent invariants worth knowing** (most-recent-first):
- **Writing room mounts writing-workspace, NOT element-detail** when narrative selected (convention #51). element-detail's writing-mode branch (in `getSelectedElement`) is still reachable via the global selection chip flow but is no longer the writing-room renderer.
- **Two new atlas-local extension fields**: `atlas_richtext_json` (TipTap JSON per Narrative) and `atlas_aliases` (string[] per any element). Both in `ATLAS_LOCAL_EXTENSION_FIELDS`; both stripped on API push; both fakes (FakeOwApiClient + MSW handlers) now consume the canonical list from constants.ts so future field additions don't drift.
- **OW URL scheme for prose links** (convention #48): `[Display Name](ow://<element-type>/<uuid>)`. Chip display text resolves dynamically from store at render-time so renames propagate without touching markdown.
- **Auto-derive on save** (convention #50): scans markdown for `ow://` matches, UNIONs into the matching multi-link relation field on Narrative. Manual entries preserved.
- **JSON → markdown serializer is custom** (handles chips as ow:// links); markdown → JSON parse uses `@tiptap/markdown` then post-processes ow:// link marks into ElementChip nodes via `convertLinkMarksToChips`.
- **DESIGN.md atlas-specific tracking section** added — catalogs every atlas-local field, world-level state, and per-tool config. Flags `atlas_shape` and `atlas_aliases` as candidates for future OW council motions.

(Prior session-226 invariants preserved below.)

- **Writing room reads URL for active narrative, not selectedElementId** (convention #46). Element-detail's `getSelectedElement` branches on `route.mode === 'writing'`. Global selection chip stays pinned to whatever was selected before writing was opened.
- **Selected-element chip on far right of room-nav-strip** (convention #45). Persistent affordance showing icon + name + ×. Click body → navigate to element room; click × → clear. Highlights cyan when route mode is 'element'.

**Recent invariants worth knowing** (most-recent-first):
- **Writing room reads URL for active narrative, not selectedElementId** (convention #46). Element-detail's `getSelectedElement` branches on `route.mode === 'writing'`. Global selection chip stays pinned to whatever was selected before writing was opened.
- **Selected-element chip on far right of room-nav-strip** (convention #45). Persistent affordance showing icon + name + ×. Click body → navigate to element room; click × → clear. Highlights cyan when route mode is 'element'.
- **Esc in writing room is a no-op** (convention #32 amendment). Esc only clears selection + navigates home when NOT in writing — writing room owns its own keyboard.
- **Marker delete via drag-to-trash** (zone-edit). Vertex handle drags onto the per-tab trash zone → `deleteMarkerInEdit`. Floor-guarded: at the polygon min (3) / line min (2) the trash zone stays disarmed; user can still right-click delete (which surfaces the floor toast).
- **Click outside zone in edit mode deselects** (no more click-anywhere insert). Inserts happen only via segment-overlay clicks. Click on map background → clear `selectedElementId` → `syncEditMode` exits edit cleanly.
- **Sync pill renders a decay ring during pending debounce.** `SyncEngine.getPendingPush()` + `atlas:pending-push` CustomEvent. Click during pending → `flushPendingPush()`. Window configurable via Settings → Sync → Autosave delay (number input, 1–3600s, persisted as `registry.sync_debounce_ms`).
- Middle pane: `shell.middleRoomNav` + `shell.middleContent` (renderers MUST target `middleContent` — convention #31)
- Default route bare `#/w/<id>` → home room
- Writing supertype = tier label storage (convention #33 v2). Tier semantics: l1/l2/l3/l4 = Book/Chapter/Scene/Draft. Drafts flexible-parent. Convention #34 v2.
- Writing tree membership filter: `isWritingNarrative(el, worldId)` reads `supertype` against `writing_labels` (convention #38).
- Label rename triggers immediate supertype migration on existing narratives (convention #39).
- **Writing tree lives in sidebar** (convention #40). Middle pane single-column in writing mode. Override via `state.ui.sidebarWritingOverride`.
- **Element-detail header locked at 36px** (convention #41). Tier badge + writing actions live inside it.
- **Field edits close optimistically** (convention #42). Popover tears down before awaiting persistence. Width now matches anchor field width with a small inset.
- **Narrative deletes cascade descendants** (convention #43). `findDependents` BFS-walks `parent_narrative` chain.
- **Last-narrative restore from writing icon** (convention #44). `WorldRegistryEntry.last_writing_narrative_id` + `writingHashForNarrative` helper.
- Showcase config supports `atlas_*` extensions (convention #35); showcases immutable, republish creates new (convention #36)
- Sidebar mode + room are independent dimensions (convention #37)
- Sentence case throughout, slug-prefix filenames (`<slug>--<uuid>.json`)
- Hotkeys MVP wired (`Ctrl/Cmd+E`, `S`, `K`, `?`, `Esc` deselect-to-home (except writing), map-tab `F`/`Z`/`L`)
- Map view persists per-map; pin badge accurate; pin label offset 7px (tightened session 226)
- Sync pill shows "synced 3m ago" live (30s tick); pending-push decay ring on the dot
- `atlas_shape` stripped on wire; both fakes strictly reject atlas-local fields in write bodies
- Welcome panel single CTA for atlas-root setup/recover; "engine not ready" toasts route through `surfaceSyncUnavailable`
- Self-hosted Material Symbols + Vite-PWA service worker
- DOM helpers in `core/dom-utils.ts`; active-store in `core/active-store.ts`

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

## Three big projects ahead — session 227 update

- **Writing workspace v1 — SHIPPED** (session 227). Major v2 follow-ups: code-split TipTap, e2e specs, alias editor row in element-detail, first-mention auto-link extension, hover preview card on chips, focus mode, backlinks pane on element-detail. Full v2 roadmap in DESIGN_WRITING.md.
- **Timeline** — `src/visualization/timeline/timeline-bar.ts` ported. Compact mode on Home, expanded mode in `#/w/<id>/timeline`. Narrative bars, zoom/pan, filter toggles, expand-collapse all deferred.
- **Publish** — `src/middle/publish-room.ts` stub. Backend already exposes `POST /showcase/publish/`; atlas-extension model (`atlas_*` config keys) locked in convention #35. Showcase config modal, element-detail publish button, list rendering, bundle UX for books, richtext piping — all deferred.

## Session 226 (2026-05-20) — Polish day: chip + decay ring + writing/selection decoupling

Captain-driven polish day across the whole tool. 8 items from his fix list, then 5 follow-ups from his eye-on-it review, then a writing/selection decoupling that came out of the chip work.

### The 8 from the fix list

- **#1 File-picker styled** — `map-create-modal.ts` raw `<input type="file">` replaced with a custom button + hidden input + filename text (`.atlas-file-picker`).
- **#2 Pin label tightened** — `defaultLabelOffset: 12 → 7` in `map-tab.ts`.
- **#3 Hold-Alt label cluster** — attempted, then reverted same session (Captain: "labels overlapping, no real need"). `src/ui/hold-labels.ts` deleted.
- **#4 Field-edit popover matches field width** — `field-edit-popover.ts:positionPopover` sets inline `width` from `anchorRect.width` (with 24px inset for breathing room and `MIN_WIDTH=280` floor); overrides CSS `max-width` to allow wide fields.
- **#5 Selected-element chip in room-nav-strip** — `src/middle/room-nav.ts`. Far-right chip showing icon + truncated name + ×. Click → element room; × → clear. Highlights when route mode is 'element'. Style mirrors `.atlas-room-nav-btn` (transparent default, cyan-tint active). **Convention #45.**
- **#6 Sync pill decay ring + customizable autosave** — `SyncEngine.getPendingPush()` / `flushPendingPush()`, emits `atlas:pending-push` CustomEvent on arm/cancel/fire. Pill renders conic-gradient ring via `--decay-fraction` driven by rAF. Settings → Sync gets a number input (1–3600s, persisted as `registry.sync_debounce_ms`); engine reads at attach and live via `setDebounceMs`.
- **#7 Marker delete: tooltip + drag-to-trash** — vertex handle gets a native `title` ("drag to move · drop on trash to delete · right-click to delete"). Trash-zone affordance ported from `map-tab-pin-drag.ts`. Floor guard added on revisit (see follow-ups below).
- **#8 Click-anywhere marker insert removed** — `zone-edit-mode.ts` `insertMarkerAtClick` deleted along with the call site in `map-tab.ts`. Map background click in edit now clears `selectedElementId` (→ `syncEditMode` exits edit). Inserts only via segment-overlay clicks.

### 5 follow-ups from Captain feedback

- **Hold-Alt reverted** (see above).
- **Popover narrowed** by 24px inset so it sits inside the field row instead of edge-to-edge.
- **Chip visuals tightened then re-rounded** — three rounds of dialing. Final: 26px height, 13px border-radius (rounded pill), transparent default chrome, cyan-tint active. Icon 16px + × 15px, scoped with two-class specificity to outrank the `material-symbols` package's 24px default.
- **Autosave delay swapped slider → number input** (1–3600s). Captain wanted values past 30s.
- **Zone-draft overlay wraps on narrow panes** — `flex-wrap: wrap` + `max-width: calc(100% - 32px)` so the create-zone widget reflows into multiple rows instead of being clipped.

### Writing / selection decoupling

Tracked the chip work to its conclusion: writing room's `mountEditor` was mirroring the active narrative into `state.ui.selectedElementId` on every URL change, which clobbered any prior global selection. Fixed:

- `writing.ts` no longer patches `selectedElementId` when entering writing or navigating between narratives.
- `element-detail.ts:getSelectedElement` derives the target element from the URL hierarchy (`route.sceneId ?? chapterId ?? bookId`) when `route.mode === 'writing'`. Otherwise unchanged.
- Result: select a Character → go to writing → chip still shows the Character → click chip → return to Character. Writing tree still highlights the active narrative (it always read URL, never `selectedElementId`). **Convention #46.**

### Esc refinement (convention #32 amendment)

Esc was firing `deselectToHome` from anywhere with a selection — after decoupling, Esc would pull the user out of writing AND clear the persisted global selection. Now gated: `hotkeys.ts` skips the deselect hotkey when `hash.includes('/writing')`. Writing room owns its keyboard.

### Marker drag-to-trash floor guard

Originally the drag-to-trash always armed the trash zone, deferring to `deleteMarkerInEdit`'s min-vertex toast on refusal — which looked like "drop succeeds then snaps back" jank. Now `buildVertexHandle` computes the floor at dragstart (3 polygon / 2 line) and suppresses trash-zone arming when at floor. User can still move the marker; right-click still deletes (and surfaces the floor toast for that path).

### Tests + bundle

- 615 → 634 vitest (19 new in `writing-helpers.test.ts` covering `buildNarrativeIndex` / `ancestorIds` / `findAncestry` / `nextOrder` — F24 from session 225's sweep)
- 93 Playwright unchanged
- Typecheck + production build clean
- Bundle 548 KB JS / 102 KB CSS / 155 KB gzipped (slight shrink from removing hold-labels CSS, slight grow from chip + decay ring + settings input)

### Lessons (durable)

- **`material-symbols` package's `.material-symbols-outlined` rule is single-class specificity (0,1,0).** Single-class overrides from atlas.css tied on specificity, so load-order decided which won — not deterministic. Two-class scoping (`.atlas-room-nav-selected .atlas-room-nav-selected-icon`) forces a win.
- **URL is the source of truth for room navigation.** When writing room tried to MIRROR its URL state into a global UI slice, the mirror became the bug. The fix was to read the URL directly where needed, not propagate.
- **Iteration-rhythm bouts benefit from Captain in the loop.** Visual fixes need his eye — three rounds on the chip ("works but too cyan" → "works but icons too big" → "works but icons still big" → "looks right") landed faster than any single-shot guess.

---

## Session 225 (2026-05-20) — Stewardship pass

Audit + four targeted refactors. See `SWEEP-2026-05-20.md` for the full triage (26 findings, 0 high / 6 med / 20 low).

### Refactors landed

- **`element-detail.ts` split 1444 → 162 + 789 + 450 + 117 lines** across `element-detail.ts` (dispatcher), `-header.ts`, `-fields.ts`, `-refs.ts` (and the pre-existing `-zone-sections.ts`). Clears the path for the writing-workspace redesign.
- **Writing tree helpers consolidated** into `writing-helpers.ts` (`buildNarrativeIndex`, `NarrativeNode`, `NarrativeIndex`, `ancestorIds`, `findAncestry`, `nextOrder`). Previously duplicated between `writing.ts` and `writing-sidebar.ts` with subtle differences.
- **`refreshElementsAfterWrite(store)` helper** added to `sync-attach.ts`, applied to 19 sites across 11 files. Replaces the 3-line `await store.listElements(); patchSlice('data', { elements }); requestPushIfLinked();` pattern.
- **Small follow-ups**: removed `maybeAutoActivate` no-op stub, replaced `setTimeout(0)` with `queueMicrotask` in field-edit-popover, added 21 unit tests for the newly-extracted pure helpers.

### Docs synced

- `DESIGN.md`: ACRONYMS additions (PIN, GPS), convention #41 (45px → 36px), shell ratio ASCII (18/52/30 → 19/51/30).
- `DESIGN_WRITING.md`: 45px → 36px references.
- `DESIGN_HOME.md`: identity click-to-edit marked shipped, quick-actions list reduced to shipped 3 buttons.

### Tests

- 594 → 615 vitest (21 new for pure helpers in `element-detail-helpers.test.ts`)
- 93 Playwright unchanged

### Decisions made

- **Writing workspace redesign will use Option A**: new `writing-workspace.ts` module parallel to element-detail, NOT a writing-mode branch inside element-detail. The split was prep for this.
- **`element-detail.ts` split landed BEFORE workspace redesign** so the new workspace can import a clean `renderHeader`.
- **`refreshElementsAfterWrite` lives in `sync-attach.ts`**, co-located with `requestPushIfLinked` rather than a new file.

---

## Session 224 continued (2026-05-20) — Sidebar takeover + header unification + drag-reorder

Continuation of the writing-pillar work after Skeld's fill on AtlasMoppetopia validated the new model with real data. Conversation-heavy day with iterative polish.

### Sidebar takeover
- New `src/sidebar/writing-sidebar.ts` — the writing tree, mounted into `.atlas-sidebar-content` when route is `writing`. Bands and tree append directly (no wrapping flex div) so the shell-level scrollbar gutter aligns with the elements sidebar pixel-perfectly.
- Two-band header mirrors elements sidebar exactly: create-row in filter-strip slot (stacked `+ new <l1>` / `+ new <l4>` buttons, height-locked to 67px to match), then search-row reusing `.atlas-search-row` (`[input] [magnifier] [tune]`).
- Override mechanism: `state.ui.sidebarWritingOverride: boolean`. Set when user toggles to Worlds/Elements while in writing. Clears on route in/out of writing OR on writing-icon re-click.
- Middle pane in writing mode dropped its tree column — now single-column, just element-detail.
- Drag-reorder: every tree row `draggable=true`, sibling-only (same `parent_narrative`), sequential `order` writes, cyan inset box-shadow drop indicator (top or bottom edge based on mouse y vs row midpoint).

### Header unification
- Tier badge + child-create buttons moved INTO `.atlas-middle-header` (icon-only, `.atlas-icon-btn-sm`-style). New helper `renderWritingTierActions(el, header)` in element-detail.
- Header locked at 45px with `!important` on every height channel + defensive child rule. Captain reported variable heights in prior bouts — investigation showed it was likely visual-weight misperception, but the lock makes it impossible by construction.
- Tier rule final (Captain): l1 → {l2, l4}, l2 → {l3, l4}, l3 → nothing, l4 → nothing (drafts don't nest from UI).

### Narrative cascade delete
- Extended `findDependents` for `narrative` type in both `folder-store-fs.ts` and `mock-folder-store.ts`.
- BFS-walks `parent_narrative` chain → collects descendants + pins referencing target or descendants.
- Confirm dialog shows total count.
- Delete from writing room stays in writing (route check in `onDelete`).

### Polish trio
- **Pin nav respects room**: `buildPinAffordance` click handler checks current route mode. In writing → `openMapTab(m)` no URL change; elsewhere → `openMapTab(m, sourceElementId)` with element-preserved URL.
- **Optimistic save**: `field-edit-popover.ts` calls `cleanup()` BEFORE awaiting `opts.onSave`. UI stays interactive during save. Failures surface via toast.
- **Last-narrative restore**: `WorldRegistryEntry.last_writing_narrative_id` writes on every selection change (deferred via `queueMicrotask`). Writing icon in room nav reads it on click and navigates via new `writingHashForNarrative` helper.

### Bug fixes
- **Duplicated detail panel** (recursive render): `patchSlice('ui')` mid-render was firing subscribers synchronously → recursive render → two detailMounts in detailCol. Fixed by deferring the selection patchSlice via `queueMicrotask`.
- **Supertype field unclickable**: I'd used `require('./writing-helpers')` in element-detail.ts — `require` doesn't exist in browser ESM. Replaced with static import.
- **Gear icon does nothing**: outer mountWriting subscribe was a no-op in tree mode. Now calls `render()` unconditionally; `mountMode` early-returns when mode unchanged.
- **Book chevron not folding when chapter selected**: `render()` was force-expanding ancestors on EVERY render. Now tracks `lastExpandedForActiveId` and only force-expands on activeId change. User's explicit chevron toggle wins on subsequent renders.

### Code tidying (cleanup pass before reflect)
- Removed dead `findAncestry` and `createNarrativeAtTier` in writing.ts (orphaned by the toolbar→header move).
- Dropped dead CSS: `.atlas-writing-tree-list`, `.atlas-writing-detail`, `.atlas-writing-detail-mount`, `.atlas-writing-context-toolbar`.
- Added 5 unit tests for `writingHashForNarrative` covering all depth levels + broken parent chains.

### Test count
- 589 → 594 vitest (5 new for `writingHashForNarrative`)
- 93 Playwright e2e unchanged
- Production build clean

## Session 224 — Writing system redesign + offline + tidying

Long autonomous session covering:

### Writing redesign (the big one)
- **Model**: Narrative belongs to writing tree iff `supertype ∈ {l1, l2, l3, l4}`. Tier = supertype value. Subtype is FREE (user classification like "flashback", "vision"). No canonical/display split.
- **Helpers**: `src/middle/writing-helpers.ts` — `getWritingLabels`, `isWritingNarrative`, `getTierForNarrative`, `isWritingInitialized` (smart detection), tier constraints + icons.
- **Setup screen**: `src/middle/writing-setup.ts` — shown when `isWritingInitialized` is false. Configures labels, detects existing supertype groupings ("Adopt detected: Plot Arc"), offers pre-checked promote.
- **Promote**: `src/middle/writing-promote.ts` — BFS from parent-chain roots, assigns supertype by depth, fills missing `order`. Idempotent. Depth-3+ become Drafts (l4).
- **Label-rename migration**: `applyLabelRenameMigration` rewrites old supertype values to new. Triggered from Settings → Writing change-event AND setup screen on save.
- **Drafts (l4)**: flexible-parent joker tier. Can root, sit under any tier, nest other drafts. Italic in tree. Always enabled.
- **Element-detail autocomplete**: supertype field on Narratives shows the four labels as suggestion chips + Tab autocomplete. Free-text override still allowed (escape hatch).
- **Writing room**: 1) Tree filtered by `isWritingNarrative`. 2) Tier-aware icons (l1=book, l2=article, l3=short_text, l4=edit_note). 3) Contextual create per tier (l1→l2+l4, l2→l3+l4, l3→l4, l4→l4). 4) Footer adds "+ new book" + "+ new draft". 5) Header gear re-opens setup. 6) Setup screen shown via mode-switching mount.
- **DESIGN_WRITING.md v2.0** completely rewritten. Conventions #33, #34 updated; #38, #39 added.

### Offline polish (Bout D from earlier in session)
- Self-hosted Material Symbols via `material-symbols` npm package (no Google CDN)
- `vite-plugin-pwa` configured — generates `sw.js` + `manifest.webmanifest`, precaches 17 entries (~4.9 MiB)
- New `src/core/offline.ts` registers SW in production
- Atlas is now installable as a PWA on Chromium

### Code tidying (Bouts A-C from earlier)
- `core/dom-utils.ts` — `escapeText`, `escapeAttr`, `relativeTime` deduped from 20+ files
- `core/active-store.ts` — relocated from `ui/create-world-modal.ts`; 19 files updated
- World Home: timeline-bar mounts ONCE per world activation (was destroy+recreate per render)
- Search room: memoizes runSearch by `(query, elements ref)`
- Writing tree: per-node chevron collapse persisted in `registry.worlds[i].writing_tree_collapsed`

### Test infrastructure
- 17 new unit tests in `tests/unit/writing-helpers.test.ts` covering `isWritingInitialized`, `buildPromoteCandidates`, `detectExistingLabels`, `applyPromote`, `applyLabelRenameMigration`, and supertype-based classification.
- Total: 589 vitest + 93 Playwright. All green.

### What changed in registry/types
- `writing_labels` expanded to include `l4` (Draft)
- New `writing_initialized: boolean` flag
- `writing_tree_collapsed: string[]` unchanged from session 223

---

## Items dropped (don't re-add without fresh design conversation)

Per-world conflict policy override, email per-world, zone-targets-map, cross-element pin rendering, map subtype visual filter, map locking via URL, "maps within" inverse search perf, picker keyboard shortcut, pin coord council motion (already in schema), snap-to-existing-vertex for pins (only relevant for markers, already done), repair pre-migration server markers, hotkey undo/redo.

---

## Session 223 (2026-05-18) — Rooms model + decoupling + close-out polish

Long autonomous session + on-return polish round + close-out feature bouts with Captain. ~15 bouts total. All green.

### Close-out features (final hour)

- **Writing room modal** (`src/ui/writing-create-modal.ts`): replaced `window.prompt` in writing.ts with a proper BaseModal subclass. Name input + Enter/Esc + inline error. Used for "+ new book/chapter/scene" flows.
- **Empty-world onboarding** (world-home.ts): when `totalElements === 0`, home shows a CTA card with 4 quick-create tiles (character / location / event / narrative) wired to `ElementCreateModal` with `initialType` preselected.
- **Click-to-edit world name + description** on home identity strip — uses the existing `field-edit-popover` pattern. Persists via `FolderStore.writeWorldMeta` + mirrors in `state.active.meta`. Placeholder text "add a description…" when description is empty.
- **Notes overlay** (`src/ui/notes-overlay.ts`): per-world freeform notes, atlas-local (never synced). Lives on `WorldRegistryEntry.notes`. Modal with auto-saving textarea, ~600ms debounce, save-on-blur. Accessible via sidebar footer button (sticky_note_2 icon) and `N` hotkey.

### Decoupling polish (post-autonomous)

Captain identified inconsistency: room nav highlight + sidebar mode were coupled to the URL via `syncModeFromRoute`. Some room icons would auto-flip sidebar; others wouldn't — depending on whether their route was tagged "contenty". Decoupled the two dimensions:

- `state.ui.sidebarMode` is now pure UI state, persisted via new `core/ui-prefs.ts` → `localStorage["atlas_ui_prefs"]`
- Toggle clicks update state directly — no URL navigation
- `syncModeFromRoute` removed from sidebar.ts
- `activateWorld` navigates to `worldHash(id)` (home) instead of `elementsHash(id)`
- `element-detail` delete navigates to `homeHash` instead of `elementsHash`
- `link-world-modal` post-link navigates to `homeHash`
- `rightTabHashFor` falls back to home (not elements) when no selection
- Home icon in room nav matches `elements` route as well as `home` (legacy /elements URL still resolves to middle=home)
- Sidebar mountBody falls back to worlds when mode='elements' but no active world
- Element header bumped 40 → 48px; "char1" felt cramped under the room nav strip
- Convention #37 added

Test updates (5 specs touched):
- `phase-bout-cc.spec.ts:62, 109` — gear-toggle + sidebar-toggle no longer dictate URL
- `phase4-elements.spec.ts:53, 192` — toggle/delete navigation
- `phase2-ui.spec.ts:151` — activation doesn't auto-flip sidebar

### Original autonomous session (10 bouts)

Long autonomous session (Captain swimming). 10 bouts. All landed cleanly.

**Foundation**:
- Middle pane split into `[middleRoomNav | middleContent]` flex column. Convention #31.
- `MiddleMode` extended: `welcome | home | element | writing | timeline | search | publish | publish-detail | import | templates | settings`.
- Router additions: `homeHash`, `writingHash`, `searchHash`, `publishHash`, `publishDetailHash`, `importHash`, `templatesHash`. Full route parsing for nested writing/publish paths.
- Default landing for bare `#/w/<id>` flipped from `timeline` → `home`.
- Esc + click-already-selected-row both clear `selectedElementId` + navigate home. Convention #32.

**World Home (`src/middle/world-home.ts`)**:
- Identity strip (world name + description + state badge + total elements count)
- Stats spread (element type icons + counts, click → flip sidebar to elements + filter)
- Compact timeline-bar embedded (canvas-based, multi-row dot binning)
- Recent activity (last 5 by `local_updated_at`)
- Quick actions row (+ new element, open writing, settings)

**Writing room (`src/middle/writing.ts`)**:
- Tree (left) + element-detail (right) layout
- Book/Chapter/Scene labels customizable in Settings → Writing (`registry.writing_labels`)
- Three-level depth cap enforced via UI. Convention #34.
- Contextual "+ new X" buttons based on selected node depth.
- Reuses existing element-detail for the editor surface (no new richtext yet).

**Timeline (`src/middle/timeline.ts` + `src/visualization/timeline/`)**:
- Lifted core algorithm from `tools/little-element-viewer`: `temporal-fields`, `axis-calculator`, `data-normalizer`, `timeline-bar`.
- Multi-row dot binning; click → element nav; hover → tooltip with name + type + date range.
- Two modes: compact (~100px, World Home) + expanded (~240px, full timeline room).
- Deferred: narrative bars, narrative filter, zoom/pan, expand/collapse toggle, narrative-aware row affinity.

**Search room (`src/middle/search.ts`)**:
- Search across name + description + supertype + subtype for all elements
- 200ms debounce, query in URL, match excerpt with highlight, click → element room
- "Search everywhere" icon in elements-sidebar opens the room with the sidebar's current query

**Publish (`src/middle/publish-room.ts` + `publish-detail.ts`)**:
- Stub home page lists `registry.worlds[i].showcases` (empty list → explanation copy).
- Per-showcase detail route with public URL display + back nav.
- Atlas extension model documented in `DESIGN_PUBLISHING.md`. Conventions #35, #36.

**Import + Templates stubs** — explanatory copy, "coming soon".

**Tests**: 572 vitest green (+12 timeline-axis + 7 deselect-conventions added). 93 Playwright green after 3 spec updates for new default route + canvas-based timeline.

**Lessons (durable)**:
- Foundation-laying via rooms model worked cleanly in one big session because the existing `MiddleMode` switch architecture was already in place — the refactor was extension, not rewrite.
- Reusing element-detail as the writing editor surface bought us a working writing room without a new editor library decision. Real richtext lands later; the data model + tree are stable.
- Timeline-bar port reused the multi-row binning algorithm directly and deferred narrative-aware affinity — that complexity is worth its own bout when narrative bars land.
- `.atlas-search-row` class collision (sidebar search input vs search-room results) caught early — namespace room-specific styles with `atlas-{room}-{element}` to keep CSS isolated.

---

Earlier sessions (217-222) archived to [`docs-archive/PROGRESS-history.md`](docs-archive/PROGRESS-history.md) — sync hardening, FK-constraint detection, atlas_shape leak fix, sentence-case scrub, slug-prefix filenames, hotkeys MVP, map camera persistence, and the rest of the Phase 3.5+ work. Architectural rules from those sessions live in DESIGN.md conventions; sync lessons in SYNC_NOTES.md.
