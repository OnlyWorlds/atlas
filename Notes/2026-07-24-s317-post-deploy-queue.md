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

## Flags from the copy pass (Captain to rule, no action taken)

- The chart step (phase b) and deep-time carry **byte-identical deeper flyouts** (the full chart explainer twice) — intentional?
- The objects phases a–d each repeat the same *parent_object* deeper; only phase b's carries the council LINK, the others say "file a motion" without one.
- "dragging him in from the sidebar" (map step copy) — the drag MECHANISM was real, but "both gestures satisfy the pin gate" was WRONG (verified the drag exists, not the gate): the drop path minted an ordinary pin that never satisfied the gate and left the user stuck. Fixed S318 (drop path rides `tourPinBake`), locked by a revert-checked e2e.

## Standing owed (unchanged)

- World-green trade (Skeld recommends keep `#008300`) · og:image + tweaks commit ride the deploy · `tools/show` redeploy (carries zone-labels-below re-lift) · maps light Phase 3 decision · SDK 3.1.0/4 elementColor re-export wake.
