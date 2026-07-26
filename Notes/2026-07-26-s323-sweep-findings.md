# S323 — post-launch sweep findings, as a work order

**Written**: 2026-07-26 12:5x · **Session**: S323 (first atlas session after the spring clean; first sweep since launch)
**Instruments**: a 6-lane read-only Workflow fleet (12 agents, ~1.16M tokens, 0 errors, every lane refute-verified by an opus skeptic) running BEHIND a keeper own-eyes walk of the live app at 1440 / 1024 / 820 / 640 / 390 px, dark and light.
**Verdict counts**: 41 findings, 41 verdicts — 18 CONFIRMED, 22 NARROWED, 1 REFUTED. Narrowed is doing its usual work: a third of the sheet was real-but-overstated.

Screenshots: `Notes/ui-snapshots/2026-07-26-s323/`.

---

## Ground truth first (the queue-verify habit)

- Working tree: **4 files uncommitted** — the S320 tab-bar scrollbar fix + its outcome test + a DESIGN_CHARTS note + the queue file. `master` matches `origin/master`, so **that fix is not on the edge**.
- Gates: typecheck clean, **1581 vitest green** (134 files). PROGRESS CURRENT STATE still reads S319/1569 — stale by one session, not wrong at the time it was written (the drift lane's claim here was REFUTED, correctly: a dated record is not a claim about today).
- Live edge answers 200, RSS feed serves.

---

## A. Data loss and failure surfaces

### A1 — Prose is silently discarded when you leave the writing ROOM inside the save debounce window
**CONFIRMED by the fleet at HIGH; then keeper-reproduced live and NARROWED to its true scope.**

The mechanism (`src/middle/writing-workspace.ts`): `scheduleSave` parks the text in `pendingSnapshot`, but `persistSnapshot` re-derives its target from the CURRENT url —

```ts
const el = getActiveNarrative();      // reads window.location.hash
if (!el || el.id !== mountedForId) return;   // line 345 — silent
```

and `flushPendingSave` (289-297) nulls `pendingSnapshot` BEFORE awaiting that call. A bail is therefore permanent: the text is gone from the editor, from state and from disk, with no toast and no console line.

**What I reproduced** (real typing, real clicks, real OPFS read): clicking the home room button inside the window lost ` ROOMSWITCH CANARY` from disk, from `state.data`, and from the editor on return.

**CORRECTION — my first narrowing was wrong, and the revert-check caught it.** I initially reported that switching to another chapter inside the writing tree was SAFE, having driven it by hand and found the text on disk. It is not safe: under the reverted guard the automated regression test fails on that route too, loudly. My manual run was a **false negative produced by my own instrument's latency** — each Playwright MCP round trip costs a second or two, and I burned more than the 6s debounce window locating the tree row before clicking it, so the timer had already fired and saved. The gesture never happened inside the window at all.

Both routes lost text. Both branches of the guard were live:
- **room exit** → the route carries no `narrativeId`, `getActiveNarrative()` returns null, the `!el` branch drops the write;
- **tree switch** → the route already names the NEW narrative, so `el.id !== mountedForId` drops it.

The lesson for the log: a hand-driven repro through a laggy instrument cannot establish a NEGATIVE about a timing window. Only the fast deterministic harness can, and it is the revert-check that made it speak.

**Exposure**: unset debounce falls back to 1000ms (`getSaveDebounceMs`, line 268-272). Note the discrepancy worth checking during the fix: `settings-storage.ts:153-155` *displays* 5000ms as the default for the same setting, so a user who has saved that panel may be carrying a 5-second loss window.

**Fix**: capture the narrative id at `scheduleSave` time and pass it through — `persistSnapshot(id, snap)` writing via `folder.updateElement(id, patch)`. The write is then addressed to the element the text came from and the route is irrelevant. Any retained guard must await or re-arm, never return.

**Test shape**: the regression test must be the room-exit gesture, not the tree-switch gesture — a test built on the route that already works would pass against the unfixed code. Revert-check it.

### A2 — A transient `NotFoundError` while opening a world deletes its registry entry and saved handle
CONFIRMED / MED. Needs a keeper read before acting: the question is whether the catch can distinguish "folder genuinely gone" from "transient", and what the honest fallback is. Do not fix blind.

### A3 — A folder I/O throw in the sync meta step wedges the pill at "Saving…" for the session
NARROWED / MED, and precisely: after the meta step's network GET succeeds, a throw at `sync-engine.ts:718, 719, 734, 737, 762, 815` escapes without the idle-restore that the push and pull phases each have. This is the S308 class (`runPushOnly` had no try/catch where `runPullOnly` did) in a third location. Mirror the existing pattern; revert-check.

### A4 (LOW) A failed dependents probe turns a cascading delete into an unconfirmed one. The confirm FLOOR from S310 has a hole in it when the probe throws.
### A5 (LOW) Settings "test connection" gives PIN advice for a revoked key.

---

## B. Light mode — three surfaces shipped broken

Light mode went out with knowledge and share never own-eyed. **I walked both today: they are clean.** The prediction was wrong and the token system held. The real damage is elsewhere.

### B1 — Map pin labels and tooltips are white-on-white
CONFIRMED / HIGH. `atlas.css:3218-3247`: background is `rgba(var(--atlas-scrim-rgb), 0.7)` — which flips to WHITE under light — while the text stays a literal `color: #fff`. Every pin label and every hover tooltip on the primary map is unreadable in light mode. Fix with the ink triplet, never a fresh literal (a new literal re-opens the class).

### B2 — The share room's pin detail modal
CONFIRMED / HIGH. `atlas.css:10740-10784`: the container is a literal `rgba(16,16,16,0.97)` while its description and close button use theme tokens that resolve DARK in light. Near-invisible text and an invisible × on a modal a user can only escape by finding that ×. Fix by re-pinning it as a deliberate dark island, the way the tour root is pinned.

### B3 — The share PREVIEW renders the wrong artifact under light mode (keeper-found, verified four ways)
`share-page-render.ts:843` writes `view.dataset.mode = theme.mode ?? 'dark'`, but the stylesheet has **no `[data-mode='dark']` rule at all** — dark was implicit, inherited free from a shell that was always dark. The comment at `atlas.css:11094` still asserts the old premise: "the surrounding shell stays atlas-dark".

Measured on a dark-mode page under the light theme: background `rgba(0, 0, 0, 0)`, ink `#1c1b18`. Meanwhile `tools/show` renders that same payload correctly dark on its own dark body (`show/src/styles.css:50-70`). So the **payload-true visitor preview shows a different artifact than the one that publishes** — and payload-truth is the preview's whole stated contract.

Fix: pin `[data-mode='dark']` explicitly. Cheap, contained, and it closes a contract hole rather than a pixel.

### B4 — ~24 literal `color: #fff` on active/hover/selected states
NARROWED / MED. The persistent (non-hover) ones are the ones that matter and the verifier named them: `.atlas-chart-focus-pill` (12119), `.atlas-chart-type-chip.active` (12102). Sweep by the grep-able signature, fix with the sanctioned token.

### B5 (MED) Unsupported-browser landing heading unreadable in light. ### B6 (MED) Demo view h1 + Leaflet zoom controls break in light. ### B7 (LOW) decorative literal-black borders.

**Not a bug** (NARROWED to nothing): the family colours baked at module load are a documented Phase-0 trade and their consumers are mostly dark islands.

---

## C. The narrow-window layer — one cause under three symptoms

This is the design decision of the sheet, and it wants Captain's call before I build.

**Measured**: the shell has a hard floor of `180 + 280 + 240` = **~706px** of min-width, and `atlas.css` contains exactly **three media queries in ~14,800 lines** — at 1599px (tour dock padding), 560px (import columns), 360px (context lists). None of them touch the shell. `html, body { overflow: hidden }` removes every scroll escape hatch, so overflowed content is not awkward, it is **unreachable**.

What that produces, all verified by measurement:

- **768px tablet**: the three panes need 818px. ~50px of the right pane is painted outside the shell and clipped.
- **640px**: the entire right pane is off-screen. `scrollWidth === clientWidth`, so there is no scrollbar and no affordance. It is simply gone.
- **390px phone**: the tour collapse we banked on 2026-07-25. **It is not a tour bug.** It is this, at its worst width.
- **1280px laptop, no narrow window needed at all**: dragging the middle divider right past ~61% makes the shell exceed the viewport (`app-shell.ts:152-160` clamps in fractions while the right pane clamps in pixels), pushing the map's right-anchored pin trash and zones dropdown off-screen. The ratio is persisted, so the broken state survives reload, and the only recovery is a reset-layout icon the user has no reason to connect to a missing trash can.

**Two fixes, different sizes:**

- **C1 (one-line, do regardless)** — the element-detail header clips its own controls. `.atlas-middle-header > * { flex-shrink: 0 }` inside `overflow: hidden`, and the name has no `min-width: 0` / ellipsis. A ~55-character element name at 15px semibold pushes delete, the sync dot and +pin past a clipped edge at 1280 and below. The same header class serves four rooms (element, knowledge ×3 sites, share ×2). Give the name the treatment the writing crumb bar already has.
- **C2 (small)** — clamp the dividers against measured pixels, not fractions, and re-clamp on window resize. Note the two handlers already disagree with each other (0.85 vs 0.88, `app-shell.ts:148` vs `:158`).
- **C3 (large, needs the call)** — one shell breakpoint at ~1100px that lifts the right pane out of the flex row into an overlay toggled from the tab bar. That single move recovers the 1024 half-screen, the 768 tablet, and removes the min-width arithmetic; a second at ~820 collapses the sidebar to a rail. Below ~700 an honest "atlas needs a wider window" panel beats a silently clipped shell.

**The e2e suite cannot see any of this**: 273 specs at exactly one viewport width. Any narrow work needs an own-eyes gate, not a spec. (Confirmed by the fleet, and it is the S321 phone lesson restated: the tour suite is green at 390px on a screen a human cannot read.)

---

## D. Weight — one absurd win, one setting

- **D1 (CONFIRMED / MED, best ratio on the sheet)**: `owlogo.png` ships at **4748×4748px, 426KB**, to render a **15×15px** footer icon. Resize it.
- **D2 (NARROWED / LOW)**: `og.png` (103KB, crawler-only) is precached by the service worker via workbox `globPatterns: '**/*.png'`, not via `includeAssets`. One `globIgnores` entry.
- **D3 (NARROWED / LOW)**: the SW install pulls ~6.49MB, of which 3.93MB is the unsubsetted icon font. This is background and buys the documented offline behaviour, so it does not "defeat code splitting" as first claimed — but the font is still the banked highest-leverage fix, and it should go to Kael first as a possible Assembly card since every tool of ours using that icon set pays the same tax.
- **D4 (CONFIRMED / LOW)**: main entry chunk 958KB uncompressed. Noted, not urgent (283KB gzip).

---

## E. Copy that makes claims the code does not keep

The class that has bitten this codebase repeatedly. All verified against source.

- **E1 (CONFIRMED / MED)** The landing tells Chrome users they need Chrome — **every phone visitor sees it**, because the gate is capability-based and a mobile Chrome has no folder API. Ties directly into C.
- **E2 (CONFIRMED / MED)** The demo page advertises a web of linked elements; its payload contains **zero links**.
- **E3 (NARROWED / MED)** After the tour on a non-folder browser the landing offers no forward action: one de-emphasised ghost "replay", a stale folder note, and an outbound sigil link.
- **E4 (NARROWED / LOW)** The tour's closing sentence sends the finisher to "each room's help icon in the footer" — on a screen (`atlas-preroot`) that hides the sidebar and its footer entirely. Hits any finisher without a root.
- **E5 (CONFIRMED / LOW)** Publish hint says "Settings → World"; that tab wears the world's own name. **(NARROWED / LOW)** A toast says "Settings → Editing"; the tab has been called Elements since 2026-07-19.
- **E6 (CONFIRMED / LOW)** **Em-dashes in user-visible copy, including the social-card alt text that is the first thing a stranger sees.** Voice law; sweep it.
- **E7 (CONFIRMED / LOW)** The changelog ships styling and a filter mechanism for a toolbar it never renders.
- **E8 (NARROWED / LOW)** Settings tells non-folder browsers their worlds "live in browser storage"; the only browser-storage world any code path creates is the tour's throwaway.

---

## F. Docs and drift

- **F1 (NARROWED / MED, and the narrowing made it worse not better)**: three live docs (`DESIGN_ZONES.md:160,510`, `SYNC_NOTES.md:355,560`, `DESIGN_IMPORT.md:184`) name the adapter by its dead v1 identity — but the real drift is **semantic**: they state a v1 rule (all `atlas_*` extension fields stripped on write) that v2 does not follow. A future session building on that sentence would build wrong.
- **F2 (NARROWED / LOW)** `DESIGN_IMPORT.md` cites `src/import/ref-resolve.ts`, which does not exist; the logic lives in `src/import/reconcile.ts:189`.
- **F3** PROGRESS CURRENT STATE is one session stale (S319 / 1569 vitest; today is 1581).
- **F4 (NARROWED / LOW)** `show/render.ts` never renders `PayloadChartNode.label/endLabel` — not doc drift (DESIGN.md already says "parsed and carried"), just a dead-but-harmless payload field.

---

## Upheld — ground the fleet attacked and could not break

Worth recording so no future session re-verifies it: the knowledge and share rooms under light (keeper own-eyes), the disclosure token rules in the payload builder, the per-id write chain on every body writer except `resetSyncBaseline`, the confirm floor on cascading deletes except the probe-throw edge, and the tour's capability gating on OPFS-only browsers.

---

## What I would sequence, if it were mine to sequence

1. **A1 + B3** — the two contract holes. Silent data loss, and a preview that shows the wrong artifact.
2. **C1 + C2 + D1 + E6** — the cheap true things: one-line header clamp, pixel divider clamp, a 426KB logo for a 15px icon, the em-dash sweep.
3. **B1 + B2 + B4-B7** — light mode finished properly, own-eyes gated.
4. **C3** — the narrow-window layer, if Captain wants it. This is the one that changes what atlas IS on a phone, and it is the honest answer to the banked tour collapse.
5. **A2 + A3**, then the copy batch **E1-E5, E7-E8**, then docs **F1-F3**.

Every user-visible item lands a changelog entry in the same commit as its fix.

---

# WHAT SHIPPED, AND THE SMOKE CHECKLIST

**Session close, 2026-07-26.** Gates: typecheck 0 · **1595 vitest** · **285 e2e** (count = `--list` = 285, `PLAYWRIGHT_EXIT=0`, quiet machine) · `npm run build` clean · changelog regenerated (v1.1, 12 entries). **UNCOMMITTED**, and the diff also carries the four S320 files that were never committed, so the tab-bar scrollbar fix rides out with this.

## The smoke checklist

Numbered to mirror each change. The e2e covers regression; this covers feel.

### Data, the ones that matter
1. **Writing room, leave mid-typing.** Open a narrative, type a few words, and within a second click another ROOM in the top bar. Come back. **The words are there.** Repeat by clicking a different chapter in the writing tree instead. (This was silent data loss with no undo.)
2. **Delete an element with children** (a Book with chapters). The confirm still names what dies in your own tier words. Nothing changed here; I only closed a hole where a failed check skipped the confirm entirely.

### Light mode
3. Settings → General → Appearance → **Light**. Then open a **map with pins**: pin labels and hover tooltips are dark chips with white text, readable. (They were white on white.)
4. Still in light: **Pages room** → open a page → **preview**. The page renders DARK, the way a visitor gets it. Toggle the app back to dark: the page looks identical. (The preview used to show a different artifact than the one that publishes.)
5. Still in light: skim the **Charts** room. The plot island stays dark with white labels, the chips around it read dark-on-light. Then the **knowledge** and **share** rooms, which I swept and believe are clean.

### The narrow window (new)
6. **Drag your browser window narrower.** Around 1100px the right pane leaves the row and a panel icon appears at the right of the room-nav strip. Click it: the pane slides over with a dimmed backdrop. Escape, or a click on the dimmed area, closes it.
7. Keep going, below ~820px. A second icon appears at the LEFT of the strip for the sidebar. Only one drawer opens at a time.
8. **Widen back to full screen.** Everything returns to three columns and both icons disappear. Nothing should look different from this morning at desktop width.
9. **Take the tour in a narrow window** (or a phone, at atlas.onlyworlds.com once deployed). The narrator panel now grows to fit its text and scrolls; the sentence no longer prints on top of the step notes.

### Layout and headers
10. Give an element a **very long name**. The header shortens it with an ellipsis and the delete / sync / pin controls stay reachable. (They used to be clipped off the edge.)
11. **Drag the middle divider as far right as it goes** on a 1280-ish window. The right pane keeps its minimum and stays on screen; the map's pin-trash and zone controls remain reachable. Reload: still fine.

### Copy and first contact
12. **Settings → Storage** and the landing note on a non-Chromium browser now say "desktop Chromium". If you can, load atlas on your **phone**: the landing offers the tour and an example page rather than telling you to get the browser you are using.
13. Landing → **see an example page** works (it appears for non-folder browsers, and after you have finished the tour).
14. **Changelog** (Settings → General → the link): v1.1 is on top with twelve entries.

### Weight
15. Nothing to look at, but the OnlyWorlds mark is now 68KB instead of 426KB and the social card no longer downloads on first visit. First load should feel the same or slightly quicker.

## What to watch for, honestly

- The narrow layer is **new code on the shell**, the most load-bearing surface in the tool. It is inert above 1100px by construction and the desktop dock measured byte-identical, but if anything looks off at your normal width, that is the first suspect and it reverts cleanly (one CSS block, one module, two lines in `room-nav.ts`, one line in `app.ts`).
- With a drawer open the room-nav toggles sit behind the scrim by design: dismiss first, then open the other. Discovered by a test timing out on that click, which is the design answering back.
- The **rename input** inside the element header is narrow (189px) for a long name. Pre-existing, not touched, worth a look if it annoys you.

## Left undone, deliberately

- **`revokeIfPublished`** (cascade/direct-URL page deletes can orphan a published page) — banked since S319, still banked; it touches the shared cascade path.
- **Icon-font subsetting**, 3.9MB for ~60-80 glyphs. Still the highest-leverage single fix available. Should go to Kael first: every tool of ours using the same set pays the same tax, so it may want to be an Assembly card rather than an atlas patch.
- **Re-cutting the demo payload with real links** rather than rewording its intro. That needs source data, and inventing links into a no-invention world is the one thing I will not do to make a sentence true.
- The **localStorage registry** eviction risk on iOS. Desktop-safe; a hard blocker for any mobile build, and it belongs to the mobile roadmap.
