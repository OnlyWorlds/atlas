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

**Tour bouts (roughly in order):**
1. **Tour resilience** ("pop back cheeky"): re-assert baked elements/links idempotently on step-enter — users can mess (unlink, delete), the world heals. The consul pin too. Design: run the reveal/heal pass for all ids ≤ current step on every step-enter.
2. **Hands-on pin drag** — the user places the pin themselves (map interaction beat).
3. **Charts-step redesign** (design round with Captain FIRST): only the right elements visible, drag-from-rail beat, set-world-date beat, possibly a Rachmaninov-composes-Prelude event ~5k years back. TENSION to resolve: we removed his 1873 birth_date because it stretched the axis; a far-past event re-stretches it — maybe that IS the zoom-out lesson. Captain resolves during copy pass.
4. **Progressive-precision audit** (one sweep + a per-stage chrome table for Captain's bless): right-pane top icons, map toolbar staging (zones button appears at the swamps step), sidebar filter icons per step.
5. **Staggered reveals**: multi-element steps pop one at a time, maybe word-then-icon. Polish after structure settles.
6. **Chart-steps dock dodge**: dock narrower / slides aside on chart steps (the sentence's empty right space), pleasant/animated.
7. **Keep-the-world finale option**: quiet affordance beside "Set up a folder" that exports the tour world into the new real folder. Freek was against, Captain mildly for — build SMALL and hidden-away; Finish stays the residue-contract path.
8. **Hide empty element sections during tour** (not collapsed — hidden).

**Share/app bouts:**
9. **Zones on the share map block** (Captain's find — "no zones in share page!").
10. og:image asset.
11. Map ⚙ visual-settings popover restyle (grainy highlight borders → squircle per Freek; panel styleover, e.g. soft "Zones" title) — align with app language.
12. Maps-in-Maps-tab clarity (smaller tabs? collapsible into maps) — design conversation.
13. Drag elements from sidebar (and maybe home recents) onto the map — feature, maps arc.
14. Imageless maps (default size, warn on small image) — design/discussion.

**Standing (pre-existing)**: Crimson Text bundling (if serif blessed) · real-Safari smoke (Mac) · Hyperion share-page URL into the 'online' step extras row (slot is commented in tour-bar.ts) · settings-overlay routing (parked) · browser-storage-worlds project (post-launch).

**Captain's lane**: copy pass over the 17 bodies + "more information" texts (flag sheet: `Notes/2026-07-19-s298-tour-flag-sheet.md`, still valid minus the intro row) · the council motion (vehicle/equipment) · Hyperion share page · commit + Boss redeploy briefing.

**Cross-bay**: ping Skeld with the two new bundle deltas for the frozen demo world (Saurian Pack rename, consul.objects ship) — sent 2026-07-19 in the residue-question reply.

## Traps for the next session

- Step indices shifted (intro cut): e2e speaks `data-tour-step` (1-17); NEVER reintroduce a visible step label without Captain's ask.
- The opener flag in tour-bar.ts is `idx === 0` (no stage-0 step exists anymore; the stage-0 CSS shell-hide rule is dead but harmless).
- The-world step's `meta` text is displaced by the eyebrow/cite at idx 0 — its teaching line lives in the locked create-world modal hint, so nothing is lost; don't "fix" it back.
- Bundle changes re-bake NOTHING automatically — hyperion-world.json is the shipped artifact; keep `_bake_notes` honest.
