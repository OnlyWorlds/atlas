# Atlas — Knowledge Design

**Version**: 1.0 (2026-05-25) — initial model lock
**Status**: Model locked through design conversation (session 234). Build = Phase 1 (pure-local, no API/sharing dependency). Implementation pending.
**Related**: `DESIGN.md` (rooms model), `DESIGN_WRITING.md` (narrative authoring, mentions/autolink), `DESIGN_SHARING.md` (consumes this foundation)

---

## Vision

Worlds are full of secrets, rumors, lore, and partial truths — and *who knows what* is itself worldbuilding. A masked rebel leader is one thing to the city watch and another to her inner circle. A DM's party knows only what they've discovered. Today no tool models this: every competitor reduces "knowledge" to a visibility flag bolted onto a wiki page.

Atlas models knowledge as **first-class world data**: a piece of knowledge is a thing in your world, held by the characters and groups who know it, *about* the elements it concerns. This is independently valuable as pure worldbuilding — model what your factions know, see the world through a character's eyes — and it later becomes the foundation that makes selective **sharing** (DM → players) clean (see `DESIGN_SHARING.md`).

The research confirmed this is unclaimed territory: no incumbent (World Anvil, Kanka, LegendKeeper, Foundry, Roll20) models knowledge as data — they all use access/visibility flags. This is ours to define.

---

## Foundational Principle

> **You don't know *elements*. You know *knowledge*. A piece of knowledge is a narrative that mentions elements — and the text is the knowledge.**

A character does not "know the Character element Aralia" with all her fields. A character knows a specific piece of information — *"a masked woman named Aralia leads the rebellion"* — which *mentions* Aralia. The canonical Aralia record (her true name, stats, secret history) is **not** what is known; only what the knowledge expresses.

Everything below follows from this one principle.

---

## The Model

### A knowledge entry = a Narrative

A piece of knowledge is a **Narrative** with `subtype: "knowledge"` (free-text subtype — no schema change). User-facing name: a **knowledge entry**. It reuses everything Narrative already provides: prose (`story`), element links, base fields. It is authored with the same editor as stories, but lives in the Knowledge room, not the writing room (see *Authoring*).

Knowledge entries are **flat** in v1 — no book/chapter hierarchy. They are surfaced per-knower, not nested.

### Two relationships, never conflated

Around every knowledge entry there are exactly two link roles:

| Role | Meaning | Stored as |
|---|---|---|
| **about** (subjects) | what the knowledge *concerns* | the narrative's `Involves` multi-links (`characters`, `locations`, `objects`, `events`, `constructs`, …) — populated **for free** by the writing editor's @-mentions |
| **held-by** (knowers) | who *holds / knows* it | `narrator` (one Character) · `collectives` (Circles / groups). **Two channels only.** |

The **about** side is the existing mention system: write the entry, @-mention the elements it concerns, and `characters`/`locations`/etc. populate automatically.

The **held-by** side is the knowledge-specific reinterpretation: **for a `knowledge`-subtype narrative**, `narrator` and `collectives` mean *holders*, not their usual story meanings.

### Held-by channels

- **`narrator` (single Character)** — a lone knower. The "one specific NPC knows this secret" case, with no group needed. (`narrator`'s normal meaning is "the character who tells/records the tale" — a teller knows what they tell, so the reinterpretation is natural.)
- **`collectives` (multi Collective)** — the **Circle(s)** holding it; group knowledge, where members inherit. Supports multiple Circles (a fact known by both the party and the city watch).
- *(No separate institution channel.)* An institution that "knows" (a library, a chronicle order, a guild) holds knowledge via a **Circle of its members**, not a dedicated field — a separate conservator/institution channel would just duplicate a Circle. The narrative `conservator` field is left to its normal story meaning. *(Dropped session 234 on review — it added a third concept for no gain.)*

Rule of thumb: **one specific carrier → `narrator`; one-or-more potential carriers → a Circle (`collectives`).** Adding a second individual holder promotes the entry to Circle-held (even "those who know the secret" is a legitimate Circle).

### Knowing is computed, never stored

The knower stores nothing. Knowing is derived by scanning knowledge entries — exactly how atlas already computes reverse-links ("mentioned in"):

> Character **X knows** knowledge entry **K** if `K.narrator == X` **OR** any Collective in `K.collectives` lists **X** in its `characters` (membership inheritance, via `Collective.characters`).

*"What does Ireena know?"* = every knowledge entry whose `narrator` is Ireena, plus every entry whose `collectives` includes a Collective Ireena belongs to.

### Field mapping (the complete picture)

```
Knowledge entry  =  Narrative { subtype: "knowledge" }

  story            → the knowledge itself (prose)
  characters       ┐
  locations        │
  objects          │  ABOUT (subjects) — auto-populated by @-mentions
  events           │
  constructs, …    ┘

  narrator         → HELD-BY: a single Character knower
  collectives      → HELD-BY: Circle(s) — group knowers (members inherit)
```

No new schema fields. No Relation elements. No atlas-local metadata required for the core model. Pointer principle fully preserved (every link is a real OW link field).

---

## Circles

A **Circle** is a knower-group. Under the hood it is a **Collective** — which is conceptually honest: knowledge is always held by *agents*, individually or in groups, and even an institution's knowledge reduces to its members (model that as a Collective with `operator` = the institution). There is no knower that isn't ultimately people, so Collective (a group of physical beings) is the right primitive. We do **not** introduce a new element type, and we do **not** use Construct (the catch-all is unnecessary when Collective fits honestly).

**Circle is a role, not a required type:**
- **Any Collective can hold knowledge** — just list it in a knowledge entry's `collectives`. No special subtype needed to *allow* holding. A cult, a guild's rank-and-file, a noble house — any existing Collective can be a knower.
- **Circles can be created proactively** from the Knowledge room (a deliberate "+ new Circle" creates a Collective, optionally tagged `subtype: "circle"`, without leaving the room — for pre-setting-up a party before it holds anything).
- The optional `subtype: "circle"` marker is **purely organizational** (so empty/new circles surface in the room) — never load-bearing for the mechanic.

Membership and inheritance use `Collective.characters` (verified present in the SDK Collective type, alongside `creatures`, `species`).

---

## What "knowing" means (the disclosure rule)

- **The text is the knowledge.** Knowing an entry means knowing its prose + that the linked elements are *involved*. It does **not** auto-expose any linked element's canonical fields. If the party knows Aralia's birthdate, the DM *writes it into the entry* — nothing is auto-pulled. This is the safe, immersive default: the text can't leak anything you didn't write.
- **Depth / fidelity = separate entries, not link metadata.** The vague rumor and the intimate truth are *different knowledge entries* ("a masked woman leads them" held by the townsfolk; "Aralia, the dethroned heir, leads them" held by the inner circle). Fidelity is expressed by writing different texts held by different Circles. This is why we need **no per-link qualifier** — and therefore **no Relation elements** (their only advantage here was carrying per-link data we don't need).

---

## The Known-View

The signature feature: **see the world as a knower knows it.**

Pick a knower (a Circle or a Character) → the world rendered through their knowledge:
- The set of elements they know *about*, each shown as its **compiled known-view** = the union of the knowledge entries they hold that mention that element (texts + the bare element reference).
- **Never the canonical element record.** A known-view of Aralia is built up from what they've learned, not a redacted copy of her real data.

This is the "wow" moment — *"show me Barovia as the party understands it."* It is also the basis for the future "publish for a Circle" bridge into the Sharing room.

---

## Authoring

Knowledge prose is authored **in the Knowledge room**, reusing the **writing editor *component*** (the same TipTap surface + @-mention + autolink), **not the writing room itself**:

- The **writing room** stays exclusively for tiered *stories* (book/chapter/scene) — knowledge entries never clutter that tree.
- The **Knowledge room** embeds the same editor for knowledge entries. Because it's the same editor, @-mentions auto-populate the **about** links for free.

Shared infrastructure, separate homes. The two narrative *kinds* (story vs knowledge) stay visibly distinct, distinguished by `subtype`. The writing room only handles story-subtype narratives and ignores knowledge ones — so `narrator`'s dual meaning (teller for stories, holder for knowledge) causes no conflict.

---

## The Knowledge Room (UX)

Route: `#/w/<id>/knowledge`. Room-nav icon added to the strip. A middle-pane room, with the right pane reused (no new surface type).

**Layout** (respects atlas's pane semantics — sidebar nav · middle room content · right pane = maps/context only):

- **Sidebar** → the existing elements sidebar **filtered to knowers** (Circles + characters that hold knowledge) for quick selection. Light, no bespoke sidebar.
- **Middle (the room)** → detail + the **known-view**. Pick a knower → the world as they know it. Pick a knowledge entry → edit its text + about-links + held-by. Pick any element → "known by whom, via which entries" (reverse view).
- **Right pane** → the **context graph in a new "knowledge mode"** (a new subject for the tab that already exists — not a new surface). Center on a Circle → its knowledge entries + the elements they touch. Center on an element → who knows about it, via what.

**What you SEE:** your Circles/knowers; each knower's held knowledge; the known-view ("the world as they know it"); the knowledge graph; reverse "who knows about this element."

**What you DO:** create knowledge entries (a draft editor — nothing persists until "create"); write the prose; wire held-by (assign a Character via `narrator`, Circles via `collectives`); add About subjects (a "+ add subject" picker → the matching `Involves` field; collectives excluded as they're holders — @-mention auto-population arrives with K3); create Circles proactively; toggle the known-view to verify what a knower sees; (Phase 2.5) "publish for this Circle" → jump to the Sharing room with a Circle block pre-filled.

**Locked UI ideas (future work):**
- **React to selection** — pick the atlas-selected element (if a knower-capable type) → the room shows what it knows / its Circles.
- **Known-view "lens"** — a toggle that dims/hides everything the knower *doesn't* know — watch the world go dark down to their knowledge. Visceral; great demo.
- **Graph as the wiring tool** — drag a knowledge node onto a Circle node to assign held-by. The graph isn't just display, it's how relationships are built. (Part of the broader emerging direction: graphs as a show/organize/wire surface across rooms.)

---

## Conventions (extends the global list; continues from #66)

- **#67 — Knowledge entry = Narrative `subtype: "knowledge"`.** Flat (no hierarchy). Distinguished from story-narratives by subtype; the writing room ignores knowledge-subtype narratives.
- **#68 — `about` vs `held-by` never share a field.** `about` = the narrative's `Involves` multi-links (auto-populated by mentions). `held-by` = `narrator` (solo Character) + `collectives` (Circles) — **two channels only**. For knowledge-subtype narratives these fields are reinterpreted as *holders*. (No institution/conservator channel — institutions hold via a Circle.)
- **#69 — Knowing is computed, never stored.** Scan knowledge for `narrator == X` or a `collectives` Collective whose `characters` includes X. No reverse-link persisted on the knower.
- **#70 — The text is the knowledge.** No canonical fields are auto-pulled into a known-view; the prose is the disclosure surface.
- **#71 — Fidelity = separate entries, not link metadata.** Different depths of a fact are different knowledge entries held by different Circles. Consequence: no Relation elements, no per-link qualifier fields.
- **#72 — Circle = a Collective acting as a knower (role, not a required type).** Any Collective can hold knowledge; an optional `subtype: "circle"` is organizational only.

---

## Accepted Limitations

- **`collectives` as holder collides with `collectives` as subject.** For a knowledge-subtype narrative, `collectives` reads as *holders* — so knowledge that is *about* a Collective (e.g. "the party knows about a rival adventuring band") can't cleanly mark that band as a *subject* in the same field. Rare (most knowledge is about characters/places/objects/institutions), and you usually know more about the *institution* that defines a group anyway. Workaround: prose, or the `institutions` field. Accepted v1 cost.
- **`narrator` is single-link** — only one lone holder. Two+ individual holders → promote to a Circle. Accepted (slightly artificial, elegant enough).

---

## Relationship to OW Schema (verified, SDK v2.2.2+)

- **Narrative** carries: `story`, base `supertype`/`subtype`; single-links `narrator`/`protagonist`/`antagonist` (Character), `conservator` (Institution), `parent_narrative`; and `Involves` multi-links to all element types (`characters`, `locations`, `collectives`, `constructs`, …). All held-by + about channels exist today.
- **Collective** carries `characters`, `creatures`, `species` (membership — enables inheritance) and `operator` (an Institution — models "an institution's knowledge = its members"). It has **no** `narratives` field → confirms knowledge points at the Collective, knowing is computed.
- **No schema additions required for the v1 model.** A future depth/fidelity feature, if it ever needs per-link data, would be reconsidered then (and would go to council) — but the current model deliberately avoids it.

---

## Build Phases

- **Phase 1 — Knowledge as pure-local worldbuilding** (no API, no sharing): the `knowledge` subtype, the Knowledge room, held-by wiring (`narrator` + `collectives`), the computed known-view, the knowledge graph mode. Ships standalone value. Syncs through the existing engine like any narrative/collective (these are plain OW elements + standard fields). *(K1+K2+K4-core built session 234.)*
- **Phase 1.5 — Cross-surfacing**: a normal element's detail view surfaces "known by: [circles]" (the knowledge dimension wherever you look at an element).
- **Phase 2.5 — The sharing bridge**: "publish for this Circle" auto-derives a Reference page from a Circle's compiled knowledge (see `DESIGN_SHARING.md`).
- **Later**: depth/fidelity refinements, graduated map reveal (which pins a Circle knows), live reveal-by-group.

---

## What Knowledge Is NOT

- Not a visibility/permission flag system — it's modeled *content* (what is known), not access control.
- Not per-field redaction — the unit of disclosure is the *entry*, and its text contains only what's known.
- Not auto-generated — knowledge is *authored* for facts that matter, never an exhaustive pairwise "who-knows-whom" web. (Knowledge is per-fact, with many holders and many subjects — so there is no N² explosion.)
- Not a Relation graph — fidelity lives in the text, so no per-link relation objects.
