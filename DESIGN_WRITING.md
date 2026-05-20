# Atlas — Writing Design

**Version**: 2.0 (2026-05-19) — supertype-tier model
**Status**: Core model implemented (setup, promote, four-tier filter, label-rename migration). Real richtext editor still deferred.
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
- Can nest other drafts
- Distinct icon
- Use case: side material, alt versions, deleted scenes, scratch ideas, research notes, anything the writer wants in their writing tree but doesn't fit the spine

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

## Room layout

```
┌──────────────────────────────────────────────────────────┐
│ 🏠 ✎ 🕓 ⌕ ⬆ ⬇ 🧩 ⚙        ← room nav                  │
├────────────────┬─────────────────────────────────────────┤
│  BOOKS    ⚙    │                                         │
│  ▼ 📖 Book 1   │   <active narrative — element detail>   │
│    ▼ Ch 1      │                                         │
│      • Sc 1    │   name, description, story, etc.        │
│      • Sc 2    │                                         │
│      ✎ Draft   │                                         │
│    ▶ Ch 2      │                                         │
│  ▶ 📖 Book 2   │                                         │
│    ✎ Draft     │                                         │
│  ✎ Loose Draft │                                         │
│                │                                         │
│  + new book    │                                         │
│  + new draft   │                                         │
├────────────────┴─────────────────────────────────────────┤
```

**Left sub-column**:
- Tree built from narratives where `supertype ∈ {l1, l2, l3, l4}`
- Tier-aware icons: `menu_book` (l1), `article` (l2), `short_text` (l3), `edit_note` (l4)
- Drafts get italic name + slightly muted styling
- Chevron expand/collapse for any node with children (state persists in `registry.worlds[i].writing_tree_collapsed`)
- Header gear → re-opens setup screen for label changes / re-promote
- Footer: "+ new book" + "+ new draft" (top-level creates)

**Right sub-column**:
- Renders the active Narrative as the existing element-detail view
- Contextual "+ new child" toolbar above element-detail based on active tier:
  - l1 (Book) → + Chapter, + Draft
  - l2 (Chapter) → + Scene, + Draft
  - l3 (Scene) → + Draft only
  - l4 (Draft) → + Draft only (drafts nest drafts)
- When no narrative selected: empty state copy

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

## v1 scope (this session — session 224)

**Shipped**:
- supertype-tier model + four-tier labels (l1-l4)
- Setup screen (`writing-setup.ts`) with detect/adopt + promote
- Promote logic (`writing-promote.ts`) + label-rename migration
- Writing tree filter on `isWritingNarrative` (supertype matches one of l1-l4)
- Tier-aware tree rendering (icons, drafts italic, contextual create)
- Element-detail supertype autocomplete (suggestion chips + Tab complete)
- Settings → Writing l4 input + change-event triggers migration

**Defer (unchanged from v1)**:
- Richtext editor (TipTap / ProseMirror / Lexical — library decision not made)
- Element autolinking (`[[name]]` syntax or autodetect)
- Element preview popover on hover
- Inline element creation from selected prose
- Word count / progress tracking
- Outline mode (markdown-per-book sidecar)
- Find/replace
- Reading mode / presentation mode
- Drag-to-reorder chapters
- Export to PDF/EPUB/HTML/markdown (lives in publish room)
- Per-row promote opt-out in setup (whole-batch in v1)

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

---

## What writing is NOT

- Not a replacement for prose tools at scale (Scrivener, Word) — atlas is *world-aware* writing, optimized for connection
- Not a markdown power-user surface — atlas is a structured editor first, markdown is a serialization choice for portability
- Not a publishing platform — that's the publish room (`DESIGN_PUBLISHING.md`)
- Not a wiki — element descriptions are the wiki; writing is narrative authorship
