# Atlas — Progress Log

Operational state. Architecture: **DESIGN.md** is the index (since S366), with the conventions in `DESIGN_LAWS.md`, the folder in `DESIGN_FOLDER.md`, sync in `DESIGN_SYNC.md`, the shell in `DESIGN_SHELL.md`, fields in `ATLAS_FIELDS.md`; per-room design in `DESIGN_{MAPS,ZONES,WRITING,KNOWLEDGE,SHARING,HOME,IMPORT,CHARTS,TOUR}.md`; the doc-system map lives in **README.md** ("Notes decide, DESIGN docs hold"). Sync lessons in **SYNC_NOTES.md**. Sharing contracts: **`SHARING_CONTRACT.md`** + **`SHARING_CF_DELIVERY.md`**. Superseded docs live in `docs-archive/` (incl. session history `PROGRESS-history.md`).

---

## CURRENT STATE (2026-10-09, SESSION 381: **1.17.0 PUSHED for Boss's deploy**, on the Captain's note (13:38, "might as well, right?") and Skeld's go (h37 #1869), without the walk-page smoke: he smokes on live; gates on the pushed code: typecheck 0 + **2620 vitest** (274 files, 2 skipped, exit 0) + **415 e2e (chromium 404 + firefox 10 + firefox-private 1, each = its `--list`, PLAYWRIGHT_EXIT=0, zero flaky)** + a production build (404.html, robots.txt, the canonical link, all in `dist/`); changelog dated 2026-10-09)

**Records**: handover `Forge/Notes/2026-10-05-s377-handover.md` with its S380 addenda (what 1.17 carries beyond S377: `78dddce` the seat secret, `0028fd6` the edge colour); S381 in the Forge chat log.

- **S381 added**: 15 unit tests for S380's two commits (`tests/unit/seat-secret-and-edge-retry.test.ts`; revert-checked: 11 go red on the pre-S380 source, the 4 that stay green are the old behaviour's cases). `public/robots.txt`, `public/404.html` (Cloudflare Pages answers unknown paths with it and a 404 instead of the SPA fallback; Atlas routes only by hash), `<link rel="canonical">` in `index.html` (Boss's #101 row, the is-agentic metadata).
- **A flake named and fixed**: `browser-worlds` "Delete removes it from the browser" failed one Firefox run in five. A registry log showed `[Alpha, Alpha, Beta]` before the test acted: the specs seed `browser-worlds/` raw (no make lock) while the boot reconciliation is still running, so Alpha's folder was adopted as a second row. A real make holds the world's Web Lock and the `.atlas/making` marker, so the product path is guarded. The four specs that seed raw (`browser-worlds`, `home-keepsafe`, `move-world`, `world-file`) now wait out the reconciliation in `boot()` (a no-op `enqueueActivationTask`). 0 failures in 60 diagnostic runs and 20 of the original, from 2 in 45 before.
- **A full e2e run that lost its dev server** mid-run (84 `ERR_CONNECTION_REFUSED`, no error from the server itself) was discarded and rerun clean. If 3045 goes away again under a run, look for another process killing node before suspecting the suite.
- **Banked for 1.18** (S380 addendum, unchanged): on a view-only world hide or disable the header's Delete; skip the `[world-prefs]` write on a view-only world. Plus S377's banked set (handover).
- **Deck**: #21 closes when live and smoked; #113 (Try Moppetopia), #121, #122, #123 open.
- ⚡ **NEXT**: Boss deploys 1.17 (h11) and fetches robots.txt and an unknown path live (#101); the Captain smokes the five stations in h37 #1821; Boss reads the folder-store card once live (h37). Then **#113** "Try the Moppetopia demo", then the **`#/join/` door** (OW Infra #104) once keel's side lands (Skeld, after Keel #120 and #119), then **Little Lens** through the same door (the Captain's note on the world page's Open with). The Moppetopia share page's republish (map v2) needs a co-builder seat from the Captain. **Session F**, the copy session (item #23), with him.

---

Earlier session entries (S253 to S376, newest first, moved verbatim 2026-10-05, with the July `BANKED / TODO` standing queue that sat among them) are at the bottom of `docs-archive/PROGRESS-history.md`.
