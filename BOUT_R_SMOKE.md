
- [ ] Chromium browser (FS Access API is Chromium-only) // yes and should we add, like deprecated atlas, a screen when not on chrome/edge that explains this? so firefox users know whatsup


 

 
 
 
---

---

## Path 2 — `+ link api` (download existing api world)

The "I made a world on onlyworlds.com, suck it down" flow.

- [ ] Sidebar → `+ link api`
- [ ] Paste api_key for `5474990854`. Leave display name blank.
- [ ] Submit
- [ ] Progress box: `discovering character…` → `downloading N of M elements…`
- [ ] **Expected**: toast `linked <name> — N elements downloaded`. Sync pill flips to `synced`.
- [ ] Browse around — characters, locations, maps. Verify content.
- [ ] DevTools console: any pagination warning? (`pagination cap hit on TYPE: server has X, page returned Y`) — note if so.

**Flag if**:
- Pagination warning fires (we may need to wire load-more before cutover).
- Elements render with missing fields → adapter unwrap missed a shape.
- Sync pill stuck on saving or never goes to synced.

---

## Path 3 — `+ new api` shortcut (sidebar one-step)

New 3.5 shortcut: skips the "create local then make-online" two-step.

- [ ] Sidebar → `+ new api`
- [ ] Enter name `Smoke New API`, email, pin
- [ ] Submit → progress: `creating local folder` → `creating api world` → `fetching new world id`
- [ ] **Expected**: toast `Smoke New API created online`. Sidebar entry has cloud icon.
- [ ] Verify on onlyworlds.com: the world appears in the account's list with an api_key

**Flag if**:
- Local folder is created but api world isn't (orphaned local).
- Sync pill stuck on starting state.

---

## Path 4 — Make online → create new (Route 1 from settings)

Same as Path 3 but starts from an existing local world.

- [ ] Create a fresh `+ new local` named `Pre-online`. Add 2-3 elements.
- [ ] Open settings → World tab → `make online`
- [ ] Tab defaults to `create new`. Display name pre-filled with world name.
- [ ] Submit → progress: `creating world` → `reading new world id` → `uploading N of M elements`
- [ ] **Expected**: toast `<name> is online — N elements uploaded`. Sidebar entry flips to cloud.
- [ ] Verify on onlyworlds.com: the new world has those elements.

---

## Path 5 — Make online → link existing (Route 2 bidirectional)

The trickiest path. **Critical for 3.5 — bidirectional merge.**

- [ ] On onlyworlds.com, note an api_key for a world that has 2-3 elements (different from `5474990854`).
- [ ] In atlas: `+ new local` → `Smoke Merge`. Add 3 elements:
  - One with a name matching an element on that existing api world (duplicate by name).
  - Two with unique names.
- [ ] Settings → World tab → `make online` → `link to existing`
- [ ] **Policy b (overwrite)**: paste api_key + pin, submit.
- [ ] Progress: `validating` → `reading server elements` → `merging N of M`
- [ ] **Expected**: toast like `linked to <name> — 1 updated, 2 pushed, X downloaded`. The X downloaded should be the server-only elements (the ones you didn't have locally).
- [ ] Browse the linked world in atlas — verify both your pushed elements AND the server's original elements are present locally.
- [ ] Verify on onlyworlds.com: matched element has your content, your unique elements appear, server-original elements unchanged.

Then re-run with Policy c (skip) on another fresh local world:
- [ ] Match expects `0 updated, N pushed, X skipped, Y downloaded`
- [ ] The matched element on local should now have SERVER's content (you've "merged toward server")

**Flag if**:
- Local folder is missing any server element after merge (violates the local-rep invariant).
- Matched local element's id didn't swap to server's id (check JSON of local file).
- Duplicate ids exist after merge.

---

## Path 6 — Edit + autosave roundtrip

Verify pushes still work after Phase 3.5.

- [ ] Pick any element in the linked `5474990854` world, edit its description.
- [ ] Sync pill: `synced → saving… → synced` within 5-6s.
- [ ] Refresh page; world auto-activates from URL.
- [ ] Re-open the element — edit is persistent.
- [ ] Verify on onlyworlds.com: edit landed server-side.

---

## Path 7 — Manual refresh (3.5 NEW)

- [ ] On the linked `5474990854` world: hover the sync pill — refresh icon appears.
- [ ] Click the pill — toast `already up to date` (since you're in sync).
- [ ] Edit something on onlyworlds.com web app (a description, anything).
- [ ] In atlas, click pill again — toast `pulled 0 new + 1 updated`. The element's content refreshes on screen.

**Flag if**: refresh doesn't fire OR doesn't reflect the server-side edit.

---

## Path 8 — Pull on activate setting

- [ ] Settings → Sync tab → toggle `pull from api when a world activates` ON
- [ ] Edit something on onlyworlds.com web app for a world you have linked
- [ ] In atlas: switch to a different world, then back to the edited one
- [ ] **Expected**: pill goes through `synced → fetching → synced`. The edit appears.

---

## Path 9 — Auto-refresh cadence (3.5 NEW)

- [ ] Settings → Sync tab → set cadence to `every 1 min` (test mode)
- [ ] Edit on onlyworlds.com web app
- [ ] Wait ~1 minute. Watch the pill — should see `fetching` flash, then update appear.
- [ ] Tab into another browser tab (hide atlas). Make another edit on web. Wait 1 min.
- [ ] Tab back to atlas — the change should appear shortly (visibility resume + tick).
- [ ] Set cadence back to `off`.

**Flag if**: cadence keeps firing when tab is hidden.

---

## Path 10 — Stay offline (per-world)

- [ ] Settings → World tab → check `stay offline` for the linked world
- [ ] Pill changes to `paused — local edits queued` (warm-tinted dot)
- [ ] Edit a field. Edit is saved locally but no network request (check DevTools)
- [ ] Sidebar row should show the pause icon (visible without hover when paused)
- [ ] Uncheck `stay offline` — pill goes to `saving → synced`; the queued edit pushes.

---

## Path 11 — Global pause-all

- [ ] Settings → Sync tab → check `pause all sync (master kill switch)`
- [ ] Every api-linked world's engine pauses. Pill shows `paused`.
- [ ] Edits to any api-linked world stay local. No network requests.
- [ ] Uncheck → resumes for whichever world is active.

---

## Path 12 — Sidebar hover icons (3.5 NEW)

- [ ] Hover an api-linked world row in the sidebar
- [ ] Pause (or play, if paused) icon + refresh icon appear inline
- [ ] Click the pause icon → toggles offline; toast confirms
- [ ] Click refresh icon → pulls from api (toast indicates result)
- [ ] Local-only rows do NOT show these icons.

---

## Path 13 — Conflict review (two policies)

The policy lives in Settings → Sync tab → `default conflict policy`. Two values: **`local wins`** (default) and **`pause and review`**. Test BOTH.

### 13a — `local wins` policy (default)

- [ ] Confirm Settings → Sync → policy = `local wins`.
- [ ] On the api-linked world, edit a character's description on web → "server-version".
- [ ] In atlas, edit the SAME field → "atlas-version".
- [ ] Wait 5s for autosave debounce → push fires.
- [ ] **Expected**:
  - Toast: `saved over server change(s) for 1 element`.
  - Pill: `synced` (no badge).
  - Sync-state has NO conflict entry persisted.
  - Server side: now has "atlas-version" (your local won, server overwritten).
- [ ] Now test pull-conflict: edit BOTH sides again to fresh values. Click pill refresh.
- [ ] **Expected**:
  - Toast: `skipped pulling 1 element you also edited locally — your version pushes next sync`.
  - Local stays at your version. Server unchanged at its version.
  - Next autosave (or manual): your version pushed over server.

### 13b — `pause and review` policy

- [ ] Settings → Sync → switch policy to `pause and review`.
- [ ] Edit on web → "server-v2". Edit on atlas → "atlas-v2".
- [ ] Wait 5s → autosave fires.
- [ ] **Expected**:
  - Push is SKIPPED. Pill shows ⚠ badge `1`.
  - Server unchanged at "server-v2" (atlas didn't overwrite this time).
- [ ] Click badge → modal opens with `Admiral Splashworth` row, 1 field diverged: description.
- [ ] Click `pull (theirs wins)` — local file now has "server-v2". Badge clears. Verify on disk.
- [ ] Re-create the conflict. Click `overwrite (mine wins)` — server gets "atlas-v2". Badge clears.
- [ ] Re-create the conflict. Close modal without picking — badge STAYS (decide-later). Re-open works.

### 13c — Pull-time conflict under `pause and review`

- [ ] Keep policy as `pause and review`.
- [ ] Edit on web to "fresh-server". Edit on atlas to "fresh-local". DON'T let autosave run (pause atlas, or expect skip).
- [ ] Click pill refresh.
- [ ] **Expected**:
  - Pull SKIPS applying server for that element.
  - ⚠ badge fires with 1.
  - Modal lets you resolve.

**Flag if**: badge appears under `local wins`, OR toast appears under `pause and review`, OR sync-state persists conflicts under `local wins`, OR pull-time conflict isn't badge-surfaced under `pause and review`.

---

## Path 14 — Server-side delete review

- [ ] On onlyworlds.com, delete an element from the api-linked world.
- [ ] In atlas, click the pill to refresh.
- [ ] **Expected**: server-delete review modal pops up auto-magically.
  - It lists the deleted element with `delete locally` and `keep + re-push` buttons.
- [ ] Click `delete locally` for one — local file removed; no tombstone written.
- [ ] Click `keep + re-push` for another — local element keeps its content; next push re-creates it on server. Verify on web app.

Optional: Settings → Sync tab → uncheck `confirm before deleting locally to match server deletes`. Delete another server-side element. Refresh from atlas. The modal should NOT auto-open. The element's local file should still be removed automatically (Phase 3.6 polish — actually currently still records to sync-state but does not auto-delete; verify behavior matches expectations).

---

## Path 15 — Unlink from api

- [ ] Settings → World tab on an api-linked world → `unlink from api`
- [ ] Confirm the dialog
- [ ] Sidebar row's cloud icon becomes folder icon; pill says `local`
- [ ] Edit fields locally; no network requests (DevTools verify)
- [ ] Verify on onlyworlds.com: the api world still exists there (not deleted server-side).
- [ ] In atlas, re-link via `+ link api` with the same api_key — initial download brings everything back.

---

## Path 16 — Test connection (settings)

- [ ] On an api-linked world: Settings → World tab → `test connection`
- [ ] **Expected**: toast `connected — <world name>`
- [ ] Change PIN in identity tab to wrong value. Click `test connection` again.
- [ ] **Expected**: toast `api key or pin invalid`. Engine should re-attach with the new pin automatically (look at the pill transition).

---

## Path 17 — PIN re-attach

- [ ] On an api-linked world (pill says `synced`).
- [ ] Identity tab → change pin to the correct one. Blur the field.
- [ ] **Expected**: pill momentarily transitions (re-attach), then back to `synced`.
- [ ] Edit a field — autosave should still work with the new pin.

---

## Path 18 — Bad creds path

- [ ] Sidebar → `+ link api`. Paste a bogus api_key (or right key, wrong pin).
- [ ] **Expected**: inline error in modal: "api key or pin invalid". Modal stays open.
- [ ] Same for `+ new api` with a wrong-format email → 400 surfaces in modal.

---

## Path 19 — Settings deep-link

- [ ] Navigate manually to `#/settings/sync` — settings opens on the sync tab.
- [ ] Navigate to `#/w/<id>/settings/world` (where `<id>` is a real world id) — world tab opens for that world.
- [ ] Click tabs and watch URL change.

---

## Path 20 — Reload + auto-activate

- [ ] On an api-linked world, hard-refresh (Ctrl+F5).
- [ ] World auto-activates from URL (if chrome remembers FS permission).
- [ ] Pill resumes; engine state survives.
- [ ] If chrome doesn't auto-grant: row appears but isn't active. Click row → permission prompt → activate.

---

## Path 21 — Multi-world switching

- [ ] Switch between two api-linked worlds.
- [ ] Each time: pill flips correctly, sync engine detaches/re-attaches.
- [ ] Edit in world A — wait for synced. Switch to world B. Edit there. Wait for synced. Back to A — A's edit is still there + still synced.

---

## After all paths pass — Cutover

When everything looks right:

1. From `C:/Users/Titus/Carrier/Forge/tools/atlas/`:
   - `git status` — confirm working tree (commits between bouts).
   - `git remote -v` should still point at the atlas repo.
2. **Force-push**: `git push --force origin main` (overwrites previous build).
3. Cloudflare Pages auto-redeploys.
4. Update `Forge/tools.json`:
   - Atlas status stays `deployed`.
   - Note 3.5 milestone in description.
5. Update memory `project_atlas.md`: phase 3.5 shipped.
6. Archive `PHASE3.5_BRIEF.md` (mark as shipped at top).

---

## Backlog (after smoke — phase 3.6 candidates)

Items deferred from 3.5:

1. **Manual save toggle** — autosave-only today.
2. **Per-world conflict policy overrides** — global only today.
3. **Pagination beyond first page** — single-page only; warning logs in console.
4. **Conflict review for `ask` policy** — auto-open on conflict detection (vs badge-click).
5. **Drag-from-element-list pin drop** — right-click + create covers primary case.
6. **Worlds sidebar nesting UI** — parent_id exists in registry, no UI yet.
7. **Maps location-grouped index sections** — legacy had this.
8. **Map upload warning** — visual indicator for maps without `image_url` after make-online.
9. **"Last synced X min ago"** prominent on pill (currently in title attribute).

None are blockers — surface as polish bouts when Captain has time.

---

*Written 2026-05-13, session 201 close. Phase 3.5 bouts J–Q feature-complete.*
