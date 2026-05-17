# Phase 3.5 — Local-first Polish + Sync Controls

**Status**: ACTIVE (started session 201, 2026-05-13)
**Predecessor**: Phase 3 — api flows shipped session 200, single-bout smoke (BOUT_I) was deferred to end of 3.5.
**Goal**: every flow on the world-management map works end-to-end, settings has a proper home, then one mega smoke.

This brief is archived (with done-marker) once all bouts ship and smoke passes.

---

## Why 3.5 exists

Phase 3 shipped link / make-online / autosave / sync pill. Captain + Temper did a sanity check session 201 against the complete picture and found gaps:

1. **No pull mechanism after initial download.** Once linked, you never see edits made elsewhere unless you re-link.
2. **No "Unlink from API" UI** (though `detachApi()` exists in the registry).
3. **No "stay offline" UI** (engine has `pause()`/`resume()` but nothing calls them).
4. **Route 2 merge is one-directional** — pushes local-only up, but doesn't pull server-only down. Violates the folder-first invariant ("every Atlas world is fully represented in local files, full stop").
5. **No conflict review UI.** Conflicts log to disk but are invisible.
6. **No server-delete handling.** If someone deletes an element on onlyworlds.com, Atlas doesn't notice.
7. **Settings panel is two flat sections.** Doesn't scale to the new options.
8. **No "+ new api world" shortcut.** Users have to create local first, then make online.
9. **PIN change doesn't re-attach engine.** Stale credentials used until world switch.
10. **No last-sync timestamp visible.**
11. **Pagination ceiling on initial download** has no warning UX.

Together these are not 3.5-as-polish — they're foundational to "this tool can be trusted with my world."

---

## Decisions locked (session 201)

1. **Conflict review: per-element, not transactional.** One conflicting element doesn't block the rest. Pending count visible on pill → click → modal with per-row actions: `skip` / `overwrite-mine` / `pull-theirs`.
2. **Local representation invariant**: every world Atlas knows about is fully represented in local files, regardless of origin. Route 2 merge gets a download phase added.
3. **Default pull = manual only.** Local-first stance. Auto-pull is opt-in.
4. **Auto-pull options**: `off` (default) / `1m` / `5m` / `15m` / `1h` / `6h` / `1d`. Plus a separate `Pull on activate` toggle (= when you click the world in sidebar).
5. **Auto-pull pauses on `visibilitychange:hidden`.** No requests against unfocused tabs.
6. **On Route 2 name+type match, server's id wins** for both policies. Local file re-saved with server's id. Reason: api world existed first; cleaner than duplicate-id ghosts.
7. **Sync settings are global** in Phase 3.5 (cadence, default conflict policy, confirm-before-local-delete). The only per-world override is the "stay offline" toggle. Per-world cadence/policy overrides → defer to 3.6 if needed.
8. **Stay-offline per-world** persists in `WorldRegistryEntry.sync_paused?: boolean`. Survives reloads.
9. **Global "pause all sync"** kills cadence AND debounced pushes for every engine. Single kill switch in settings.
10. **PIN change in settings**: detach + re-attach active engine with new creds. No confirmation dialog.
11. **+ new api world shortcut**: modal asks name + email + pin, creates local then immediately runs Route 1. No need to create local separately.
12. **PIN verification**: skip auto-verify. Add "Test connection" button per api-linked world in World settings tab — fires `client.worlds.get()` with current pin + that world's api_key.
13. **Conflict policy choices** (revised mid-3.5): two policies only — `local-wins` (default) and `pause-and-review`. Symmetric across push + pull. Legacy values (`drain-blind`, `pause-on-conflict`, `ask`) migrated on registry load. The third `ask` policy was redundant with `pause-on-conflict` and dropped. Rationale: the previous three-policy model conflated "what happens to data" with "how loudly user is notified" — `drain-blind` already-resolved conflicts but ALSO fired a modal whose actions were no-ops. Cleaner: each policy fully decides both data behavior + notification surface.
14. **Server-delete handling**: pull detects "element gone from server, was synced before, no local tombstone". Setting (default ON): "Confirm before deleting locally to match server deletes." If user opts to KEEP a server-deleted element: flip its `server_updated_at` to undefined → next push CREATEs it back server-side.
15. **Sidebar world widget**: hover-reveal mini-actions (offline toggle, refresh) to keep resting state clean. Settings is canonical surface; widget is shortcuts.
16. **JSON stays as element format.** YAML deferred.

---

## Complete flow map (Phase 3.5 deliverable scope)

| # | Flow | Status |
|---|---|---|
| **Creation** | | |
| W1 | Create local-only world | ✅ live (pre-3.5) |
| W2 | Link existing api world (download all) | ✅ live (pre-3.5) |
| W3 | Make online → create new api world (Route 1) | ✅ live (pre-3.5) |
| W4 | Make online → merge into existing api world (Route 2) | 🟡 needs bidirectional fix |
| W5 | + new api world (shortcut) | ❌ NEW |
| **Edit & sync** | | |
| W6 | Edit api-linked, autosave debounced push | ✅ live (pre-3.5) |
| W7 | Manual save button | 🟢 backlog (not in 3.5) |
| **Pull / refresh** | | |
| W8 | Pull on world activate (setting, default off) | ❌ NEW |
| W9 | Periodic auto-pull while active (setting + scheduler, default off) | ❌ NEW |
| W10 | Manual "Refresh from API" button | ❌ NEW |
| W10b | Visibility-aware pause/resume of auto-pull | ❌ NEW |
| **Offline / pause** | | |
| W11 | Per-world "stay offline" toggle (persists in registry) | ❌ NEW |
| W12 | Global "pause all sync" master switch | ❌ NEW |
| W13 | Resume → flush queued pushes | partial (engine has it, UI doesn't) |
| W14 | Auto-pause on `navigator.onLine === false`, resume on `online` event | ❌ NEW |
| **Conflicts** | | |
| W15 | Push-conflict per-element skip (`pause-on-conflict` policy) | ✅ live (pre-3.5) |
| W16 | Conflict review modal (per-row skip / overwrite-mine / pull-theirs) | ❌ NEW |
| W17 | Server-deleted element review modal | ❌ NEW |
| W18 | Per-world conflict policy selector (settings) | ❌ NEW |
| **World management** | | |
| W19 | Rename, favorite, parent, delete world | ✅ live (pre-3.5) |
| W20 | Unlink from API (api-linked → local-only) | ❌ NEW |
| W21 | Forget world (registry-only) | ✅ live (pre-3.5) |
| W22 | "Test connection" button per api-linked world | ❌ NEW |
| **Settings (redesign)** | | |
| W23 | PIN/email/atlas root | ✅ live (pre-3.5, moves into Identity tab) |
| W24 | PIN change re-attaches engine | ❌ FIX |
| W25 | Pagination ceiling warning on initial download | ❌ NEW |
| W26 | Last-synced-at display on pill | ❌ NEW |

---

## Settings page (target layout)

Tab rail on left, content on right. Tabs:

```
[identity]    pin, email
[atlas]       atlas root folder + change root
[sync]        global pause-all toggle
              default conflict policy (drain-blind / pause-on-conflict / ask)
              pull on activate (toggle)
              auto-refresh cadence (off / 1m / 5m / 15m / 1h / 6h / 1d)
              confirm before deleting locally to match server deletes (toggle, on by default)
[world]       (only shown when a world is active)
              name (rename)
              state (read-only label)
              api credentials (read-only for now)
              ─ if api-linked ─
                stay offline (toggle, per-world)
                refresh from api (button)
                test connection (button)
                unlink from api (button + confirm)
              ─ if local-only ─
                make online (button)
              ─ both ─
                delete world (forget, folder preserved)
[about]       version, github link, atlas docs
```

Mobile/narrow consideration: tabs stack vertically below 600px. (Out of 3.5 scope to verify — Chromium-only desktop tool.)

---

## Sidebar world widget — hover actions

Resting state stays clean:
- ⭐ favorite (always shown if favorite)
- ☁ cloud icon if api-linked (always)

Hover reveals (api-linked only):
- ⏸ stay-offline toggle (filled if paused)
- ↻ refresh from api

Click any → that action fires inline on the active world (or activates first if not active). Tooltip on hover.

---

## Bout list

Each bout = backend + UI + tests + PROGRESS.md update + commit. Vertical slices.

### Bout J — Refresh from API plumbing

**Adds**: `SyncEngine.pullNow()` public method (wraps `pullPhase()` with state management); "Refresh from API" button on sync pill (right-click? or always-visible?); "Pull on activate" registry setting (`registry.sync_pull_on_activate: boolean`); when an api-linked world activates AND setting is on AND not paused → call `pullNow()`.

**Tests**: vitest for `pullNow()`; playwright for pill click → pull fires.

**Done when**: clicking the pill while active world is api-linked + online triggers a visible pull; verified server-side change appears in local.

### Bout K — Periodic auto-pull + visibility

**Adds**: `registry.sync_cadence_ms: number | null`; module-level scheduler that polls every N ms, calls `getCurrentSyncEngine()?.pullNow()`, scoped to currently-active world only; `visibilitychange` listener pauses/resumes scheduler; `online`/`offline` window events auto-pause/resume the active engine.

**Tests**: vitest for scheduler timing; playwright for visibility transitions.

**Done when**: cadence setting actually triggers pulls; hidden tab doesn't poll.

### Bout L — Bidirectional Route 2 merge

**Modify**: `mergeLocalIntoApi` adds a server-only download phase. For each server element with no name+type match against local, download it via `applyServerRecord`. For matched elements where local wins (policy b), local content goes up AND local file's id is rewritten to server's id. For matched elements where server wins (policy c), pull server's full record down (overwrites local content + adopts server's id).

**Tests**: vitest cases for: server-only download, matched-policy-b id-swap, matched-policy-c full pull, mixed scenario.

**Done when**: after Route 2 merge with either policy, local folder contains every element that exists on either side; ids are consistent (server-side ids preserved on matches).

### Bout M — Settings tabbed redesign

**Adds**: new `tabs` array driving the panel; tab-button row; per-tab render functions; route `#/settings/:tab` (default `identity`); move existing fields into the right tabs.

**Tests**: playwright for tab switching, deep linking to `#/settings/sync`.

**Done when**: every existing setting still works; new shell ready to absorb new sync settings.

### Bout N — Pause + unlink + PIN re-attach

**Adds**:
- `WorldRegistryEntry.sync_paused: boolean` field; registry helper `setSyncPaused(reg, worldId, paused)`.
- `registry.sync_pause_all: boolean`; helper `setSyncPauseAll(reg, paused)`.
- `attachSyncEngine` checks both flags at attach time, starts engine in paused state if either is true.
- Sidebar widget hover-actions for per-world toggle.
- Settings → World tab: `stay offline` toggle, `unlink from api` button (calls `detachApi` + detach engine + confirms first), `test connection` button.
- Settings → Sync tab: `pause all sync` toggle.
- PIN/api_key change in Settings → Identity: if active world is api-linked, detach + immediately re-attach with new creds.

**Tests**: vitest for registry helpers, sync-attach respecting flags; playwright for toggle flow + unlink flow + PIN re-attach.

**Done when**: per-world pause survives reload; unlink leaves folder + drops engine; PIN edit re-attaches without world switch.

### Bout O — Conflict review modal + `ask` policy wiring

**Adds**: Pending-conflict badge on sync pill (count derived from `state.sync.activeSync` + sync-state.json conflicts); click → modal listing conflicts with per-element rows (id, type, name, conflict fields, three buttons: skip / overwrite-mine / pull-theirs). Each action calls the engine's resolution helper (new API: `engine.resolveConflict(id, action)`). `ask` policy stops pushing the moment a conflict is detected on that element; conflict review modal is the only way to clear them.

**Tests**: vitest for resolution helpers (`overwrite-mine` re-pushes local; `pull-theirs` overwrites local + stamps; `skip` clears the conflict without touching either side); playwright for modal interaction.

**Done when**: drain-blind shows pending count as info; pause-on-conflict surfaces them as actionable; ask blocks until reviewed.

### Bout P — Server-delete handling

**Adds**: Pull phase detects "server element gone, local exists, server_updated_at present, no local tombstone" → records as a "server-deleted" event in sync-state.json. Setting (default on): "Confirm before deleting locally." On next world activation (or refresh), if there are pending server-delete events, modal opens listing them with per-row actions: `delete locally` / `keep + re-push`. "Keep" flips local's `server_updated_at` to undefined.

**Tests**: vitest for detection + resolution; playwright for the confirm modal.

**Done when**: deleting on onlyworlds.com web propagates to atlas after pull; user can selectively keep elements.

### Bout Q — Polish + shortcuts

**Adds**:
- `+ new api world` sidebar button (modal: name + email + pin → create local + Route 1, single flow).
- Last-synced-at timestamp on pill hover (tooltip: "synced 3 min ago").
- Pagination ceiling warning: if any single type returns >= 200 elements (SDK page size), surface a toast at the end of initial download or merge.
- Map upload warning indicator: after Make-Online, any map without `image_url` gets a warning chip on its row in the map index.

**Tests**: playwright for the shortcut; vitest for pagination warning trigger.

**Done when**: every gap from the session-201 critical pass has a UI surface.

### Bout R — Mega smoke + cutover

**Replaces**: BOUT_I_SMOKE.md → BOUT_R_SMOKE.md covering every flow above with click-by-click checklists. Captain-driven session. Force-push to GitHub main, archive `atlas-deprecated/`, redeploy.

---

## Risk / unknowns

- **`onlyworlds.com` rate limit on `Test connection`** — unknown ceiling. Mitigation: button is manual; no auto-fire.
- **Periodic auto-pull conflict with autosave debounce** — if cadence triggers a pull mid-edit-burst, the pre-update GET in push will detect server moved and... what? In drain-blind, local wins, fine. In pause-on-conflict, that user's pending edit is blocked. Acceptable trade — that's what the policy means.
- **Visibility API quirks across Chromium versions** — should test against Chrome stable + Edge. Probably fine.
- **Element id-swap on Route 2 policy (b) match** — risk: a pin or relation that referenced the local element's old id now points at a non-existent local id. **Mitigation**: when swapping ids, scan all elements for foreign-key references to the old id and rewrite them. Adds complexity; flagged here so we don't forget.
- **Tombstone confusion if user "keeps" a server-deleted element** — re-push CREATEs with the local id; server might still have the old id around in references. Worth thinking about during Bout P.

---

## Done criteria for the whole phase

- All 26 flows in the map work end-to-end.
- Settings has 5 tabs, all functional.
- BOUT_R_SMOKE.md exists; Captain has run it; cutover happened.
- Vitest + playwright count rose by ~50 tests minimum (across bouts).
- DESIGN.md updated with new conventions.
- PROGRESS.md tracks per-bout state.
- `project_atlas.md` memory updated post-cutover.

---

*Written 2026-05-13, session 201 start.*
