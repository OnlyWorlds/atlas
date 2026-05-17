 

    
 
  

## 2.7 — Auth-failure surfaces correctly (Bout T)

- [ ] Make a fresh local world online via Make-Online Route 1 (or pick a disposable test world).
- [ ] On onlyworlds.com web app: **delete that world**.
- [ ] In atlas, make a field edit on any element.
- [ ] **Expected pill**: brief `saving` flash, then **red `error` state** (NOT `synced`). Tooltip says "authentication failed — verify pin in settings, test connection, or unlink".
- [ ] **Expected toast**: "sync paused: authentication failed. verify your pin in settings, or unlink this world if it was deleted on the server."
- [ ] Make a second edit. Pill stays red. **DevTools console**: NO new 401 request fires (the engine is paused; debounce no-ops).
- [ ] Recover via Settings → World → `unlink from api`. Pill goes grey `local`. World stays editable locally.

---

# Tier 3 — Spot-check (heavily tested elsewhere, one line each, ~3 min)

These were hammered in recent sessions (201-204) and locked in by regression tests. Just verify they don't visibly regress.

## 3.1 — Make online: Route 2 (merge into existing)

- [ ] Settings → make online → `link to existing` → policy `b` → 1+ duplicate-by-name + 1+ local-only → submit. **Expected**: toast `linked — N updated, M pushed, X downloaded`. Done.
- [ ] **Bout X check (Route 2)**: if you had a local-only element selected (one that'll get a new server id), or a duplicate-by-name element selected (one that'll swap to server id), the middle pane should still show it post-modal — no `not found` flash. URL silently advances.

## 3.2 — Conflict review (local-wins, the default)

- [ ] Edit same field on web + atlas → autosave → **toast** `saved over server change for 1 element`. No badge. Server has atlas's version.

## 3.3 — Auto-refresh cadence

- [ ] Settings → Sync → cadence `every 1 min`. Edit on web. Wait ~60s. **Expected**: pill flickers fetching, toast `pulled ...`, element refreshes.
- [ ] Tab away + back: cadence countdown stays continuous (no reset on visibility change — Bout W6 fix).

## 3.4 — Per-world stay-offline + global pause

- [ ] Per-world: tested in 2.1. Global: Settings → Sync → `pause all sync (master kill switch)` → all api-linked worlds show `cloud_off`, edits stay local. Unset → resumes for the active world.

## 3.5 — Multi-world switching

- [ ] Switch between two api-linked worlds. Each: pill flips correctly, no cross-contamination (a push triggered in one world doesn't fire on the other).

## 3.6 — Pull-on-activate

- [ ] Settings → Sync → toggle `pull from api when a world activates` ON → edit on web → switch worlds away + back → element refreshes without manual pill click.

---

# Tier 4 — Optional deeper (defer if time short)

Cheap to verify, low blast radius if any fails.

- [ ] **Bad creds**: `+ link api` with wrong pin → inline error `api key or pin invalid` in modal.
- [ ] **Test connection**: Settings → World → `test connection` → toast `connected — <world name>`. Wrong pin → toast `api key or pin invalid`.
- [ ] **PIN re-attach**: change pin in identity → engine re-attaches automatically (pill transitions).
- [ ] **Settings deep-link**: navigate to `#/w/<id>/settings/sync` directly → settings opens on sync tab.
- [ ] **Unlink from api**: Settings → World → `unlink from api` → cloud icon becomes folder, world stays editable locally, web world unchanged.
- [ ] **Multi-tab lock**: open the same world in a second atlas tab → second tab warns about read-only mode.
- [ ] **Toast for pulled changes from auto-cadence** (Bout 7): cadence tick lands updates → toast surfaces (`pulled N updated from api`).
- [ ] **Pin-drag autosave** (Bout 1 fix): drag a pin on api-linked world, wait 5s — verify on web app position synced.


## 2.2 — Pin lifecycle (spatial UX, was missing from old smoke)

- [ ] On an api-linked world: `+ new element` → Map. Use a small image file (under 1 MB).
- [ ] Map tab opens on the right pane. Image renders with edge-color background.
- [ ] **Right-click empty map** → contextual element-create modal → create Character → pin drops at click location.
- [ ] Click pin → element detail loads + selectedElementId migrates.
- [ ] Hover pin → tooltip with name + type + description preview.
- [ ] **Drag pin** to new position → autosave fires within 5s (pill flicks). Reload to confirm position persisted server-side.
- [ ] Delete the map (element-detail header trash icon) → confirm dialog says `this will also remove N pins`.
- [ ] **Expected**: map + pins gone from atlas. Verify on web app: also gone server-side.


## 2.5 — Cascade-delete (cross-bay tested via vitest; quick browser check)

- [ ] Delete a character that has pins on a map.
- [ ] Confirm dialog mentions the pin count.
- [ ] Verify on web app: character + its pins all gone.
- [ ] Verify atlas: pin is no longer rendered on the map.


---

# After all green — Cutover

1. `cd C:/Users/Titus/Carrier/Forge/tools/atlas`
2. `git status` — confirm working tree state. Multiple bouts of unpushed commits ready.
3. `git push --force origin main` — overwrites previous build on the atlas repo.
4. Cloudflare Pages auto-redeploys (~1 min).
5. Update `Forge/tools.json`: atlas stays `deployed`; note 3.5 milestone in description.
6. Update memory `project_atlas.md`: phase 3.5 shipped.
7. Archive `PHASE3.5_BRIEF.md` (mark SHIPPED at top).
8. `/reflect` (session-close).

---

# Backlog (phase 3.6+ candidates)

Deferred from 3.5 — surface as polish bouts when Captain has time. None are blockers.

1. **Manual save toggle** — autosave-only today.
2. **Per-world conflict policy overrides** — global only today.
3. **Full pagination** — first page only; safety guard prevents data loss but `>200 elements/type` worlds don't fully render.
4. **Drag-from-element-list pin drop** — right-click + create covers primary spatial flow.
5. **Worlds sidebar nesting UI** — `parent_id` exists in registry, no UI yet.
6. **Maps location-grouped index sections** — legacy had this; not yet ported.
7. **Map upload warning** — visual indicator for maps lacking `image_url` after make-online.
8. **"Last synced X min ago"** prominent on pill (currently only in title attribute).
9. **Visual indicator on auto-updated elements** — flash/glow when a pulled change lands on a row.
10. **`getElement` perf** — O(types) directory probe per lookup; cache id→type when load warrants.

---

*Rewritten 2026-05-14, session 204 close; Bout S/T/U checks folded in session 205 close; Bout X (transient-engine + merge id-swap UI propagation) checks folded in session 206. Tiered structure: T1 core lifecycle • T2 UI + recent fixes • T3 spot-check what tests already cover • T4 optional deeper. 266 vitest tests stand behind T2/T3 — this smoke is the real-browser integration check.*
