# Atlas — Build Brief (the polish-arc orchestrator handover)

**Created**: 2026-07-07 18:07 (session 247 close) · **Author**: Temper, for build-seat Temper
**This is the pickup for the UI/UX build sessions.** Load order: this file → `Forge/Notes/2026-07-05-atlas-ui-workplan.md` (THE spec source — every ID below resolves there) → `Forge/Notes/2026-07-05-atlas-copy-inventory.md` (exact strings for the copy work). Positioning/post material: `Forge/Notes/2026-07-05-atlas-positioning-research.md`.
**State**: every design decision is CLOSED (Captain's pass + rounds 1-8, 2026-07-05→07). "Aim high, get this nice and complete." Nothing here is speculative — build what the workplan says, judge by screenshot, keep the tree green.

---

## Standing rules (unchanged, non-negotiable)

- **Git is Captain's.** Nothing committed, ever. Both repos may carry his uncommitted state — check `git status` at wake and DON'T be surprised by dirty trees.
- **Test cadence**: per-edit typecheck · per-bout typecheck + full vitest (~3s) + ONLY affected e2e specs · full Playwright ONCE at session close. **Kill the dev server before the full e2e suite** (HMR module-state corruption → false failures). A `1 flaky` summary with EXIT=0 is green (knowledge.spec:92 = documented TipTap load-flake).
- **Self-inspection**: I run the dev server (3045/3046) + Playwright MCP; screenshot judgment at every bout end. Bootstrap recipe: `CHARTS_HANDOVER.md` + atlas-tool skill. Real-density data: inject Moppetopia (the sweep recipe — read files from `Desktop/TESTOWFOLDER/.../atlasmoppetopia-*`, strip api creds, createElement with preserved ids).
- **Work surfaces**: never edit source while live e2e/inspection runs on the same dev server. Agents get file-scoped, non-overlapping domains. **Subagents: sonnet (simple/medium) / opus (complex) — NEVER Fable** (Captain's standing rule).
- **Bout discipline**: each bout ends at green + something pokeable + screenshots for Captain. Checkpoint at pokeable boundaries.
- **Copy rules** (workplan Part 3): one-sentence DO-voice subtitles · no em-dash appositives · no tech-speak (payload/schema/supertype) outside settings/import · no norm-claims · buttons say outcomes · skip-consequences stated.
- **Style canon**: titles white (cyan = interactive accent only) · sentence-case headers (tag-chips ≤10px may stay caps as badges — one decision, applied everywhere) · two-tier header model (conv #80) + the NEW D1 additions below.

## The bout order (sessions are elastic — take bouts in order, stop at green)

### BUILD 1 — mechanics & unification
1. **S9 first** (15 min, trust-critical): `republishPage` honors `patchPage`'s boolean (share-room.ts:1299-1306; parity with `publishPage`'s failure toast). Regression test.
2. **Bout Q — mechanical sweep** (agent-friendly: precise specs, file-scoped): G2 G3 G4/T-G10 G6 G7 G8 **G11** (`scrollbar-gutter: stable` on `.atlas-sidebar-content`, atlas.css:193-197) **G12** (disable+tooltip notes btn when `!active`) ST1 (PIN masking) T-ST2 (v1.0.0 + CHANGELOG.md) T-K10 T-K11 T-S8 IE4 K4 + Part 4: B-strings · B-B2 · B-B9 · B-tail · B-armor. Fleet strategy: 3-4 sonnet agents on non-overlapping file groups, I verify each diff + run gates.
3. **Bout U — unification** (my hands on components, agents on sweeps):
   - MY HANDS: the **room-section tab component** (import's underline+icon pattern, labels **Capitalized**, sized up so they read as main sections — apply to knowledge Entries|Knowers + import Bring in|Take out) · the **drill-in prefix band** (`‹ Knowledge` muted clickable room-name before entity icon+title — knowledge entries/knowers + share pages; element room exempt; prototype → screenshot → Captain judges) · **D9b taxonomy trio**: st/sub autocomplete (datalist from loaded world, derive-not-track) + reserved-value hint (tooltipped icon when value has atlas semantics) + sidebar sub-filter chips (when exactly one type filtered).
   - AGENTS: sentence-case + weight sweep (uppercase-site table in copy inventory — decide badge-exemptions first) · token unification (B-style list) · room-subtitle replacements (suggested lines in copy inventory).
   - Gate: full suite + a 6-room screenshot set for Captain.

### BUILD 2 — the rooms
4. **Bout H — home** (MY page, use frontend-design care; Captain: "letting you have a crack at this page"): cover-page × study-desk hybrid — identity hero (name, description, world image T-H7), woven stat line (kills H2 chips + H3 count grid), **continue strip** (last room/narrative/map), tighter Recent (H5, room-of-edit where free), quicklinks as quiet text-links (H6), kill timeline-mini (H4). **Stretch: D2b favorites** — registry `{protagonist_id, nexus_id}`, assignment icon in element-detail header (char+loc only), cast slot on the cover. G9 (grey vs cyan icons): screenshot both here, Captain picks.
5. **Bout K — knowledge clarity**: entry page → WHO/WHAT/ABOUT zones (D4; K5 K6) · K8 naming unification ("open known world →" both places) · K9 create-circle inline · K1 subtitle.
6. **Bout IE — import/export**: take-out grouped type-list (D6/IE3) · IE4 Save to file + Copy JSON · IE5 bigger growing paste box · IE6 live green/red validation + granular error (surface parsePayload/validate errors, debounced) · IE7 example-JSON link · the D8 AI-migration section (copyable convert-notes prompt + toolkit link).
7. **Bout S — share simplification**: REMOVE intent picker (D5 — `atlas_page_intent` stays in model, hidden; default on create; keep wire compat) · empty-state use-case examples ("a character showcase · a player handout · a world landing page") · S3 full-page preview tab (payload-true renderer → blob/`?preview`) · T-S7 meta collapse (slim summary row: theme swatch · publish state) · embeddable-suggestions row in block picker ("from your world: N circles · N charts · N maps") · S5 rides the show wave (Captain's push).

### BUILD 3 — context & the OW layer
8. **Bout W — writing setup** (WR1-4 + WR5): visual nest (indented Book › Chapter › Scene + floating Draft, inline-editable labels), norm-claim reworded, supertype-speak behind ⓘ, delta-only narratives table, skip-consequence line, tier-label affordance on the writing landing header.
9. **Bout CX — context defaults** (D3): knowledge-list entries-graph (K7) · share-page carded-elements mini-graph (refs mirror) · writing-landing fill · T-CX2 hairball label rules (port charts' label-priority idea) · T-CX3 anchor caption · per-tab empty-state copy.
10. **Bout HELP**: the `?` overlay component (one shape, every room; unify with hotkey reference) + per-room content map (what this room is for, 3-4 "you can…" lines, links; strings in one file). Content voice: Part 3 rules.
11. **Bout OW**: Settings→Account becomes **"OnlyWorlds"** — intro (identity sentence + powered-by), account block (masked PIN), **waypoints v3** (workplan D11c: 10 waypoints, action-hooks at USER-GESTURE call sites only — never data layer; import/demo/sync origins blocked; once-ever OW-styled toast, queued, suppressed during input, first-ever toast carries "optional — see all · turn off"; "mark all as familiar"; quiet "N of 10"), links row (site · tools · AI toolkit · council · spec), **dev corner** (spec · SDK · schema · example world · magelet as reference integration), footer OW icon → routes to the tab.
12. **Bout DEMO**: bundle a trimmed Moppetopia snapshot · "Explore the sample world" (welcome + home) → local-only world via `createWorldFromImportedData` · "make it yours" conversion path. Demo actions must NOT complete waypoints (origin flag).
13. **Bout E** (any session with 30 min headroom): T-E1 dim-empty-rows try → screenshot → judge.

### Then (in Captain's decided order)
14. **Charts sitdown** (design session, Captain + me): D7 agenda — recipes on real worlds, the right-edge label wall, undated story, forward-half (Simmer), mini-chart/starred-chart for home. NO major charts work before this.
15. **Home pass 2** (post-charts): starred chart? protagonist refinement? customizable home = post-v1.
16. **Pipeline smoke** (Captain + me, guided): knowledge → share → publish → live viewer → import round-trip. Chart-block smoke (it EXISTS — S245). Requires show redeploy first.
17. **Pre-flight & release**: real-world smoke on Captain's worlds · import/export round-trip vs live ow.com · LLM context pack + funnel-page dev snippets (Skeld's lane, I review) · og:image (needs Captain's asset) · version → v1.0.0 · the release plan's remaining ground (`Notes/2026-07-03-atlas-release-plan.md`).

## Captain's lane (blocking items only he can do)
- **Push show + atlas** (show carries THREE unpushed waves) → Boss redeploys → unblocks: public theme/republish verification, S5 footer, Skeld's three-surface copy pass, live chart pages.
- CF cache rule + purge token · og card asset · backup restore drill · r/worldbuilding post (strategy + template in the positioning doc — Resource flair, founder voice, GIF of the trust chain, zero AI).

## External threads
- **Skeld**: Folder Format spec skeleton (I reference-check vs DESIGN.md naming table) · API v2 spec — my review lives in `Orrery/keel/api-v2-spec.md` §14 (T1 gap-free cursor + T2 extension passthrough + T3 bulk link-validation flagged blocking; T2 directly gates whether custom fields can ever sync) · three-surface copy pass after show redeploy.
- **Boss**: show redeploy · show open-source call at release (Captain: "makes sense").
- **Simmer**: charts forward-half design input at the charts sitdown.

## Scope honesty (the aim-high ledger)
Round 8 moved INTO v1: taxonomy trio, sample world, OW page + waypoints, favorites-stretch, intent removal, embeddable suggestions. That's roughly +2 sessions vs the pre-pass scope. Nothing blocks the release-critical path (show redeploy → pipeline smoke → pre-flight), but if timing pressure appears, the natural cut line is: OW/DEMO ship in a fast-follow week-one update — Captain's call, flag it at Build 3 open.

## Gotchas (don't re-learn)
- Kill dev server before full e2e (HMR corruption) · heavy vitest/playwright evicts the dev server — restart after.
- OPFS is case-sensitive, user disks aren't — filename-contract tests can't see case-fold on OPFS (already gated, don't touch fs-utils naming without re-running the slug suites).
- Per-folder pub mirrors diverge across browser profiles (S2/V1b) — expected; don't chase it as a bug.
- The intent field: hidden ≠ deleted. Wire still sends a value (default); fakes expect the field.
- Waypoint hooks: USER-GESTURE call sites only. If you find yourself hooking FolderStore, stop.
- `.playwright-mcp` screenshots default to Forge root — always pass full paths under `Notes/ui-snapshots/<date>/`.

## Definition of done for the arc
Every workplan item confirmed/altered is shipped or explicitly re-parked · full suite green (fresh server) · per-room screenshot set for Captain's judgment · PROGRESS.md + memory updated · this file marked superseded.
