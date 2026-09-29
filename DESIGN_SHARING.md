# Atlas — Sharing Design

**Version**: 1.4 (2026-06-12, session 239) — **BACKEND LIVE**; contract v0.3 as-built; critical pass closed (disclosure scrub, scheme allowlist, publish-flow hardening)
**Status**: S1+S2 shipped (237); S4+S5+viewer built (238); **Anchor's `ow/sharing/` slice BUILT + DEPLOYED** (2026-06-12, live-probed: envelope/401/CORS all match). Contract **v0.3** = the as-built shape: slug-addressed PATCH/DELETE, locked error enum, **quota 20/account**, purge-by-URL. Session 239 critical pass: **payload markdown is disclosure-SCRUBBED at build** (`scrubMarkdownForPayload` — non-included `ow://` ids never reach the wire; §5.1 render rule stays as defense-in-depth) · markdown link hrefs are scheme-allowlisted (no `javascript:` XSS in public renderers) · compact cards are identity-only incl. no image · delete-while-published revokes first · stale-mirror recovery on `not_found` · in-flight guards on republish/revoke. Remaining backend-free queue: S3 themes · map block (design conversation first — D3) · element-collection · drag-reorder · share-room list-reconcile.
**Related**: `DESIGN_KNOWLEDGE.md` (the foundation Sharing consumes), `DESIGN_SHELL.md` (rooms), `DESIGN_WRITING.md` (narrative authoring), `SHARING_CONTRACT.md` (v0.3, as-built)

> **Supersedes `DESIGN_PUBLISHING.md`.** That doc was built on the dead write-tool prototype's assumptions (atlas = thin client, reuse the old showcase API as-is, one-showcase-per-element, opaque `showcase_config`). Nobody used the prototype; nothing to migrate. We start fresh — Anchor builds whatever Django model the design needs.

---

## Vision

Atlas is primarily a local private editor — but every worldbuilder wants *some* way to share. Sharing serves **three intents** (an axis independent of *content shape*):

- **Show** — social, ephemeral, public. "Look at this character / this history / this world!" Low effort, appreciation-oriented.
- **Reference** — functional, selective, audience-specific. "Here's what your party knows." DM → players; collaborator handoff. Defining trait: *deliberate partial disclosure*.
- **Publish** — permanent, curated, styled, a *destination* you'd link from a bio. The world bible, the published novella.

**Content shapes** cut across all three: a single element, a collection, a long-form narrative (reading experience), a map, or a Circle's compiled knowledge.

---

## Two Surfaces

- **Atlas = author + manage.** Compose pages, pick elements/fields, write prose, style, publish, manage existing shares. Sharing is a room; atlas is the everything-tool.
- **A dedicated viewer tool = consume.** A lightweight read-only web app that renders shared pages, **lifting atlas's existing renderers** (element detail, Leaflet maps, narrative reading, the context graph). Cheap to build precisely because atlas already wrote every renderer. Atlas stays editor-shaped; the public experience stays reader-shaped.

The viewer is a **first-class pillar**, not an afterthought — the moment a shared page needs interactivity (clickable map pins, cross-linked elements, a reading experience) you're running a read-only world browser, which atlas already is.

---

## Taxonomy

Everything is a **page**. Pages differ on one axis: **how they're sourced.**

| Kind | Intent | Source | Live / snapshot |
|---|---|---|---|
| **World Showcase** | Publish | the world itself (curated front door) | **live**, auto-updates, **one per world** — ⚠ DEFERRED to post ow.com rebuild (Anchor review §3.1); v1 showcase = a frozen page you republish |
| **Page** | Show / Reference / Publish | hand-composed blocks (elements, prose, map, narrative, **Circle**) | **snapshot** (frozen = safe), quota'd (20/account, contract v0.3) |

- **Frozen = the safety feature.** A snapshot page never leaks the DM's later prep edits to players holding the link. The research is emphatic this matters.
- **The Circle block collapses "Reference pages" into the general model.** "Publish for the party" = a Page containing a **Circle block** (a knower's compiled knowledge, from `DESIGN_KNOWLEDGE.md`). So there's no separate "Circle Reference" page kind — just a Page with a Circle block. Two page kinds, one block set.
- **A shared story** (book/novella) is a Page whose main block is a narrative rendered for reading — not a separate top-level thing.
- **Quota**: 20 active pages per ACCOUNT (as-built; revoked don't count). The World Showcase question returns post-rebuild.

---

## The Block Model (the display sublanguage)

Goal: **wide perceived freedom through few, opinionated blocks** — never a freeform CSS canvas (the World Anvil trap). A page is an **ordered single-column stack** (responsive by construction, impossible to break); each block picks from a small **layout menu** (no arbitrary positioning).

**~8 block types** (✅ = built):
1. **heading** ✅ — section structure (+ future auto table-of-contents)
2. **prose** ✅ — rich text (the workhorse; one block, not five)
3. **element-card** ✅ — binds to a world element; choose visible fields; variants (compact / full; tile later)
4. **circle** ✅ (238) — a knower's compiled knowledge, FROZEN into the payload at publish (the Knowledge bridge; conventions in DESIGN_KNOWLEDGE)
5. **element-collection** — binds to a *set* (a Collective, or a filter) → gallery / list / table (one dataset, chosen framing)
6. **map** — embeds a world map with *selected* pins/zones (⚠ design conversation first — only `image_url` maps can publish; local-media images never leave the folder)
7. **image / gallery** — single image or lightbox grid
8. **callout** — icon + text + one accent background · **divider** — section break

**~6 theme tokens** (combinatorially huge range, zero broken output):
accent color · font *pairing* (a vetted pair, not individual pickers) · light/dark · spacing density · cover image · layout width.

**Beautiful-defaults principles** (from research — GitBook/Gamma/Carrd/Notion):
- Curated palettes & font-*pairs*, never raw pickers; system derives the full type scale.
- One density knob → all spacing. No per-element sizing.
- **Content and theme fully separated** — swapping a look never touches content.
- Single-column stack as the layout engine; columns only as a constrained 2-up wrapper if at all.
- Semantic blocks auto-populate (an element-card fetches its own image/fields).
- **No raw CSS** in v1. An "advanced" escape hatch is a far-future maybe, never the path.

OnlyWorlds-themed throughout (lowercase, cyan accent, glass panels) by default, with the tokens letting a user make it *theirs*.

---

## Snapshot vs Live

- **Pages = snapshot.** Frozen at publish. Republish to update. Safe for Reference (no leaks). Self-contained.
- **World Showcase = live.** Renders current world data. Always current. The curated public home. *(⚠ DEFERRED to post ow.com rebuild — Anchor review §3.1: live re-resolution on the hottest URL is the riskiest piece on current infra. v1 showcase = a frozen page + the republish button. `is_live` stays reserved in the schema.)*
- **Field surfacing** (from a knowledge entry or an element-card's chosen fields): copied/frozen into a snapshot at publish; retrieved at view-time for the (future) live showcase.

---

## The Viewer Tool + Delivery (Cloudflare — verified)

A new dedicated tool, deployed to a subdomain (e.g. `show.onlyworlds.com`). Verified feasible against current Cloudflare docs:

- **Path-based deep links, cold-loadable.** `show.onlyworlds.com/<id>` or `/<world-slug>` via `_redirects` `/* /index.html 200` (rewrite, not redirect — URL stays, SPA router takes over). No hash routing.
- **Custom subdomain** works as a Pages custom domain (onlyworlds.com is already a CF zone).
- **Custom slugs** — `show.onlyworlds.com/<your-slug>` with a uniqueness check at publish (small Anchor addition: a unique slug field).
- **Link previews / SEO** — a Cloudflare **Pages Function** injects per-page OpenGraph `<meta>` server-side (Discord/Twitter/Google unfurls), which a pure SPA can't do. `_routes.json` excludes `/assets/*` so static assets stay free/fast.
- **One deployment serves both** static SPA shell (client fetches page data live from the OW API) **and** dynamic per-path meta. Supports both frozen-snapshot and live-showcase models.

Recommended architecture: **Pages + a thin Function** (static SPA + edge meta-injection). Standalone Worker is overkill unless we outgrow Pages.

---

## Knowledge Integration

The **Circle block** is the bridge to the Knowledge foundation:
- A Circle block on a Page renders everything a Circle holds (compiled known-view → blocks).
- **"Publish for this Circle"** (from the Knowledge room) auto-derives a Page pre-filled with that Circle's compiled knowledge + optionally a map showing only its known pins. The DM's core flow.
- Knowledge is an **optional source** — Show/Publish pages (full element-cards, no partial disclosure) never touch it. Reference pages lean on it.

---

## Partial Disclosure (the DM use case)

- **v1 baseline (beats most incumbents):** per-element selection + per-field visibility, published as a **snapshot**. Because a snapshot contains only what you chose, cross-links to non-included elements render as plain text — **permission chaining for free**, no leak. Field-level granularity is something even World Anvil lacks.
- **Deferred** (OW's to own, post-v1): graduated visibility (Foundry's "see the pin exists, not its contents"), live reveal-by-group, graduated map fog. These build on the Knowledge foundation + the live model.

---

## Research-Informed Steal / Avoid (summary)

**Steal:** LegendKeeper's per-share-target URLs + free unlimited read-only guests; Kanka's permission-chaining (hidden link auto-hides); GitBook/Gamma's preset-themes-not-CSS; Obsidian's hover-previews + auto-backlinks + selective publishing; stable slug/ID permalinks from day one.
**Avoid:** World Anvil's three overlapping disclosure systems, silent-failing CSS, title-derived URLs that break on rename, paywalled basic privacy, overwhelming onboarding; Notion's too-few-controls genericness; Kanka's whole-campaign-only public sharing.

---

## Decisions — the 5 calls, CLOSED (session 237 design conversation)

Settled with Captain from `PHASE_SHARING_BRIEF.md` (kept as the decision record); flexible if building proves any of them wrong, but all five survived the S1/S2 build:

1. **Page storage = lean hybrid.** A page is a Narrative `subtype: "page"`. Composition lives in atlas-local fields: `atlas_page_blocks` (the source of truth) + `atlas_page_refs` (flat element-id mirror — keeps element-card bindings safe when ids change; the re-key kernel's `rekeyBody` also walks `atlas_page_blocks` raw since S363, and `blocksOf()` heals nested ids positionally) + `atlas_page_intent` + `atlas_page_theme` (reserved). The canonical `story` field carries a **derived plain-markdown compilation** regenerated on every blocks save — synced + readable on other devices/tools, never hand-edited. The published artifact = a frozen snapshot in Anchor's Django model (`SHARING_CONTRACT.md`). *(Resolves the call-1 wrinkle: an unpublished page's composition lives only in the local element file; the snapshot is born at first publish.)*
2. **v1 authoring = minimal-blocks.** Builder UI from day one with three blocks (heading / prose / element-card); the architecture is block-shaped from the start, so the set grows without a prose→blocks migration. Page prose runs **NO mention-derive** — mentions render chips (presentation) but never write Involves fields; a page's element bindings are its element-card blocks. The third narrative kind is sealed via `core/narrative-kind.ts` (story / knowledge / page — writing tree, promote, and setup heuristics all exclude non-story kinds).
3. **Backend contract** → `SHARING_CONTRACT.md` (global slug namespace, api_key+PIN auth, payload schema derived from the as-built block model).
4. **Revoke = tombstone.** Content deleted, slug retained, URL serves "no longer shared". Owner can republish to their revoked slug.
5. **Showcase = a Page flagged `is_live`, unique per world.** One model, one endpoint set, one viewer code path (live = server-side re-resolution of the same envelope).

## Decisions — release sheet, CLOSED (2026-07-03 Comms session: Captain + Skeld + Temper)

1. **B6 — pin disclosure is STRICT BY DEFAULT** (supersedes the session-239 full-fields call). An included map pin ships its element as name/type/description (+ image) only; the author opts specific pins into the full profile via the per-pin `full` toggle (`MapBlock.fullPinIds`, healed alongside `pinIds` on id-swap, fails toward LESS disclosure). Trust rationale (Skeld): a DM whose secret prep leaks once never comes back. A card/collection's separate disclosure still unions in — a map never downgrades a deliberate card choice.
2. **B5 — republish re-snapshots EVERYTHING, charts included.** Pages never update without an explicit republish (already true); republish means "publish the current state of this page" uniformly across block kinds (prose, cards, circles, charts). Confirmed by Captain + Skeld.
3. **B1 — edited-since-publish reminder.** `atlas_page_pub.content_sig` (cheap hash over name/blocks/theme/intent, stamped at publish + republish) vs the live page → amber dot in the Publish section. Signature, not timestamps — the pub-mirror write itself bumps `local_updated_at`.
4. **B3 — a dangling block renders NOTHING on the public page** (and in the preview, which must match it). "(missing element)" was author-debug info; the author still sees the block in the builder's edit rows. Applied in both renderer copies (atlas share-page-render + show).
5. Duplicate-page mint fixed: knowledge-room "create page →" opens the existing page carrying that knower's circle block instead of minting again.

---

## Build Phases

- **Phase 2 (after Knowledge):** World Showcase + Pages, the block/token builder, snapshot publish → Anchor's Django model → clean URL + custom slug, the viewer tool, a Sharing room in atlas (list/manage, copy link, republish, revoke, preview-as-visitor).
  - **S1 + S2 SHIPPED (session 237)**: share room (`#/w/<id>/share[/<pageId>]`, legacy `/publish` aliases), page CRUD (create-with-unique-name, rename, intent, delete-with-confirm), block builder (heading + prose + element-card; one-block-at-a-time editing; reorder/delete; TipTap prose via lazy `share-editor` chunk; per-field disclosure checklist on full cards), **visitor preview** via the portable `share-page-render.ts` (the Track C seed), sync round-trip test-locked (`sharing-sync.test.ts`: id-swap heal + strip + pull-overlay).
  - **PAYLOAD + S4 SHIPPED fakes-first (session 238)**: `core/share-payload.ts` (`buildPagePayload()` — §5 wire shape, schema_version, disclosure tokens, dangling-ref drop, refs-mirror healing; 9 unit tests) · visitor preview now renders **from the payload** (`renderPayloadPage` in share-page-render — author preview ≡ served page; prose `ow://` to non-included targets renders PLAIN TEXT via `renderProseFragment`'s `unresolved:'text'` mode) · copy-payload button (`data_object`) · **publish section** (slug input w/ `suggestSlug` + local validation · publish / republish / revoke · `atlas_page_pub` mirror field for offline display · gated: api-linked worlds only) · `src/sync/sharing-client.ts` (typed §4 client, error-code enum mapping) · `tests/msw-sharing-handlers.ts` (stateful fakes encoding contract v0.2: slug rules + reserved list, global uniqueness, own-tombstone revival, quota 10, slug immutability, 256KB cap, admin_locked) · 15 integration tests. **Backend integration = point `SHARING_BASE_URL` at Anchor's base path.**
  - **Next** (S3 themes + S6 collection + S7 map + drag-reorder + list-reconcile all SHIPPED 239; backend LIVE; every designed v1 block built): image/gallery + callout/divider blocks (nice-to-have) · then the UI pass (`Notes/2026-06-12-knowledge-sharing-ui-audit.md`). **Map block decisions (D3 closed with Captain, 239)**: image_url-only, self-host messaging, static renderer (no Leaflet in viewer), per-pin include-checklist defaulting all-on, hover = identity only (fields stay card-gated), zones/markers out of v1, Phase-3 fog builds on this shape.
  - **Map zones SHIPPED with per-zone curation (S299, 2026-07-20 — post-launch, Captain's "no zones in share page!" find + his "per-zone option, yes")**: the map block freezes zone overlays alongside pins, curated by a per-zone include-list. **`MapBlock.zoneIds?: string[]`** mirrors `pinIds` exactly: ABSENT = all zones on the map (friendly default + legacy blocks that predate zones); PRESENT (even empty) = exactly those zones. Initialized to all the map's zones at block creation (`addMapBlock`), so new zones never auto-join a curated map. Joins the refs mirror (`pageRefsFor`/`blocksOf`, count-aware, healed on Route-2 id-swap after the pins — legacy absent blocks consume zero zone refs, keeping the flat mirror aligned; unit-locked). Builder: a per-zone checklist with all/none, mirroring the pin checklist, shown only when the map carries zones. Freeze → `PayloadMapBlock.zones[]` (name + shape + %-normalized polygon/line points; `ref` only when the zone element is itself included — the pin disclosure rule). Geometry compiles from markers (the only spatial truth — DESIGN_ZONES §1), shape via the shared `getZoneShape` helper (builder/payload/canvas cannot diverge), degenerate geometry drops (<3 polygon / <2 line points). Renderer: one `%`-space SVG (`non-scaling-stroke`) under the pins in `renderMapView`, so builder and served page share the path. Openable zones (included element) are keyboard-operable (tabindex + Enter/Space, mirroring pins). Additive — old payloads/viewers ignore the field; **show viewer re-lifted** (render + parse + styles + a11y/NaN guards; the include-list is applied at freeze so `PayloadMapBlock.zones` is unchanged — show needed no further change). Closes the D3 "zones out of v1" deferral, now with the same per-item disclosure control pins have.
- **Phase 2.5:** the Circle block + "publish for a Circle" bridge.
- **Phase 3:** live reveal-by-group, graduated map reveal, depth-aware disclosure, theming polish.

---

## Conventions (extends the global list; continues from DESIGN_KNOWLEDGE's #72)

- **#73 — Page = Narrative `subtype: "page"`, third narrative kind.** Classification is `core/narrative-kind.ts` (`story` / `knowledge` / `page`) — any surface consuming "narratives" decides which kinds it means through this seam, never ad-hoc subtype checks.
- **#74 — Blocks are the page's source of truth; `story` is a derived mirror.** Every blocks save goes through `pageBlocksPatch()` which writes blocks + refs mirror + compiled story in one patch. Nothing else writes a page's `story`.
- **#75 — The refs mirror keeps element-bearing block bindings id-swap-safe.** `atlas_page_refs` = the element ids of element-bearing blocks in block order — element-card `elementId`s AND circle `knowerId`s (session 238) — as a flat array any id rewrite handles (the re-key kernel's `rekeyBody`, which also walks the blocks raw; the old flat `rewriteIdReferences` retired with Route 2's rebuild, S367); `blocksOf()` heals each block's nested id from the mirror positionally. Any future block kind that binds an element id MUST join both `pageRefsFor` and the `blocksOf` healing walk. Never read `atlas_page_blocks` raw for rendering — always via `blocksOf()`.
- **#76 — Page prose never derives relations.** Mentions/chips in page prose are presentation; no Involves writes, no holder semantics. The page's element bindings are its element-card blocks (mirrored in refs).
- **#77 — Page writes are serialized per room mount** (a promise chain): two rapid edits on the same element race inside FolderStore's read-merge-write and silently lose the first field otherwise. *(Session 238: the store now also serializes per-id at the boundary — convention #79 in DESIGN_LAWS.md — covering every room. The room chain remains: its await discipline additionally guarantees whole-block-array patches are computed from post-write state, which a store-level chain can't provide. Page deletes route through the same room chain so queued writes land before the file disappears.)*
- **#78 — `share-page-render.ts` stays store-free.** It takes resolved data (an elements Map) and returns DOM — the visitor preview and the future viewer tool share it. No imports from state/store/sync, ever.

---

## Sharing Room (atlas) — first sketch

Route: the existing `publish` stub, renamed **"share"** (`#/w/<id>/share`).

**What you SEE:** your Pages + the World Showcase as a list/gallery (title, intent, view count, public URL, live vs snapshot, last-published); optionally a **graph overview** ("what have I exposed publicly?") — pages linked to the elements/circles they include (doubles as an over-share check).

**What you DO:** create/edit a Page (the block builder); insert blocks; publish / republish / revoke; copy link; set a custom slug; configure the World Showcase; preview as visitor.

---

## What Sharing Is NOT

- Not a self-hosted CMS — atlas authors, OW backend stores snapshots, the viewer renders.
- Not a freeform design canvas — opinionated blocks + theme tokens, no raw CSS.
- Not a collaboration/multi-author tool — that's OW sync semantics.
- Not a print pipeline — PDF/EPUB export is a separate future pillar.
