# The folder as an interop surface — probe findings + one banked bout

**2026-07-28 14:18** · S331 (the interlude) · Temper
**Why**: Skeld asked three folder-authority questions (spatial layout, `world.json` minimum, what a keyless read-only consumer needs) because two SDKs and a spec are about to be written from atlas's behaviour. Two bays were quoting a stale claim about that behaviour. I ran the tool instead of reading the docs.
**Method**: hand-built foreign folders in OPFS, driven through the real setup/discovery/activation paths on the dev server, own eyes on the result. Snapshots: `Notes/ui-snapshots/2026-07-28-folder-probe/`.

---

## The verified ingest contract (this supersedes the "four live-proven ingest facts" from 2026-07-14)

| Surface | Requirement | Evidence |
|---|---|---|
| `world.json` | `id` non-empty string; `name` a string (**`""` is legal**) | `openWorldFolder` + `discoverWorldsInRoot`; probe opened a `{id,name}`-only file |
| element body | non-empty string `id`, and nothing else | id-less files are skipped, left on disk, logged |
| element body `type` | **NOT required** to load. Was effectively required by a render crash — see below | probe: type-less element landed in state |
| element body `local_updated_at` / `created_at` | **NOT required.** Nothing synthesises them on read | probe: two elements carrying neither list + render fine |
| `.atlas/` | **NOT required** to open. Created on activation | probe folder had none |
| directory placement | **Authoritative for discovery.** `spatial/{map,pin,zone,marker}/`, everything else `elements/<type>/` | `elementDirSegments` — no fallback either way |
| body vs directory `type` | The **body wins** for what the element IS; the **directory decides whether it is FOUND** | probe: a `type:'location'` file inside `elements/character/` loads and renders as a location |

**The practical correction**: under the old claim a folder writer would synthesise a `local_updated_at` per element — a local-edit timestamp stamped onto a frozen capture. It must not. Atlas does not want them.

## Fixed this session

**One type-less element file blanked the whole elements sidebar and the home desk.** `renderElementRow` escapes `el.type` twice unguarded (`escapeAttr`/`escapeText`), so `undefined` threw inside the list's `.map()` and the room rendered empty with nothing but a console error. `buildDesk` had the same shape. Classic one-sided hardening: the icon lookup on the line above already had `?? 'category'`.

Fix is one site, not two: `FsFolderStore.buildIndexFor` stamps `type` from the directory when the body omits it. **Fill-only, never overrides a declared type** (convention #14 — the body is the schema). Same SHAPE as `adaptV2Record`'s stamp, though NOT the same reason (see the 17:05 section: the v2 list does return `type`, so the adapter's stamp is a harmless identical overwrite; here the fill is load-bearing).

Guard: `tests/e2e/folder-store-fs.spec.ts` → "indexing stamps a missing in-body type from the directory, and never overrides a declared one". **Revert-checked** (fails by 1 assertion with the stamp removed). 17/17 folder-store e2e, 1595 vitest, typecheck clean. UNCOMMITTED.

## ⚡ BANKED BOUT — the snapshot identity collision (real, verified, not yet fixed)

**Symptom, reproduced end to end**: two folders carrying the same `world.json` id (which is what a per-chapter folder export produces BY DESIGN — stable ids are the point) both import via discovery as separate registry entries, and both point at the **same** handle-vault slot `world-<world.json id>`. The second `storeHandle` silently overwrites the first.

```
after discovery:  Probe World        → world-1111…1111
                  Probe World (ch12) → world-1111…1111    ← same slot
vault holds:      probe-world-ch12
```

**After a reload, clicking the chapter-1 entry opens the chapter-12 folder.** No warning, no error, correct-looking UI, wrong world's data.

Note `openWorldFolder` DOES dedupe on this key (returns `{already:true}`), so the manual open path refuses the second snapshot rather than aliasing it. Only discovery aliases. Both behaviours are wrong for the snapshot use case, in opposite directions.

**The fix**: key the folder handle by the REGISTRY ENTRY id ("this folder, on this machine"), not by the world id ("which world this is"). The world id stays as the re-discovery MATCH hint, which is what it is genuinely good for.

**Size it as a bout with a pre-build gate, not a patch.** `world-${...}` is load-bearing in four places (`registry.ts:232` findByOwIdentity, `atlas-root-flow.ts:165` discovery, `:234` openWorldFolder, `:478` scaffold, `:742` link-existing), and the id-swap machinery keys off world identity too. Migration matters: existing vault entries are under the old key and must keep resolving.

**Not urgent for the parse** — writing snapshots is unaffected; only browsing several in one atlas is. Urgent before anyone builds a snapshot browser or points a viewer at N folders.

## ⚡ BANKED — the `spatial/` layout ruling (waiting on Skeld)

Atlas is the only implementation that splits the four spatial types into `spatial/`; Magelet puts all 22 under `elements/`. **A Magelet-layout world opened in atlas today silently loses its maps, pins, zones and markers and looks complete.** Verified: I placed a map in each layout in one folder; one loaded, one vanished, no warning anywhere.

My ruling, sent to Skeld: `elements/<type>/` for all 22 is the format; `spatial/` becomes a named, dated legacy READ path. The split carries no semantics — it is my Leaflet subsystem's convenience leaking into the serialization, which is the direction Skeld has ruled against twice this week for other people's runtimes. Atlas reads BOTH (union), writes `elements/` for new worlds, leaves existing folders where they are (the same stickiness the filename contract already has). **Do not start until he rules**, so the conformance fixture encodes the ruling rather than today's behaviour.

## ⚡ PROPOSED — the conformance fixture (~1h, blocked on the ruling above)

One tiny folder, committed, deliberately minimal and deliberately imperfect: minimum-legal `world.json`, an element with only `id`+`name`, an element whose declared type contradicts its directory, one spatial element per layout, an id-less file that must be skipped and survive, no `.atlas/`. Every reader implementation (atlas, npm 4.x envelope reader, the C# one) runs against it and reports what it found. Turns "does atlas need X?" from a question asked of a person into a failing test.

*This whole note exists because a claim about atlas's behaviour was written down once, quoted in good faith across three bays, and used to constrain a design. Reading told everyone what the code says; only running it told anyone what the tool does.*

## Added 14:50 — answering Kael's writer questions (probed, not remembered)

**A stale claim of mine, corrected.** `adaptV2Record`'s comment and the atlas skill file both say *"per-type endpoints omit `type`"*. **False.** Probed `GET /api/v2/character/?limit=1` on demo key `0000000000`: 43 fields, `type: "character"` present, `change_seq: 48` present, **no `world` field**. Behaviour is harmless (the adapter stamps the same value it skips) but the comment misleads anyone building a writer. ⚡ Fix the comment + the skill line.

**The wire→disk transform has three parts** and a folder writer must do all three (told to Kael; the normative source is `adaptV2Record` + `relationFieldsFor`):
1. `type` — keep (it IS on the wire).
2. `change_seq` — strip (on the wire; a disk copy rides the next PATCH and 422s).
3. **pin/marker relation fields take `_id`/`_ids` on disk** (`map`→`map_id`, `element`→`element_id`, `zone`→`zone_id`). Only those two types. A writer that dumps wire bodies produces pins with no map, silently.

**★ The aliasing hazard has a cheaper cure than my bout, and it is the format's.** Element ids being stable across snapshots does NOT require the WORLD id to be stable — I carried that assumption in without examining it. Verified: no element body carries a world reference on the wire or on disk, so a snapshot can take a fresh world id at the cost of one key in one file. Distinct world ids, distinct handle slots, no collision, in atlas or any other consumer. **The handle-key bout is still worth doing** (one identifier doing two jobs is a real defect, and a user with two folders holding one world will hit it) **but it stops being a blocker for anything.** Priority drops accordingly.

**Look-don't-touch mode, conceded to Quillon.** I argued a "frozen" marker was redundant with the absence of an `api` block. Right about syncing, wrong about editing: atlas renamed three files in a folder it had merely opened (the tidy pass, working as designed). There is no way today to open a world without modifying it. Snapshot consumers need one. ⚡ Queued.


---

## THE PARKED QUEUE (everything from this session, priority order — nothing started)

Captain's ruling: park all of this until after the tangle converge. Sizes are honest.

| # | Item | Size | Blocked on |
|---|---|---|---|
| 1 | **Per-row render isolation in the elements sidebar + home desk.** Today's stamp fixes the KNOWN trigger; the class is open — the whole list renders inside one `.map()`, so any future bad element blanks the room silently (console-only). A per-row guard rendering a "damaged element" row closes it. | small | — |
| 2 | ~~**`spatial/` union read**~~ **SHIPPED S334** (2026-07-28) — both layouts read, sticky writes, cross-layout twins served-not-deleted, both halves revert-checked. Record: `Notes/2026-07-28-s334-union-read.md` | half session | — |
| 3 | ~~**The conformance fixture**~~ **SHIPPED S334** — `tests/fixtures/folder-conformance/` (portable, `expected.json` beside the folder exactly as Kael framed it) + `tests/e2e/folder-conformance.spec.ts` as atlas's answer. Also covers the mapless pin and the id-less-file-survives rule. | ~1h | — |
| 4 | **SDK re-export delete.** The SDK now exports `ELEMENT_FAMILIES`, `FAMILY_COLORS`, `elementColor`, `familyOf`, `SPATIAL_TYPES`, `ELEMENT_LABELS`, `isDemoKey`; atlas carries a local copy of every one, in a file whose header says to delete them when the SDK ships. Verified byte-identical 2026-07-28, so it is a delete not a merge. | small | — |
| 5 | **Look-don't-touch mode.** There is no way today to open a world without modifying it — the filename tidy renames foreign files on open (verified: 3 renamed in a folder I only opened to read). Snapshot consumers need this; conceded to Quillon. | medium | — |
| 6 | **Copy truth**: the open-existing-folder card says *"Point at its folder and atlas opens it in place. Nothing is copied or moved."* Then the tidy renames files. Technically true, experientially false. Fix with item 5 or ahead of it. | trivial | — |
| 6b | **★ BARE LINK FIELDS — a ruling of mine that never got built.** Folder-format spec §5: *"Link fields on disk: bare schema names, uniformly — RULED 2026-07-13 (Temper: option b). Atlas's sole exception (pin/marker `map_id`/`zone_id` on disk) migrates: write-bare, read-accept-both forever, open-time tidy converges old files."* **Atlas has done none of it** — grepped the read path 2026-07-28: `map_id` consumed bare-suffixed in ~12 call sites (`pin-uniqueness`, `map-spatial-scale`, `element-detail-header` x5, `share-payload`, `element-detail-zone-sections`), zero tolerance for the bare name. Caught by Kael, who quoted my own ruling back at me after I reported atlas's current behaviour to him as the norm. **Blocks Assembly copying `adaptV2Record`** (the suffix IS the transform in question). Not urgent — Blood Meridian has no spatial elements — but it is a named debt. | medium | — |
| 7 | **Handle-key bout** (registry-entry keying, migration, pre-build gate). **Priority DROPPED** — under the fresh-world-id-per-snapshot ruling the hazard cannot occur, so this is now defect-hygiene rather than a blocker. | one session | — |

Fixed + uncommitted from this session: the type stamp + its guard test, and two stale-comment corrections (`adaptV2Record` header, the atlas-tool skill's OW-quirks line).
