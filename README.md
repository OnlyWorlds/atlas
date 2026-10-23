# Atlas

Folder-first OnlyWorlds world browser and editor with optional API sync. A world is a folder of plain files on your disk (or in your browser's storage), and Atlas reads and writes it; linking the world to an account on [onlyworlds.com](https://www.onlyworlds.com) adds sync.

Use it at [atlas.onlyworlds.com](https://atlas.onlyworlds.com); what changed in each release is at [atlas.onlyworlds.com/changelog.html](https://atlas.onlyworlds.com/changelog.html) (its one edit surface is `src/changelog/changelog.data.ts`; `CHANGELOG.md` is the pre-launch log, kept for history).

**Who writes this repository.** Atlas is built by Temper, one of a crew of AI minds working with the OnlyWorlds founder (the Captain in these files). The design docs, `PROGRESS.md` and `Notes/` are that crew's working record, kept as they were written: session numbers (S459), room references (h20 #1234) and paths into the crew's own folders (`Forge/Notes/...`) point at records outside this repository.

## Licence and contributions

The code is MIT (`LICENSE`). The OnlyWorlds name, the logo and the look are not: see `NOTICE`, and give a fork its own name. Issues are welcome on this repository; pull requests are read, but merging one is not promised.

## Run

```bash
npm install
npm run dev          # Vite dev server (port 3045)
npm run build        # tsc + vite build
npm run test         # vitest watch
npm run test:run     # vitest one-shot
npm run typecheck    # tsc --noEmit
npm run e2e          # Playwright (boots dev server)
npm run e2e:ui       # Playwright UI mode
```

## Stack

TypeScript + Vite + `@onlyworlds/sdk` (version in `package.json`) + Leaflet 1.9 + Vitest + MSW + fake-indexeddb + Playwright. Vanilla DOM, no React. `base: './'` for Cloudflare Pages compatibility. Folder mode needs the File System Access API (Chromium); since 1.17 a world can also live in browser storage (OPFS), the only home on Firefox 111+ and Safari 26+ and a choice on Chromium (conv. 129).

## Architecture (one-line)

Single `FolderStore` is the source of truth for every world's data. Optional `SyncEngine` attaches when api credentials are present; pushes and pulls through a thin keel v2 adapter (no SDK in the sync path); uses per-element `local_updated_at` timestamps and a tombstone log instead of a pending ops queue.

Full architecture: `DESIGN.md` (the index into the design docs).

## Documentation map

The doc system has five live layers. **Rule: Forge/Notes decide, DESIGN docs hold**: dated decision records (in `Forge/Notes/`) get folded into the room's DESIGN doc promptly; the DESIGN doc is the living truth.

| Layer | Files | Job |
|---|---|---|
| Stable architecture | `DESIGN.md` (the index) · `DESIGN_LAWS.md` · `DESIGN_FOLDER.md` · `DESIGN_SYNC.md` · `DESIGN_SHELL.md` · `ATLAS_FIELDS.md` | Vision and doc map · the numbered conventions · on-disk layout and the File naming table (= Folder Format spec source) · the sync engine · shell, state, routes · the atlas extension fields |
| Per-room design | `DESIGN_{MAPS,ZONES,WRITING,KNOWLEDGE,SHARING,HOME,IMPORT,CHARTS,TOUR}.md` | One authoritative doc per room or subsystem: model, decisions, shipped state |
| Operational log | `PROGRESS.md` | CURRENT STATE block + session entries (history in `docs-archive/`) |
| Arc pickups | `*_HANDOVER.md` | Warm-start doc for a live arc; rebuilt per arc, archived when the arc closes (none open today: the charts and release handovers are in `docs-archive/`) |
| Cross-bay contracts | `SHARING_CONTRACT.md`, `SHARING_CF_DELIVERY.md` | Live agreements (Anchor backend, Boss CF delivery) |

Reference: `CODEMAP.md` (the per-module map of `src/` and `tests/`), `SYNC_NOTES.md` (sync lessons), `PORTED.md` (legacy port log), `CHANGELOG.md`. Superseded docs live in `docs-archive/`, never the root.
