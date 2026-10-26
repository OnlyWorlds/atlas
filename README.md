# Atlas

Folder-first OnlyWorlds world browser and editor with optional API sync. A world is a folder of plain files on your disk (or in your browser's storage), and Atlas reads and writes it; linking the world to an account on [onlyworlds.com](https://www.onlyworlds.com) adds sync.

Use it at [atlas.onlyworlds.com](https://atlas.onlyworlds.com); what changed in each release is at [atlas.onlyworlds.com/changelog.html](https://atlas.onlyworlds.com/changelog.html).

## Licence and contributions

The code is MIT (`LICENSE`). The OnlyWorlds name, the logo and the look are not: see `NOTICE`, and give a fork its own name. Issues are welcome: a bug, a wrong word, a thing you could not do. Pull requests are read; a small fix is usually taken as is, and a change to how the tool works is better opened as an issue first, since we may already be building it or have ruled it out. Temper reads and answers its issues and pull requests; for now those replies post from the founder's account, so a reply from `tmoosting` may be Temper's. A reply can take a few days. What we ask at the door, and what you can expect: the [code of conduct](https://github.com/OnlyWorlds/OnlyWorlds/blob/main/CODE_OF_CONDUCT.md).

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

The public changelog is generated from one edit surface, `src/changelog/changelog.data.ts` (`npm run changelog`); `CHANGELOG.md` is the pre-launch log, kept for history.

## Stack

TypeScript + Vite + `@onlyworlds/sdk` (version in `package.json`) + Leaflet 1.9 + Vitest + MSW + fake-indexeddb + Playwright. Vanilla DOM, no React. `base: './'` for Cloudflare Pages compatibility. Folder mode needs the File System Access API (Chromium); since 1.17 a world can also live in browser storage (OPFS), the only home on Firefox 111+ and Safari 26+ and a choice on Chromium (conv. 129).

## Architecture (one-line)

Single `FolderStore` is the source of truth for every world's data. Optional `SyncEngine` attaches when api credentials are present; pushes and pulls through a thin keel v2 adapter (no SDK in the sync path); uses per-element `local_updated_at` timestamps and a tombstone log instead of a pending ops queue.

Full architecture: `DESIGN.md` (the index into the design docs).

## Documentation map

The design docs in the repository root are the living record of how Atlas works: each holds the current model, the decisions behind it and what has shipped, and a decision is written into its doc when it is made.

| Kind | Files | What they hold |
|---|---|---|
| Architecture | `DESIGN.md` (the index) · `DESIGN_LAWS.md` · `DESIGN_FOLDER.md` · `DESIGN_SYNC.md` · `DESIGN_SHELL.md` · `ATLAS_FIELDS.md` | Vision and doc map · the numbered conventions new code must keep · on-disk layout and the file naming table (the source of the folder format spec) · the sync engine · shell, state, routes · the atlas extension fields |
| Per room | `DESIGN_{MAPS,ZONES,WRITING,KNOWLEDGE,SHARING,HOME,IMPORT,CHARTS,TOUR}.md` | One doc per room or subsystem: model, decisions, shipped state |
| Shared pages | `SHARING_CONTRACT.md` · `SHARING_CF_DELIVERY.md` | The contract with the onlyworlds.com sharing backend · the Cloudflare delivery of shared pages |
| Reference | `CODEMAP.md` · `SYNC_NOTES.md` · `PORTED.md` · `CHANGELOG.md` · `SECURITY.md` | The per-module map of `src/` and `tests/` · sync lessons · the legacy port log · the pre-launch log · how to report a vulnerability |

Earlier versions of these docs and the maintainers' working notes are not in the tree; git history keeps them.

Maintained by Temper, an AI agent working for Titus. Issues and pull requests are read and answered here.
