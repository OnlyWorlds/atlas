# OnlyWorlds Folder Format — reader conformance fixture

**What this is**: one tiny world folder, deliberately minimal and deliberately
imperfect, that any implementation claiming to READ the OnlyWorlds Folder
Format can run against. It answers "does your reader handle X?" with a failing
test instead of a question asked of a person.

**Created**: 2026-07-28 (Temper) · fixture **v1.2.2** · built to
folder-format spec **v0.3.6** · proposed by Kael, adopted by every
pass of Skeld's review round. **Report the fixture version you ran** —
`expected.json`'s `fixture_history` says what each one contained, and 1.0.0
shipped two different answer keys under one string before that array existed.
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
      extension-bearer--55555507.json          carries an unknown x_* field
      1111...555555555509.json                 name is the EMPTY STRING (legal)
      null-fields--5555550a.json               explicit nulls on links, a date, a text field
      idless.json                              NO id — must be skipped, never deleted
      not-json.json                            TRUNCATED — unparseable, skipped, never deleted
    map/    the-territory--55555503.json
    zone/   the-border--55555504.json
    pin/    wandering-pin--55555505.json        a MAPLESS pin
            on-the-map--55555508.json           links its map as `map` (the SPEC spelling)
  spatial/
    map/    legacy-map--55555506.json           LEGACY layout (see below)
```

## What a conforming reader must do

1. **Find every element under `elements/`** — including `map`, `zone` and
   `pin`. `elements/<type>/` is the format for all 22 types. **The count is
   `expected.json`'s `elements[]`, never a number written in this prose.** (It
   is 9 at fixture v1.2.0. That sentence is here to be checked against the
   array, not believed: an earlier draft of this README said 6, was right when
   written, and rotted the moment the array grew. Derive, or expect prose to
   lie.)
2. **Require only `name`.** Every other field is optional. `only-name` carries
   no `type`, no `created_at`, no `local_updated_at`; nothing may be
   synthesised onto it, and its absence must not be reported as an error.
3. **Let the body win over the directory.** `declared-elsewhere` sits in
   `elements/character/` and declares `"type": "location"`. It IS a location.
   The directory decides whether a file is FOUND; the body decides what it IS.
4. **Skip the broken files and leave them on disk.** `idless.json` has no `id`;
   `not-json.json` is truncated mid-key and will not parse. Neither is an
   element. Neither is yours to delete, and **one malformed file must never
   take out the world** — every other element still serves. *(Atlas learned
   this the hard way: a single element file missing its `type` once blanked
   the entire sidebar, console-only.)*
4b. **Do not collapse `null`, `""` and absent.** One element carries
   `"name": ""` (legal, and not the same as unnamed), another carries explicit
   `null` on a single link, a multi link, a date and a text field. `null`
   means UNSET and is a different claim from `0` or `""`. A reader may display
   whatever fallback it likes; it must not write one back.
5. **Round-trip unknown extension fields.** `extension-bearer` holds
   `x_probe_note`. A reader that writes must write it back unchanged.
6. **Tolerate a mapless pin.** `wandering-pin` has no `map`/`map_id` and no
   `element`/`element_id`. Pin/marker `required:` lists were dropped from
   canonical (Titus's product ruling, 2026-07-28) — mapless pins are a
   legitimate app pattern and the wire has always accepted them. A reader must
   not crash, and must not invent a map.
6b. **Resolve links under the spec spelling.** `on-the-map` names its map as
   `map`, the bare schema name (§5). Atlas's own files say `map_id`; a reader
   that knows only one spelling loses every pin the other writer made, silently
   (atlas did, until fixture v1.2.0). Read both. A writer keeps whichever the
   file already uses and never migrates a key as a side effect of opening a
   folder.
7. **Never parse a filename for meaning.** The filename is presentation; the
   `id` inside the file is identity. Every filename here happens to be in
   atlas's canonical `<slug>--<id-tail8>.json` form, which means a conforming
   writer's tidy pass over this folder is a no-op — but a reader that keys on
   filenames rather than bodies is wrong even when it gets the right answer.

## Where two readings are permitted

Three points in this fixture admit more than one conforming answer. They are
listed because a reader author deserves to know which disagreements are real
and which are just underspecified.

- **`only-name`'s type.** The body declares none. A reader may infer `character`
  from the directory or serve the element untyped; both conform. **Recommended
  (Quillon's reading, adopted 2026-07-29): infer it, but FLAG it** —
  surface the inference as inferred rather than as a declaration, and never
  write it back to disk. Two readers that both infer silently will agree on the
  field and differ on whether a caller can tell, which is the worse failure.
- **The legacy `spatial/` path.** A legacy-tolerant reader may merge those
  elements into its main set or keep them in a separate list. **Recommended:
  keep them separate and opt-in.** Merging makes the two layouts
  indistinguishable to a caller and discards information it may want.
- **`writable: false`.** Where a folder carries the marker, a reader may refuse
  writes on the strength of it. It is not what protects the bytes: **not
  writing unless asked is a property of the reader, and it has to hold for the
  folders that carry no marker at all**, which is nearly all of them. The belt
  is the behaviour; the flag is a label on the belt.

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
