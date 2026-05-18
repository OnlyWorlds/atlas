# Atlas — Writing Design

**Version**: 1.0 (2026-05-18)
**Status**: Foundation locked. v1 shell building this session. Editor deferred.
**Related**: `DESIGN.md` (Rooms model), `DESIGN_HOME.md`, `DESIGN_PUBLISHING.md`

---

## Vision

Atlas as a primary writing tool. Books, chapters, scenes — long-form fiction or campaign prep written *inside* the world it describes. Element references one click away. World-aware autocomplete and back-references. Eventually richtext, autolinking, word counts, presentation mode.

The user can move to another OW tool and keep their content (prose lives in OW Narrative fields). They lose atlas-only affordances (richtext styling, outline mode, notes) but never their words.

---

## Terminology

Writer-friendly labels on top of OW's Narrative element. The three-layer hierarchy is canonical; the labels are customizable per-world.

### Defaults

| Atlas UI label | OW data |
|---|---|
| **Book** | `Narrative` with no `parent_narrative_id` |
| **Chapter** | `Narrative` with `parent_narrative_id` → Book |
| **Scene** | `Narrative` with `parent_narrative_id` → Chapter |

### Customization

User can rename the three labels in **Settings → Writing**. Stored per-world in the registry entry as:

```json
{
  "writing_labels": {
    "l1": "Book",
    "l2": "Chapter",
    "l3": "Scene"
  }
}
```

Examples that work:
- Story / Substory / Scene
- Volume / Book / Chapter
- Campaign / Arc / Session  (TTRPG/DM)
- Tome / Part / Chapter

**Constraint**: no hardcoded "book"/"chapter"/"scene" strings in UI code. Every label reads from `getWritingLabels(worldId)`. Atlas-internal docs and code can still say "Book"/"Chapter"/"Scene" by convention — that's *naming*, not user-facing display.

### Three-level constraint

Hard cap at three levels deep. The UI prevents creating a 4th-level child Narrative via the writing room (the OW schema doesn't care, but writing UI does). Users who need deeper structure use the existing element-detail surface to create nested Narratives, which then surface in the writing room only down to depth 3.

---

## OW data mapping

Narrative element fields used by the writing room:

| Field | Purpose |
|---|---|
| `name` | Title shown in tree + editor |
| `description` | Short summary / blurb |
| `story` | Long-form prose body — the **primary writing surface** |
| `consequences` | Story outcomes (optional, surfaced in advanced view) |
| `parent_narrative` | Hierarchy pointer |
| `order` | Sibling sequence (integer) |
| `start_date` / `end_date` | Timeline placement |
| `protagonist` / `antagonist` / `narrator` | Character links surfaced in sidebar info |
| `events` / `characters` / `locations` / ... | Multi-link relations for "what this references" |

Sorting: `order ASC`, then `name ASC` for siblings with equal/missing order.

---

## Room layout (v1 shell)

Inside the writing room middle pane:

```
┌──────────────────────────────────────────────────────────┐
│ 🏠 ✎ 🕓 ⌕ ⬆ ⬇ 🧩 ⚙        ← room nav                  │
├────────────────┬─────────────────────────────────────────┤
│  Books         │                                         │
│  ▼ 📖 Book 1   │   <active narrative — element detail>   │
│    ▼ Ch 1      │                                         │
│      • Sc 1    │   name, description, story, etc.        │
│      • Sc 2    │                                         │
│    ▶ Ch 2      │   (reuses existing element-detail       │
│  ▶ 📖 Book 2   │    rendering for v1 — no new editor)    │
│                │                                         │
│  + new book    │                                         │
├────────────────┴─────────────────────────────────────────┤
```

**Left sub-column** (~28% of middle pane):
- Book/Chapter/Scene tree
- Chevron expand/collapse per node
- Active node highlighted
- Inline "+ new chapter" / "+ new scene" buttons contextual on parent node
- "+ new book" at bottom
- Drag-reorder DEFERRED (uses `order` field write directly)

**Right sub-column** (~72%):
- Renders the active Narrative as the existing element-detail view
- This is the **v1 shortcut**: we reuse the schema-driven editor instead of building a new richtext one. Story field edits via popover/inline like any text-long field today.
- When no narrative is selected (e.g. landing on `#/w/<id>/writing` with no active book): empty state "select a book or create one to begin"

---

## Routes

```
#/w/<id>/writing                                  → writing room, no active narrative
#/w/<id>/writing/book/<bookId>                    → book selected
#/w/<id>/writing/book/<bookId>/chapter/<chapId>   → chapter selected
#/w/<id>/writing/book/<bookId>/chapter/<chapId>/scene/<scnId>  → scene selected
```

`writingHash(worldId, bookId?, chapterId?, sceneId?)` helper in `core/router.ts`.

The route is sticky: refreshing on `/writing/book/B/chapter/C` reopens the same active narrative.

---

## Sidebar mode interaction

The sidebar remains 2-mode (Worlds | Elements). Writing room does NOT add a third sidebar mode in v1.

Reasoning: writers benefit from keeping the elements list visible in the sidebar while writing — easier to find characters/locations to link. The book/chapter/scene tree lives inside the writing room itself.

**Future setting**: "Use sidebar as writing tree" toggle in Settings → Writing. When enabled, sidebar becomes a 3-mode toggle `[Worlds | Elements | Writing]` and the writing room's left sub-column collapses. Deferred — not building this session.

---

## v1 scope (this session)

**Build**:
- Writing room shell (left tree + right element-detail)
- Routes
- Book/chapter/scene tree from Narratives
- "+ new book/chapter/scene" creation flows (creates Narrative with correct `parent_narrative_id` + `order`)
- Settings → Writing tab with label customization
- `getWritingLabels(worldId)` helper

**Defer**:
- Richtext editor (TipTap / ProseMirror — library decision not made)
- Element autolinking (`[[name]]` syntax or autodetect)
- Element preview popover on hover
- Inline element creation from selected prose
- Word count / progress tracking
- Outline mode (markdown-per-book sidecar)
- Notes overlay (random thoughts modal)
- Find/replace
- Reading mode / presentation mode
- Drag-to-reorder chapters
- Export to PDF/EPUB/HTML/markdown (lives in publish room)

---

## Deferred design questions

These need their own design conversations before building:

1. **Richtext editor library** — TipTap, ProseMirror, Lexical, custom? Atlas-only features (footnotes, callouts, element embeds) need rich extension surface. Markdown serialization for OW description portability.

2. **Where richtext lives** — Captain's call this session was: don't put markdown in OW description fields yet, keep it simple. So richtext is either: (a) atlas-local sidecar files alongside the Narrative, or (b) future atlas-extension field on Narrative (`atlas_richtext_html`?). Decide when editor lands.

3. **Autolinking algorithm** — full-text scan on save? Background worker? Inline as typed? `[[name]]` syntax vs. auto-detect both? Performance at large worlds.

4. **Element creation from prose** — select text → "create Character" → modal pre-filled with selected name. Where in the editor toolbar? Keyboard shortcut?

5. **Word count UX** — chapter footer? Sidebar of tree? Per-session goal? Global vs. per-book.

6. **Outline mode** — a separate file per book, plain markdown, used for planning. Where to surface in UI — toggle, separate route, sidecar?

7. **Notes overlay** — Captain mentioned "random notes modal/page persistent in app." Per-world notes? Global notes? Both? Storage layer.

8. **Reading mode** — render the active book/chapter as a clean reading view, no editor chrome. Could be a presentation route or a toggle.

---

## Conventions added

- **#33**: Writing tree labels read from `registry.worlds[i].writing_labels` — never hardcoded in UI.
- **#34**: Atlas writing depth cap is 3 (Book → Chapter → Scene). UI enforces via "+ new X" button visibility on parent depth.

---

## What writing is NOT (this tool)

- Not a replacement for prose tools at scale (Scrivener, Word) — atlas is *world-aware* writing, optimized for connection
- Not a markdown power-user surface — atlas is a structured editor first, markdown is a serialization choice for portability
- Not a publishing platform — that's the publish room (`DESIGN_PUBLISHING.md`)
- Not a wiki — element descriptions are the wiki; writing is narrative authorship
