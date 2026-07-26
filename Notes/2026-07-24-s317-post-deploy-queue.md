# Post-deploy queue — banked from the S317 tour finish-line session

**Written**: 2026-07-24 15:40 · **Updated**: 2026-07-24 (S318: item 6 SHIPPED — field-edit safety + description in header; commit-on-outside-click shape, unit-locked. Charts set-now default also shipped in S318 as part of the tour push.) · Captain's non-tour items from the S317 round, deferred so the tour could ship first. Each line re-verified against his words; strike lines as they land.

## Captain's banked items

**S319 (2026-07-24 evening autonomous sweep) landed 2, 3, 5 and most of 1. Full record: `Notes/2026-07-24-s319-final-sweep-handover.md`.**

1. **Zone LINE editing suite** — SPLIT and mostly DONE:
   - ~~line placement buggy / wrong-ordered~~ **DONE S319 (1A)**: ZD5 shape-preserving insert gated to polygon-only; lines always append in draw order.
   - ~~line LABEL too far below~~ **DONE S319 (1B)**: line labels anchor at midpoint (`lineMidAnchor`), not bbox-bottom.
   - ~~no visible way to DELETE a zone~~ **DONE S319 (1D)**: labeled "Delete zone" pill in the zone detail Markers header, routing through the cascade-aware confirm.
   - **EXTEND an existing line (1C) — DEFERRED post-launch**: a real new gesture/feature (no append-beyond-endpoint path exists), MED–HIGH risk, out of the no-risky mandate.
2. ~~**Locate an existing pin**~~ **DONE S319 (2)**: the on-map `place` badge on a sidebar row now pans the open map to the element's pin / zone-marker centroid (`pin-locate.ts` + `panMapTabTo`), instead of routing to its room.
3. ~~**Charts rail** — share PAGES in the undated list~~ **DONE S319 (3)**: `undatedElements()` excludes non-story narratives (pages AND knowledge entries); story narratives still appear. e2e-locked.
4. **Page delete vs published object** — **INVESTIGATED S319, no change tonight.** The main share-room `deletePage` ALREADY revokes-first and does not orphan (verified). Only cascade/direct-URL edges could orphan a published page (unlikely; pages rarely carry parent_narrative/inbound links); touching the shared cascade path pre-launch is risky. **Banked post-launch:** extract `revokeIfPublished(el)` and call it from any `deleteElement` path (and each page in a cascade) before tombstoning a page.
5. ~~**Chart label truncation**~~ **DONE S319 (5)**: `LABEL_MAX_CHARS` 24→60 (sanity bound, not a display budget; the collision engine governs fit). "Moistened Valley Massacre" renders in full.
6. ~~**Field-edit safety (Captain: important)**~~ **SHIPPED S318**: a full outside click (press + release both on the backdrop) COMMITS changed non-empty text exactly like Enter — typed work is never lost to a stray click; unchanged/emptied closes without writing; Escape stays the discard; drag-out does nothing (pointer-pair discipline, shared with modal-base). Field description now renders behind the label in the popover header. Unit-locked (`field-edit-popover.test.ts`); no temp-storage net needed under the commit shape.

## Launch-night polish batch (Captain, 2026-07-24 21:5x — "write down as fixes for a batch later")

Both spotted in the v1.0 launch screenshots. Neither is a defect in behaviour; both are the kind of pixel debt his eye reads immediately. Do them together in one small CSS-level bout.

1. **The word-count pill sits ON TOP of the prose's last line.** `.atlas-writing-workspace-wc-corner` is anchored to the workspace ROOT (deliberately, so it survives scrolling — see writing-workspace.ts step 7), and the prose column scrolls underneath it, so the final visible line renders behind the pill ("...The Felt Exchange opene" in the launch shot). The fix is tail room, not a re-anchor: bottom padding on the scrollable prose body sized to clear the pill (the S312 tour-mode `.atlas-detail` bottom-padding fix is the same shape and the precedent to copy). Check BOTH view modes — compiled and this-level — since they mount different subtrees into the same host.

2. **The sync pill's refresh icon sits a touch too far right.** Cause is a doubled gap, not a margin the eye can't find: `.atlas-sync-pill` is a flex row with `gap: 6px` (atlas.css:3437) and `.atlas-sync-pill-refresh` ALSO carries `margin-left: 4px` (atlas.css:5494), so the icon sits 10px off the label while the state dot sits at 6px. Drop the margin (or set it to 0 and let the gap own the rhythm) and the icon tucks in. One line; verify the `data-state="saving"` variant, where the icon is display:none and the dot pulses instead.

Observed but NOT banked as work (Captain has not called it): the Web graph's labels collide at depth 2 on a busy narrative ("Feltropolis - Level 5: Admini…" over a node; Admiral Fluffington / Pip / Puddle Futures overlapping). Pre-existing, visually tuned, and the depth selector already gives the user a way out.

## Flags from the copy pass (Captain to rule, no action taken)

- The chart step (phase b) and deep-time carry **byte-identical deeper flyouts** (the full chart explainer twice) — intentional?
- The objects phases a–d each repeat the same *parent_object* deeper; only phase b's carries the council LINK, the others say "file a motion" without one.
- "dragging him in from the sidebar" (map step copy) — the drag MECHANISM was real, but "both gestures satisfy the pin gate" was WRONG (verified the drag exists, not the gate): the drop path minted an ordinary pin that never satisfied the gate and left the user stuck. Fixed S318 (drop path rides `tourPinBake`), locked by a revert-checked e2e.

## Standing owed (unchanged)

- World-green trade (Skeld recommends keep `#008300`) · og:image + tweaks commit ride the deploy · `tools/show` redeploy (carries zone-labels-below re-lift) · maps light Phase 3 decision · SDK 3.1.0/4 elementColor re-export wake.

## Banked 2026-07-25 (S321, from the mobile design read) — atlas's own items

Three findings that belong to atlas, not to the mobile project, and are live in v1.0 today.

1. **THE PHONE PATH IS BROKEN, AND WE INVITE PEOPLE ONTO IT.** Verified by emulating a mobile browser (delete `showDirectoryPicker`, 390x780 viewport, `Notes/ui-snapshots/2026-07-25/`). The landing renders WELL on a phone (sigil, honest capability line, one CTA) and offers **"take the tour"**. Step 1 is genuinely phone-shaped, no overflow. Then the tour enters the app shell and **collapses**: at 390px the sentence and the step copy render on top of each other unreadably, the right pane computes to 0px, the middle clips to 280px, and the forward control is gone (only Back / Exit tour). Anyone clicking our links from a phone — including the reddit comment sending people to atlas.onlyworlds.com — can reach this. **Either the landing stops offering the tour on narrow viewports, or the tour's docked narrator gets a narrow-screen layout.** The former is one condition and could ship today; the latter is the real fix.
   - ⚠ **The tour e2e suite is GREEN at 390px (24/24, run with a phone-viewport config).** It maps transitions, and Playwright counts off-screen elements as visible, so the whole collapse is invisible to it. This is the "green suite maps transitions, not surfaces" law in its sharpest form yet: the tests pass on a screen a human cannot read. Any narrow-screen fix needs an OWN-EYES gate, not a spec.
   - Note: `tour.spec.ts:1029` already covers "OPFS-only browser (Safari-shaped): app boots, tour runs, folder door honest" — the capability path is tested; the LAYOUT is not.

2. **The icon font is 3.9 MB, precached, for ~60-80 glyphs.** `material-symbols` ships un-subsetted; the service worker's cache limit was raised to 6 MB specifically to admit it (`vite.config.ts`). With the bundled demo art (`sikelia-map.webp` 1.63 MB + others) that is ~5.7 MB of first-load precache; `dist/` totals 8.2 MB. The JS itself is fine (283 KB gzip). **Every desktop visitor pays this today** and it would be disqualifying on a phone data plan. Subsetting the font to the glyphs actually used is independent of everything else and is probably the highest-leverage single fix available to atlas right now. (Ask Kael first: this may want to be an Assembly card, since any tool of ours using the same icon set pays the same tax.)

3. **The world registry lives in localStorage and holds API credentials** (`atlas_worlds_registry`, plus `atlas_knowledge_draft_<worldId>` for unsaved drafts). Fine on desktop. On iOS, Safari evicts localStorage after ~7 days without a visit, which would take the registry, the credentials and the drafts while leaving the worlds themselves in storage — orphaned and unlistable. Not urgent for desktop atlas; it is a **hard blocker for any mobile use of the same code**, and worth knowing before someone opens atlas on a phone with a real world in it.

Full context for all three: `Forge/Notes/2026-07-25-mobile-design-draft.md` sections 7 and 13.


---

## S323 (2026-07-26) — the first post-launch sweep closed most of this file

1. ~~**THE PHONE PATH IS BROKEN**~~ **DONE**. Root cause was not the tour: the SHELL had a ~706px floor and no responsive layer at all. `src/layout/narrow-layout.ts` turns the side panes into drawers below 1100 / 820px, and the tour dock (fixed-height for desktop no-jitter) now grows and scrolls on the phone tier. Own-eyes at 1440/1024/820/760/640/390; `tests/e2e/narrow-layout.spec.ts` is the suite's first width-aware spec. The landing also stops telling phone visitors on Chrome that they need Chrome, and offers them the example page.
2. **The icon font (3.9 MB)** — STILL OPEN and still the highest-leverage single fix. Take it to Kael first: every tool of ours on the same icon set pays the same tax, so it may want to be an Assembly card. Meanwhile S323 took ~590 KiB off the precache anyway (owlogo 4748px→512px, og.png out of the SW manifest).
3. **The localStorage registry** — unchanged and correctly out of scope here; it belongs to the mobile roadmap. S323 did remove one way to LOSE that registry: a transient `NotFoundError` during world open used to delete the entry and its saved handle on a name-matched guess, and now asks the filesystem first.

**Also closed from the older lists**: item 4's `revokeIfPublished` is STILL banked (untouched, still the right call). The launch-night polish batch is fully done — the word-count pill shipped pre-launch, and the sync-pill refresh icon plus the tab-bar scrollbar ride out with this commit.
