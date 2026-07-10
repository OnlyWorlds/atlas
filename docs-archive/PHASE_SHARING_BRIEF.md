# Sharing Arc — Session Opener Brief

**Written**: 2026-06-07 (session 236 close) — pre-read for the Sharing design conversation
**Purpose**: frame `DESIGN_SHARING.md`'s 5 OPEN calls with options + honest recommendations so the conversation starts hot. **Nothing here is decided** — every call is Captain's. Read `DESIGN_SHARING.md` first; this brief doesn't repeat it.

---

## Arc shape (recap)

Knowledge is done (236). Sharing = **settle the 5 calls below → write the Anchor contract artifact → build S1 (share room shell) + S2 (block builder, local-render) which need NO backend → then Track C (viewer tool) + Track D (Anchor's Django) in parallel → integrate → S5 Circle block.**

What's buildable BEFORE any call is settled: almost nothing cleanly. S1's rename (`publish`→`share`) is trivial but the room's list/gallery shape depends on call 5; S2's block model is storage-agnostic in *rendering* but its persistence depends on call 1. **The calls are the bottleneck — hence this brief.**

---

## Call 1 — How a Page is stored

| Option | Shape | Consequences |
|---|---|---|
| (a) All-in-Django | Page content lives only in the backend record | Breaks local-first authoring; no offline page editing; atlas becomes a thin client to its own feature. Against the tool's one principle. |
| (b) All-in-world | Page = pure OW elements; snapshot derived at publish | World fills with composition/theme config other tools see as junk; the strip-discipline (`atlas_*`) can hide it from the API but then api-linked worlds can't sync pages across devices. |
| **(c) Lean hybrid** (doc's lean) | Prose = Narrative `subtype: "page"` (syncs like any element) + composition/theme as `atlas_*` fields on it (local, stripped) + frozen snapshot = Django model | Prose syncs + is authorable offline; config stays atlas-local; the public artifact is self-contained server-side. Cost: `atlas_*` config doesn't follow you across devices (acceptable — page *composition* is a workstation activity; re-deriving from the published snapshot is a future recovery path). |

**Rec: (c).** One wrinkle to settle live: where does composition live for a page that was never published — only in the local element file? (Lean answer: yes; the snapshot is born at first publish.)

## Call 2 — v1 authoring mode

| Option | Shape | Consequences |
|---|---|---|
| (a) Prose-first (doc's lean) | Page = a narrative rendered nicely; blocks come later | Cheapest; reuses writing room wholesale; great for Show/Publish intents. But the **DM Reference page — the unclaimed territory — isn't expressible** until blocks land. Sharing v1 ships without its moat. |
| (b) Blocks-first | Build the 8-block builder before shipping anything | The differentiator first, but the longest path to ANY public URL; high design surface before first feedback. |
| (c) Minimal-blocks v1 | 3 blocks only: heading / prose / element-card. Builder UI from day one, trivially small block set. Circle block lands next (S5), rest follow | First publish is nearly as fast as (a); the architecture is block-shaped from the start (no prose→blocks migration); Reference pages become possible the moment the Circle block lands. |

**Rec: (c).** The prose-first path quietly bakes in a "page = one narrative" model that the block model then has to break. Starting block-shaped with a tiny set avoids the migration while keeping v1 scope honest. (a) is the fallback if v1 speed matters most.

## Call 3 — Backend model shape (the Anchor contract)

Mostly enumerated in the doc already (world, owner, unique slug, intent, composition payload, theme tokens, snapshot payload, live flag, view_count, published_at, revoked, quota). The genuinely open sub-calls:

- **Slug namespace**: global (`show.onlyworlds.com/<slug>`) vs per-world (`/<world>/<slug>`). **Rec: global** — shortest URLs, matches the verified CF routing; uniqueness check at publish is already planned.
- **Auth**: publish/republish/revoke authenticated by api_key + PIN like everything else. **Rec: yes, no new auth concept.**
- **Snapshot payload format**: the viewer's input contract — effectively "rendered block model + resolved element data." Worth sketching WITH the block model (call 2), not separately.

**Rec on process**: the contract artifact should be a single markdown doc (endpoints + model + payload schema + quota + error shapes) handed to Anchor — same data-contract pattern as Skeld (relationships.md: the contract IS the coordination).

## Call 4 — Revoke semantics

| Option | Behavior | Consequences |
|---|---|---|
| (a) Hard delete | Snapshot row gone; slug freed | Simplest; but a freed slug can be re-claimed by someone else → old links show a stranger's page (slug takeover). |
| **(b) Tombstone** | Snapshot content deleted, row + slug retained as revoked; URL serves 410-style "no longer shared" | No takeover; "revoked" is honest to link-holders; quota should NOT count revoked rows. |

**Rec: (b).** Cheap for Anchor (a flag the doc already lists), kills the takeover class.

## Call 5 — Showcase ↔ Page boundary

| Option | Shape | Consequences |
|---|---|---|
| **(a) Page flagged live + singular** (doc's lean) | One Django model; `is_live` + uniqueness constraint per world | One model, one endpoint set, one viewer code path (live = fetch world data at view-time, snapshot = serve frozen payload). |
| (b) Separate Showcase record | Two models | Cleaner conceptual split but two of everything in the contract and the viewer. |

**Rec: (a).** The live/snapshot difference is a *sourcing* flag, not a different kind of thing — the doc's own taxonomy says so.

---

## Proposed arc sequence (post-decisions)

1. **Bout 0** — design conversation closes the 5 calls (this brief = the agenda) + locks the block-model v1 set.
2. **Bout 1** — write the Anchor contract artifact; route to Anchor via Captain (Anchor is dormant — delivery is Captain's call; Skeld is the present API expert for schema questions).
3. **Bouts 2-3** — S1 share room (rename, list/gallery, empty states) + S2 minimal block builder rendering from local config. No backend needed; e2e against local worlds.
4. **Track C scaffold** — viewer tool repo skeleton (CF Pages + `_redirects` + meta-injection Function) can start any time after the snapshot payload shape is locked; it's a NEW tool (Assembly foundation? — worth asking whether Kael ships a viewer foundation or we scaffold directly).
5. **Integration waits on Anchor's Track D.**

## Known constraints worth keeping in view

- Frozen-snapshot-by-default is the safety feature (DM leak protection) — never trade it for "live is simpler."
- No raw CSS, ever (the World Anvil trap). ~6 theme tokens, curated pairs.
- The viewer lifts atlas renderers — any S2 rendering code should be written portable-ish (no deep store coupling) since Track C re-hosts it.
