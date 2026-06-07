# Sharing Backend Contract — atlas ↔ onlyworlds.com

**Status**: DRAFT v0.1 (2026-06-07, session 237) — for Captain review, then Anchor.
**Owner pairing**: Temper (atlas + viewer tool) · Anchor (Django backend). Skeld is the present API expert for schema questions while Anchor is dormant.
**Context docs**: `DESIGN_SHARING.md` (the design), `core/sharing.ts` (the block model as built and tested).

This is the coordination artifact for Sharing Phase 2 (same data-contract pattern as the Skeld DCC collaboration: the contract IS the coordination). Everything atlas-side that this contract assumes is **already built and test-locked**; everything backend-side is **proposed** — Anchor owns the implementation shape and may push back on any of it.

---

## 1. What this enables (one paragraph)

Atlas users compose **pages** — ordered stacks of blocks (heading / prose / element-card; later map, collection, circle) — and publish them to a public URL: `show.onlyworlds.com/<slug>`. A published page is by default a **frozen snapshot** (safe: later world edits never leak to link-holders). One page per world may be flagged **live** (the World Showcase — auto-reflects current data). A lightweight read-only **viewer tool** (Temper builds it; CF Pages + a meta-injection Function) renders the payloads.

## 2. Decisions already locked (atlas-side, sessions 234–237)

| Decision | Value |
|---|---|
| Page storage in the world | prose/composition = a Narrative `subtype: "page"`; composition config in atlas-local fields (never hits worldapi); canonical `story` = derived plain-markdown mirror |
| Block model v1 | `heading` / `prose` / `element-card` — extensible without migration |
| Slug namespace | **global** (`show.onlyworlds.com/<slug>`), uniqueness enforced at publish |
| Auth | `api_key` + PIN, identical to worldapi — no new auth concept |
| Revoke | **tombstone** — content deleted, row + slug retained, public URL serves a 410-style "no longer shared"; prevents slug takeover |
| Showcase ↔ Page | **one model** — a page flagged `is_live`, unique per world |
| Disclosure | snapshot contains ONLY chosen content; cross-references to non-included elements are pre-resolved to plain text (permission chaining for free) |

## 3. Proposed Django model

```python
class SharedPage(models.Model):
    id           = models.UUIDField(primary_key=True, default=uuid7)
    world        = models.ForeignKey(World, on_delete=models.CASCADE, related_name="shared_pages")
    slug         = models.SlugField(max_length=40, unique=True)   # GLOBAL namespace
    title        = models.CharField(max_length=200)
    intent       = models.CharField(max_length=10, choices=[("show",)*2, ("reference",)*2, ("publish",)*2])
    payload      = models.JSONField(null=True)    # §5; null after revoke (tombstone)
    is_live      = models.BooleanField(default=False)             # World Showcase flag
    revoked      = models.BooleanField(default=False)
    view_count   = models.PositiveIntegerField(default=0)
    published_at = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            # At most one live page (the World Showcase) per world.
            models.UniqueConstraint(fields=["world"], condition=Q(is_live=True, revoked=False),
                                    name="one_live_page_per_world"),
        ]
```

**Quota**: max **20** active (non-revoked, non-live) pages per world, enforced at publish. Revoked rows don't count. The live showcase sits outside the quota. (Number negotiable.)

**Slug rules**: `[a-z0-9-]`, 3–40 chars, no leading/trailing `-`. Reserved list (Anchor's call): `api`, `assets`, `admin`, `about`, `static`, … Owner keeps a revoked slug — republishing to it un-tombstones (sets `revoked=False`, new payload). Only non-owners are blocked from a taken slug, revoked or not.

## 4. Endpoints

All under e.g. `/api/sharing/` (Anchor's call). Authenticated calls use the worldapi headers (`API-Key` + `API-Pin`); the world association derives from the key.

| Method + path | Auth | Behavior |
|---|---|---|
| `POST /pages/` | yes | Publish. Body: `{slug, title, intent, payload, is_live?}`. 201 → `{id, slug, url}`. 409 slug taken · 4xx quota exceeded (with `{"error": {"code": "quota_exceeded"}}`) · slug-format 400 |
| `GET /pages/<slug>/` | **none** (public) | The viewer's fetch. Active → 200 payload envelope (§5). Revoked → **410** `{"error": {"code": "revoked"}}`. Unknown → 404. Increments `view_count` (best-effort; caching may batch). For `is_live` pages: resolve current data server-side (§6) |
| `PATCH /pages/<id>/` | yes | Republish: replace `payload` / `title` / `intent` / `slug` (re-validated) / `is_live` |
| `DELETE /pages/<id>/` | yes | Revoke (tombstone): `payload=None, revoked=True`. 204. Idempotent |
| `GET /pages/?world=<id>` | yes | List own pages incl. revoked (atlas's share-room management list) |
| `GET /slug-check/?slug=` | yes | `{available: bool}` — pre-publish UX nicety |

## 5. The payload (the viewer's input contract)

Produced by atlas at publish time from the page's block stack (`core/sharing.ts` shapes, as built). Self-contained: the viewer renders it with zero further fetches (frozen pages).

```jsonc
{
  "version": 1,
  "title": "barovia primer",
  "intent": "reference",
  "theme": {},                       // reserved — ~6 tokens land with S3 (accent, font pair, light/dark, density, cover, width)
  "blocks": [
    { "id": "…", "kind": "heading", "text": "The Domain", "level": 1 },
    { "id": "…", "kind": "prose",   "markdown": "The mists never lift. [Ireena](ow://character/<id>) hides." },
    { "id": "…", "kind": "element-card", "elementId": "<id>", "variant": "full", "fields": ["description", "birthplace"] }
  ],
  "elements": {                      // ONLY the included elements, ONLY chosen content
    "<id>": {
      "name": "Ireena",
      "type": "character",
      "image_url": "https://…",      // optional
      "fields": {
        "description": "The burgomaster's daughter.",
        "birthplace": [ { "text": "Vallaki" } ]              // resolved at publish; see encoding rule
      }
    }
  }
}
```

**Relation-value encoding rule** (the disclosure mechanic): inside `elements[*].fields`, relation values are arrays of tokens `{ "text": "<display name>", "ref": "<element-id>"? }`. `ref` is present **only when that element is itself included** in `elements` (viewer renders a link); otherwise the token is plain text — a non-included element leaks nothing but a name the author chose to show. Prose `ow://` links follow the same rule at render time: target in `elements` → link/chip, else plain text.

**Size guard**: payloads should stay small (text + refs; images are URLs, never binaries). Suggest a server-side cap (e.g. 256 KB) with a clear 400.

## 6. Live pages (the World Showcase)

Same model, same endpoints — `is_live=True` changes the **sourcing** of `GET /pages/<slug>/`:

- The stored `payload` of a live page contains blocks + the element-card configs, but its `elements` map is treated as STALE.
- At GET time the server re-resolves `elements` from current world data: for each element-card, fetch the element, project the chosen `fields`, apply the relation-encoding rule (§5) against the included-id set.
- Response envelope is identical to the frozen case — **one viewer code path**.

**Open for Anchor**: if server-side resolution is unwelcome (perf/complexity), the fallback is a second public endpoint (`GET /pages/<slug>/elements/`) and the viewer composes. Atlas/viewer can work with either; server-side keeps the viewer dumbest. Caching: live pages want a short TTL (30–60 s?); frozen pages can cache aggressively (invalidate on republish/revoke).

## 7. Delivery (Temper's side, for context)

- Viewer: new tool on a CF Pages subdomain (e.g. `show.onlyworlds.com`). `_redirects /* /index.html 200`; `_routes.json` excludes `/assets/*`; a Pages Function injects per-page OpenGraph meta (title + intent-flavored description) for unfurls. Verified feasible against current CF docs (session 234).
- The viewer lifts atlas's portable renderer (`share-page-render.ts` + `renderProseFragment`) — already written store-free for exactly this.

## 8. Open questions for Anchor

1. §6 live-resolve: server-side projection vs. second endpoint — your call, see trade-off there.
2. Quota number (20?) and whether it's per-world or per-account.
3. Slug reserved list + whether you want slug rate-limiting (squatting).
4. `view_count` semantics under caching (exact vs. best-effort).
5. Does `DELETE` of the WORLD cascade to its shared pages (suggest: yes, hard-delete — world's gone, tombstones are moot)?
6. Anything in the payload schema you'd reshape for Django/DRF comfort — the viewer doesn't exist yet, so the wire shape is still cheap to change.

---

*Nothing here requires atlas-side rework to adjust — the payload is produced by one function at publish time, and S4 (the publish flow) is unbuilt by design until this contract settles.*
