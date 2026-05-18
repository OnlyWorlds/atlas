# Atlas — Publishing Design

**Version**: 1.0 (2026-05-18)
**Status**: Architectural model locked from write-tool scout. v1 stub this session. Implementation deferred.
**Related**: `DESIGN.md` (Rooms model), `DESIGN_WRITING.md`

---

## Vision

Atlas is primarily a local private editor. But every worldbuilder wants *some* way to share — a character profile for collaborators, a published book for readers, a snapshot of a location for a player. Publishing in atlas should be:

- **Selective** — pick which fields to share per published item
- **Public** — a URL anyone can open, no OW account needed
- **Atomic** — each publish is a snapshot, immutable; republish creates a new one
- **Extensible** — the model supports richer content (richtext, presentations, multi-element bundles) over time

The mechanism already exists: **OW write-tool built a backend showcase API** that atlas can reuse directly. Atlas extends what the showcase *contains*, not how it's stored.

---

## Existing showcase API (from OW write-tool scout)

Backend already provides:

### `POST /showcase/publish/`

Request body:
```ts
{
  element_type: string;
  element_id: string;
  element_data: Element;            // full element snapshot
  showcase_config?: {
    hidden_fields?: string[];       // field names to exclude from public view
    view_mode?: string;             // reserved for future styling
  };
}
```

Response:
```ts
{
  showcase_id: string;
  published_at: string;             // ISO datetime
  public_url: string;               // https://onlyworlds.com/showcase/<id>
  shareable_url: string;
}
```

### `GET /showcase/{showcase_id}/`

Public, no auth. Returns:
```ts
{
  showcase_id: string;
  element_type: string;
  element_data: Element;
  showcase_config: { hidden_fields, view_mode };
  linked_elements?: Record<string, LinkedElement>;   // related elements for preview
  view_count: number;
  world_name: string;
  published_at: string;
}
```

### Notes from scout

- Backend stores full snapshot. Atlas is a thin client.
- Snapshots are **immutable** — republish creates a new `showcase_id`. Intentional.
- `hidden_fields` is a blacklist (default = include all, opt-out per field).
- `view_count` tracked per showcase.
- `linked_elements` already comes back for preview without separate queries.
- Currently field-level only — no richtext, no per-field styling, no multi-element bundles.

---

## Atlas extensions (future, beyond v1 stub)

`showcase_config` is opaque to OW schema validation — that's the flex point. Atlas can extend it without breaking the API contract:

```ts
showcase_config: {
  hidden_fields?: string[];
  view_mode?: string;

  // Atlas extensions (atlas writes them; backend stores opaque; atlas reads them on retrieve)
  atlas_field_richtext?: Record<string, string>;   // field name → ProseMirror JSON / HTML
  atlas_layout?: 'card' | 'page' | 'book';
  atlas_bundle_ids?: string[];                     // multi-element publish (e.g. all chapters in a book)
  atlas_theme?: string;
  atlas_cover_image_url?: string;
}
```

Other OW tools opening a showcase ignore the `atlas_*` keys — they see the canonical OW data. Atlas-published showcases viewed from another tool degrade to plain-field rendering.

### Multi-element bundle (the "publish a book" use case)

Atlas can publish a Book (top-level Narrative) by:

1. Creating ONE showcase with `element_id = bookId, element_type = 'narrative'`
2. Populating `atlas_bundle_ids` with all child chapters/scenes
3. Backend stores the bundle ids in `showcase_config`
4. On retrieve, atlas-side viewer fetches each child showcase (or atlas embeds them in `element_data`)

Alternative: backend extension for "publish a hierarchy." Defer this conversation — single-element with bundle pointer works for v1.

### Richtext

If atlas builds a richtext editor (see `DESIGN_WRITING.md`), the richtext lives in `atlas_field_richtext` per published field. Public viewer renders it; OW tool viewers see the plain `story` / `description` from `element_data`.

---

## Room layout

### Publish home — `#/w/<id>/publish`

List of all showcases for this world. Reads from a local registry of published showcases (atlas-side cache keyed by world):

```
┌──────────────────────────────────────────────────────────┐
│ 🏠 ✎ 🕓 ⌕ ⬆ ⬇ 🧩 ⚙        ← room nav                  │
├──────────────────────────────────────────────────────────┤
│  Publications                                            │
│                                                          │
│  📖 Book 1: The Beginning                                │
│     Published 2d ago · 47 views · 12 chapters bundled    │
│     [open] [copy link] [republish] [revoke]              │
│                                                          │
│  👤 Aralia                                               │
│     Published 1w ago · 3 views                           │
│     [open] [copy link] [republish] [revoke]              │
│                                                          │
│  ...                                                     │
│                                                          │
│  + publish current element                               │
└──────────────────────────────────────────────────────────┘
```

### Per-showcase — `#/w/<id>/publish/<showcase_id>`

Manage a specific publication:
- See public URL + share button
- Preview as visitors see it
- Toggle field visibility (modifies via republish)
- View stats
- Republish (creates new showcase_id, optionally archives old)
- Revoke (best-effort backend call; the snapshot may persist)

### Element-level publish action

A "publish" button appears in the element-detail header for any element. Clicking opens the showcase config modal (toggle field visibility, optional cover, optional atlas extensions later) → posts to API → toast with public URL + autocopied → navigates to `#/w/<id>/publish/<showcase_id>`.

---

## Atlas-side state

A new registry slice for published showcases:

```ts
interface ShowcaseEntry {
  showcase_id: string;
  world_id: string;
  element_id: string;
  element_type: string;
  published_at: string;        // ISO
  public_url: string;
  hidden_fields: string[];
  // Atlas extensions (optional)
  atlas_bundle_ids?: string[];
  atlas_layout?: string;
}

interface WorldsRegistry {
  // ... existing fields
  showcases?: ShowcaseEntry[];     // per-world list, atlas-local
}
```

Stored in localStorage with the rest of the registry. Backend is the ultimate truth (atlas can `GET /showcase/{id}/` to verify), but the local cache makes publish-home fast and offline-tolerant.

---

## v1 scope (this session)

**Build**:
- Publish room stub at `#/w/<id>/publish` — empty showcase list, "publishing coming soon" copy explaining what it will do
- Per-showcase route `#/w/<id>/publish/<showcase_id>` (stub — empty state with showcase id)
- Routes work + room nav highlights correctly

**Defer**:
- Actual `POST /showcase/publish/` client wiring
- Element-detail "publish" button
- Showcase config modal
- Public viewer (lives at `onlyworlds.com/showcase/<id>` — already provided by backend)
- Showcase list rendering (no data to render yet)
- Atlas extensions (richtext, bundles, layouts)
- Revoke flow

---

## Open design questions

1. **Element-detail publish button placement** — header action icon next to delete? Settings → World → Publish? Right-click context menu?

2. **Showcase config modal UX** — list of fields with toggle switches? "Hide all" / "show all" presets? Live preview pane?

3. **Local registry of showcases** — when is the local list out of sync with backend? Refresh-from-API equivalent for showcases. Soft-edge for v2.

4. **Bundle UX for books** — when publishing a Book Narrative, atlas should detect children (chapters/scenes) and offer "publish whole book?" with one click. The modal needs to surface this.

5. **Revoke semantics** — does the backend support delete? If not, atlas just removes from local registry (the public URL still works). Confirm with Skeld/backend.

6. **Richtext at publish time** — when atlas has a richtext editor, do we serialize richtext to `atlas_field_richtext` on publish ONLY, or always (so any tool can show it if it knows the field)? Probably publish-time only — keeps the OW data clean.

7. **Multi-tool authoring** — if user publishes from atlas (with `atlas_*` extensions), then republishes from write-tool, the atlas extensions are LOST. Acceptable v1 tradeoff; preserve-foreign-keys is a v2 concern.

---

## Conventions added

- **#35**: Atlas extensions to showcase_config use `atlas_*` prefix. Other tools ignore them gracefully.
- **#36**: Showcases are immutable. "Republish" creates new, doesn't mutate old. Atlas registry tracks all published showcases for a world.

---

## What publishing is NOT

- Not a self-hosted publication platform — atlas posts to OW backend, OW backend serves public URLs
- Not a collaboration / multi-author tool — that's an OW backend concern (sync semantics)
- Not a CMS — no drafts, no scheduling, no SEO tooling
- Not a print pipeline — export to PDF/EPUB is a separate pillar (lives in writing-room future scope)
