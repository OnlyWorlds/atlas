# Atlas — Writing Design

**Version**: 2.1 (2026-05-20) — sidebar takeover + unified header
**Status**: Core model + sidebar takeover + drag-reorder + last-narrative restore all shipped. Real richtext editor still deferred.
**Related**: `DESIGN.md` (Rooms model), `DESIGN_HOME.md`, `DESIGN_PUBLISHING.md`

---

## Vision

Atlas as a primary writing tool. Books, chapters, scenes — long-form fiction or campaign prep written *inside* the world it describes. Element references one click away. World-aware autocomplete and back-references. Eventually richtext, autolinking, word counts, presentation mode.

The user can move to another OW tool and keep their content (prose lives in OW Narrative fields). They lose atlas-only affordances (richtext styling, outline mode, notes) but never their words.

---

## The model — supertype-tier

A Narrative belongs to the writing tree iff its `supertype` matches one of the four configured tier labels for the world. The supertype value IS the tier — atlas writes it directly, no canonical/display split.

### Four tiers

| Tier key | Default label | Constraints | Tree role |
|---|---|---|---|
| `l1` | **Book** | No parent | Top of the tree |
| `l2` | **Chapter** | Parent must be l1 | Children of books |
| `l3` | **Scene** | Parent must be l2 | Children of chapters; no children of their own (in atlas's create flow) |
| `l4` | **Draft** | No parent constraint | Flexible — root, under any tier, or under another draft |

Tier `l4` (Draft) is the flexible joker:
- Lives anywhere in the tree
- No required parent, no required position
- Distinct icon
- Use case: side material, alt versions, deleted scenes, scratch ideas, research notes
- **Atlas doesn't offer "+ new draft" as a child of an existing draft** (no nesting from UI) — Captain's call session 224: keeps the affordance set small and consistent. Drafts can still be re-parented manually via element-detail; the data model doesn't forbid it.

### Storage shape

Atlas's create flow writes a Narrative with these fields:

| Field | Value |
|---|---|
| `supertype` | `labels.l<n>` for the chosen tier (e.g. "Book") |
| `subtype` | Not set — **always left empty for the user** |
| `parent_narrative` | Required for chapters and scenes; optional for books and drafts |
| `order` | Sequential integer within sibling group |
| `story` | Empty on create — the primary writing surface (text-long) |

`subtype` is the user's freeform classification surface — they can put "flashback", "vision", "research-note", anything. Atlas reads only `supertype` for tree membership; `subtype` is invisible to the writing tree.

### Why supertype, not a separate atlas-local field

- **Self-documenting** to other OW tools: opening a Narrative anywhere shows `supertype: "Book"`. No magic.
- **Searchable** via the existing search room (which scans supertype + subtype).
- **No translation layer**: storage matches display 1:1.
- Cost: when the user renames a label, supertype values get migrated — see "Label-rename migration".

---

## Customizable labels

User picks labels in **Settings → Writing** or on first writing-room visit via the setup screen.

```json
{
  "writing_labels": {
    "l1": "Book",
    "l2": "Chapter",
    "l3": "Scene",
    "l4": "Draft"
  }
}
```

Examples:
- Story / Substory / Scene / Note
- Volume / Book / Chapter / Sketch
- Campaign / Arc / Session / Idea (TTRPG / DM)
- Tome / Part / Chapter / Margin (formal)

**Constraint**: all four labels must be distinct. Empty labels reject — atlas refuses to save without a value.

---

## Setup screen

When `isWritingInitialized` returns false for the active world, the writing-room route shows a setup screen instead of the tree. The flag goes true once the user saves.

`isWritingInitialized` smart-defaults:
- `entry.writing_initialized === true` → initialized
- No narratives in the world → initialized (defaults apply silently; user can later open Settings → Writing or the writing-room gear to change labels)
- Narratives exist but none have parent chains → initialized (no decision to make)
- Structured narratives exist but none match the writing labels yet → **NOT initialized** — show setup

The setup screen surfaces:

1. **Label inputs** (l1-l4) pre-filled with current values or defaults
2. **Adopt-detected suggestions** when promote candidates share a single supertype value at a depth (e.g. "Adopt detected: Plot Arc")
3. **Promote preview** when candidates exist — grouped by depth, showing sample names and the current→new supertype mapping
4. **Promote toggle** (pre-checked) — opt out per-row not supported in v1; whole batch promotes or none
5. **Save** (primary) or **Skip — use defaults, don't promote** (secondary, only shown when promote section exists)

The writing-room tree header has a `tune` icon that clears the initialized flag and re-opens setup. Re-running setup mid-life uses the rename-migration path automatically when labels change.

---

## Promote (initial migration)

`buildPromoteCandidates(elements, labels)`:
- Filters to narratives that participate in a parent chain (either has a parent_narrative pointing at another narrative, or is the parent of another narrative)
- BFS from roots to assign depth (0/1/2/3+)
- Proposes supertype by depth: 0 → l1, 1 → l2, 2 → l3, 3+ → l4 (drafts)
- Detects whether each candidate needs `order` assignment

`applyPromote(store, candidates)`:
- Iterates candidates and writes `supertype` + `order` via FolderStore.updateElement
- Idempotent — skips candidates whose current supertype matches proposed AND order is already set
- Returns count of writes

`detectExistingLabels(candidates)`:
- For each depth (0-3), if all candidates share a single `currentSupertype`, returns that value
- Used by the setup screen's "adopt detected" suggestion buttons

---

## Label-rename migration

When the user renames a label (e.g. Book → Volume) via the writing settings:

1. Atlas detects which labels changed
2. `applyLabelRenameMigration(store, elements, oldLabels, newLabels)` walks all narratives
3. For each narrative whose `supertype` matches an old label value, rewrites to the new value
4. Idempotent — no-op when labels unchanged

This keeps storage and display consistent. After migration, a narrative previously stored as `supertype: "Book"` reads as `supertype: "Volume"`. No hidden canonical / display split.

Triggered from two surfaces:
- **Settings → Writing**: change-event on any label input → migration runs immediately
- **Re-running setup** mid-life: if writing was already initialized and labels changed in the setup screen → migration runs on save

---

## Element-detail integration

When the user edits a Narrative's `supertype` in element-detail, the field-edit popover surfaces the four tier labels as suggestion chips:

- Click chip → fills input
- Tab → autocompletes to longest-prefix match among suggestions
- Free-text override always allowed — typing "flashback" sets supertype to "flashback" (loses writing-tree membership; the narrative becomes a regular Narrative element)

This is the escape hatch for users who want to remove a narrative from the writing tree without deleting it. Equivalently, setting supertype to one of the four labels via element-detail PROMOTES that narrative into the tree.

---

## Room layout (sidebar takeover, single-pane editor)

Session 224 moved the writing tree from a left column in the middle pane INTO the sidebar. The middle pane in writing mode is a single column with just the element-detail of the selected narrative. Tier badge + child-create buttons live in the element-detail header. No separate toolbar.

```
┌─────────────────┬────────────────────────────────────────┐
│  [Worlds | W..] │ 🏠 ✎ 🕓 ⌕ ⬆ ⬇ 🧩 ⚙   ← room nav     │
│  ┌───────────┐  ├────────────────────────────────────────┤
│  │+ new book │  │ [icon] Joint Expedition Departs        │
│  │+ new draft│  │           [SCENE] (no child buttons)   │
│  └───────────┘  │                                        │
│  Search... 🔍⚙ ├────────────────────────────────────────┤
│  ▼ 📖 Drip St   │                                        │
│    ▶ Three W…   │   <active narrative — element detail>  │
│    ▼ Chapter 4  │                                        │
│      • Scene 1  │   name, description, story, etc.       │
│      • Scene 2  │                                        │
│    ▼ Chapter 5  │                                        │
│  ▶ 📖 Failing   │                                        │
│  ✎ Loose Draft  │                                        │
└─────────────────┴────────────────────────────────────────┘
```

**Sidebar** (`src/sidebar/writing-sidebar.ts`):
- Layout matches the elements sidebar exactly — two-band header (filter-strip slot, search-row slot), then list. Same pixel positions so switching between Worlds/Elements/Writing feels like the same surface.
- Band 1 — create row: two stacked compact buttons `+ new <l1>` / `+ new <l4>` (top-level creates).
- Band 2 — search row: `[input] [magnifier opens search room] [tune opens writing settings]`.
- Tree: built from narratives where `supertype ∈ {l1, l2, l3, l4}`, tier-aware icons (`menu_book` / `article` / `short_text` / `edit_note`).
- Drafts get italic name + slightly muted styling.
- Chevron expand/collapse for any node with children. State persists in `registry.worlds[i].writing_tree_collapsed`.
- **Drag-reorder**: every row is draggable. Drop above/below another row (same `parent_narrative` only) to reorder. Sequential `order` values written to all affected siblings. Re-parenting deferred.
- Search input filters the tree by narrative name (case-insensitive substring). Ancestors of matches are force-expanded so the path is visible.

**Sidebar takeover rules**:
- When the route is `writing` and the user hasn't explicitly toggled to worlds/elements during this writing session, the sidebar shows the writing tree.
- Clicking the Worlds or `<world-name>` toggle while in writing sets `state.ui.sidebarWritingOverride = true` — the chosen mode wins until either the route leaves+re-enters writing OR the user clicks the writing icon in the room nav (which clears the override).
- The toggle never shows a third "Writing" button. The takeover is implicit, not a toggle.

**Middle pane** (`src/middle/writing.ts`):
- Single column. No tree, no separate toolbar.
- Renders the active narrative's element-detail.
- Tier badge ("Book" / "Chapter" / "Scene" / "Draft") and child-create buttons live in the **element-detail header** (so all elements share the same 36px header band). See "Header unification" below.
- Empty state when no narrative selected:
  - Tree has narratives → "Pick a {l1}, {l2}, {l3}, or {l4} from the sidebar to begin."
  - Tree is empty → centered create buttons (New {l1} + New {l4}) for fast first-touch.

**Header unification** (`.atlas-middle-header`):
- Locked at 36px (`height` + `min-height` + `max-height` + `flex: 0 0 36px`, all `!important`).
- `overflow: hidden; flex-wrap: nowrap` — content never grows the band.
- Defensive `.atlas-middle-header > * { max-height: 100%; flex-shrink: 0 }` — no descendant can push the band taller.
- For writing-tree narratives, header renders: `[icon] [name] [spacer] [tier pill] [+ child icons] [pin clusters] [sync dot] [delete]`. For other element types: same minus the tier pill and child-create buttons.
- Child-create buttons are icon-only (`.atlas-icon-btn-sm`) with tooltip — saves horizontal space, no text-collision risk.

**Last-narrative memory**:
- `WorldRegistryEntry.last_writing_narrative_id?: string` — persists the narrative the user was last editing.
- Saved on every narrative selection change (debounced via `queueMicrotask` to avoid render thrash).
- The writing icon in the room nav reads this on click: if a remembered narrative exists and is still present, navigate straight to its writing URL. Otherwise default to the bare writing path (empty state).
- Combined with element-detail's module-level `scrollMemory` (keyed by element id), returning to writing restores not just selection but also scroll position within the narrative's story field.

---

## Routes

```
#/w/<id>/writing                                  → writing room, no selection
#/w/<id>/writing/book/<bookId>                    → l1 selected
#/w/<id>/writing/book/<bookId>/chapter/<chapId>   → l2 selected
#/w/<id>/writing/book/<bookId>/chapter/<chapId>/scene/<scnId>  → l3 selected
```

Note: the URL path names reflect the *default* labels for readability. They aren't authoritative — the actual semantic is `parent_narrative` chain. Selecting a draft uses the same route format with the draft's id in whichever slot matches its depth.

`writingHash(worldId, bookId?, chapterId?, sceneId?)` in `core/router.ts`.

---

## Cumulative scope (through session 224)

**Shipped**:
- supertype-tier model + four-tier labels (l1-l4)
- Setup screen (`writing-setup.ts`) with detect/adopt + promote
- Promote logic (`writing-promote.ts`) + label-rename migration
- Writing tree filter on `isWritingNarrative` (supertype matches one of l1-l4)
- Tier-aware tree rendering (icons, drafts italic, contextual create)
- Element-detail supertype autocomplete (suggestion chips + Tab complete)
- Settings → Writing l4 input + change-event triggers migration
- **Sidebar takeover** — writing tree moved from middle pane into the sidebar (`src/sidebar/writing-sidebar.ts`), middle pane single-column
- **Header unification** — tier badge + child-create buttons moved INTO `.atlas-middle-header`, header height locked at 36px across all rooms
- **Drag-reorder** — sibling-only, sequential `order` writes, cyan drop indicator
- **Cascade delete** — deleting a book/chapter cascades all descendant narratives (and their pins) per `findDependents` extension in folder-store-fs.ts + mock-folder-store.ts
- **Last-narrative memory** — `registry.worlds[i].last_writing_narrative_id`, room-nav writing icon restores it
- **Stay-in-room after delete** — element-detail's `onDelete` checks route mode, navigates to `writingHash` when in writing instead of always going to home
- **Pin nav respects current room** — pin affordance in element-detail header doesn't change URL when in writing
- **Non-blocking saves** — `field-edit-popover` closes optimistically before awaiting persistence

**Defer (still)**:
- Richtext editor (TipTap / ProseMirror / Lexical — library decision not made)
- Element autolinking (`[[name]]` syntax or autodetect)
- Element preview popover on hover
- Inline element creation from selected prose
- Word count / progress tracking
- Outline mode (markdown-per-book sidecar)
- Find/replace
- Reading mode / presentation mode
- Export to PDF/EPUB/HTML/markdown (lives in publish room)
- Per-row promote opt-out in setup (whole-batch in v1)
- **Re-parenting via drag** — currently sibling-only; dropping into a different parent's children area is the natural next move
- **Writing sidebar scroll memory** — sidebar tree scroll position not preserved across room toggles (element-detail scroll IS preserved)

---

## Deferred design questions

1. **Richtext editor library** — TipTap, ProseMirror, Lexical, custom? Atlas-only features (footnotes, callouts, element embeds) need rich extension surface. Markdown serialization for OW description portability.

2. **Where richtext lives** — atlas-local sidecar alongside Narrative, or future atlas-extension field on Narrative (`atlas_richtext_html`?). Decide when editor lands.

3. **Autolinking algorithm** — full-text scan on save? Background worker? Inline as typed? `[[name]]` syntax vs auto-detect both?

4. **Element creation from prose** — select text → "create Character" → modal pre-filled with selected name.

5. **Word count UX** — chapter footer? Sidebar of tree? Per-session goal?

6. **Outline mode** — separate file per book, plain markdown, used for planning.

7. **Reading mode** — clean reading view, no editor chrome.

8. **Draft state field** — separate from draft tier: should any tier narrative be markable as "WIP"? Likely an `atlas_writing_state: 'wip' | 'final'` atlas-local field. Not v1.

---

## Conventions

- **#33** (updated session 224): Writing tier labels live in `registry.worlds[i].writing_labels` (l1-l4). The label IS the `supertype` storage value on each Narrative. UI reads via `getWritingLabels(worldId)`. **No canonical/display split** — storage matches display.

- **#34** (updated session 224): Atlas writing has three structured tiers + one flexible (Draft). Tier l1 forbids parent; l2 requires l1 parent; l3 requires l2 parent; l4 has no parent constraints. Child-create affordances in the header surface only where they make sense: l1 → {l2, l4}, l2 → {l3, l4}, l3 → nothing (scenes are leaves), l4 → nothing (drafts don't nest — root creates remain available from the sidebar footer). The writing-room create flow enforces these; element-detail edits don't (user can override at their own discretion).

- **#38** (new session 224): A Narrative belongs to the writing tree iff its `supertype` matches one of the four labels for the world. Detection via `isWritingNarrative(el, worldId)`. Setting supertype to anything outside the four labels removes the narrative from the writing tree (still visible elsewhere).

- **#39** (new session 224): Label changes trigger immediate supertype migration on existing narratives. Run via `applyLabelRenameMigration` from both Settings → Writing change events and the setup screen on save.

- **#40** (new session 224): The writing tree lives in the sidebar (`src/sidebar/writing-sidebar.ts`) when the route is `writing`. The middle pane in writing mode is single-column (just element-detail of the active narrative). Takeover is implicit — `state.ui.sidebarWritingOverride: boolean` controls whether the user has explicitly toggled out. Override clears on route in/out of writing.

- **#41** (new session 224): `.atlas-middle-header` is locked at 36px — `height`, `min-height`, `max-height`, and `flex: 0 0 36px` all set with `!important`, plus `overflow: hidden; flex-wrap: nowrap`, plus defensive `.atlas-middle-header > * { max-height: 100%; flex-shrink: 0 }`. The header is a stable band across all element types and all rooms; tier badge + writing actions for narratives live inside it (no separate toolbar slot).

- **#42** (new session 224): Field edits via `openFieldEditPopover` close optimistically — the overlay tears down BEFORE awaiting `opts.onSave`, so the rest of the UI stays interactive during persistence. Failures surface via toast. Pattern applies generally to saves whose failure mode is rare and survivable.

- **#43** (new session 224): Deleting a Narrative cascades through `parent_narrative` chains. `findDependents('narrative')` BFS-walks descendant narratives + collects pins referencing them; `deleteElement` tombstones all in dependency-safe order. Captain confirmed: orphaning chapters with a dangling `parent_narrative` FK was the worse alternative.

- **#44** (new session 224): The writing icon in the room nav restores the last-edited narrative via `WorldRegistryEntry.last_writing_narrative_id`. Saved on every narrative selection change (deferred via `queueMicrotask` to avoid render thrash); read on writing-icon click and navigated via `writingHashForNarrative` (the helper that walks parent_narrative to build the full book/chapter/scene URL).

---

## What writing is NOT

- Not a replacement for prose tools at scale (Scrivener, Word) — atlas is *world-aware* writing, optimized for connection
- Not a markdown power-user surface — atlas is a structured editor first, markdown is a serialization choice for portability
- Not a publishing platform — that's the publish room (`DESIGN_PUBLISHING.md`)
- Not a wiki — element descriptions are the wiki; writing is narrative authorship
