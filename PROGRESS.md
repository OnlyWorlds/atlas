# Atlas — Progress Log

Operational state. Architecture: **DESIGN.md** is the index (since S366), with the conventions in `DESIGN_LAWS.md`, the folder in `DESIGN_FOLDER.md`, sync in `DESIGN_SYNC.md`, the shell in `DESIGN_SHELL.md`, fields in `ATLAS_FIELDS.md`; per-room design in `DESIGN_{MAPS,ZONES,WRITING,KNOWLEDGE,SHARING,HOME,IMPORT,CHARTS,TOUR}.md`; the doc-system map lives in **README.md** ("Notes decide, DESIGN docs hold"). Sync lessons in **SYNC_NOTES.md**. Sharing contracts: **`SHARING_CONTRACT.md`** + **`SHARING_CF_DELIVERY.md`**. Superseded docs live in `docs-archive/` (incl. session history `PROGRESS-history.md`).

---

## CURRENT STATE (2026-10-17, SESSION 422: **1.51.5 COMMITTED, with Boss to fly** (a click on an element's page, in Settings, on the right pane's tabs and on the sync pill's badges survives a redraw; gates: typecheck 0 + **2946 vitest, exit 0** + **517 e2e, PLAYWRIGHT_EXIT=0, 517 passed, 0 flaky**; carries the 0.3.8 stamp `15a6a8a`); **1.51.4 LIVE** (Boss h11 #6379); S421's block is the newest entry in `docs-archive/PROGRESS-history.md`)

- **The census's rows 3 to 5** (conv. 146, `Forge/Notes/2026-10-17-s421-rerender-census.md`): one helper, `renderGate()` (`src/ui/render-gate.ts`, parts by identity, 3 vitest), rows 1 and 2 moved onto it. The element page keys the slices it and its builders read (never `sync`), the route, the tour's switches and the two pending edit requests (`pendingInlineNameEdit`, `pendingCustomFieldEdit`). Settings keys the markup it would write plus the world entry its handlers capture, and redraws on `atlas:waypoints-changed` (the old redraws had been carrying the waypoint count; a full run's flake found it). The right pane's tab bar keys its tabs as drawn; the sync pill writes its inside only on a change and binds its badges then (a badge rebuilt mid-click gave the click to the pill, which refreshed).
- **Guards** (`front-door.spec`): the element page, a settings tab, a right pane tab, the conflict badge (the click's target), the waypoint count; each red 3 of 3 with its fix stashed, all 72 of 72 under six workers. `clickAcrossRerender` now follows the press with a hashchange AND a `sync` patch, waits for its target to sit still (the strip's opening settle slides the rooms left by design), then scrolls it into view. Two false reds on the way were the guard's: a press off-screen, and a route to the folder's world id (Atlas registers its own).

- ⚡ **NEXT**: (0) Boss flies 1.51.5. (1) The census's rows 6 to 9 (elements filter strip, writing tree, map index, timeline), the same shape, and a listener for every outside source a keyed surface draws. (2) When v1 goes (the Captain's Q7, not ruled): Make online signed out moves to sign-in only (h29 #5947). (3) #350, the ruling's second half, on its talk.

---

Earlier session entries (S253 to S376, newest first, moved verbatim 2026-10-05, with the July `BANKED / TODO` standing queue that sat among them) are at the bottom of `docs-archive/PROGRESS-history.md`.
