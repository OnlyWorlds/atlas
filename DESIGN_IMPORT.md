# Atlas — Import & Export Design

**Version**: 0.1 (2026-06-18, design) — **built and shipped**
**Status**: SHIPPED (bouts B0-B4). The room is live and branded **Data** in the
UI (route segment stays `import`). The header below is the original pre-build
design; the code and the changelog are current for what actually shipped.
**Owner**: Temper
**Relationship**: companion to `DESIGN_FOLDER.md` (folder-first model, FolderStore) and `DESIGN_SYNC.md` (SyncEngine). Import is the last main data pillar. This doc is the stable reference for the import/export subsystem.

Grounded by the session-241 research sweep (6 read-only agents: atlas reconcile machinery · FolderStore surface · base-tool pipeline audit · validation/schema · test idioms · UI integration).

---

## Vision

Atlas should ingest OnlyWorlds data from anywhere — a full world JSON exported by ow.com, or a loose pile of elements parsed from ChatGPT / OnlyWorldsBot / Claude+toolkit — and emit it back out in the same ow.com-compatible shape. Powerful, elegant, safe, error-free. The **base-tool** (`Development/OnlyWorlds/base-tool`) has a proven validate→reconcile→write pipeline we lift the *ideas* from while rebuilding the *core* clean for atlas.

**Design north star:** import is **bulk local-create into the folder**. Sync is orthogonal. If the world is api-linked, the existing SyncEngine pushes the imported elements up afterward — exactly like any other local edit. One path, no special-casing per world-state.

---

## The folder-first simplification (why import is simpler than sync)

The single most important architectural fact: **the local folder has no foreign-key constraints.** FK ordering, id-swap, and ref-rewrite — the hard parts of `mergeLocalIntoApi` and the SyncEngine push — exist *because the OW server enforces FK and reassigns UUIDs on CREATE*. None of that applies when writing JSON files to disk.

Consequences:
- Import writes records to the folder in **any order**; there is no "create Location before Character" requirement locally.
- We do **not** reuse the topo-sort / id-swap / 5-phase merge machinery. That stays in `sync/` where it belongs.
- After import, `requestPushIfLinked()` fires once; the engine's existing push path discovers the new elements (via `listLocallyChangedSince(null)`), topo-sorts them, and handles server-side id reassignment with the proven id-swap path. **Import inherits all of that for free.**

So the import core is: **detect format → validate → resolve identity (ids + name-relations) → produce an `ImportPlan` → apply to folder.** The genuinely shared kernel with Route 2 is the *matching + name-resolution* logic only.

---

## What we support (v1)

| Mode | Trigger | Source shape | Lands where | Identity strategy |
|---|---|---|---|---|
| **A — Import as new world** | full-world JSON dropped/picked; loose elements too, by choice or with no world open (1.103, #856) | `{World:{…}, Character:[…], …}` (has `World`, uuid ids, uuid relations) | a **new** world folder (Create-Local, populated) | keep the file's uuids verbatim |
| **B — Merge into current world** | loose elements *or* a full JSON's elements (World table ignored) | type-keyed lists; ids optional; relations as uuids *or* names | the currently-open world's folder | id when present & matched, else name+type; per-conflict skip/overwrite |
| **Export — full world** | button in import/export room | n/a (reads folder) | downloaded `*.json` (ow.com-uploadable) | inverse of Mode A |
| **Export — by-type subset** | type checkboxes in export panel | n/a | downloaded `*.json` | subset of full export |

**Deferred (not v1, no re-add without a fresh design pass):**
- **Destructive "replace world"** (delete locals absent from the file). The only real footgun; if ever built, behind an explicit, loudly-warned checkbox.
- **Update-world-metadata-only** (World table → existing world's `world.json`) as a standalone action. Folds naturally into Mode A's world mapping; not its own flow yet.
- **Element-level subset export** (cherry-pick individual elements). By-type is the v1 granularity.
- **YAML** in/out. JSON only; serialization sits behind a tiny interface so YAML is a later bolt-on.

---

## Format model

### Detection (decide once, per payload, top-level)

1. Parse JSON. Not an object → reject ("unrecognized format").
2. **keel world-export ENVELOPE** (checked first): `format: "onlyworlds-world-export"`, OR structurally a `world` object beside an `elements` object. → **full-world**. `elements` is nested and keyed by **lowercase** type slug; `world` carries the world id. This is what ow.com emits today. See "keel world-export envelope" below.
3. Has a `World` key (PascalCase, at root) → **full-world format**. Element buckets are the other top-level keys. The older shape (atlas base-tool lineage); kept for backward compatibility.
4. No `World` key, but keys (lowercased) are mostly in `ALL_ELEMENT_TYPES` with array values → **loose type-keyed format** (no world metadata; targets the current world). AI-assistant output.
5. Otherwise (flat array, single bare element, garbage) → reject with a clear message.

The envelope MUST be detected before shapes 3–4: its `world`/`elements` keys are not element types, so a naive root-key scan would bucket them as "unknown" and call the file unrecognizable. Bucket keys are **PascalCase** in the old shape and **lowercase** in the envelope; atlas's `ElementType` union is lowercase. **Always lowercase the bucket key** and validate membership in `ALL_ELEMENT_TYPES` (`src/core/types.ts`). Unknown bucket → routed aside, not imported.

### Path selection (per element, payload-level default)

For each record:
- Has a string `id` that is a valid UUID → **keep-ids candidate**. Relation fields classified via `FIELD_SCHEMA[type][field]`: `single_link` expects a string id, `multi_link` expects `string[]`. UUID values kept verbatim. A *non-UUID* string in a relation field → that field needs **name-resolution**.
- No `id` → **resolve-names**: assign a fresh UUID (or adopt a matched existing element's id); relation values are names → resolve against the lookup.

A full ow.com export is uniformly keep-ids (uuid-v7 throughout, bare relation names) → fast path. AI-parsed payloads are typically resolve-names. **Mixed payloads are supported** because the branch is per-element/per-field, not per-pipeline (this is the key limitation we fix vs base-tool, which has two disjoint code paths).

### Disk-shape note (content vs spatial)

OW export content elements use **bare** relation names (`location`, `objects`, `birthplace`) — identical to atlas's on-disk content shape. **Pins and markers are stored on disk with `_id`/`_ids` suffix** (`map_id`, `zone_id`, `element_id`) per the adapter's disk-shape contract, so the importer renames the incoming bare names to disk shape (done in the reconcile core via `relationFieldsFor`'s `schemaField`→`diskField`).

### keel world-export envelope (CURRENT — `keel portal/views.py:509-560`, the world-export spec)

**This is what ow.com's "Export JSON" button emits today** (keel rebuild; registry `world_export`; confirmed with Skeld 2026-07-23, canonical, spec § being frozen). It SUPERSEDES the session-241 `services.py` note below, which described the retired Django backend.

```
{ format: "onlyworlds-world-export",
  schema_version: "0.30.00",          // _EXPORT_SCHEMA_VERSION module constant
  exported_at: "<iso>",
  world: { id, name, created_at, updated_at },        // lowercase; id PRESENT
  elements: { "<lowercase-type>": [ <serialize()'d v2 element>, … ] } }   // only types with ≥1 element
```

- **World id is PRESENT now** (the old backend dropped it "for security"; the rebuild keeps it so a round-trip is lossless). Element bodies come through the same `serialize` the API uses: uuid ids, **bare-name v2 relations** (`location`, `map`, `zone`, `element_id`), extension fields (`atlas_*`/`x_*`/`shadow_*`) intact, `type`/`change_seq`/timestamps present.
- **Only types with ≥1 element appear** (unlike the old always-emit-22).
- **Atlas reads it** (`parseEnvelope` in `parse.ts`). **World-id adoption on import is RULED (Skeld) but NOT yet wired** — atlas currently mints a fresh world id; element ids are kept verbatim (keep-ids path), so `ow://element` refs already survive. Adopting the world id (lossless world identity + same-id→same-world) is a tracked follow-up (needs the scaffold path + a collision decision).
- **Atlas's EXPORT writes this envelope too (2026-09-02)**: `format`, `schema_version` (the SDK's `ONLYWORLDS_VERSION`), `exported_at`, `exporter: 'atlas'`, `world` WITH id, lowercase `elements` buckets (all 22 by default, the requested subset otherwise). The old `World`+PascalCase shape is read forever and written never. Q2 closed.

### legacy ow.com export format (RETIRED backend — `django/ow/worldsync/services.py`)

Kept for the record; describes the pre-keel Django backend. Atlas still *reads* this `World`+PascalCase shape for backward compatibility, but ow.com no longer emits it.

- Top-level: one `World` block + **all 22 PascalCase element arrays always emitted** (even empty). Each element starts `{"id": "<uuid>", ...}`.
- **World block: 11 fields, NO world id** (removed "for security" — worlds are keyed by `api_key`): `api_key`, `name`, `description`, `version`, `image_url`, `time_format_names`, `time_format_equivalents`, `time_basic_unit`, `time_current`, `time_range_min`, `time_range_max`.
- **ALL relation fields are BARE for every type, including pin/marker** — `map`, `zone`, `element_id` (not `map_id`/`zone_id`). FK = single uuid string; M2M = array of uuid strings.
- **Every scalar is stringified** (`"x":"12"`, `"time_current":"0"`); unset FK = `""`; unset M2M = `[]`. → import coerces numeric strings → numbers, drops `""` FKs.
- **Pin `element_type` on export is a numeric ContentType pk** (e.g. `"7"`), NOT a type name. The reconcile core can't map this to a target; **B2's applier must derive the real `element_type` from the referenced `element_id`'s element** (look it up among imported/existing). Tracked as a B2 task; flag a spatial-import test before ship.
- Server has a matching IMPORT endpoint (`POST /store/`) but atlas imports to the **folder**, not via it (folder-first).

---

## Architecture

Three layers, clean seam between pure and IO:

```
  parse + detect (pure)                       src/import/parse.ts
        │
        ▼
  validate (pure)  ──►  ValidationError[]      src/import/validate.ts
        │                    └─► ChatGPT-fix prompt (kept feature)
        ▼
  reconcile (pure) ──►  ImportPlan             src/import/reconcile.ts
        │                                       (name to id resolution: resolveRelations in reconcile.ts)
        ▼
  apply (IO)        ──►  folder writes          src/import/apply-import-plan.ts
        │                + requestPushIfLinked once
        ▼
  UI (import/export room)                       src/middle/import-room.ts
```

### The reconcile core (pure — no FolderStore, no network)

Modeled on `make-online.ts`'s already-pure "match phase" (it builds typed decision records from plain arrays, touching no IO). Free functions, plain-object in/out, fully unit-testable with object literals.

```ts
// src/import/reconcile.ts
interface ImportPlan {
  creates: Array<{ type: ElementType; data: Record<string, unknown> }>;   // new elements (id assigned/kept)
  updates: Array<{ type: ElementType; id: string; patch: Record<string, unknown> }>; // matched → overwrite
  skips:   Array<{ type: ElementType; name: string; reason: 'conflict-skip' }>;
  worldMeta?: Partial<WorldMeta>;          // Mode A only (mapped World table)
  report: ImportReport;                    // counts + dropped-link diagnostics
}

interface ImportReport {
  created: number; updated: number; skipped: number;
  droppedLinks: Array<{ type: ElementType; element: string; field: string; value: string }>;
  unknownFieldsDropped: number;
}

// The single reconcile decision, shared shape with sync's discriminated union spirit:
function reconcileElement(
  incoming: Record<string, unknown>,
  type: ElementType,
  lookups: ReconcileLookups,            // normalized name→element + id→element, import + existing
  opts: { matchByName: boolean; onConflict: 'skip' | 'overwrite' }
): { action: 'insert' | 'update' | 'skip'; targetId: string; resolvedFields: Record<string, unknown> };
```

**Match priority** (fixes base-tool's case-sensitivity flaw): (1) by UUID if `incoming.id` exists and is found; (2) by **normalized** name+type — `name.trim().toLowerCase()` — within the same type; (3) else insert. Lookup maps are keyed on the normalized name (original preserved for display). Names normalized **once** at lookup-build time, used consistently across detect/resolve/write.

**Name → id resolution** (`resolveRelations` in `src/import/reconcile.ts` — the planned standalone `ref-resolve.ts` module was never cut; corrected 2026-07-26): uses `FIELD_SCHEMA[type][field].target` to know the target type — **never** base-tool's `inferTargetType()` string-guessing (that mis-targets `species`, `birthplace`, `founders`, etc.). Resolution priority: import payload first, then existing world (so self-contained imports resolve internally). Unresolved single-links drop with a `droppedLinks` report entry; unresolved multi-link entries are filtered. One shared relation-introspection helper used by both validate and resolve, so target logic lives in exactly one place.

**Shared with sync, reused (pure):** `deepEqual` (content diff to decide whether a matched element actually differs before issuing an update); the `FIELD_SCHEMA` relation introspection. **Not reused:** topo-sort, id-swap, rewriteIdReferences, applyIdSwapsToBody — sync-push concerns, not import-to-folder concerns.

> **Refactor opportunity (separate later bout, not v1):** `make-online.ts`'s name+type match phase and the new reconcile matcher are the same logic. After import ships green, a follow-up can route Route 2's match phase through the shared matcher — with the full 808-vitest + sync suite as the safety net. **Do not destabilize sync in the import bout.**

### The folder applier (IO)

Modeled on `initialDownloadAll` (the existing bulk-write template): warm `fileIndex` per involved type, iterate the plan sequentially (or bounded concurrency ~4–8 — each write is a double-readback atomic op, so avoid unbounded `Promise.all`), wrap each element in try/catch into `PerElementFailure[]`, emit progress per item, then **one** `refreshElementsAfterWrite(store)` + `requestPushIfLinked()` at the very end.

Write-primitive by provenance:
- **New local content** → `createElement(type, {id, ...fields})`. Honors a caller-supplied id; stamps `local_updated_at` only (no `server_updated_at`) → the engine treats it as a CREATE and pushes it.
- **Already-synced-elsewhere content** (carries a known server `updated_at`) → `applyServerRecord(type, {id,...}, server_updated_at)` (stamps both timestamps → in-sync, preserves atlas-local extension fields). *Rare for import; default is createElement.*
- **Idempotency:** before `createElement`, check `getElement(id)` — an existing id routes to `updateElement` (createElement silently overwrites duplicates with no error).

**New gap to fill:** there is no `bulkCreate` primitive and none is needed on the FolderStore *interface* — the applier is a thin module over existing per-id methods. Keeps the FolderStore seam unchanged.

**Mode A new-world:** `createWorldFromImportedData(name, plan)` reuses `createWorldInRoot` scaffolding (atlas-root check → subfolder + handle-vault → `FsFolderStore.open` → `writeWorldMeta`), but applies the `ImportPlan` **before** register/activate, and writes the mapped `worldMeta`. Must close the prior active store first (one-writer-per-folder lock), same as `createWorldInRoot`.

---

## Validation spec

Per record, error-tolerant (warn, don't block — preserves base-tool's resilience), but **observable** (dropped/unknown counts surfaced in the final summary):

1. Lowercase the bucket key; reject if not in `ALL_ELEMENT_TYPES`.
2. Require `typeof name === 'string' && name.trim().length > 0` (schema: `name` is `required:true`).
3. Strip the **strip set** from the body: `SERVER_MANAGED_FIELDS` (`type`, `world`, `created_at`, `updated_at`) + `ATLAS_LOCAL_FIELDS` (`local_updated_at`, `server_updated_at`, …`ATLAS_LOCAL_EXTENSION_FIELDS`). `type` is derived from the bucket, never trusted from the body.
4. Warn-and-drop unknown fields not in `knownFieldsFor(type)` (foreign/garbage fields the OW server would 422 on).
5. Coerce link cardinality to `FIELD_SCHEMA`: `single_link` → `string | null`; `multi_link` → `string[]` (filter non-strings), mirroring `adaptRecord`.

**Field types:** switch on the real SDK `FieldType` names — `'text' | 'integer' | 'integer_max' | 'single_link' | 'multi_link'` (and `'number'` seen in practice for stat fields). *Do not* use base-tool's dead `case 'number'` that never matches `integer`.

**ValidationError shape — keep all six fields**: `{ path, field, value, issue, expected, suggestion }`. The ChatGPT-fix-prompt generator depends on every one of them.

### The ChatGPT-fix-prompt (KEEP — standout feature)

Port `generateChatGPTPrompt(errors)` essentially verbatim: numbered, human-readable, per-error path/issue/expected/fix lines, "once fixed, provide the complete corrected JSON" footer. Surfaced as a **"copy fix prompt for AI"** button in the validation section. This is the escape hatch that closes the loop with the user's parsing AI — Titus explicitly wants it kept.

---

## World mapping & api_key safety (Mode A)

Map the `World` block onto `WorldMeta` (`src/core/types.ts`) via `writeWorldMeta`:

| Export `World` field | `WorldMeta` | Note |
|---|---|---|
| `name` | `name` | |
| `description` | `description` | |
| `version` | `version` | |
| `time_format_names` / `time_format_equivalents` | same | arrays |
| `time_basic_unit` | same | |
| `time_current` / `time_range_min` / `time_range_max` | same | **coerce string → number** (export stores `"0"`) |
| `image_url` | `image_url` | ✅ added to `WorldMeta` (Titus: preserve world image through round-trip) |
| `api_key` | **— (DROPPED)** | see below |
| — | `id` | **generated by atlas** — the export carries **no** world id (removed server-side "for security"; worlds keyed by api_key) |

**api_key safety — the explicit decision.** Sync activation is gated *solely* by the presence of `WorldMeta.api`. Writing the export's `api_key` there would silently arm sync against a server world **with no PIN and no user consent**. So:

- **Default:** import full-world as **local-only**. `WorldMeta.api` stays undefined. Safe by construction.
- **Convenience (Titus's point 2):** if the file carries an `api_key`, **stash it** (non-activating) and surface an explicit **"link this world for sync"** action afterward that pre-fills the api_key — the user only adds their PIN (and we validate via `client.worlds.get()`, then run the existing link/merge flow). This gives the whole-world-copy convenience without auto-arming sync.
- *Open:* the export contains `api_key` but likely **not** the atlas-internal `world_id` or the PIN. Linking still needs both (PIN from the user; `world_id` resolved by the link flow). Verify what ow.com's export actually includes before finalizing the "link" affordance.

---

## Duplicate-world handling (Mode A collision)

When a full-world import matches an existing registry world (by file `World` name / api_key), **never silently pick** — offer a small, clear choice:

1. **Import as a new world** (default, safe) → lands beside the existing one (`"Blood Meridian (imported)"`).
2. **Update the existing world** → runs **Mode B** merge into that world with **file-wins-on-conflict**. This is the "overwrite" function — implemented as merge (updates + adds), so it can't delete local elements absent from the file.

A true destructive replace is the deferred footgun (above).

---

## Conflict UX (Mode B)

When merging into a populated world, matched elements (by id, else normalized name+type) are conflicts. Default resolution: **skip** (non-destructive). Per-conflict toggle to **overwrite**. For `multi_link` fields under overwrite, offer **merge (union)** semantics so "overwrite additively" actually is additive (base-tool's label lied — its update was a replace). Surface a **dependents count** per conflict ("N elements reference this") as base-tool does — useful, cheap.

Keep it to **one review surface**, not a multi-tab wizard (see UI).

---

## Export design

World-scoped export does not exist yet (only the page-scoped share payload). Build it as the inverse of Mode A:

- **Full world:** read all types from the folder → assemble `{ World:{…}, Character:[…], … }` with **PascalCase** bucket keys (emit all 22, matching ow.com) → strip `ATLAS_LOCAL_FIELDS` + sync fields (`local_updated_at`, `server_updated_at`, atlas extension fields) → convert pin/marker disk `_id`/`_ids` back to bare names (`map_id`→`map`) → `World` block from `WorldMeta`, **no world id**; for api-linked worlds include `api_key` via an **"include credentials" checkbox, ON by default** (Titus) → download as `onlyworlds_<slug>_<date>.json`. (Round-trips through ow.com's `/store/`.)
- **By-type subset:** type checkboxes (all on, with counts) filter which buckets are emitted.
- **Pin/marker:** emit in the shape ow.com's own export uses (verify against a pinned world; mirror `adaptRecord`'s read shape otherwise).
- Reuse the **Blob download** idiom (base-tool `downloadAsFile`) and the **clipboard-copy-with-fallback + pretty `JSON.stringify(_, null, 2)`** idiom (share-room payload button) for a "copy to clipboard" alternative.

Round-trip is the acceptance test: **export → re-import (Mode A) → equivalent world.**

**As built** (`src/import/export-world.ts`; the plan above is its first draft): the keel envelope (`format: 'onlyworlds-world-export'`, the world block WITH its id, lowercase type buckets), credentials never offered by the room. Since 1.113.1 the world block also carries every `x_` key on the World verbatim (`x_names`, the strand's `x_strand`; a null is left out), as the import keeps them; an import that gives an incoming element a fresh id moves the strand mark's ids with it. A by-type export still carries the World's keys whole, so its strand can name elements the file leaves out (an empty slot on the way back in).

---

## The room with no world (1.103, #856)

`#/import` is the Data room before a world exists: Other ways in's "Bring in a file, notes or JSON" and the site's `#/bring-in` land there, and nothing is made until Import. Every payload is "Import as a new world" (a full world named from its World block, loose elements "Imported world"); Create world asks the persist request and the where-question as Mode A always has, makes the world from the plan and lands on its home. A world file opens as its own world, as anywhere, and from here lands on its home too. With a world open `#/import` is that world's `#/w/<id>/import` (replaced, not pushed); arriving that way, loose elements default to a new world (`core/bring-in-intent.ts`, read once by the room), while the world's own Data room merges them by default, and a view-only world defaults to new. Only `#/import` itself is world-less: a closed world's `#/w/<id>/import` (a folder world after a reload, or an open from the room that failed) shows the welcome, never an offer that would duplicate it. The room bar keeps its preview strip (conv. 31) with Data marked current; the header has Back to start. Under the tour both routes say the tour's line and go to `#/`. Back from a world opened out of the room returns to its Data room (accepted). Guards: `tests/e2e/bring-in-door.spec.ts`.

## UI — single-panel import/export room

The `import` room is already routed (`#/w/<id>/import`), nav-registered (download icon), and mounted (`app.ts` → `mountImportRoom`, currently a stub). Widen the mount signature to take `toasts` (knowledge/share rooms already do).

**One scrolling panel** (model: share-room's `buildDetail` — a root container, a room-landing header per convention #80 `.atlas-room-header` 22px white title + `.atlas-room-actions`, then ordered `section` blocks). Sections revealed progressively; re-render only the affected section on a new file (never wipe the drop zone):

1. **Bring in** — drop zone + paste textarea + file picker. Lift show's landing recipe (`show/src/main.ts`): dragover/dragleave/drop reading `dataTransfer.files[0]`, hidden `<input accept="application/json">`, `file.text()`, inline error line (keeps user input on parse failure).
2. **Summary** — instant: `"Full world 'Blood Meridian' · 47 elements / 9 types"` or `"Loose · 23 elements / 4 types · no world table"`; the chosen mode (new world / merge) with a toggle when a collision is detected.
3. **Validation** — grouped issues + the **"copy fix prompt for AI"** button. Empty when clean.
4. **Conflicts** (Mode B only) — compact list, skip/overwrite per row, dependents count.
5. **Import** — single action button; progress; result summary (created / updated / skipped / dropped-links).

**Export** lives in the **same room** as a second section ("Take out": full-world button + by-type checkboxes). Room titled e.g. **"Import & export"** (naming = Titus call; keeps the `import` route). *Alternative considered:* export in Settings → World. Recommend same-room for discoverability.

---

## Test plan (atlas idioms)

- **Pure core** (`tests/unit/import-*.test.ts`) — model on `element-name-match.test.ts`: a 1-line `mkEl({id,type,name,...})` factory, plain literals, synchronous, no fixtures. Cover: format detection (full/loose/reject); keep-ids vs resolve-names branch; id-match vs normalized-name+type match vs insert; matchByName on/off; case/whitespace normalization; mixed payload; same-name-different-type isolation; unresolved-link reporting; validation rules + the ChatGPT prompt text.
- **Folder application** (`tests/integration/import-*.test.ts`) — model on `make-online.test.ts`: one `MonotonicClock`, `MockFolderStore` (pre-seed with pinned ids), call `applyImportPlan`, assert via `listElements`/`getElement` — counts, timestamp stamping, atlas-local-field preservation, **no spurious tombstones**, per-element resilience via `__inject_apply_failure`. Spatial pin/marker import test (wire-shape-on-disk) is **mandatory before ship**.
- **Fakes discipline:** if import introduces any new server-rejected field or rule, encode it in **both** `fake-ow-client.ts` and `msw-handlers.ts` guards (kept in lockstep) **before** fixing the caller.
- **No api client needed** for folder-only import tests (just `MockFolderStore`). Use `FakeOwApiClient`/MSW only for the post-import push assertions if covered.
- **E2e** (Playwright) — drop blood_meridian → new world appears with N elements; paste loose → merge into current; export → file downloaded → re-import round-trips. Self-inspected via the Playwright MCP loop.

---

## Build sequence (bouts — each ends green + pokeable)

- **B0 — Grounding + design** ✅ (this doc).
- **B1 — Reconcile core (pure, TDD)** ✅ — `parse` + `normalize` + `validate` (+ ChatGPT prompt) + `reconcile` → `ImportPlan`. 51 unit tests; adversarially reviewed (5 bugs fixed).
- **B2 — Folder application** ✅ — `apply-import-plan.ts` (`applyImportPlan`) + `createWorldFromImportedData` (Mode A) + `importIntoActiveWorld` (Mode B), shared `scaffoldWorldInRoot`. 7 integration tests. 866 vitest green.
- **B3 — Import room UI** ✅ — single-panel `import-room.ts`. Self-inspected via Playwright; Mode A + Mode B verified end-to-end.
- **B4 — Export** ✅ — `export-world.ts` (`buildWorldExport`): ow.com shape, bare spatial relations, no world id, by-type subset, include-credentials. Round-trip + subset integration tests.
- **B5 — E2e + hardening** — Playwright e2e specs for the room; full suite; smoke checklist for Titus. (next)
- **B6 (optional, separate) — Route 2 dedup.** Route `make-online` match phase through the shared matcher, sync suite as safety net. Only if clean.

---

## Resolved

1. **World image:** ✅ preserve — `WorldMeta.image_url` added; mapped on import, emitted on export.
2. **api_key on export:** include for api-linked worlds via an "include credentials" checkbox, **ON by default** (Titus).
3. **Room naming:** one **"Import & export"** room (Titus: "sure").
4. **ow.com export format:** VERIFIED from the Django backend — see "ow.com export format (VERIFIED)" above. Key consequences baked into B1: no world id; bare relations for all types; stringified scalars; pin `element_type` is a numeric ContentType pk (B2 derives the real type from the referenced element).

---

## Conventions introduced (provisional — finalize at ship)

- **#81 Import is bulk local-create.** Import writes to the folder; FK ordering / id-swap is the engine's push concern, not import's. Never reuse sync's topo/id-swap machinery for import-to-folder.
- **#82 One reconcile branch per element, not per pipeline.** keep-ids vs resolve-names is decided per element/field (`isUUID` on `id` + per-relation), enabling mixed payloads — unlike base-tool's two disjoint paths.
- **#83 Normalized identity matching.** Name matching is always `name.trim().toLowerCase()` within type; ids matched first. Lookup maps keyed on the normalized form, original preserved for display.
- **#84 Relation targets come from `FIELD_SCHEMA[type][field].target`** — never string-guessing. One shared introspection helper for validate + resolve.
- **#85 api_key never auto-arms sync.** Imported credentials are stashed, not written to `WorldMeta.api`; linking is an explicit, PIN-gated, consent-based follow-up.
