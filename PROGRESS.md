# Atlas — Progress Log

Operational state. Architecture: **DESIGN.md** is the index (since S366), with the conventions in `DESIGN_LAWS.md`, the folder in `DESIGN_FOLDER.md`, sync in `DESIGN_SYNC.md`, the shell in `DESIGN_SHELL.md`, fields in `ATLAS_FIELDS.md`; per-room design in `DESIGN_{MAPS,ZONES,WRITING,KNOWLEDGE,SHARING,HOME,IMPORT,CHARTS,TOUR}.md`; the doc-system map lives in **README.md** ("Notes decide, DESIGN docs hold"). Sync lessons in **SYNC_NOTES.md**. Sharing contracts: **`SHARING_CONTRACT.md`** + **`SHARING_CF_DELIVERY.md`**. Superseded docs live in `docs-archive/` (incl. session history `PROGRESS-history.md`).

---

## CURRENT STATE (2026-10-09, SESSION 384: **1.21.0 LIVE** (`85123b8`, world units, #149; Boss f4cf890f, walked live by 23:33 in Chromium and Firefox from fresh contexts, no page errors; #149 closed); 1.20.1 before it. Gates on the 1.21 tree: typecheck 0 + **2646 vitest** (exit 0) + **424 e2e (= `--list`, PLAYWRIGHT_EXIT=0, zero flaky)** + a production build)

**Records**: the room lines h37 #2250 (what 1.21 does, what it leaves out) and h11 #2249 (Boss). The previous front door, `Forge/Notes/2026-10-09-s383-handover.md`, still holds the queue below it.

- **1.21 BUILT** (the Atlas piece of OW Infra #146, standard 00.31.00, keel 8d6f231, folder spec v0.3.7): `src/core/world-units.ts` maps the nine fields to `length_unit` / `mass_unit` / `distance_unit` (creature speed prints "/round"); `element-detail-fields.ts` sets `data-unit` and CSS prints it after the number (the text stays the bare number; the modal editor label gains "(cm)"); Settings, World tab has Length, Mass and Distance on one row (`settings-world.ts`). Synced as world meta: a trimmed `label` kind in `world-meta-sync.ts`, because keel trims and an untrimmed hand edit would re-PATCH every round. Import (`reconcile.ts`) and export carry them; `FOLDER_FORMAT_VERSION` is 0.3.7. Both fakes trim and cap at 64 as keel does. No SDK repin needed (Atlas calls `/world` directly).
- **Revert-checked**: the trimmed kind (the integration guard goes red with three pushes of " cm "), the `data-unit` line (the e2e goes red).
- **Own eyes**: Chromium and Firefox, the Settings row at two widths, a character and a creature (`Forge/Notes/ui-snapshots/2026-10-09-s384/`, script `tools/atlas/Notes/ui-snapshots/2026-10-09-s384/walk.mjs`). Firefox renders the unit; its `getComputedStyle` does not resolve `attr()` in `content`, so the e2e asserting the computed value is Chromium-only by the project setup.
- **Left out on purpose**: share pages print bare numbers (the payload carries no world meta; a contract change with `tools/show`, its own item if wanted, h37 #2250). No fleet gate: a small revert-checked change on an existing, gated sync path.
- **Not walked live**: a sync round on an account world (the integration tests on the fakes and Skeld's live keel PATCH check cover it).
- ⚡ **NEXT**: #104's door both ways; the upload button (Keel #59); #139, #140 (gate it); #141; #126.

---

Earlier session entries (S253 to S376, newest first, moved verbatim 2026-10-05, with the July `BANKED / TODO` standing queue that sat among them) are at the bottom of `docs-archive/PROGRESS-history.md`.
