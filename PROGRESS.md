# Atlas — Progress Log

Operational state. Architecture in **DESIGN.md** (+ `DESIGN_MAPS.md`, `DESIGN_ZONES.md`, `DESIGN_WRITING.md`, `DESIGN_KNOWLEDGE.md`, `DESIGN_SHARING.md`). Sync lessons in **SYNC_NOTES.md**. Session-by-session history archived to `docs-archive/PROGRESS-history.md`.

---

## CURRENT STATE (handover snapshot, 2026-06-07 session 237 close)

**Session 237** = **Sharing arc opened: the 5 calls CLOSED + S1/S2 BUILT + the Anchor contract DRAFTED.** Design conversation settled all five `PHASE_SHARING_BRIEF.md` calls (lean-hybrid page storage · minimal-blocks v1 · global slugs + api_key/PIN auth · tombstone revoke · showcase = live-flagged page) plus three build-decisions (blocks JSON is truth + derived `story` mirror · pages stay in the elements sidebar v1 · NO publish affordance until backend). Four bouts: **(1) Foundations + share room** — `core/sharing.ts` (block model v1: heading/prose/element-card; `blocksOf()` heals card ids from the flat `atlas_page_refs` mirror so id-swap can't strand bindings; `pageBlocksPatch` keeps blocks+refs+story in lockstep), `core/narrative-kind.ts` (story/knowledge/page seam — writing tree/promote/setup + element-detail refs all exclude non-story kinds), 4 new `ATLAS_LOCAL_EXTENSION_FIELDS` (blocks/refs/intent/theme — fakes reject automatically), route `publish`→`share` (legacy alias parses), share room (list + intent chips + create/rename/delete), `/share/<id>` id-swap migration, Esc-gate. **Lost-update race found & fixed**: rapid same-element writes race FolderStore's read-merge-write — page writes now serialize through a promise chain (convention #77). **(2) Block builder** — one-block-at-a-time editing, lazy `share-editor` TipTap chunk (mentions/chips, NO derive — convention #76), reorder/delete, derived story mirror. **(3) Element-card + preview** — picker-bound cards, compact/full, per-field disclosure checklist, `share-page-render.ts` (store-free, the Track C viewer seed) powering both static blocks AND the visitor preview toggle. **(4) `SHARING_CONTRACT.md` DRAFT** — Django model, endpoints, snapshot payload schema (from the as-built block model), slug/revoke/quota/live-resolve semantics, open questions for Anchor. **Captain SHIPPED the contract to Anchor at session close — she is investigating; expect her reply next session** (her answers to §8's six questions + any model pushback drive S4 + Track C timing). Conventions #73-78 in DESIGN_SHARING. Sync round-trip test-locked (`sharing-sync.test.ts`, full adapter+SDK+MSW stack). **760 vitest + 148 Playwright + typecheck + build green** (share-editor is its own lazy chunk; TipTap still absent from main). **Post-smoke fix**: the generic element picker's "All" list now excludes pin/marker/zone (the type strip already did — Captain's card picker showed stray pins; one rule at the picker boundary now covers every generic pick, knowledge subjects included; `restrictToType` still reaches those types). +1 e2e regression assert. **Next session opener**: (1) `/receive` or check for **Anchor's reply** to the contract — her answers reshape S4 + Track C timing; (2) backend-free build candidates, roughly in value order: **S5 Circle block** (the Knowledge bridge — the differentiator) · **map block** · "Featured in" real reverse-scan over `atlas_page_refs` (~20 lines, currently decorative) · element-collection block · S3 theme tokens · drag-reorder; (3) Track C viewer scaffold can start once the contract payload shape survives Anchor's review. Captain smoked all 10 items of the 237 checklist (one fix: generic picker map-artifact leak, closed same-session).

**Session 236** = Knowledge **functionally complete** (critical review verdict → 4 gap-closing bouts): in-room **entry delete** (confirm + cascade count), honest **not-found interims** (no URL hijack, no tick churn), same-elements **tick guard** + scroll preservation for list/knower rebuilds, **known-view LENS v1** (sidebar world-dimming via transient `ui.knowledgeLens`, banner exit, id-swap migration; map reveal stays Later-phase), `extraData` on ElementCreateModal (circle tag in one write), and **sync round-trip locked by tests** (`knowledge-sync.test.ts` — full adapter+SDK+MSW stack: id-swap FK rewrites incl. circle membership, richtext stripped-on-wire + survives id-swap + pull-overlay, server-created entries recognized on pull). Holder-field reinterpretation **logged as schema-requirement candidate** (DESIGN.md "Semantic reinterpretations"). **741 vitest + 140 Playwright + typecheck + build green** (TipTap verified absent from main chunk; **e2e now runs `workers: 4` — full suite ~52s**, validated 2× + stress). Captain smoked 235's checklist + 236's five items (all passed). **Next arc: Sharing — open with `PHASE_SHARING_BRIEF.md`** (the 5 OPEN calls framed with options + recs → Anchor contract → S1+S2). K5 (graph knowledge-mode + drag-to-wire) deferred past Sharing.

**Session 235** = hygiene + doc alignment, THEN **Knowledge phase 1 core**: **K3** (embedded TipTap editor — mentions/autolink/chips, draft parity, `collectives` excluded from the derive + toast), **K4** (Knowers tab + known-view `/knowledge/knower/<id>`), **K6** (element-detail "Knowledge" section), context-pane interim (entry/knower as graph subject), and a Captain-smoke fix (single-link fields were invisible to the context graph). New `core/ow-links.ts` + `core/narrative-fields.ts` canonical homes keep the derive TipTap-free; `knowledge-editor.ts` lazy chunk keeps TipTap code-split (verified: main bundle clean). Full entry below.

**Session 234** = Knowledge + Sharing **design** (two new docs + Build Map below) + **Knowledge phase-1 build**: K1 (room skeleton) · K2 (in-room detail + held-by editor) · K4-core (known-view scan functions + unit tests). Atlas-only, pure-local. Full entry below the Build Map.

**Stable surface** (pre-Knowledge): phases 0-6 + 3.5 shipped — foundation, sync engine (two-policy conflict model), maps + zones + markers, rooms model (home/element/writing/knowledge/timeline/search/settings), writing workspace (TipTap, tiers, autolink/aliases, compiled view), tool-global context pane (route-driven graph). Architectural rules live in DESIGN.md conventions #1-72; sync lessons in SYNC_NOTES.md; per-room detail in the DESIGN_* docs. For current test counts run `npm run test:run` / `npx playwright test`; for bundle size run `npm run build`.

---

## Knowledge + Sharing — Build Map (session 234)

Designed session 234 (`DESIGN_KNOWLEDGE.md` + `DESIGN_SHARING.md`). Build order: **Knowledge first (atlas-only, no blockers), then Sharing (needs Anchor's Django backend + a new viewer tool).**

**Critical path**: Knowledge phase 1 (atlas) → define atlas↔backend *page contract* with Anchor → parallel { Anchor: Django backend · Temper: viewer tool + atlas share-room/block-builder } → integrate → Circle block (needs Knowledge).

### Track A — Knowledge (atlas-only, pure-local) — ✅ PHASE 1 FUNCTIONALLY COMPLETE (session 236)
- **K1 — Room skeleton** ✅ (234)
- **K2 — Entry detail + held-by** ✅ (234) — narrator = solo Character · collectives = Circles, two channels only
- **K3 — Authoring** ✅ (235) — embedded writing-editor component; @-mentions populate about-links with **`collectives` excluded from the derive** (mention ≠ holdership — DESIGN_KNOWLEDGE "Mention-derive exclusion")
- **K4 — Known-view + knowers** ✅ (core 234, UI 235) — [Entries | Knowers] tabs + `/knowledge/knower/<id>`
- **K5 — Graph knowledge-mode + drag-to-wire** — **DEFERRED past Sharing** (delight feature, not load-bearing). The **lens** part of K5 shipped early (236) — sidebar world-dimming, see DESIGN_KNOWLEDGE "Known-view lens".
- **K6 — Element-detail surfacing** ✅ (235) — "Knowledge" section: Known by / Subject of / Holds
- **Lifecycle + lens + sync confidence** ✅ (236) — in-room delete, not-found interims, lens v1, knowledge-sync integration tests, schema-candidate logging

### Track B — Sharing, atlas-side
- **S1 — Share room shell** ✅ (237) — `share` route (legacy `publish` aliases), page list + intent chips, create/rename/intent/delete.
- **S2 — Block builder UI** ✅ (237) — heading/prose/element-card, one-block-at-a-time editing, reorder/delete, per-field disclosure on full cards, visitor preview via portable `share-page-render.ts`. (~8-block set + per-block layout menus grow from here without migration.)
- **S3 — Theme tokens UI**: the ~6 tokens + live preview. (`atlas_page_theme` field already registered.)
- **S4 — Publish flow**: POST → backend, return URL/slug. **BLOCKED on Anchor contract** (`SHARING_CONTRACT.md` DRAFTED 237 — routing to Anchor is Captain's call).
- **S5 — Circle block**: needs Track A done. ✅ unblocked.

### Track C — Viewer tool (new deployed tool, phase 2 — Temper)
- New tool scaffold → `show.onlyworlds.com` (subdomain TBD). CF: `_redirects /* /index.html 200`, `_routes.json` (exclude `/assets/*`), Pages Function for OG-meta injection (unfurls).
- Lift atlas renderers (element-detail, leaflet map, narrative reading, context graph) into portable/shared form.
- Path-based routing; fetch page snapshot by id/slug; render the block model.

### Track D — ow.com / Anchor backend (Django, phase 2 — Anchor, against our contract)
- New page/showcase model: world, owner, **unique slug**, intent, composition/blocks payload, theme tokens, **snapshot payload**, live-vs-snapshot flag, view_count, published_at, revoked.
- Endpoints: POST publish · GET public (no auth, cached) · PATCH republish · DELETE revoke · slug-uniqueness check · list-by-world. Quota enforcement. Snapshot-freeze at publish.
- **The atlas↔backend contract is the coordination artifact** — define when the Sharing arc starts (DESIGN_SHARING "OPEN" items 1-5).

**Status:** Track A — **PHASE 1 COMPLETE (session 235)**. Next arc: **Sharing** — settle DESIGN_SHARING's OPEN calls (page storage model, v1 authoring mode) → write the Anchor contract → build S1 + S2 (no backend needed).

---

## Session 236 (2026-06-07) — Knowledge functionally complete: lifecycle gaps, lens v1, sync tests, schema candidate

Same-day continuation. Captain's brief: "functional, feature-complete frontend AND backend for Knowledge" → critical review of design + code + tests produced a tiered gap list → 4 autonomous bouts, per-bout gated. Decisions locked up front: lens ships now (drag-to-wire/graph-mode stays K5-deferred); holder-field motion LOGGED not drafted; 235's smoke checklist considered passed (Captain tested informally).

**Backend verdict from the review**: Knowledge needs NO new backend — entries are plain Narratives on canon fields; sync was already architecturally complete. What was missing was *verification*, now locked by tests (bout 2).

### Bout 1 — functional completion
- **In-room entry delete**: trash icon in the editor title row; confirm gated by `confirm_before_delete` (+ cascade count via `findDependents`, same pattern as element-detail); cancels pending debounced prose saves (moot once deleted); navigates to the list BEFORE the data tick so the editor never renders not-found for its own deletion. +1 e2e (dismiss-then-accept dialog flow — NOTE: the confirm fires async after an awaited findDependents; specs must `page.waitForEvent('dialog')`, not stack `once` handlers).
- **Not-found interims**: missing entry/knower id now renders an honest "not found" block + back button — URL stays truthful (was: silent home render with stale URL for knowers, `mountedView` override causing per-tick teardown churn). `mountedResolved` flag makes data ticks retry a full build, which auto-resolves the deep-URL-before-load and id-swap transients. `refreshEditorData`'s vanished-entry path routes here too. +1 e2e.
- **Same-elements tick guard**: list + knower views only rebuild when `data.elements` ref actually changed (`lastBuiltElementsRef`); rebuilds preserve scrollTop (`rebuildPreservingScroll` — room root is the scroll container). Ends sync-tick scroll resets on api-linked worlds.
- **Draft autolink toast edge**: holder toast moved outside the derived-key gate (a collective never changes the derived set — excluded from about — so an autolink-converted circle missed the lesson).
- **`ElementCreateModal.extraData`**: caller-supplied fields merged into the create body; "+ new circle" tags `subtype: 'circle'` in the same write (was create-then-patch). Defensive `onCreated` clears the tag if the user flips category in the modal.

### Bout 2 — sync confidence
- **`tests/integration/knowledge-sync.test.ts`** (3 tests, FULL production stack: engine → OwClientAdapter → real SDK → MSW strict validator + server-assigned ids): (1) first-push id-swap rewrites narrator/collectives/locations + circle membership, computed-knowing scans resolve on the post-swap set, `atlas_richtext_json` absent server-side but **survives the id-swap locally** (the swapped record carries it through `applyServerRecord` at a fresh id); (2) pull-overlay of a server-side story edit preserves local richtext (extension-field overlay contract); (3) server-created knowledge entries are recognized by the scans on pull — zero migration, the computed model's payoff.
- **Unlink e2e**: locks the conservative rule — unlink replaces chip with plain text and RETAINS the field while the name still appears in prose; the About chip × is the explicit subject-removal path.

### Bout 3 — known-view lens v1
- `ui.knowledgeLens: { knowerId } | null` (transient, never persisted) + `lensKnownSet()` in core/knowledge (knower + held entries + their subjects — strictly knowledge-derived). Toggle in the known-view header; **elements sidebar** dims outside-set rows (opacity 0.22, hover 0.7) + cyan banner "world as X knows it" with the exit ×. Persists across rooms (exploration is the point); cleared on world switch; knower id migrates in `handleIdSwap` (same class as the pin-placement migration). Map-pin dimming deliberately NOT in v1 (graduated map reveal = Later phase, DESIGN_KNOWLEDGE Build Phases). +3 unit, +1 e2e.

### Bout 4 — docs + close
- DESIGN.md: new **"Semantic reinterpretations"** schema-candidate table (narrator/collectives-as-holders → future `held_by_*` motion). DESIGN_KNOWLEDGE v1.3: status, lens section, de-hiding cross-link, sync-tests note. This entry.
- Full Playwright suite at close (see CURRENT STATE numbers).

---

## Session 235 (2026-06-07) — Knowledge phase 1 completed: hygiene, K3 editor embed, K4 known-view, K6 surfacing

Re-grounding session after a 12-day gap → critical pass over K-phase code + docs (bouts 1-2), then a design conversation locked four calls (trimmed editor embed · draft parity · in-room knower tabs over a sidebar takeover · the known-view screen shape) and bout 3 built K3 + K4 + K6 + the context interim; bout 4 = post-smoke fix + polish + this PROGRESS scrub. All green-gated; at close: **735 vitest + 136 Playwright + typecheck + production build.**

### Bout 1 — code hygiene
- **F1 groundwork (the K3 trap, fix shipped in bout 3)**: @-mentioning a Collective in knowledge prose would silently grant holdership — `NARRATIVE_RELATION_FIELDS.collective = 'collectives'` + UNION-on-save. Decision locked: K3's derive excludes `collectives` for knowledge entries + toasts. Documented in DESIGN_KNOWLEDGE (Authoring + convention #68).
- **F2 — stale-baseline blur-saves fixed** (knowledge-room): name + prose blur handlers compared against build-time snapshots, so edit → save → revert-to-original → blur silently skipped the write. Both now compare against current state. +1 e2e regression spec (rename-revert).
- **F3 — draft persists**: per-world localStorage stash (`atlas_knowledge_draft_<worldId>`, key prefix in constants.ts). Restored on returning to `/knowledge/new`; saved on every draft mutation; cleared on create + explicit cancel. +1 e2e spec. Replaces silent draft loss on navigate-away.
- **F4 — stale conservator comments swept** (`core/knowledge.ts` header + known-view block, `tests/unit/knowledge.test.ts` header) — code was correct, comments described the dropped third channel.
- **F6 — one canonical field map**: `NARRATIVE_RELATION_FIELDS` moved to `src/core/narrative-fields.ts` (derive re-exports for writing modules + tests); `ABOUT_FIELDS` now DERIVED from it (minus `collectives`) instead of a hand-maintained twin list.
- **F7 — writing/knowledge separation hardened**: `buildPromoteCandidates` explicitly excludes knowledge-subtype narratives (was safe only by accident of their flat shape).
- Polish: saved-entry title (h1) now syncs on same-view ticks (renames/pulls) — it's plain text, not an input.

### Bout 2 — doc sweep
- **DESIGN.md**: knowledge room added (rooms table, routes, `knowledgeHash` helper, shell diagram); per-room docs list gains Knowledge + Sharing; publish room rows point at `DESIGN_SHARING.md`; conventions **#35/#36 marked SUPERSEDED** (write-tool-prototype showcase model) → `DESIGN_SHARING.md`; "Showcase-config extensions" section replaced with a Sharing pointer.
- **DESIGN_KNOWLEDGE.md**: status → v1.1 (phase-1 core shipped); **Mention-derive exclusion** locked into Authoring + convention #68; **de-hiding path** noted in the schema section (council motion for first-class holder fields once Knowledge proves out — same track as `atlas_shape`/`atlas_aliases`).
- **PROGRESS.md**: Build Map de-staled; conventions #35/#36 supersession; session-archive pointers refreshed.

### Bout 3 — K3 + K4 + K6 build
- **Code-split groundwork**: `OW_LINK_HREF_RE`/`createOwLinkScanner` → new `core/ow-links.ts` (chip module re-exports), making `writing-workspace-derive` TipTap-free so knowledge-room imports `computeRelationPatch`/`extractProseLinks` statically. Verified post-build: TipTap absent from the main chunk; `knowledge-editor` is its own lazy chunk.
- **K3 — `knowledge-editor.ts`** (lazy, mirrors the writing.ts → workspace boundary): wraps `mountWorkspaceEditor` with mentions (`buildMentionItems`) + autolink + chips + chip hover-preview + a TRIMMED right-click menu (create-from-selection / link-autolink / unlink — no split, no global hotkey events). Unlink never touches `collectives` (holders are wired only via Held-by). Chip click → `atlas:context-select-element` (same gesture as writing).
- **K3 — knowledge-room editor session**: prose host carries `.atlas-writing-workspace-prose .atlas-knowledge-prose-rich` (inherits typography/chips/hints; compact-box overrides; writing `:has` chrome can't leak — no `.atlas-writing-workspace` ancestor). Saved entries: debounced save (registry `sync_debounce_ms`) → `story` + `atlas_richtext_json` + `computeRelationPatch` **with `collectives` deleted from the patch** + one-shot toast ("mentioning a circle doesn't make it a holder"); flush on view-switch/unmount/pagehide. **Draft parity**: same editor; `onSnapshot` → `draft.story`/`draft.richtextJson` → stash; prose-derived subjects render as non-removable `.is-derived` About chips and union into the Involves fields at create.
- **K4 — Knowers + known-view**: home view gains **[Entries | Knowers]** tabs (ephemeral tab state; new-entry/`view as…`/`+ new circle` actions per tab). `listKnowers` = direct holders + `subtype:"circle"` collectives (members NOT expanded). Known-view at **`/knowledge/knower/<id>`** (router + `knowledgeKnowerHash` + id-swap migration in `handleIdSwap`): header w/ counts · **Held knowledge** rows · **Known world** — one card per known-about element, full text of every mentioning held entry with entry attribution (conventions #69/#70 made visible).
- **K6 — element-detail "Knowledge" section** (`element-detail-refs.ts`): knowledge entries PARTITIONED OUT of "Mentioned in" (their chips were routing to the writing room) into a section with per-group nav targets — **Known by** (`knowersOfElement` → known-view) · **Subject of** (entries about this element) · **Holds** (entries this element holds).
- **Context interim**: `resolveSubject` treats an open knowledge entry OR knower as an element-mode subject (graph shows entry ↔ holders ↔ subjects); routeKey + chip-select extended; knowledge empty-state copy. Full "knowledge mode" stays K5/deferred.
- **New scans** (`core/knowledge.ts`): `listKnowers`, `knowersOfElement`, shared `aboutFieldFor`, `CIRCLE_SUBTYPE`. +8 unit tests. e2e rewritten for TipTap + 4 new specs (draft mention→subject · **mentioned circle never becomes holder** · knowers/known-view compile · K6 chips + routing).

### Bout 4 — post-smoke fix + polish + scrub
- **Captain-smoke fix — single-link fields were invisible to the context graph**: `collectDirectNeighbors` walked MULTI_LINK_FIELDS only, so a knowledge entry's `narrator` (its primary holder channel) — and every single-link relation tool-wide (`birthplace`, `protagonist`, …) — never appeared as a neighbor. Now also collects id-shaped string values generically (convention #5; double-gated by the caller's `byId.has`), with **`parent_narrative` deliberately excluded** (tree hierarchy ≠ graph material). +1 knowledge e2e regression spec (9 total). Side effect to watch in smoke: element/writing graphs now also show single-link neighbors — if a graph feels busier than before, that's this, and it's tunable via the skip-set.
- **Entries list rows** now show holder names ("held by Ireena", "held by the party +2") instead of a bare count.
- **PROGRESS scrub**: sessions 229-233 archived to `docs-archive/PROGRESS-history.md`; CURRENT STATE block slimmed (stale per-session paragraphs + volatile bundle/convention-count numbers dropped — run the commands for truth).
- Considered + skipped: debouncing the draft-stash writes (per-keystroke sync localStorage of a few KB is sub-millisecond; a debounce adds flush-on-navigate edge cases that could lose the freshest keystrokes — the exact thing the stash exists to prevent).

### Bout 5 — test-cadence codified + DESIGN.md close read
- **Test cadence codified** (Captain: "err on sparse") — table in the `atlas-tool` skill ("Test Cadence"), pointer in DESIGN Test Strategy, memory updated. Per-edit = typecheck; per-bout = typecheck + vitest (~3s) + affected spec file(s) only; full Playwright ONCE at session close/pre-commit. Open experiment: `--workers=4` (~30s full suite) — trial against the load-sensitive writing specs first.
- **Esc-gate fix**: `deselect-to-home` now also skips `/knowledge` routes (same trap as writing — Esc yanking the user to home mid-entry; DESIGN #32/#46 notes updated).
- **DESIGN.md close read** (v1.1): header status current (Knowledge shipped, Sharing next); on-disk tree `atlas-worlds/` → `onlyworlds-atlas/`; W1 lands on home (not timeline); W10's dead `ask` policy → `pause-and-review`; **UUIDs section rewritten** (server assigns v7 + id-swap — was still claiming client ids are accepted, contradicting SYNC_NOTES); deselect block contradiction fixed (click-row-toggle was dropped in 223 but still documented as live); writing routes show the primary short form (legacy noted); `writingHash(worldId, narrativeId?)` signature corrected; conventions pointer **67-72 → DESIGN_KNOWLEDGE** added; Build History de-staled (cutover done — `github.com/OnlyWorlds/atlas`); context-pane graph capabilities note the single-link neighbor scan.

### Smoke checklist (Captain)
1. **Draft + persistence**: Knowledge → "+ new knowledge entry" → type name + rich prose → leave the room → return → "+ new" → draft restored (including formatting). Cancel → "+ new" → fresh.
2. **Editor feel (saved entry)**: open an entry → type; `@`-mention a character → picker → chip; type an element's bare name → autolink hint → Tab converts; hover a chip → preview card; click a chip → context pane selects it; right-click selection → "Create element from selection"; right-click a chip → unlink.
3. **The holder trap**: @-mention a circle/collective in prose → chip appears, toast explains, and Held by does NOT gain it. Add it properly via Held by → Circles.
4. **About auto-population**: mention an element → it appears under About (draft: faded "from the text" chip; saved: real chip after the ~1s save).
5. **Knowers tab**: [entries | knowers] tabs; knowers lists circles first w/ member + entry counts; `view as…` picks any character; `+ new circle` creates a circle-tagged collective.
6. **Known-view**: click a knower → Held knowledge + Known world cards (full entry texts, source attribution, element names link to canon). A circle member inherits the circle's entries.
7. **K6**: open an element some knowledge is about → "Knowledge" section: Known by chips → known-view; Subject of chips → entry editor. Knowledge entries no longer appear under "Mentioned in".
8. **Context pane**: with an entry or knower open, the right-pane Context tab graphs it — narrator, circles, and subjects all as neighbors. ⚠ also check a normal element + writing graph still feel right (single-link neighbors are new there too).
9. **Rename-revert regression**: rename a saved entry → blur → rename back → blur → reload → original name held.
10. **Writing setup**: knowledge entries never appear as promote candidates.

---

## Session 234 (2026-05-25) — Knowledge + Sharing design; Knowledge phase-1 build (K1, K2, K4-core)

Long design conversation → two new docs (`DESIGN_KNOWLEDGE.md` + `DESIGN_SHARING.md`; `DESIGN_PUBLISHING.md` superseded to a pointer) + the Build Map above. Then three autonomous build bouts on the Knowledge foundation (atlas-only, pure-local), each typecheck+build gated, full suite at close.

- **K1 — Knowledge room skeleton**: `knowledge` route (`#/w/<id>/knowledge[/<id>]`) + `knowledgeHash` + parse; `MiddleMode 'knowledge'`; room-nav icon (`psychology`, between Writing & Timeline); `src/core/knowledge.ts` (`KNOWLEDGE_SUBTYPE`, `isKnowledgeNarrative`, `listKnowledgeEntries`, `heldByOf`/`heldByCount`); `src/middle/knowledge-room.ts` — list of entries + "+ new knowledge entry" (mints a narrative w/ `subtype:'knowledge'`) + held-by summary + empty state.
- **K2 — In-room editor (draft flow + held-by)**: three views — list (`/knowledge`), **draft** (`/knowledge/new`, in-memory, NOTHING persists until "create"), editor (`/knowledge/<id>`). In-room authoring surface: name input + **prose textarea** (`story`; rich @-mention prose deferred to K3) + **held-by** editor (Character via `narrator` single · Circles via `collectives` multi — **two channels only**) via `pickElement(restrictToType)`. About chips read-only (`aboutIdsOf`, excludes `collectives`). Build-once + surgical refresh (held-by/about re-render on same-view ticks; name/prose inputs never clobbered → focus/typing survive background sync). Saved-entry name/prose save on blur; held-by writes immediate.
- **K4-core — Known-view scans + tests**: `isKnowerType` (character|collective), `circleMembers`, `characterKnowsEntry`, `knowledgeHeldBy` (dispatch: character = narrator|circle-member, collective = direct holder), `elementsKnownAboutBy`. +14 unit tests (`tests/unit/knowledge.test.ts`) covering direct/inherited holding, non-knowers, about-exclusion of collectives. +2 e2e (`tests/e2e/knowledge.spec.ts`): empty state + draft-no-premature-save.

**Captain feedback iteration 1 (same session):** (a) nav icon `psychology`→**`menu_book`** (open book); (b) **dropped the conservator/institution held-by channel** — redundant with Circles; an institution holds via a Circle of its members (model + scans + tests + docs updated); (c) **draft create flow** replaces auto-create-then-edit (premature-save + jump was jarring); (d) **in-room prose textarea** replaces "bounce to element-detail" (kept a small "all fields →" link); (e) **empty-state layout fixed** (was centered + two-column via `atlas-pane-empty`; now top-anchored stacked block).

**Captain feedback iteration 2 (same session):** (a) **held-by/about chips → cyan pills** (were drab gray blocks); (b) **id-swap migration for `/knowledge/<id>`** — the "create bounces to overview" was the push reassigning the entry's id on api-linked worlds; `handleIdSwap` (sync-attach) now migrates the knowledge route like it does `/element` and `/map`; (c) **About is now linkable in-room** — a "+ add subject" picker writes the subject to its matching `Involves` field via `NARRATIVE_RELATION_FIELDS` (collectives rejected — they're holders); works in draft (stored on `draft.aboutIds`, grouped into fields on create) + saved. Exported `ABOUT_FIELDS` from `core/knowledge`. Verified in-browser (Playwright): empty block top-anchored + stacked; draft persists nothing until create (`count===0`); chips computed `rgba(34,211,238,*)` cyan pill; create lands on the **saved entry** (not list) with `narrator`/`collectives`/`locations`(subject) all persisted; collective rejected as a subject.

**Conventions #67–72** (in `DESIGN_KNOWLEDGE.md`; conservator dropped).

---

## Items dropped (don't re-add without fresh design conversation)

Per-world conflict policy override, email per-world, zone-targets-map, cross-element pin rendering, map subtype visual filter, map locking via URL, "maps within" inverse search perf, picker keyboard shortcut, pin coord council motion (already in schema), snap-to-existing-vertex for pins (only relevant for markers, already done), repair pre-migration server markers, hotkey undo/redo. Also dropped during session 231 context-pane work: search/highlight-by-name in graph (less load-bearing than other v2 features; hover already shows names); hierarchical tier-zoom drill-down (replaced by click-to-recenter which gives drill-down for free).

---

Earlier sessions (197-233) archived to [`docs-archive/PROGRESS-history.md`](docs-archive/PROGRESS-history.md) — Phase 3.5+ sync hardening, zone subsystem, hotkeys MVP, rooms model (223), writing system (224, 227-228), stewardship + polish (225-226), writing-room redesign + context pane (229-231), maintenance splits (232-233). Architectural rules from those sessions live in DESIGN.md conventions; sync lessons in SYNC_NOTES.md; writing-specific patterns in DESIGN_WRITING.md.
