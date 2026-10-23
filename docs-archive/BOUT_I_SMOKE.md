# Bout I — Smoke Test Plan (SUPERSEDED by Phase 3.5)

> **NOTE (2026-05-13)**: This smoke plan was written at the end of Phase 3 (session 200).
> The session-201 critical review surfaced enough additional flows (pull, unlink, conflict
> review, server-delete, settings redesign, etc.) that we deferred BOUT_I and rolled smoke
> into a single mega-pass at the end of Phase 3.5. See `PHASE3.5_BRIEF.md` for the
> active scope. A successor `BOUT_R_SMOKE.md` will be written at the end of 3.5
> covering every flow.

**Status**: superseded — kept as historical reference
**Target world**: `<retired key>` (Captain's messworld on production OW)
**Goal**: surface anything MSW couldn't simulate. Pass this and we cut over.

After all checks pass: see "Cutover" at the bottom.

---

## Pre-flight

Confirm before starting:

- [ ] `npm run dev` is running on port 3045
- [ ] You're in Chromium (the file system access API is Chromium-only)
- [ ] You have your `<retired key>` api_key + pin handy from onlyworlds.com
- [ ] Atlas root is already set up (use the same folder you smoked Phase 2 with)

If anything fails along the way, stop, paste what you saw, and we patch.

---

## Path 1 — Link Existing API World (the easy path)

The "I made a world on onlyworlds.com, suck it down to disk" flow.

- [ ] Sidebar header → `+ link api`
- [ ] Modal opens. PIN should pre-fill if you saved it in settings; otherwise type it.
- [ ] Paste the api_key for `<retired key>`. Leave display name blank (we'll use the server's name).
- [ ] Click `link`
- [ ] Watch the progress box. Should show: "discovering character…" then "downloading N of M elements…" with the count climbing.
- [ ] **Expected**: toast `linked <name> — N elements downloaded`. Modal closes. Sidebar shows the world with a cloud icon + `api` chip. Sync pill bottom-right shows `synced`.
- [ ] Switch to elements mode. Click around — characters, locations, the lot. Verify they look right.
- [ ] Open a few maps if there are any. Pins should appear at the right positions.

**Things to flag**:
- Progress count stalls or jumps weirdly (pagination ceiling?)
- Any toast that says "X elements failed" — the SDK shape probably surprised us. Note the failure messages.
- Elements render but with missing fields → adapter unwrap may have missed a field shape.

---

## Path 2 — Edit + Autosave Roundtrip

This proves the engine actually pushes back. Do this on the world you just linked.

- [ ] Pick any element, edit its description. Save the popover.
- [ ] Sync pill should flip `synced → saving… → synced` within 5-6 seconds (5s debounce).
- [ ] Refresh the page. Re-open the world (silent auto-activate should fire).
- [ ] Open the element again — edit should be persistent locally.
- [ ] Verify on onlyworlds.com that the edit landed server-side too (the real proof).

**Things to flag**:
- Sync pill never moves off `synced` (engine never fired)
- Sync pill goes to `error` (the SDK push response surprised us)
- Server-side check shows the edit didn't land

---

## Path 3 — Make-Online Route 1 (create new api world)

The "I have local stuff, make it online from scratch" flow.

- [ ] Sidebar header → `+ new local`. Name it something disposable like `Smoke Test New World`.
- [ ] Add 2-3 elements (a character, a location, maybe a map). Add a description to one.
- [ ] Open settings (gear icon). Click `make online`.
- [ ] Tab defaults to **create new**. Display name should pre-fill with your world name. Email + pin pre-filled if saved.
- [ ] Submit. Progress flow: `creating world on onlyworlds.com…` → `reading new world id…` → `uploading N of M elements…`.
- [ ] **Expected**: toast `<name> is online — N elements uploaded`. Sidebar entry flips to cloud icon + `api` chip. Pill shows `synced`.
- [ ] Verify on onlyworlds.com: the new world appears in your worlds list with the api_key + elements.

**Things to flag**:
- 400/429 from create-world-external (validate email/pin)
- Push count is right but server says fewer elements landed (per-element silent failures)
- Map without `image_url` upload warning is missing

---

## Path 4 — Make-Online Route 2 (merge into existing)

This is the trickiest path. Do this AFTER Path 3 worked.

- [ ] On onlyworlds.com, take note of an api_key for a DIFFERENT world that has a few elements.
- [ ] In atlas: `+ new local` → name it `Smoke Test Merge`. Add 3 elements:
  - one with a name matching something on the existing api world (will be the duplicate match)
  - two with unique names (will be new)
- [ ] Settings → `make online` → tab `link to existing`.
- [ ] Pick policy **overwrite** (b). Paste the api_key + pin. Submit.
- [ ] Progress: `validating credentials…` → `reading server elements…` → `merging N of M…`.
- [ ] **Expected**: toast like `linked to <name> — 1 updated, 2 created`. Server-side: the matched element's content should now be the local version.

Re-run with policy **skip** (c) on another local world — `0 updated, N created` should be the toast for the unique ones; matched ones get the "skipped" count.

**Things to flag**:
- Policy b doesn't actually overwrite (server kept its version)
- Policy c overwrote anyway
- Counts don't match what you expected

---

## Path 5 — Offline edit + resume

Optional but worth a quick check.

- [ ] On the api-linked world, open DevTools → Network → throttle to "Offline".
- [ ] Edit a field. Save.
- [ ] Pill should show `offline` or stuck `saving…` (the engine catches network errors silently for now — flag if behavior surprises you).
- [ ] Restore network. Sync pill should recover to `synced` after the next push fires.

---

## Path 6 — Delete propagation

Verify deletes actually DELETE on the server.

- [ ] On an api-linked world, pick an element with no dependents. Delete it (header trash icon → confirm).
- [ ] Sync pill should `saving…` briefly.
- [ ] Refresh onlyworlds.com — the element is gone server-side.
- [ ] Also try a CASCADE delete: delete a map that has pins on it. Confirm dialog should say "this will also remove N pins". Verify pins disappear server-side too.

**Things to flag**:
- Element gone locally but still on server (tombstone push failed silently)
- Cascade count in confirm dialog is wrong

---

## Path 7 — Bad credentials path

Quick error-message audit.

- [ ] `+ link api`, paste a bogus api_key (or a real one with wrong pin). Submit.
- [ ] **Expected**: inline error in the modal: "api key or pin invalid" or similar. Modal stays open, form re-enabled.
- [ ] Same for Make-Online Route 2: pop a wrong api_key. Should fail at validation, modal stays open.
- [ ] Make-Online Route 1 with wrong email format or pin: should surface a 400 with the server's message.

**Things to flag**:
- Cryptic error like "API Error 401" instead of "api key or pin invalid"
- Modal closes on error (it should stay open so user can fix)

---

## Path 8 — Multi-world switching

Confirms the engine attach/detach singleton works.

- [ ] You should now have at least two api-linked worlds in the sidebar from earlier paths.
- [ ] Click between them. Each time, the sync pill should switch — the prior engine detaches, the new one attaches.
- [ ] Make an edit in world A. Wait for `synced`. Switch to world B. Edit there. Wait for `synced`. Switch back to A. The edit should still be persisted (folder is truth) and `synced`.

**Things to flag**:
- Sync pill stuck on the previous world's name/state after a switch
- Edits in B somehow trigger pushes on A's engine

---

## Path 9 — Reload after linking

Permission re-prompt UX check.

- [ ] On an api-linked world, hard-refresh the page (Ctrl+F5 to bypass cache).
- [ ] **Expected if Chrome remembers the permission**: world silently auto-activates, sidebar shows it selected, sync pill resumes.
- [ ] **Expected if Chrome does NOT remember**: world appears in the sidebar list but isn't auto-selected. You click it, get a permission prompt, grant, world activates normally.
- [ ] Verify both paths feel acceptable.

**Things to flag**:
- World auto-activates but the engine doesn't (sync pill never recovers)
- Silent activate succeeds but element selection from URL doesn't restore

---

## After all paths pass — Cutover

When everything above looks right, cutover:

1. From `Carrier/Forge/tools/atlas/`:
   - `git remote -v` should already point at the atlas repo (set up session 197).
   - `git status` — confirm working tree clean (commits between bouts).
2. **Force-push**: `git push --force origin main` (overwrites legacy code).
3. Rename `tools/atlas-deprecated/` → archive (or delete — your call).
4. Update `Forge/tools.json`:
   - Atlas status stays `deployed`
   - Update `deployed_url` if it changes
5. Cloudflare Pages will redeploy automatically from main.
6. Update memory `project_atlas.md`: phase 3 shipped, only Phase 3.5 polish remains.

---

## After smoke — Phase 3.5 priorities

Defer-but-track:

1. Conflict review modal (per-field diff + keep-mine/keep-theirs/manual)
2. Pagination on initial download (real worlds may exceed listElements default)
3. "Unlink from API" confirm UX in settings
4. Drag-from-element-list pin drop on map (right-click + create covers the primary case)
5. Worlds sidebar nesting UI (parent_id exists in registry, no UI)
6. Maps location-grouped index sections (legacy had this)

None are blockers — surface them as polish bouts when Captain has time.

---

*Written 2026-05-12, session 200 close.*
