# Atlas — Sharing Design

**Version**: 1.0 (2026-05-25) — fresh design (supersedes `DESIGN_PUBLISHING.md`)
**Status**: Direction locked through design conversation (session 234). Data-model + backend **provisional** — co-owned with Anchor (Django), finalized when we build. Sequenced **after** the Knowledge foundation.
**Related**: `DESIGN_KNOWLEDGE.md` (the foundation Sharing consumes), `DESIGN.md` (rooms), `DESIGN_WRITING.md` (narrative authoring)

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
| **World Showcase** | Publish | the world itself (curated front door) | **live**, auto-updates, **one per world** |
| **Page** | Show / Reference / Publish | hand-composed blocks (elements, prose, map, narrative, **Circle**) | **snapshot** (frozen = safe), many per world, quota'd |

- **Frozen = the safety feature.** A snapshot page never leaks the DM's later prep edits to players holding the link. The research is emphatic this matters.
- **The Circle block collapses "Reference pages" into the general model.** "Publish for the party" = a Page containing a **Circle block** (a knower's compiled knowledge, from `DESIGN_KNOWLEDGE.md`). So there's no separate "Circle Reference" page kind — just a Page with a Circle block. Two page kinds, one block set.
- **A shared story** (book/novella) is a Page whose main block is a narrative rendered for reading — not a separate top-level thing.
- **Quota**: ~N pages per world (e.g. 20). The World Showcase is separate from the quota.

---

## The Block Model (the display sublanguage)

Goal: **wide perceived freedom through few, opinionated blocks** — never a freeform CSS canvas (the World Anvil trap). A page is an **ordered single-column stack** (responsive by construction, impossible to break); each block picks from a small **layout menu** (no arbitrary positioning).

**~8 block types:**
1. **heading** — section structure + auto table-of-contents
2. **prose** — rich text (the workhorse; one block, not five)
3. **element-card** — binds to a world element; choose visible fields; variants (compact / full / tile)
4. **element-collection** — binds to a *set* (a Collective, or a filter) → gallery / list / table (one dataset, chosen framing)
5. **map** — embeds a world map with *selected* pins/zones (atlas's Leaflet renderer, read-only)
6. **image / gallery** — single image or lightbox grid
7. **callout** — icon + text + one accent background (the single "highlight" primitive)
8. **divider** — section break
- **Circle block** — renders a knower's compiled knowledge (Knowledge-foundation dependent; optional)

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
- **World Showcase = live.** Renders current world data. Always current. The curated public home.
- **Field surfacing** (from a knowledge entry or an element-card's chosen fields): copied/frozen into a snapshot at publish; retrieved at view-time for the live showcase.

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

## OPEN — to finalize with Anchor / as we build

These are direction-set but not locked (the Knowledge foundation is the priority to build first):

1. **How a Page is stored.** Lean: page *prose* = a Narrative (`subtype: "page"`); composition/theme/field-visibility = `atlas_*` config; the published artifact = a **frozen snapshot in a new Django model** Anchor builds. World stays clean for other tools; the public snapshot is self-contained. *(Needs Anchor.)*
2. **v1 authoring mode.** Lean: start **prose-first** (page = narrative, cheapest, reuses the writing room, best for Show/Publish), blocks/composition-first follow (best for the DM Reference page). The biggest scoping call — revisit when we start building Sharing.
3. **Backend model shape** — Anchor's domain. We hand her a contract (page record, snapshot payload, slug uniqueness, view counts, revoke, quota).
4. **Revoke semantics** — does deleting a page remove the public snapshot, or just unlink it? Confirm with Anchor.
5. **Showcase ↔ page exact boundary** — is the World Showcase a special live Page, or its own record? (Lean: a Page flagged live + singular per world.)

---

## Build Phases

- **Phase 2 (after Knowledge):** World Showcase + Pages, the block/token builder, snapshot publish → Anchor's Django model → clean URL + custom slug, the viewer tool, a Sharing room in atlas (list/manage, copy link, republish, revoke, preview-as-visitor).
- **Phase 2.5:** the Circle block + "publish for a Circle" bridge.
- **Phase 3:** live reveal-by-group, graduated map reveal, depth-aware disclosure, theming polish.

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
