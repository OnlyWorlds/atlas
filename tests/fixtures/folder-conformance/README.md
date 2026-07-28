# OnlyWorlds Folder Format — reader conformance fixture

**What this is**: one tiny world folder, deliberately minimal and deliberately
imperfect, that any implementation claiming to READ the OnlyWorlds Folder
Format can run against. It answers "does your reader handle X?" with a failing
test instead of a question asked of a person.

**Created**: 2026-07-28 (Temper, Forge) · built to folder-format spec **v0.3.3**
· proposed by Kael (Assembly), adopted by every pass of Skeld's review round.
Destined for a public sibling repo alongside the spec; built portable (plain
files, no tool-specific assumptions, nothing generated at read time) so moving
it is a copy.

**How to use it**: point your reader at `world/`, load every element it can
find, and compare against `expected.json`. Report what you found. That is the
whole protocol.

---

## The world

```
world/
  world.json                                  minimum-legal: id + name
  elements/
    character/
      only-name--55555501.json                id + name and NOTHING else
      declared-elsewhere--55555502.json        body type contradicts its directory
      extension-carrier--55555507.json         carries an unknown x_* field
      idless.json                              NO id — must be skipped, never deleted
    map/    the-territory--55555503.json
    zone/   the-border--55555504.json
    pin/    wandering-pin--55555505.json        a MAPLESS pin
  spatial/
    map/    legacy-map--55555506.json           LEGACY layout (see below)
```

## What a conforming reader must do

1. **Find all 6 elements under `elements/`** — including `map`, `zone` and
   `pin`. `elements/<type>/` is the format for all 22 types.
2. **Require only `name`.** Every other field is optional. `only-name` carries
   no `type`, no `created_at`, no `local_updated_at`; nothing may be
   synthesised onto it, and its absence must not be reported as an error.
3. **Let the body win over the directory.** `declared-elsewhere` sits in
   `elements/character/` and declares `"type": "location"`. It IS a location.
   The directory decides whether a file is FOUND; the body decides what it IS.
4. **Skip the id-less file and leave it on disk.** `idless.json` has no `id`.
   It is not an element. It is also not yours to delete.
5. **Round-trip unknown extension fields.** `extension-carrier` holds
   `x_probe_note`. A reader that writes must write it back unchanged.
6. **Tolerate a mapless pin.** `wandering-pin` has no `map`/`map_id` and no
   `element`/`element_id`. Pin/marker `required:` lists were dropped from
   canonical (Captain's product ruling, 2026-07-28) — mapless pins are a
   legitimate app pattern and the wire has always accepted them. A reader must
   not crash, and must not invent a map.
7. **Never parse a filename for meaning.** The filename is presentation; the
   `id` inside the file is identity. Every filename here happens to be in
   atlas's canonical `<slug>--<id-tail8>.json` form, which means a conforming
   writer's tidy pass over this folder is a no-op — but a reader that keys on
   filenames rather than bodies is wrong even when it gets the right answer.

## The legacy path (NOT normative)

`spatial/{map,pin,zone,marker}/` is a **named, dated legacy read path**: atlas
through v1.0 wrote the four spatial types there, and no other implementation
ever did. Spec v0.3 rules `elements/` for all 22.

A third-party reader is **not required** to read `spatial/`. Atlas does, as a
union with `elements/`, so folders written by either layout open whole.
`expected.json` therefore splits the answer key: `elements` is what everyone
must find, `legacy_elements` is what a legacy-tolerant reader additionally
finds. Report which tier you cover; both answers are conforming.

## Why the spatial elements are in here at all

Because until 2026-07-28 shipped atlas silently found none of them. A capture
written to spec opened showing every content element, a clean UI, and no maps,
pins or zones at all, with no warning anywhere. A world that looks complete
while missing an entire subsystem is the failure this format exists to
prevent, and a fixture built only from the types that work cannot detect it.
