# Post-deploy queue — banked from the S317 tour finish-line session

**Written**: 2026-07-24 15:40 · Captain's non-tour items from the S317 round, deferred so the tour could ship first. Each line re-verified against his words; strike lines as they land.

## Captain's banked items

1. **Zone LINE editing suite** — line placement is buggy / wrong-ordered when drawing; the line LABEL sits too far below (bring it closer to the line); need a way to EXTEND an existing line (continue adding points while editing); need a visible way to DELETE a zone (none found in the UI).
2. **Locate an existing pin** — clicking the small right-side pin icon on a sidebar row should find/centre that element's pin on the map.
3. **Charts rail** — share PAGES currently appear in the undated drag-into-view list; exclude them.
4. **Page delete vs published object** — verify what happens to the published server object when its page is deleted locally; then DISCUSS the wanted behaviour (Temper's lean: deleting the page should revoke the publication, never orphan it silently). Investigate before proposing.
5. **Chart label truncation** — e.g. "Moistened Valley Massacre" truncates; write labels in full.
6. **Field-edit safety (Captain: important)** — when a text-field editor holds NON-EMPTY text, click-outside must NOT close it (only close on empty); the text still saves. Captain left the exact shape open to discussion (alternative: save-on-outside-click). Companion: show the FIELD DESCRIPTION in the editor header behind the field name (space exists, would be useful). Consider a cheap catch-most temp-storage net for typed-but-lost text.

## Flags from the copy pass (Captain to rule, no action taken)

- The chart step (phase b) and deep-time carry **byte-identical deeper flyouts** (the full chart explainer twice) — intentional?
- The objects phases a–d each repeat the same *parent_object* deeper; only phase b's carries the council LINK, the others say "file a motion" without one.
- "dragging him in from the sidebar" (map step copy) — VERIFIED real: sidebar rows drag onto maps via `application/x-atlas-element`; both gestures satisfy the pin gate.

## Standing owed (unchanged)

- World-green trade (Skeld recommends keep `#008300`) · og:image + tweaks commit ride the deploy · `tools/show` redeploy (carries zone-labels-below re-lift) · maps light Phase 3 decision · SDK 3.1.0/4 elementColor re-export wake.
