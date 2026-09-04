# Atlas

Folder-first OnlyWorlds world browser and editor with optional API sync.

**Status**: **v1.0 LAUNCHED** 2026-07-24 at [atlas.onlyworlds.com](https://atlas.onlyworlds.com) (rebuild ran 2026-05-12 to 2026-07; public changelog at `/changelog.html`, drops 1.1 to 1.3 since). Post-launch work: interop with other OnlyWorlds writers (the union read, both disk link spellings, the keel export envelope) and the migration bout (`Notes/2026-09-02-migration-hops.md`). See `DESIGN.md` for architecture, `PROGRESS.md` for operational state, `CHANGELOG.md` for releases.
**Legacy**: Previous IDB-cached design lives at `tools/atlas-deprecated/` — UI/UX reference only. See its `DEPRECATED.md` for what to port vs drop.

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

TypeScript + Vite + `@onlyworlds/sdk` ^3.0.0 + Leaflet 1.9 + Vitest + MSW + fake-indexeddb + Playwright. Vanilla DOM, no React. `base: './'` for Cloudflare Pages compatibility. Chromium-only for full folder-mode editing; Safari 18.2+ / Firefox 111+ can still take the guided tour and use browser-storage worlds (folder mode needs the File System Access API).

## Architecture (one-line)

Single `FolderStore` is the source of truth for every world's data. Optional `SyncEngine` attaches when api credentials are present; pushes/pulls via OW SDK; uses per-element `local_updated_at` timestamps and a tombstone log instead of a pending ops queue.

Full architecture: `DESIGN.md`.

## Documentation map

The doc system has five live layers. **Rule: Forge/Notes decide, DESIGN docs hold** — dated decision records (in `Forge/Notes/`) get folded into the room's DESIGN doc promptly; the DESIGN doc is the living truth.

| Layer | Files | Job |
|---|---|---|
| Stable architecture | `DESIGN.md` | Folder-first model, conventions, file-naming spec (= Folder Format spec source) |
| Per-room design | `DESIGN_{MAPS,ZONES,WRITING,KNOWLEDGE,SHARING,HOME,IMPORT,CHARTS}.md` | One authoritative doc per room: model, decisions, shipped state |
| Operational log | `PROGRESS.md` | CURRENT STATE block + session entries (history in `docs-archive/`) |
| Arc pickups | `*_HANDOVER.md` | Warm-start doc for a live arc; rebuilt per arc, archived when the arc closes |
| Cross-bay contracts | `SHARING_CONTRACT.md`, `SHARING_CF_DELIVERY.md` | Live agreements (Anchor backend, Boss CF delivery) |

Reference: `SYNC_NOTES.md` (sync lessons), `PORTED.md` (legacy port log), `CHANGELOG.md`. Superseded docs live in `docs-archive/`, never the root.
