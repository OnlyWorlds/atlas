# Sharing Backend Contract — atlas ↔ onlyworlds.com

**Status**: v0.3 (2026-06-12, session 239) — **AS-BUILT**. Anchor's `ow/sharing/` Django slice is implemented (83 backend tests, adversarial self-review, awaiting Captain's deploy); this version folds in her as-built calls from the 2026-06-07 message: **slug-addressed mutations**, the **locked error enum** (+`title_too_long`/`intent_invalid`, enveloped 401), **quota 20/account**, **purge-by-URL** invalidation, base path `/api/sharing/` confirmed, empty payloads are valid pages. Atlas fakes + client synced same day (session 239).
**Owner pairing**: Temper (atlas + viewer tool) · Anchor (Django backend).
**Context docs**: `DESIGN_SHARING.md` (the design), `core/sharing.ts` (the block model as built and tested), Anchor's feasibility review (the deployment ground truth).

This is the coordination artifact for Sharing Phase 2. Everything atlas-side that this contract assumes is **built and test-locked**; the backend slice below is **built** — integration smoke (both sides live) is the remaining step.

---

## 1. What v1 enables (one paragraph)

Atlas users compose **pages** — ordered stacks of blocks (heading / prose / element-card; later map, collection, circle) — and publish them to a public URL: `show.onlyworlds.com/<slug>`. A published page is a **frozen snapshot** (safe: later world edits never leak to link-holders; **all of v1 is frozen-only** — see §6). Updating = republish, one button. A lightweight read-only **viewer tool** (Temper; CF Pages + a meta-injection Function) renders the payloads. Public reads are served from the **Cloudflare edge** (§7) so anonymous traffic never competes with members' API calls for PythonAnywhere workers.

## 2. Decisions locked (v0.1 + Anchor review + Captain sign-off, sessions 234–238)

| Decision | Value |
|---|---|
| Page storage in the world | prose/composition = a Narrative `subtype: "page"`; composition config in atlas-local fields (never hits worldapi); canonical `story` = derived plain-markdown mirror |
| Block model v1 | `heading` / `prose` / `element-card` / `circle` (added session 238 — a knower's compiled knowledge, frozen into the payload at publish; backend-opaque like all blocks) — extensible without migration |
| **Live pages** | **DEFERRED entirely — v1 is frozen-only** (Anchor §3.1). `is_live` stays in the schema as a reserved column, default false, unused. The "World Showcase" v1 = a frozen page you republish |
| Slug namespace | **global** (`show.onlyworlds.com/<slug>`), uniqueness enforced at publish, **min length 4**, `[a-z0-9-]`, max 40, no leading/trailing `-` |
| **Slug immutability** | **v1 disallows slug change after publish** (atlas D1). Renaming a page's URL = revoke + republish to a new slug; the old slug stays an owner-held tombstone. No silent release → no takeover surface. `PATCH` may change `title`/`intent`/`payload` only |
| Auth | `api_key` + PIN, identical to worldapi (`world_api_auth`) — no new auth concept |
| Revoke | **tombstone** — payload deleted, row + slug retained, public URL serves 410; owner may republish to their own tombstoned slug. **Plus `admin_locked`** (Anchor §3.3): admin takedown that also blocks owner republish — the slug is burned |
| Quota | **20 active pages per ACCOUNT** (not per world — Anchor §4.2; raised from 10 in her as-built slice). Revoked don't count. Raise later is trivial |
| Throttles | per-account publish limit (~10/hr, squatting + abuse) · **per-IP throttle on the public GET** (required in v1 — the endpoint is otherwise a DoS amplifier) |
| Showcase ↔ Page | one model — `is_live` flag reserved for post-rebuild; one-live-per-world constraint ships in the schema, dormant |
| Disclosure | snapshot contains ONLY chosen content; cross-references to non-included elements are pre-resolved to plain text (permission chaining for free) |
| `view_count` | best-effort, inline `F()+1` on cache-miss only; CDN caching undercounts and that's accepted. No task queue |
| World DELETE | hard-deletes its pages (CASCADE). Frees the slugs — acceptable for a rare, deliberate, destructive act |
| Old showcase prototype | **frozen as-is** (Anchor §3.4a); eventual redirect-to-retired-notice; no migration (nobody used it) |

## 3. Django model (Anchor §5 — agreed)

```python
class SharedPage(AbstractBaseModel):           # base provides created_at/updated_at
    id            = UUIDField(pk, default=uuid7)
    world         = FK(World, on_delete=CASCADE, related_name="shared_pages")
    slug          = SlugField(max_length=40, unique=True)      # global; min length 4 in API
    title         = CharField(max_length=200)
    intent        = CharField(max_length=10)                   # advisory metadata ONLY (§5)
    payload       = JSONField(null=True)                       # §5; null after revoke (tombstone)
    revoked       = BooleanField(default=False, db_index=True)
    admin_locked  = BooleanField(default=False)                # takedown; blocks owner republish
    view_count    = PositiveIntegerField(default=0)
    is_live       = BooleanField(default=False)                # RESERVED, unused in v1
    published_at  = DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [Index(fields=["world", "-published_at"])]
        constraints = [UniqueConstraint(fields=["world"],
                       condition=Q(is_live=True, revoked=False),
                       name="one_live_page_per_world")]
```

## 4. Endpoints

Base path: **`/api/sharing/`** on `https://www.onlyworlds.com` (confirmed as-built; §8.1 closed). Authenticated calls use the worldapi headers (`API-Key` + `API-Pin`); world association derives from the key.

**Mutations are SLUG-addressed** (as-built): django-ninja 1.3 emits no typed `<uuid>` path converter, so an id-path and the public `<slug>` GET would collapse into one Django pattern → 405s. The immutable, globally-unique slug (held from the publish response) addresses PATCH/DELETE; GET/PATCH/DELETE share one path with per-method dispatch. The publish response is unchanged: still `{id, slug, url}`.

| Method + path | Auth | Behavior |
|---|---|---|
| `POST /pages/` | yes | Publish. Body: `{slug, title, intent, payload}`. 201 → `{id, slug, url}`. Errors: 409 `slug_taken` · 400 `slug_invalid` · 4xx `quota_exceeded` · 400 `payload_too_large` (256KB, measured on serialized JSON server-side) · 400 `title_too_long` (title ≤ 200) · 400 `intent_invalid` (intent ∈ {show, reference, publish}) |
| `GET /pages/<slug>/` | **none** (public) | The viewer's fetch. Active → 200 envelope (§5.2) with `Cache-Control: public, max-age=…` + ETag (§7). **An empty payload (`{}`) is a valid active page → 200.** Revoked/admin-locked → **410** `{"error":{"code":"revoked"}}`. Unknown → 404. `view_count` increments best-effort on cache-miss |
| `PATCH /pages/<slug>/` | yes | Republish: replace `payload` / `title` / `intent`. **Slug NOT changeable** (§2). Rejected if `admin_locked` |
| `DELETE /pages/<slug>/` | yes | Revoke (tombstone): `payload=None, revoked=True`. 204. Idempotent |
| `GET /pages/?world=<id>` | yes | List own pages incl. revoked (atlas's share-room management list) |
| `GET /slug-check/?slug=` | yes | `{available: bool}` — pre-publish UX nicety |

**Error shape everywhere**: `{"error": {"code": "<machine_code>", "detail": "<human text>"?}}`. **Locked enum (as-built, §8.3 closed)**: `slug_taken` · `slug_invalid` · `quota_exceeded` · `payload_too_large` · `title_too_long` · `intent_invalid` · `revoked` · `admin_locked` · `not_found` · `rate_limited` · `forbidden` · `unauthorized`. The 401 carries the envelope (`code: "unauthorized"`) via an additive global handler that ALSO keeps the legacy `{"detail": "Unauthorized"}` key, so worldapi/worldsync clients are unaffected.

## 5. The payload (the viewer's input contract)

Produced by atlas at publish time from the page's block stack (`core/sharing.ts` shapes, as built; builder function `buildPagePayload()` — session 238+). Self-contained: the viewer renders it with zero further fetches.

### 5.1 Payload body

```jsonc
{
  "schema_version": 1,               // the PAYLOAD schema version — viewer branches on this
  "title": "barovia primer",
  "intent": "reference",             // advisory only — drives viewer chrome + OG flavor, never server behavior
  "theme": {},                       // reserved — ~6 tokens land with S3
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

**Relation-value encoding rule** (the disclosure mechanic — unchanged from v0.1, Anchor-approved): inside `elements[*].fields`, relation values are arrays of tokens `{ "text": "<display name>", "ref": "<element-id>"? }`. `ref` is present **only when that element is itself included** in `elements` (viewer renders a link); otherwise the token is plain text. Prose `ow://` links follow the same rule at render time: target in `elements` → link/chip, else **plain text** (no chip styling, no data-id — non-disclosure means non-disclosure).

### 5.1.1 Worked example (generated shape — locked by `tests/unit/share-payload.test.ts`)

A page with one full Ireena card (fields: `description`, `birthplace`, `friends`) and one compact Ismark card, where Vallaki is NOT included:

```jsonc
{
  "schema_version": 1,
  "title": "barovia primer",
  "intent": "reference",
  "theme": {},
  "blocks": [
    { "id": "b1", "kind": "element-card", "elementId": "<ireena>", "variant": "full",
      "fields": ["description", "birthplace", "friends"] },
    { "id": "b2", "kind": "element-card", "elementId": "<ismark>", "variant": "compact", "fields": [] }
  ],
  "elements": {
    "<ireena>": {
      "name": "Ireena", "type": "character", "image_url": "https://…",
      "fields": {
        "description": "The burgomaster's daughter.",
        "birthplace": [ { "text": "Vallaki" } ],                   // NOT included → text only
        "friends":    [ { "text": "Ismark", "ref": "<ismark>" } ]  // included → linkable
      }
    },
    "<ismark>": { "name": "Ismark", "type": "character", "fields": {} }   // compact = identity only
  }
}
```

Builder guarantees (all test-locked): prose blocks ship markdown only (no TipTap JSON) · **prose + circle markdown is disclosure-SCRUBBED at build** (`ow://` links to non-included targets pre-resolve to plain labels — the payload JSON never carries undisclosed ids; session 239) · dangling relation ids are DROPPED (disclose nothing) · compact cards contribute no fields · chosen fields project only while still populated · meta/atlas-local fields never appear · card ids are healed from the refs mirror before building (id-swap safety). Atlas's visitor preview renders THIS payload — author preview ≡ served page.

**Card images** (session 239): card blocks carry `showImage` (default true; per-card author opt-out). `elements[*].image_url` ships only when at least one card for that element wants it. Renderers: full card → banner image, compact card → small head avatar in place of the type icon. Older payloads without `showImage` render as true.

**Collection blocks** (session 239, S6 — backend-opaque like all blocks): `{ "id", "kind": "collection", "elementIds": [...] }` — an identity grid. Members join `elements` identity-only (name/type/image_url, empty `fields` unless they also have a full card); dangling member ids are dropped from the wire.

**Map blocks** (session 239, S7 — backend-opaque): frozen at build to `{ "id", "kind": "map", "title", "image_url", "showLabels"?, "pins": [{ xPct, yPct, name, type, ref? }] }`. Image is `image_url`-only (D3: local media never leaves the folder); pins are %-positioned (top-left origin); labels render by default (`showLabels: false` → hover-only); maps without a web image or dimensions drop from the wire entirely; pin/map IDs never ship. **Pinned elements are disclosed BY INCLUSION** (Captain's call, same session): each included pin's element joins `elements` with image + description + ALL populated fields (relations tokenized per the standard rule) — the pin-click modal renders from it; the per-pin checklist is the disclosure gate for maps.

**Theme** (session 239, S3 — live): the `theme` slot carries allowlist-validated tokens only — `accent` (curated hex set) · `font` (pairing key) · `mode` (dark/light) · `density` (compact/cozy/airy) · `width` (narrow/regular/wide) · `cover` (https URL). Unknown keys/values are dropped at build AND at viewer parse (no style injection path).

**Circle blocks** (session 238, atlas+viewer concern — opaque to Django): in the payload a circle block carries its compilation FROZEN at build time: `{ "id", "kind": "circle", "knowerId", "title": "<knower name>", "knowerType": "collective"|"character", "entries": [ { "title", "markdown" } ] }`. Entry markdown follows the same prose disclosure rule at render time.

### 5.2 GET response envelope

```jsonc
{
  "slug": "barovia-primer",
  "published_at": "2026-06-07T…",
  "updated_at": "2026-06-07T…",      // viewer shows "last updated" for trust
  "payload": { …§5.1… }
}
```

## 6. Live pages — DEFERRED (post ow.com rebuild)

v1 ships nothing live. When it lands (post-rebuild, with Redis / a real host): the **second-endpoint path** (`GET /pages/<slug>/elements/`, separately and briefly cached) — never inline re-resolution in the hot GET. The schema is already ready (`is_live` + the one-live-per-world constraint). The viewer's render path is identical either way (one envelope shape).

## 7. Delivery + caching (the piece that makes the economics work)

**Confirmed 2026-06-07**: onlyworlds.com is already Cloudflare-proxied (`Server: cloudflare`, `cf-cache-status: DYNAMIC` — proxied, not yet caching). So:

- **Frozen payloads are immutable between republishes** → Django sets `Cache-Control: public, max-age=<long>` + ETag on the public GET; a CF **Cache Rule** on the GET path caches it at the edge. Anonymous spike traffic (the Reddit moment) is served by Cloudflare and never reaches a PythonAnywhere worker.
- **Invalidation (as-built, §8.2 closed): purge-by-URL.** Django holds a scoped Zone→Cache-Purge token (Captain mints it) and purges the exact public GET URL on republish/revoke; degrades to edge TTL if the token's absent. **The cache key is `https://www.onlyworlds.com/api/sharing/pages/<slug>/`** (configurable via `SHARING_API_ORIGIN`) — every payload fetcher (atlas client, viewer SPA, OG Function) must pin to that exact host or purges miss their cache entry.
- **Viewer**: CF Pages at `show.onlyworlds.com` (same CF zone). `_redirects /* /index.html 200`; `_routes.json` excludes `/assets/*`; a Pages Function injects per-page OpenGraph meta — its server-side payload fetch rides the same edge cache.
- **Per-IP throttle on the GET** at Django remains required (cache-miss path + cache-bypass attempts).
- **Durability requirement**: the **public GET path + slug URLs survive the ow.com rebuild unchanged**. This is the contract's most durable line — the viewer and every shared link depend on it.

## 8. Open items — ALL CLOSED (Anchor's as-built calls, 2026-06-07)

1. ~~Base path~~ → **`/api/sharing/`** ✅
2. ~~Purge vs TTL~~ → **purge-by-URL** (scoped zone token, TTL degradation when absent) ✅
3. ~~Error code enum~~ → **locked** (§4; +`title_too_long`, `intent_invalid`, `forbidden`, `unauthorized`) ✅
4. ~~Reserved + blocklist~~ → implemented server-side (Anchor owns contents) ✅
5. ~~§5 reshaping~~ → none needed; payload/envelope unchanged from v0.2 ✅

**Verify-live residue — ALL CONFIRMED (Anchor, 2026-06-12; fakes exact):**
- Cross-account PATCH/DELETE → **404 `not_found`** (existence-hiding: the queryset scopes by world; `403 forbidden` is reserved for demo-world writes).
- PATCH with a payload on your own *revoked* slug → **200, it REVIVES** (a second legal revival path beside POST; quota-checked like any transition-to-active).
- Revival at quota → **429 `quota_exceeded`** (ALL limit rejections are 429; 400 is validation-only). Reserved slugs → **409 `slug_taken`**, not 400.
- **Status map (locked)**: 400 `slug_invalid`/`payload_too_large`/`title_too_long`/`intent_invalid` · 401 `unauthorized` (dual-shape) · 403 `forbidden` (demo world)/`admin_locked` · 404 `not_found` (missing OR cross-account) · 409 `slug_taken` (incl. reserved + own-active re-POST) · 429 `quota_exceeded`/`rate_limited`.
- **CORS on the public GET**: verified live — the zone reflects origins (`Vary: origin`), `show.onlyworlds.com` + `localhost:3045/3046` all allowed; per-origin cache keys make cached-ACAO safe. Re-check on a cache HIT at the §7 joint pass (CF_DELIVERY §5 items 6–7).

---

## Sequence (from Anchor §7, Captain-approved)

1. ✅ Captain decisions (defer-live · 10/account · CF-fronted reads · freeze prototype · slug immutability).
2. **Anchor builds the §3–§5 slice** (model + migration + endpoints, frozen-only, throttles, cache headers).
3. **CF mini-design** (Temper + Anchor): Cache Rule + headers + purge — short doc, spans both sides.
4. **Temper**: payload builder + fakes-first S4 publish flow + viewer fetch locked against §5.
5. Retire the prototype deliberately (freeze now, redirect later).
6. **Post-rebuild**: light up `is_live` via the second-endpoint path; Phase-3 disclosure features.

*Atlas-side adjustments for anything above are cheap — the payload is produced by one function at publish time, and S4 builds against fakes that encode THIS document, so a contract change is a fake change + a test run.*
