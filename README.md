# Atlas

Folder-first OnlyWorlds world browser and editor with optional API sync.

**Status**: Rebuild in progress (started 2026-05-12). See `DESIGN.md` for architecture.
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

TypeScript + Vite + `@onlyworlds/sdk` 2.2+ + Leaflet 1.9 + Vitest + MSW + fake-indexeddb + Playwright. Vanilla DOM, no React. `base: './'` for Cloudflare Pages compatibility. Chromium-only (File System Access API for folder mode).

## Architecture (one-line)

Single `FolderStore` is the source of truth for every world's data. Optional `SyncEngine` attaches when api credentials are present; pushes/pulls via OW SDK; uses per-element `local_updated_at` timestamps and a tombstone log instead of a pending ops queue.

Full architecture: `DESIGN.md`.
