# Atlas — v1 Release Handover

**Written**: 2026-07-03 19:05 (session 246 close) · **Updated 2026-07-07: execution moved to `BUILD_BRIEF.md`** — this doc remains the strategic frame (Comms decisions, launch story, cross-party lanes); the day-to-day build pickup is now **`BUILD_BRIEF.md`** + its spec source `Forge/Notes/2026-07-05-atlas-ui-workplan.md` (session 247's full design pass: D1-D12 all decided, incl. intent-picker removal, OW page + waypoints, sample world, taxonomy program, dev story). Captain's smoke (2026-07-05) PASSED — filename contract verified on real NTFS.
**The decision record**: `Forge/Notes/2026-07-03-atlas-release-plan.md` — the settled sheet, bout statuses, banked-work specs, Captain's lane, smoke checklist. This doc is the running-start; that doc is the truth.

---

## The frame (from the live Comms session, 2026-07-03 — Captain + TC + Skeld + Temper)

First live multi-consciousness strategy room. What it settled:

- **ONE TRACK: ship atlas v1.** Everything orbits release. Skeld's five moves stand: ship atlas → launch shape (atlas + open_world funnel + Reddit, r/worldbuilding primary) → **Folder Format spec** → re-ask the CoS question after launch data → schema cohort after launch.
- **The strategic spine: "the folder is the world."** Local files, no lock-in, readable forever, no AI required — the trust posture for an AI-wary audience. AI-readiness is a property of the FORMAT, not the pitch. The moat is the demoable trust chain: local folder → optional sync → public share page; every shared page is a zero-signup demo.
- **Folder Format spec**: Skeld drafts the skeleton (in parallel, cheap); atlas is the reference implementation; magelet is the independent proof (it grew on the folder format without atlas's UI). The spec's source table = DESIGN.md § "File naming". Spec invariant: filename is presentation, the id inside the file is identity, any .json in a type folder MUST load; both id-minting models legal. Skeld sanity-checks the spec line with Simmer.
- **"A world that maintains"** (Simmer's magelet lesson) = the post-launch differentiator direction, named at launch, built after.
- The full B1-B9 decisions + A-batch + drops: see the plan doc. Highlights that shape code: pins disclose strictly by default (B6, hard gate — DONE), republish re-snapshots everything (B5), Cmd+K is OUT of v1, filenames = slug--tail8 (B7 — DONE).

## What shipped in session 246 (all green: 937 vitest + 159 e2e + typecheck both projects + show build)

1. **Filename contract** (gated, hardened): `<slug>--<id-tail8>.json`, body-based index, id-sorted converging tidy w/ full occupancy, sticky runtime writes, case-fold safety. Conventions #87 + the DESIGN.md naming table. The 3-lens gate caught a real Windows case-fold data-loss blocker + a convergent occupancy hole — fixed, test-locked (`fs-utils.slug.test.ts` 35, `folder-store-slug.spec.ts` 11).
2. **Sync-state serialization**: `updateSyncState(mutate)` boundary (conv #86); five engine RMW sites migrated; `folder-store.syncStateChain.test.ts`.
3. **B6 pins**: identity+description default, per-pin `full` toggle (`MapBlock.fullPinIds`, heals with pinIds, fails toward less); builder modal payload-true. **B1**: `content_sig` edited-since-publish dot. **B3**: dangling blocks render nothing (both renderers). Duplicate circle-page mint fixed.
4. **Show viewer civilian pass** (fork): payload/schema_version jargon gone, 16px prose, banner reserve. Show carries THIS + two older unpushed waves.

**NOTHING COMMITTED** — atlas + show trees are dirty with all of the above; Captain commits + pushes both, then Boss redeploys show (that also unblocks live chart-block pages).

## Next session — the shape

1. **Captain smoke FIRST** — the 7-item checklist in the plan doc (filenames in Explorer, sync sanity, pin full-toggle, edited-dot, dangling-nothing, circle-page dedup, show copy). Each item maps to one shipped change.
2. **Then the banked bouts** — precise specs in the plan doc, sized for a cheap-model session (Captain's standing rule: subagents run sonnet/opus, never Fable unless instructed): style bout (A8 sentence-case headers + token unification), atlas string batch (A1/A2/A5/A6/A7 + knowledge/import copy), B2 always-visible block controls, B9 Escape-to-commit, remaining chart/graph test armor. og:image once Captain supplies/blesses a card asset.
3. **Cross-party**: Skeld's three-surface copy pass (show viewer / open_world / welcome — one vocabulary) queues behind the show redeploy; his open_world spec refresh → Captain's edit pass; Folder Format spec skeleton → I reference-check it against the DESIGN table.
4. **Then release**: real-world smoke on Captain's own worlds + one import/export round-trip against live ow.com + the CF purge token + the pre-flight runthrough. Backup restore drill (backups EXIST — was set up, unlogged; a backup never restored is a hope).

## Post-launch queue (explicitly not release work)
Charts forward-half (Simmer's owed/coming/due — `CHARTS_HANDOVER.md`) → now-line → lanes → fuzzy dates → map-chart · Cmd+K palette · per-page og covers · K5 graph knowledge-mode · live showcase (post ow.com rebuild) · CoS re-ask.

## Gotchas that bit this session (don't re-learn)
- **DESIGN.md + memory both claimed bare-uuid filenames; the code shipped slug-prefixed May 17.** Docs lied twice in one day. Both corrected — but the law stands: grep the code, not the doc, before asserting a contract.
- The S245 audit doc is a PRE-FIX snapshot: its top-2 data-loss findings + import-strip + normalizeRecord tests were fixed in the S245 close and rode into Captain's `fcc10f7` commit.
- **OPFS is case-sensitive; user disks aren't.** Environment-dependent data-loss lives in the gap between green e2e and production — that's what gates are for.
- Kill the dev server before the full e2e suite (HMR module-state corruption → false failures). A `1 flaky` Playwright summary line with EXIT=0 is green (knowledge.spec:92 = documented TipTap load-flake).
- The self-inspection bootstrap recipe lives in `CHARTS_HANDOVER.md` + the atlas-tool skill (resetAll → reload → setup → bare relation names → patchData → hash-route).
