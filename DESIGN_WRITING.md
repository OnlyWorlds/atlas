# Atlas — Writing Design

**Version**: 3.2 (2026-05-24) — context pane promoted to tool-global (session 231)
**Status**: v1 + v1.5 + v2 batch all shipped (sessions 227-228). Session 229 added the writing-context pane in the right tab. Session 230 polished it (Featured/Planned, click-recenter, reading-mode redesign). Session 231 promoted the context pane to a tool-global Context tab — see `DESIGN.md` "Context Pane" section for the cross-route architecture. Writing-mode behavior in the context pane (Cast + Potentials + chip-click selection + Featured/Planned semantics) is unchanged.
**Related**: `DESIGN.md` (Rooms model, atlas-specific fields, **Context Pane**), `DESIGN_HOME.md`, `DESIGN_PUBLISHING.md`

---

## Vision

Atlas as a primary writing tool. Books, chapters, scenes — long-form fiction or campaign prep written *inside* the world it describes.

**The differentiator**: your world is one keystroke away while you write. Characters, locations, objects — connected, navigable, never far. Other tools either prioritize prose with the world bolted on (Scrivener, Ulysses) or prioritize the world database with prose as an afterthought (World Anvil, Campfire). Atlas keeps both in one runtime, with the prose surface as the first-class citizen.

The user can move to another OW tool and keep their content (prose lives in the OW Narrative `story` field as markdown). They lose atlas-only affordances (richtext styling, atlas-specific node types, auto-derived relations) but never their words.

---

## User Stories (the writing workspace serves these, in priority order)

1. **The drafting writer**: opens atlas, jumps to where they left off, cursor lands in prose. Large surface, minimal chrome. Writes for 40 minutes. Word count updates in the footer. Nothing interrupts.
2. **The connecting writer**: mid-sentence wants to mention a Character. Types `@halloway`, picker finds Halloway via name or alias, Enter inserts a cyan chip. Later, the chip can be clicked to open the element in the right pane without leaving the prose.
3. **The world-consistency writer**: writing a scene in a known Location. Hovers a chip to see the linked element's name and type. Clicks through if more detail is needed. Returns to prose with no context lost.
4. **The structuring writer**: wants to see book/chapter/scene shape. The sidebar tree shows it. Drag-reorder shuffles scenes. Breadcrumb in the workspace shows position.
5. **The exploratory writer**: has an idea but doesn't know where it fits. Creates a Draft (tier l4 — flexible parent). Lower stakes. Promotes it to a scene later when it crystallizes.
6. **The reviewing writer**: wants to read their own chapter as a reader would. Toggles reading mode — no chrome, serif type, generous line height.
7. **The portable writer**: moves to another OW tool. Sees their prose as clean markdown in the `story` field. Loses the atlas richtext styling, keeps every word and every link.

The workspace solves stories 1–3 directly; the sidebar handles 4; tier model handles 5; reading mode handles 6; markdown serialization handles 7.

---

## The model — supertype-tier (unchanged from v2.1)

A Narrative belongs to the writing tree iff its `supertype` matches one of the four configured tier labels for the world. The supertype value IS the tier — atlas writes it directly, no canonical/display split.

### Four tiers

| Tier key | Default label | Constraints | Tree role |
|---|---|---|---|
| `l1` | **Book** | No parent | Top of the tree |
| `l2` | **Chapter** | Parent must be l1 | Children of books |
| `l3` | **Scene** | Parent must be l2 | Children of chapters; no children from atlas's create flow |
| `l4` | **Draft** | No parent constraint | Flexible — root, under any tier, or under another draft |

Tier `l4` (Draft) is the flexible joker. See v2.1 history for full constraints discussion.

### Storage shape

Atlas's create flow writes a Narrative with these fields:

| Field | Value |
|---|---|
| `supertype` | `labels.l<n>` for the chosen tier (e.g. "Book") |
| `subtype` | Not set — **always left empty for the user** |
| `parent_narrative` | Required for chapters and scenes; optional for books and drafts |
| `order` | Sequential integer within sibling group |
| `story` | Empty on create — the primary writing surface (text-long), markdown serialization of the richtext document |
| `atlas_richtext_json` | High-fidelity TipTap JSON document (atlas-local extension field; stripped on API push) |
| `atlas_aliases` | Optional `string[]` of name aliases — feeds the link picker (atlas-local extension field) |

---

## Customizable labels, setup, promote, label-rename migration

Unchanged from v2.1. See git history for full text if needed (these flows are shipped + stable). Brief summary:

- User picks l1-l4 labels in Settings → Writing or via the writing-room setup screen.
- `isWritingInitialized` smart-detects when setup is needed; setup screen offers detect/adopt + promote-existing-narratives.
- Renaming a label triggers `applyLabelRenameMigration` to rewrite supertype values on existing narratives.

---

## Element-detail integration (unchanged from v2.1)

When the user edits a Narrative's `supertype` in element-detail, the field-edit popover surfaces the four tier labels as suggestion chips. Free-text override removes the narrative from the writing tree (still visible elsewhere).

---

## Sidebar (unchanged from v2.1)

The writing tree lives in `src/sidebar/writing-sidebar.ts`. Two-band header (create row, search row), tree with tier-aware icons, chevron expand/collapse, drag-reorder (sibling-only). See v2.1 for layout details. Sidebar takeover via `state.ui.sidebarWritingOverride`.

---

## The writing workspace (v1 — NEW in v3.0)

This is the redesign. The middle pane in writing mode stops being a generic element-detail and becomes a dedicated prose-centric writing surface.

### File

`src/middle/writing-workspace.ts` — new module, parallel to `element-detail.ts`. Mounts when `route.mode === 'writing'` AND an active narrative exists in the URL hierarchy. Falls back to the empty state in `writing.ts` when no narrative is selected.

### Layout (single column, prose-centered)

```
┌─ 36px header (reuse element-detail-header.ts unchanged) ───────────────┐
│ [icon] Narrative name  [TIER]  [+ child]  [pin]  [sync]  [delete]     │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   Narrative name                  ← inline editable (click to edit)    │
│   ─────────────────────                                                │
│   Book › Chapter › Scene name     ← breadcrumb, each segment clickable │
│   📅 Date label                   ← inline start_date (or date range)  │
│                                                                        │
│   ┌─ TipTap editor ──────────────────────────────────────────────┐    │
│   │                                                              │    │
│   │   [generous prose surface, max-width 800px on contents]      │    │
│   │   [autogrowing; pane fills vertically]                       │    │
│   │   [chips render inline as styled cyan spans]                 │    │
│   │                                                              │    │
│   └──────────────────────────────────────────────────────────────┘    │
│                                                                        │
│   ▶ Details (description, subtype, characters, locations, …)           │
│   ▶ References (3 elements link to this narrative)                     │
│                                                                        │
│            [📖 reading mode]  1,247 words · 5 min · saved 12s ago      │
└────────────────────────────────────────────────────────────────────────┘
```

### Why one column, not three-pane

Cross-tool research showed the three-pane shell is the genre default (Scrivener, World Anvil, NovelCrafter) — and also the genre's primary complaint surface. Writers describe feeling overwhelmed by always-visible chrome. Atlas's sidebar already handles structural navigation; an always-visible third panel for "world context" duplicates work that hover preview + the element room can handle on demand.

The collapsibles below the prose (Details + References) keep the full schema editor reachable without it competing for the writer's eyes.

### The 10 v1 essentials

1. **Reuse `element-detail-header.ts`** for the 36px band — tier badge, child-create buttons, pin/sync/delete affordances. Already extracted in session 225.
2. **Inline editable title** — large, click-to-edit. Port from element-detail.
3. **Breadcrumb** — Book › Chapter › Scene with clickable segments.
4. **Inline date row** — `start_date` (and `end_date` if present) shown as a single tidy line.
5. **TipTap editor** — mounted in the prose slot. `prose` class, max-width 800px on contents, generous vertical space, autogrowing.
6. **`@` element picker** — see Linking Model below.
7. **Dynamic chip rendering** — chip display text resolves from the store by UUID on every render, so renames propagate without touching markdown.
8. **Collapsible "Details"** — wraps `element-detail-fields.ts` unchanged. Collapsed by default.
9. **Collapsible "References"** — wraps `element-detail-refs.ts` unchanged. Collapsed by default.
10. **Footer** — live word count, reading-time estimate (words / 250), save state derived from sync pill state, "Open as element →" link.

### Storage model

Two fields on every Narrative:

- **`story`** (canonical OW text-long field) — markdown serialization of the document. Source of truth for OW interop. Other OW tools see this.
- **`atlas_richtext_json`** (atlas-local extension field, added to `ATLAS_LOCAL_EXTENSION_FIELDS` in `core/constants.ts`) — full TipTap JSON document, preserves atlas-only formatting and custom node types. Stripped on API push; persists in folder storage.

**On load**: atlas reads `atlas_richtext_json` if present; otherwise parses `story` markdown into a TipTap doc. The "no sidecar, only markdown" case is the migration path for narratives already in the world (AtlasMoppetopia, others).

**On save** (debounced via existing sync debounce window):
1. TipTap doc → markdown serializer → write to `story` field.
2. TipTap doc → JSON → write to `atlas_richtext_json` field.
3. Auto-derive relation fields (see below).
4. Single `folder.updateElement` call. Sync push fires via existing `requestPushIfLinked()` pipeline.

**Coherence**: the two representations are atomically updated in the same write. ⚠ **OUT-OF-BAND `story` EDITS ARE NOT YET RECONCILED (verified 2026-07-13, S260)**: the editor prefers `atlas_richtext_json` unconditionally when non-empty (`writing-workspace-editor.ts` initial-content rule), so a `story` edited by another tool (API pull or folder handoff) is silently shadowed by the stale sidecar and would be OVERWRITTEN by atlas's next save. The earlier text here described the intended mechanism as if built; it is not. **The story-coherence bout (banked, gate-worthy — persisted shape)**: store a `story` fingerprint alongside the sidecar; on load, fingerprint mismatch → re-parse markdown, regenerate the sidecar (atlas-only styling lost = the documented tradeoff, then actually enforced). Prerequisite for blessing `story` as the cross-tool prose contract (Skeld's Track H ask, 2026-07-13).

### TipTap stack (the library decision)

Library: **TipTap 3.x** (ProseMirror-based, framework-agnostic, MIT-licensed).

Packages:
- `@tiptap/core` + `@tiptap/pm` — editor runtime
- `@tiptap/starter-kit` — paragraph, bold, italic, headings, lists, blockquote, horizontal rule, strike
- `@tiptap/extension-mention` + `@tiptap/suggestion` — `@` trigger state machine
- `@tiptap/markdown` — bidirectional markdown serialization (official, MIT, currently in beta — pin version; round-trip-test every custom node)

Bundle estimate: **~70-80 KB gzipped**. Atlas currently sits at 155 KB gzipped JS. Total post-integration: ~225-235 KB gzipped. Within our ~100 KB headroom budget.

Rejected alternatives (research-backed):
- **Lexical** — memory leak benchmark (3.9 GB crash at 23 min in sustained-session stress test). Wrong shape for atlas writing sessions.
- **Slate** — React-only. Atlas is vanilla DOM.
- **Quill v2** — Delta format awkward for tree-shaped content; markdown is community plugin, not first-class.
- **Editor.js** — block-based, slow on paste at long-doc scale (10s lag on 100+ line paste).
- **CKEditor 5** — ~150-300 KB gzipped even tree-shaken. Over budget.

Fallback if TipTap's markdown beta bites us: drop to raw ProseMirror + `prosemirror-markdown` (same engine, full control, ~15 KB savings). Same TipTap doc model, so no rewrite of the workspace.

### Linking model (the full picture)

**Writer experience — explicit `@` trigger (v1 primary)**:
1. Writer types `@` in prose.
2. Picker popover appears at cursor (TipTap suggestion extension provides trigger + state machine; we build the popover UI to match atlas's glass aesthetic).
3. Writer types `dri` — picker filters by fuzzy match against element **name + atlas_aliases** across all 22 element types in the active world.
4. Picker rows show: `[type icon] Element name · Type · disambiguating subtitle`. Recents-first when query is empty; then fuzzy score.
5. Writer hits Enter (or clicks).
6. The `@dri` text in the prose is replaced with a styled cyan chip showing the element's current name.
7. Markdown serialization: `[Display Name](ow://<type>/<uuid>)`.

**Writer experience — first-mention auto-link (v1 stretch, see Bout H)**:
1. Writer types "Drizzle did not own a calendar" — no trigger.
2. Background tokenizer matches "Drizzle" against the element name+alias index for the active world.
3. Atlas shows a subtle ghost underline + Tab hint under the word.
4. Writer presses Tab → suggestion accepted, word becomes a chip. OR keeps typing → suggestion fades, word stays plain text.
5. Once Drizzle is linked once in this narrative, atlas does NOT suggest linking subsequent mentions. First-mention rule (Loreteller's universal pattern).
6. For ambiguous names (2+ matches), suggestion is suppressed — writer must use `@` to pick explicitly.

**Aliases**:
- Each element gets an atlas-local `atlas_aliases: string[]` field.
- Editable in element-detail — the schema-driven editor surfaces it like any other field.
- Stored as e.g. `["Hal", "Lady Vareth", "the duchess"]`.
- Both the `@` picker AND the auto-link tokenizer match against `name` ∪ `atlas_aliases`.
- Critical feature per research — without aliases, writers stop linking after 2-3 mentions because matching the canonical name breaks flow.

**Same-name handling**:
- Two Characters named "John" both have distinct UUIDs.
- Picker shows both with disambiguating subtitle (element type + parent context where available, falls back to description first 30 chars).
- Writer picks one explicitly — that UUID is what's stored.
- Stored markdown: `[John](ow://character/uuid1)` and `[John](ow://character/uuid2)` — distinct, never ambiguous in data.
- Both chips render as "John" but point to different elements; hover/click resolves to each individual element.
- Auto-link with ambiguous names: suppresses ghost suggestion entirely.

**Renames**:
- Markdown stores `[Drizzle](ow://character/abc-123)`.
- On render: TipTap parses markdown → for each link node, look up element by UUID in atlas store → chip displays element's **current** name.
- Rename "Drizzle" to "Drizzleton" via element-detail → all chips re-render as "Drizzleton" immediately.
- Save serializes back with updated display text.
- **Manual display text override**: if writer types `@hal` and then edits the chip text manually (v1: no UI to do this; v2 will likely add), atlas detects `displayText !== element.name` and preserves the manual text. Punt on the UI for v1.

**Click + hover (v1)**:
- Hover → cursor pointer + tooltip showing `<element name> · <type>`.
- Click → opens the element in the right pane (existing pattern via `openMapTab` and the right-pane tab system). Does NOT navigate URL away from writing — stays in writing mode.

**v2 hover**: rich preview card with image + description + "Open" button.

### Auto-derive relation fields on save

- Triggered after debounce, after markdown is computed.
- Scan markdown for `ow://(\w+)/([a-f0-9-]+)` matches.
- Group by element_type → `{character: [uuid1, uuid2], location: [uuid3], event: [uuid4]}`.
- For each relation field on Narrative (`characters`, `locations`, `events`, `objects`, etc.): compute UNION of (prose-derived UUIDs) ∪ (existing field value).
- Manual additions to relation fields stay; prose mentions get auto-populated; nothing is silently dropped.
- Edge case: a character mentioned only in deleted draft prose stays linked. This is fine — manual edit in element-detail can remove if needed.

### Reading mode

- Toggle button in footer (icon: `chrome_reader_mode` or similar).
- Adds a CSS class to the workspace root.
- That class: hides collapsibles, hides footer chrome, applies serif font to prose, increases line height to ~1.7, centers content at 70ch.
- Esc returns to write mode.
- Persisted per-world atlas-local pref (so reading mode in one world doesn't bleed into another).

### What v1 does NOT do (now historical — many of these shipped through 228-231; see Roadmap status below)

The original v1 deferral list (hover preview, focus mode, outline view, backlinks, per-narrative notes, word goal, find/replace, inline element creation, element embeds, footnotes/callouts, bidirectional consistency, prose-first extraction, visual narrative graph, compare view, export) shipped piecemeal in sessions 227-231 OR moved to the "Still on the roadmap" / "Dropped" lists below. The unshipped items are tracked there.

---

## Routes (v3.0 — shortened in session 227)

```
#/w/<id>/writing                  → writing room, no selection
#/w/<id>/writing/<narrativeId>    → narrative selected (any tier)
```

Ancestry is NOT encoded in the URL — it's derived at render time from the `parent_narrative` chain via `buildNarrativeIndex` + `ancestorIds`. Atlas always has the world's narratives in memory by the time the writing room mounts, so deriving on render has no real cost.

**Legacy form back-compat**: URLs from before the shortening (sessions 223-226) still parse. The parser picks the deepest segment as `narrativeId` and re-emits the short form on next navigation:

```
LEGACY: #/w/<id>/writing/book/<bId>/chapter/<cId>/scene/<sId>
        → parseHash sets narrativeId = sId
        → next writingHash() call emits #/w/<id>/writing/<sId>
```

The URL is the source of truth for which narrative is active (convention #46). Writing-workspace reads the route's `narrativeId`, never mirrors into `state.ui.selectedElementId`.

`writingHash(worldId, narrativeId?)` in `core/router.ts`.

---

## Roadmap status (session 231 update)

### Shipped through session 231 (context pane: writing-only → tool-global)

Big-picture context-pane work moved into `DESIGN.md` "Context Pane" — that's the authoritative architecture doc now. The writing-mode contributions to the pane (Cast + Potentials + Featured/Planned + chip-click selection + add-to-story button) stay specified here.

- ✅ **Context tab** — was writing-only ephemeral in session 229, now tool-global permanent (session 231). Writing route shows Cast + Potentials; element route shows element preview; other routes show empty state.
- ✅ **Force-directed graph** with click-recenter, recent-centers breadcrumb, mouse-back intercept, right-click menu, free zoom/pan, fit-to-view button, hover-fade, hop-depth 1-4 with per-ring caps, element-type filter chips, lock-layout mode, optional element-type edge coloring (session 231).
- ✅ **Featured/Planned distinction** in Cast — Featured = in field AND in prose (chip or name/alias text match), Planned = in field only (sessions 229-230).
- ✅ **Compiled view for parent narratives** — read-only assembly + clickable section markers + collapsible chevrons + tier-specific icons (sessions 229-230).
- ✅ **Sticky bar below element header** — breadcrumb + date + focus/reading/open action icons (session 229).
- ✅ **Ambient word-count widget** — bottom-right corner, replaces legacy footer (session 229).
- ✅ **Reading mode redesign** — hides right pane, disables link visuals, keeps writer's font (session 230).
- ✅ **Spellcheck toggle per world** + autolink hints always-`spellcheck=false` (session 230).
- ✅ **Backspace-on-chip unlinks**, **right-click chip → unlink**, **right-click autolink hint → Link to {name}** (session 230).
- ✅ **Aliases editor modal, focus mode, hover preview, find/replace, word goal, inline element creation, split-into-sibling, character cast strip, per-world font family, first-mention autolink, TipTap code-split** — see session 228 batch in archive.

### Still on the roadmap

#### Writing room

1. **In-narrative outline disclosure** — H1/H2/H3 jumps within the current narrative's prose. Recommended placement: collapsible disclosure between breadcrumb and prose.
2. **Outline / corkboard view** of writing tree — index cards, drag to reorder, alternate to the linear sidebar tree.
3. **Per-narrative atlas-local notes scratchpad** — like world notes overlay, but per-narrative.
4. **Element embeds** in richtext — render element card inline within prose (TipTap node extension). Powerful for TTRPG handouts.
5. **Footnotes + callouts** as richtext blocks (TipTap node extensions).
6. **Bidirectional consistency check** — "you wrote 'green eyes' but Lyra's element record says brown". Atlas's strongest long-term differentiator per research; no competitor does this. Needs its own design conversation.
7. **Prose-first extraction** — parse existing manuscript via OW SDK → propose Characters, Locations, Objects. Fits OnlyWorlds parsing skill heritage.
8. **Compare view** — two narratives side-by-side for revision.
9. **Export book/chapter to markdown/PDF/EPUB** — lives in publish room per `DESIGN_PUBLISHING.md`. Writing room provides the "publish this book" affordance.

#### Context pane (next from here, low priority)

1. **Edge coloring by Relation subtype** — once we settle on a default palette per relation kind (rivalry red, friendship green, etc.); currently we color by node type instead.
2. **Density slider** — per-ring caps tunable beyond tier defaults.
3. **Compiled view editable** — range tracking from compiled text back to source narrative for in-place edits.

#### Dropped (don't re-add without fresh design conversation)

- **Hierarchical tier-zoom** — replaced by click-to-recenter which gives drill-down for free.
- **Search/highlight by name in graph** — hover already shows names; navigation handles the find use case.
- **Visual narrative graph at `/writing/graph`** — the context-pane graph subsumes this for the writing tree case.

---

## Deferred design questions (slim — most v2.1 questions are now answered in v3.0)

1. **Aliases at OW schema level** — currently atlas-local via `atlas_aliases`. Whether/when to propose council motion to add to OW core schema. See DESIGN.md "Atlas-Specific Fields & Features" tracking section.
2. **Per-narrative atlas-local notes** — separate field (`atlas_notes`?) or hook into the existing per-world notes overlay scoped by narrative?
3. **Word count rollup** — current narrative only in v1. Chapter / book aggregate is v2.
4. **Reading-mode pagination** — v1 ships scrolling reading mode; pagination is a v2 polish question.

---

## Conventions added in v3.0

- **#47**: `atlas_richtext_json` lives on Narrative elements as an atlas-local extension field. Holds the full TipTap JSON document. Stripped on API push. The canonical `story` field on the same element holds the markdown serialization for OW-tool interop. Both representations are written atomically on every workspace save; load prefers `atlas_richtext_json` and falls back to parsing `story` markdown.

- **#48**: Element references in narrative prose are stored as markdown links with the OW URL scheme: `[Display Name](ow://<element-type>/<uuid>)`. Display text is resolved dynamically from the atlas store at render time (so renames propagate). Manual display-text overrides (where `displayText !== element.name`) are preserved on save.

- **#49**: Atlas elements have an optional atlas-local `atlas_aliases: string[]` field. Both the `@` picker and the first-mention auto-link tokenizer match against `name` ∪ `atlas_aliases` when resolving an element by string. Aliases are stripped on API push (atlas-local extension field).

- **#50**: On every workspace save, the auto-derive pass scans the markdown for `ow://` links, groups UUIDs by element type, and writes the UNION of (prose-derived) ∪ (existing relation field value) into each Narrative relation field. Manual relation field entries are preserved. Single `folder.updateElement` call per save.

- **#51**: The writing workspace replaces element-detail entirely as the middle-pane renderer when `route.mode === 'writing'` AND a narrative is active in the URL hierarchy. Empty-state (no active narrative) stays in `writing.ts`.

- **#52** (v1.5 polish): Any override of `.material-symbols-outlined` (font-size, color, etc.) MUST be scoped under a parent class for two-class specificity (0,2,0). The package's `.material-symbols-outlined { font-size: 24px }` rule is single-class (0,1,0) and load-order decides the tie — non-deterministic. Pattern: `.atlas-foo-parent .my-icon { font-size: Npx }` (e.g. `.atlas-link-chip .atlas-link-chip-remove`). Bitten twice (session 226 room-nav chip + session 227 link-chip-remove); locking in as a hard rule.

- **#53** (v2 batch, session 228): First-mention auto-link decorations are CASE-SENSITIVE matches against a name + alias index, with `\\b...\\b` word boundaries. Suppression rules stack: minimum 3 characters per key, ambiguous names (≥2 candidates for the same key) suppressed entirely, candidate ids already chipped in the doc skipped (first-mention rule), and the `@` mention picker takes priority (decorations don't gate Tab handling while the picker is visible). The index is rebuilt only when `state.data.elements` reference swaps — no per-tick re-build. See `writing-workspace-autolink.ts` and tests/unit/writing-workspace-autolink.test.ts.

## Autolink design (session 228, Bout 9)

The autolink plugin is a ProseMirror plugin that watches the prose for prose-level mentions of elements that the writer hasn't explicitly chipped yet. It is the COMPANION to the `@` picker, not its replacement — `@` remains the explicit, deliberate path for inserting a chip, with no ambiguity about intent.

### What the writer sees

Writer types: `"the goblin Drizzle waved cheerfully"`.

If "Drizzle" matches an element (case-sensitive, ≥3 chars, unambiguous, not yet chipped in this doc, `@` picker not open), the word gets a **subtle dotted cyan underline**. Hovering the underline reveals "Tab to link as character" (or whatever type). Pressing Tab with the cursor adjacent → text becomes a real ElementChip and the underline disappears.

Subsequent mentions of "Drizzle" in the same narrative get NO underline (first-mention rule).

### Why these rules

- **Case-sensitive**: proper nouns are uppercase; common nouns aren't. Without this, "the" matching an element named "The" would underline every "the".
- **Min 3 chars**: kills "Al", "Bo", "Jo" — short names are too noisy without context.
- **Ambiguity suppression**: if two characters share a name, the writer needs to pick explicitly with `@`. No silent default.
- **First-mention only**: per-narrative rule, matches Loreteller's universal pattern from research. Re-decoration on every mention would be visual noise.
- **`@` picker priority**: when the picker is open, Tab is owned by the suggestion list. The autolink's Tab handler checks `document.querySelector('.atlas-mention-popover')` and bails.

### Performance

The index is a `Map<string, AutolinkCandidate[]>` from name/alias → candidates. A combined `\\b(key1|key2|...)\\b` regex is compiled once; keys sorted longest-first so multi-word names ("Mira Halloway") greedy-match before their sub-words.

Doc walk on every transaction is cheap at OW scale (~hundreds of elements, ~thousands of words). One regex pass per text node. Already-chipped ids collected in a single descendants walk per re-decoration.

If a world grows to tens of thousands of elements, switch to Aho-Corasick or a trie. Not needed in v1.

---

## What writing is NOT (unchanged from v2.1)

- Not a replacement for prose tools at scale (Scrivener, Word) — atlas is *world-aware* writing, optimized for connection
- Not a markdown power-user surface — atlas is a structured editor first, markdown is a serialization choice for portability
- Not a publishing platform — that's the publish room (`DESIGN_PUBLISHING.md`)
- Not a wiki — element descriptions are the wiki; writing is narrative authorship

---

## Research foundations (informing v3.0)

v3.0 incorporates findings from a 6-agent research swarm (session 226):

- **Differentiator scout** across Scrivener, Ulysses, World Anvil, NovelCrafter, Campfire, Plottr, Obsidian, Notion — confirmed three-pane shell is genre default AND genre's primary complaint surface; identified "bolted-on editor" as the trap World Anvil falls into.
- **Reddit fiction-writer friction** — confirmed sync-state-invisibility, compile-as-black-box, setup-tax, and chrome-competes-with-page as universal pain points to avoid.
- **Reddit worldbuilder needs** — confirmed unidirectional linking (prose→wiki only) is the universal failure mode; identified prose-first extraction and bidirectional consistency check as Atlas's unique opportunities.
- **Reddit connected-notes power users** — surfaced first-mention rule, alias necessity, and "block references / transclusion aren't for fiction" anti-patterns.
- **Linking UX deep-dive** — established ID-stable links with dynamic display text, type-icon + breadcrumb in picker, and "explicit insertion only in v1" (no NovelCrafter-style auto-detect without trigger).
- **Richtext library evaluation** — TipTap 3.x recommended; Lexical eliminated by long-session memory leak benchmark.

Full agent outputs not stored in repo (would bloat docs); the synthesized findings live in this document as design decisions.
