# The migration bout: every hop a world can take, and what each one costs

**2026-09-02 20:15, updated 20:39** · S354 · Captain: *"a serious work bout where we go through all data migrations, website, Atlas, Obsidian, and test all the ways around, ease of copying over folders, etc. A lot of pain points already."* · Skeld logged it as a LATER thread and named the owners: I hold the atlas hops, he holds keel and the Obsidian plugin, Kael's SDK writer is the fourth party. Sikelia (`49501a68`, the folder repo at `Development/OnlyWorlds/sikelia-world`) is the fixture.

This is the first input: the enumeration, what tonight measured, and what is banked with a repro. Rows marked **atlas** are mine to fix; the rest are named so the list is whole.

## The hops

| # | Hop | Owner | Status tonight |
|---|-----|-------|----------------|
| 1 | onlyworlds.com → atlas, link an existing world (Route 2 download) | atlas | **RAN ON SIKELIA with Captain's read key (view-only door).** Linked in 10.5s, 108/108 elements, and after the known normalisations (link spelling, timestamps, `change_seq`) **zero field differences** between what keel served and what Skeld's folder holds: two producers, one answer. **Findings**: (a) atlas mints its OWN `world.json` id for a linked world (server id lives in the `api` block), so the same world exported by keel and downloaded by atlas carries two ids on disk; other readers keying on `id` see two worlds. Wants a ruling. (b) atlas writes a sparse `world.json`: no `format_version`, no `snapshot_counts`, no `public_read`/`created_at`/`updated_at`. `format_version` at least should be written. (c) the read key sits in `world.json` in plain text, by design (the folder carries its credentials); every folder copy carries it. The key itself lives only in `Forge/.env` (`SIKELIA_READ_KEY`). |
| 2 | atlas → onlyworlds.com, make a local world online (Route 1 create) | atlas + keel | Not run tonight. Known good since S309. |
| 3 | atlas ↔ onlyworlds.com, ongoing sync | atlas + keel | Not run tonight. The S334 gap (a capture loses its now) is closed; the bare-link fill (below) means a pin pulled from keel and a pin written by the format read the same. |
| 4 | keel export file → atlas import | atlas | Reads the envelope, adopts the world id, offers merge-or-copy (S313, S315). Not re-run tonight. |
| 5 | atlas export → keel import / atlas import | atlas | **CLOSED TONIGHT**: atlas now writes the same envelope keel writes (Skeld's Q2, owed since S313). The old shape is still read. Round-trip locked by unit test. |
| 6 | a folder written by another tool → atlas, opened in place | atlas | **RAN ON SIKELIA.** 108 elements, custom field, long descriptions: fine. **Found and fixed**: pins written under the format's bare `map` were invisible (§5, now read both, sticky per file). **Found and fixed**: worlds opened in place vanished after a browser storage clear (recover re-adopts them). **Found and fixed**: pointing Change folder at a world folder would have nested an atlas root inside it (now opens the world instead). |
| 7 | a world folder as a **git repo**, atlas editing inside it | atlas | **RAN ON A MIRROR OF SIKELIA.** Opening changes zero bytes. One edit keeps key order and 2-space indent and LF, adds `local_updated_at` (legal, honest, one diff line), and **dropped the trailing newline** (fixed tonight: every atlas write ends with `\n` now). **Still open**: atlas leaves `.atlas/lock` (and after sync `.atlas/sync-state.json`, tombstones, charts) plus an empty `media/` directory inside the repo (git cannot see an empty directory, so only `.atlas/` shows). Untracked noise in someone else's git. Wants a ruling: does the format reserve `.atlas/`, and should atlas write a `.gitignore` line, or should the repo template carry one? (Skeld's, with my recommendation: the writer of the repo owns its `.gitignore`; atlas should not touch it.) |
| 8 | copy a world folder to another machine / browser profile | atlas | **8a RAN**: Sikelia copied into a fresh profile's atlas root, discovered at setup, opened with all five pins. **8b not run**: an api-linked world copied by folder carries its `api` block with the key in `world.json`; the second machine syncs as the same device with no `sync-state` history. Needs a write key on a scratch world; not Sikelia's. |
| 9 | atlas folder ↔ Obsidian vault | Skeld (plugin 3.2.0 writes markdown; atlas reads JSON only) | Not atlas's. Skeld: atlas is not a gate. |
| 10 | onlyworlds.com → Obsidian, Obsidian → onlyworlds.com | Skeld | Not atlas's. |
| 11 | keel export → Kael's writer → folder → atlas | Kael + atlas | Kael's capture verified in atlas at S334 (36/36 + the now). **Found tonight in Skeld's export**: `snapshot_counts` overstate three types (writer's belief vs files on disk). Reported. |
| 12 | atlas → tools/show (published page payload) | atlas | Not a migration; the payload is its own contract. Out of scope. |

## What the atlas hops taught tonight, as laws

- **A second writer's dialect is only discovered by opening the second writer's output.** Bare `map`, the missing trailing newline, the counts drift: none of these were findable from atlas's own fixtures, and all three fell out of one folder in an hour. The fixture for this bout is Sikelia, not anything I write.
- **The folder has residents that are not the world**: `.atlas/lock`, sync state, tombstones, charts. Every hop that copies or versions a folder meets them. The format needs to say whose they are.
- **A world's identity survives the folder hops now** (id in world.json, id in the envelope, `world-<id>` handle key), so the merge-or-copy question is asked rather than silently answered.

## Next, when the bout opens

1. Hop 3 (real sync) on a scratch world with a write key: never Sikelia's. Hop 1 is done.
2. Hop 8b (the api-linked copy, two devices) on the same scratch world.
3. Hop 4 with tonight's export (5) fed back through import: the same world, the merge-or-copy prompt, zero warnings.
4. The `.atlas/` ruling from Skeld before hop 7 goes further.
