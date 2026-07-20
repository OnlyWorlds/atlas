# S298 handover — the Freek round: what shipped, what's queued

**Written**: 2026-07-19 ~22:30 (session close)
**Source**: Captain + Freek's live tour walkthrough (scratch list), bounced back and blessed in-session.
**State at close**: typecheck 0 · 1276/1276 vitest · full e2e 236/236 zero-flaky · production build clean · S296-298 UNCOMMITTED (one pile, Captain's hand).

## Shipped in S298 (all gated)

Round 1 (Captain's share notes): change_seq sync bug killed · share map block live · prose link-to-existing + selection bubble (B/I/link) with alias recording · tour constant-dock + em-dashes + glyph-on-create · landing sigil.
Round 2: eyebrow cut · sigil 240px + landing air · docked-from-start opener · single-route create beats · stage-1 Worlds toggle ghost segment.
Round 3 (the Freek batch):
- Intro step CUT — the tour opens on the create-world beat (17 steps; framing folded into its body; eyebrow + cite live in the meta channel).
- Act/step label removed (step number survives as `data-tour-step`, the e2e contract).
- "deeper" → "more information" · ecosystem-explorer link removed · end-of-tour neutral fill removed (only element words color).
- Sentence bright on the first two steps (`.is-fresh`).
- Create-world button becomes Next when the world already exists (Back-visit case).
- Spans narrowed: *Steinway* only, *saurian* only.
- Bundle: consul.objects gains Ebony Spaceship (balcony implied via parent_object, deliberately unlisted) · collective renamed **Saurian Pack** · 'linking' body matches · `_bake_notes` updated. NOTE: live demo world 0000000000 now DIVERGES on these two (Skeld froze it tonight — he needs a ping to adopt: collective rename + consul.objects ship).
- Pin step gained the **council-motion deeper** (vehicle/equipment field gap) — Captain drafts the real motion during his copy pass.
- Charts control bar: now field + view toggle on ONE line (right group), stacked layout retired.
- Home Recent: verb **Created** for never-edited elements (createElement now stamps `created_at` = `local_updated_at` from one instant; wire-safe, server value wins on pull) · rows sort purely by recency (the pinned Write/Map/Edit picks no longer outrank a brand-new element).

## Queued for tomorrow+ (Captain-blessed, from the Freek list)

**RECONCILED 2026-07-20 (S299 close)** — done items struck, ✅ marks what shipped. Open items carry to the live queue in PROGRESS.md CURRENT STATE.

**Tour bouts (roughly in order):**
1. ✅ **Tour resilience** — DONE S299 (3-lens gated; merge kernel `tour-heal.ts`, `updateElementWith`, heal on step-enter). DESIGN_TOUR v2.4.
2. ✅ **Hands-on pin** — DONE S299, reworked to use the REAL +pin button (highlighted, gated) + app-wide placement feedback (lit icon, map banner, crosshair, Esc). NOT drag (drag-to-map already exists separately; click-via-real-button is the taught flow).
3. **Charts-step redesign** — OPEN, held for Captain (his look first). Tension unchanged (far-past event vs axis stretch).
4. ✅ **Progressive-precision audit** — DONE S299: empty sections hidden in tour, zone chrome staged to the swamps step, Web tab to where-it-lives. Remaining proposals (filter-strip growth, custom-fields hide) in `Notes/2026-07-20-s299-precision-audit.md` for Captain's bless.
5. **Staggered reveals** — OPEN, held (re-measures the dock; wants copy settled first).
6. **Chart-steps dock dodge** — OPEN, held (same; and charts-step redesign lands first).
7. ~~Keep-the-world finale option~~ — CUT (Captain's call S299; residue contract stands).
8. ✅ **Hide empty element sections during tour** — DONE S299 (part of the precision bout).

**Share/app bouts:**
9. ✅ **Zones on the share map block** — DONE S299, with per-zone curation (`MapBlock.zoneIds` include-list mirroring pins) + show re-lift + a11y/NaN guards. DESIGN_SHARING updated.
10. ~~og:image~~ — CUT (Captain: link-preview thumbnail, his to handle / screenshots for the launch post).
11. Map ⚙ visual-settings popover restyle (grainy borders → squircle per Freek; soft "Zones" title) — OPEN, align with app language.
12. Maps-in-Maps-tab clarity (smaller tabs? collapsible) — OPEN, design conversation.
13. ~~Drag elements from sidebar onto the map~~ — already exists (Captain confirmed S299); "home recents → map" is the only enhancement left, minor.
14. Imageless maps (default size, warn on small image) — OPEN, design/discussion.

**Standing (pre-existing)**: Crimson Text bundling (if serif blessed) · real-Safari smoke (Mac) · Hyperion share-page URL into the 'online' step extras row (slot commented in tour-bar.ts) · settings-overlay routing (parked) · browser-storage-worlds project (post-launch).

**Captain's lane**: copy pass over the 17 bodies + "more information" texts (flag sheet: `Notes/2026-07-19-s298-tour-flag-sheet.md`, still valid minus the intro row) · the council motion (vehicle/equipment) · Hyperion share page · commit + Boss redeploy briefing.

**Cross-bay**: ping Skeld with the two new bundle deltas for the frozen demo world (Saurian Pack rename, consul.objects ship) — sent 2026-07-19 in the residue-question reply.

## Traps for the next session

- Step indices shifted (intro cut): e2e speaks `data-tour-step` (1-17); NEVER reintroduce a visible step label without Captain's ask.
- The opener flag in tour-bar.ts is `idx === 0` (no stage-0 step exists anymore; the stage-0 CSS shell-hide rule is dead but harmless).
- The-world step's `meta` text is displaced by the eyebrow/cite at idx 0 — its teaching line lives in the locked create-world modal hint, so nothing is lost; don't "fix" it back.
- Bundle changes re-bake NOTHING automatically — hyperion-world.json is the shipped artifact; keep `_bake_notes` honest.
