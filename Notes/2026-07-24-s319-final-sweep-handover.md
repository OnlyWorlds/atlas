# S319 — The final pre-launch sweep (autonomous)

**2026-07-24, evening** · Captain away ~2h picking up Grainne · mandate: "one final, v1.0-readying crack at atlas — full sweep, safe/proven changes only, no major refactors or risky stuff, your discretion. Roll to the end, quench, give me a report + essential smoke checks."

Everything below is **uncommitted** (Captain's hand). Gates at close: **typecheck 0 · 1569 vitest · 273 e2e (count = `--list` = 273, PLAYWRIGHT_EXIT=0) · build clean**. The changelog was deliberately **NOT touched** (see the note at the end).

---

## What shipped (all 7 verified)

The night's target was Captain's own banked post-deploy field-report queue (`Notes/2026-07-24-s317-post-deploy-queue.md`) — his items, deferred so the tour could ship first — plus the owed light-mode own-eyes.

1. **Item 3 — charts rail excludes non-story narratives.** Share pages and knowledge entries are Narratives by TYPE, so they passed the dateable gate and sat in the undated work-queue rail as if they were timeline backlog. `undatedElements()` (`timeline.ts`) now skips `narrativeKindOf(el) !== 'story'`. Story narratives (real chronological material) still appear. **e2e-locked** with a new discrimination test in `work-queue.spec.ts` (page + knowledge excluded, story kept). Verified live: rail dropped from listing them; story narrative + character + zone remain.

2. **Item 2 — the on-map badge is now a LOCATE control.** The `place` glyph on a sidebar row (shown when the element has presence on the active map) was a dead titled span. Click it now pans the open map to the element's pin, or a zone's marker centroid, instead of routing to its room. New pure resolver `src/sidebar/pin-locate.ts` (`locateTargetFor`, 5 unit tests) + a thin `locateOnActiveMap` caller reusing the existing `panMapTabTo`; badge got `cursor:pointer` + hover lift + "Locate on the open map" title. Suppressed during cast-assign. Verified live: badge click intercepts, does NOT navigate to the element.

3. **Item 5 — chart labels write in full.** `LABEL_MAX_CHARS` 24 → 60 in `timeline-view.ts`. The collision engine already sizes each label box to its MEASURED width and drops any that cannot place, so a long name claims its real space or is hidden — never cut mid-word. 60 is now a sanity bound against a paragraph-as-name, not a display budget. Verified live: "Moistened Valley Massacre" (25 chars) renders whole.

4. **Light mode — 3 signature bugs closed (sanctioned scrim-token fix, dark mode byte-identical).** A read-only agent scanned the whole stylesheet for the dark-bg-literal + themed-text signature:
   - **`.atlas-select` (`atlas.css` ~921)** — every dropdown app-wide. The S315 light round grepped `background: rgba(0,0,0,X)` and MISSED this `background-color` LONGHAND form, so every select stayed dark-tinted in light. → `rgba(var(--atlas-scrim-rgb), 0.3)`. Verified live: clean white card.
   - **`.atlas-zones-dropdown-panel`** + **`.atlas-zone-chip-context`** (maps room, `rgba(10,10,10,0.96)`) → scrim. Verified live via computed style: panel bg now `rgba(255,255,255,0.96)`.
   - The agent also **confirmed knowledge / share / charts room chrome are CLEAN** in light — the charts card is a correctly-repinned dark island, not a bug. (These were the owed-own-eyes surfaces from S315; cleared.)

5. **Item 1B — line zone label anchors at midpoint.** `labelAnchorFor` (`ZoneOverlay.ts`) used the bounding-box bottom for lines, drifting the label far under the lowest endpoint. Lines now anchor at their midpoint (`lineMidAnchor`, already existed) always; polygons keep below/centroid. Verified live: "The Kings Road" label sits at the line.

6. **Item 1D — a visible "Delete zone" button.** The generic element trash already deleted zones, but it reads "Delete element" in the header and is easy to miss on a map-centric type (Captain: "no visible way to delete a zone"). Added a labeled danger-pill in the zone detail's Markers header (beside "Edit shape"), routing through the SAME `decideDeleteConfirm` decision as the trash — so the S310 confirm-FLOOR fires and names the markers. Verified live: confirm read "This will also remove 4 dependent elements…", zone + 4 markers cascade-deleted, landed on the elements list.

7. **Item 1A — line drawing no longer splices mid-line.** The ZD5 shape-preserving insert (`zone-drawing.ts`) spliced a new point into the middle of the array whenever a click landed near an earlier segment — sensible for polygons, but it made **line** points come out wrong-ordered (Captain's report). The insert block is now gated `active.mode === 'polygon'`; lines always append. **Provably scoped**: polygons still hit the splice (mode unchanged, polygon e2e green), only lines change. Code-verified; NOT interactively re-drawn (the change is a no-op for polygons and a naive-correct append for lines).

---

## Deferred / banked (with reasons)

- **1C — extend an existing line (continue adding points).** No append-beyond-endpoint gesture exists anywhere; edit mode only inserts on interior segments. This is a real new feature (new gesture + hit-handling + order logic), MED–HIGH risk. **Deferred post-launch** per the no-risky mandate.
- **Item 4 — page delete vs published object.** The MAIN path (`share-room.ts deletePage`) **already revokes-first and does not orphan** (verified: confirms naming the URL → `client.revoke(slug)` before local delete → aborts on non-404 failure). My earlier lean was already implemented. The only gap is cascade/direct-`/element/<pageId>`-URL edges, which delete a page without revoking → an orphaned server row against the 20-page quota. Unlikely for pages (they rarely carry `parent_narrative` or inbound links), and touching the shared `deleteElement`/cascade path the night before launch is risky. **Banked, post-launch:** extract `revokeIfPublished(el)` (the `share-room.ts` revoke logic) and call it from any `deleteElement` path before it tombstones an `isPageNarrative` element, and for each page in a cascade's dependent set.

---

## The changelog decision (needs Captain's nod)

I did **NOT** add changelog entries for any of tonight's fixes, and left `changelog.data.ts` untouched. Reasoning: the v1.0 block is your curated launch narrative, and these are **pre-launch polish to v1.0 itself** — users never saw a truncated label or a dark-in-light dropdown in a shipped version, so they aren't "changes since v1.0." Folding them silently into v1.0 is the honest framing. If you'd rather any of them be visible entries, say which and I'll add them (each is one entry, same-commit).

## Provenance

Three read-only background agents ran the breadth while I hand-built: a light-mode signature scan (found the 3 above), a fresh-eyes launch-blocker read of all four primary user paths (**verdict: CLEAN, no blocker** — traced against source), and a zone/page deep-dig (mapped items 1 + 4). No agent edited anything.

## Snapshots
`Notes/ui-snapshots/2026-07-24-s319-sweep/` (charts full labels · light settings/select · light map + line-label · zone detail with Delete zone).
