# S354: Captain's pile of atlas fixes, and what Sikelia found on the way

**2026-09-02 19:50, updated 20:10** · the report Captain asked for: "scope it all out, dive in, heat up, then report back with all your great refinements and questions"

Every item below was reproduced first (own eyes, Playwright on the live dev server, Skeld's real Sikelia folder mirrored into the browser's OPFS and opened through the real open-folder path), then fixed, then re-inspected. Screenshots: `Notes/ui-snapshots/2026-09-02-s354/`.

## The five reports, in Captain's order

### 1. After a localStorage clear the welcome offered only re-link

**True.** The welcome's recover screen rendered one button. Settings already had two doors (re-link, or set up a different folder); the welcome now has the same pair. On a cancelled or refused pick it says so instead of going quiet.

**Found beside it, worse:** worlds opened IN PLACE (the open-folder button, which is how Sikelia gets into atlas) did not come back after a clear at all. Root discovery only scans inside the atlas folder; a world elsewhere on disk kept its handle in the vault and lost its registry entry, and there was no path back short of finding the folder again by hand. Re-link now re-adopts every `world-*` handle the vault still holds. Verified: cleared storage, re-linked, Sikelia returned and opened.

### 2. Settings, change folder: nothing happened

**Could not reproduce.** With an injected picker the button moved the registry and the Folder line on the first click, no error, and a success toast. What I can name is the one path that produces exactly "nothing happened, no error": Chrome refuses to grant access to the top of Desktop, Documents, Downloads and the home folder. It shows its refusal inside the picker dialog, and when that dialog closes the call returns like a cancel, which atlas swallowed silently. Change folder and open folder now say "No folder chosen. If the picker refused one, choose a subfolder" on that path.

**Question for Captain:** which folder did you pick, and did the picker open at all? If it opened and you picked something inside your user folder that is not one of those roots, this is a different bug and I want the folder name.

### 3. The web shows no backlinks (Gamoroi empty)

**True, and the biggest change of the session.** The Gamoroi has zero outgoing links and eighteen incoming ones; the web drew one lonely node. The graph's ring 1 is now the union of both directions:

- **Backlinks are muted**: ink-grey ring instead of accent, dimmed glyph and label, and they settle BELOW the center while the element's own links settle above (a small hemisphere force in the sim, only applied when both halves exist so a backlink-only element still fans out around the whole ring).
- **Each backlink edge carries a small arrowhead at the center's rim**, pointing in. Arrows appear only on edges into the center, so direction is visible exactly where "who links here?" is asked and nowhere else.
- **A legend line bottom-left** ("16 link here") appears only when backlinks are drawn. Hover restores a backlink node to full presence; its tooltip says "links to The Gamoroi".
- Uncapped, as asked. The existing label budget hides the least-connected labels on dense webs; hover shows them.
- Outer rings now walk the web undirected, so a backlink's own neighbourhood is reachable at hop 2+.

**Found beside it:** the graph's multi-link reader was a hardcoded list of eighteen field names. `governs`, `populations`, `holders`, `allies` and the rest were invisible in both directions. The House of Bakchiadai governs the Gamoroi and was not on the web. Any array of id-shaped strings is now a link list. Sixteen of the eighteen showed before that fix, seventeen after; the eighteenth is a Relation element that names the Gamoroi inside a text field, which is not a link.

**Taste call for Captain:** the arrows are deliberately faint (they share the grey of the backlink edge). If they need to read from across the room, say so and I will thicken them.

### 4. Import a local world folder like Skeld's sikelia-world

**The door already exists**: the open-folder button in the worlds sidebar (the second icon, +folder) registers any folder holding a `world.json` in place, no copy. Sikelia opens through it: 108 elements, custom `x_surety` rendering as "Surety" in the custom-fields section, the long two-paragraph descriptions wrapping cleanly.

**What was broken, and is the §5 debt from S334 finally paid:** the map opened blank and the map index read 0 pins. The folder format writes a pin's map as `map`; atlas has only ever written and read `map_id`. Five pins on disk, none on the map, no warning. The store now reads both spellings, keys everything in memory on atlas's name, and writes each FILE back in the spelling it arrived with (the same sticky rule the union read and the world `now` follow). A new pin in a folder whose pins are all bare is written bare too, so Skeld's folder stays one dialect after atlas touches it. The conformance fixture grew a bare-spelled pin (v1.2.0) and a write-side test; the byte-identical read test still passes.

**Also:** the open-folder button called the native picker directly and swallowed every error as "cancelled". It now goes through the same picker seam as setup, so the test API can drive it and a real failure surfaces.

**Not a bug:** the five pins cluster in the lower right of the 8000×5200 canvas. That is southeast Sicily on an imageless map whose declared size atlas honours.

### 5. Non-Chromium landing: the right button sat higher

**Measured, not reproduced as reported.** In Chromium the two doors differed by one pixel of height (33 vs 34) because the primary and ghost button classes carry different line-heights and weights, and Firefox's default button line-height differs from Chromium's, which is where a visible offset comes from. Both landing doors are now one locked shape: 34px tall, 152px minimum width, one line-height, one weight. Verified equal in Chromium; Firefox is yours to eyeball.

## Round two (same evening, Captain: "happy to go with whatever makes sense to you")

**The folder you failed to import was `Development\OnlyWorlds\sikelia-world`, through "Change folder".** That door sets the atlas ROOT; pointed at a world it would have nested an empty `onlyworlds-atlas/` inside Skeld's repo (it did not, because the pick never completed). Now both setup doors recognise a world folder and open it in place when a root exists, or say which button was meant on a first launch. Verified: Settings, Change folder, picked Sikelia's folder, the world opened, no litter written.

**The S324 opener, decided by me.** Rule: chrome floating over the user's map artwork keeps the dark chip in both themes. Applied to zone labels (the six-week half-application), the placement banner, and the pin tooltip's type and description lines (which were app-ink on a canvas chip, so dark-on-dark in light mode). The waypoint toast stays a deliberately distinct dark chip and now says so with the canvas tokens. The charts plot stays a dark instrument panel and gets the middle option: a hairline and a soft lift on the light page so it reads as placed. Own eyes on the charts frame in light; the chip changes are two-token swaps mirroring the verified pin label and are verified by construction.

**Backlink follow-up.** The web preview's "Appears in" named only narratives, read through a private copy of the same eighteen-name list. It now names every element that links here, narratives first, with the count ("Linked from (17):"). The element page's "Referenced by" section already did this; the two now agree.

**Export convergence, done.** Atlas writes the keel envelope (`format`, `schema_version` from the SDK, `world` with id, lowercase `elements`), the same file onlyworlds.com downloads. The old shape is read forever. Skeld's Q2 from S313 closed.

**The migration bout, opened properly.** `Notes/2026-09-02-migration-hops.md`: twelve hops enumerated with owners, two run tonight on Sikelia. The git hop measured: opening the repo changes zero bytes; one edit kept key order, indentation and LF but dropped the trailing newline. Fixed at the one write site, so atlas edits diff as one line in a world repo. Open for Skeld: `.atlas/` and `media/` residents inside a versioned folder.

## For Skeld (message sent)

- `world.json`'s `snapshot_counts` disagree with the files on disk: 17/6/8 (collective/event/relation) written, 16/4/6 present. Kael's writer or the export, not atlas.
- The bare-link fill is shipped; his folder needed nothing else.

## Gates

See PROGRESS.md CURRENT STATE for the counts (typecheck, vitest, the full e2e, build).

## Uncommitted

Everything above, in `tools/atlas`. Plus `tools/tactical-tangle/.gitignore` gained `lab/tmp/` (Boss's call on the s350 pre-deploy commit, answered by me: the scratch pile stays out).
