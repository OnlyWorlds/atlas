# Live test worlds — populated by Skeld 2026-05-15

These three OW worlds mirror the fixtures in `world-a.ts`, `world-b.ts`,
`world-c.ts`. They exist for end-to-end verification once atlas's map
foundation is wired enough to load and render API data.

The three worlds are retired: their keys no longer answer (each read 401 on
2026-10-23), so the table keeps their names and counts only.

All maps carry `image_url: https://i.imgur.com/klSYRAm.jpeg` (Captain added
for visual debugging — not in the original fixture spec, but useful when
flipping to the live world to see the tree against a real canvas).

## Worlds

| Label | World name | Counts |
|---|---|---|
| A | AAARGAAAA | 9 Maps, 0 Locations |
| B | AAARGBBBB | 4 Maps, 7 Locations |
| C | AAARGCCC  | 7 Maps, 4 Locations |

## UUIDs

### World A (pure parent_map)
- Multiverse — `06a06ea6-d7ff-7703-8000-fca04f463d4e`
- Universe Alpha — `06a06ea6-e23b-7165-8000-9e2d9f0ef229`
- Universe Beta — `06a06ea6-edb9-79d7-8000-e863733b201f`
- Continent Aurora — `06a06ea6-f96c-7bf1-8000-b7009b8c92b6`
- Continent Borealis — `06a06ea7-08ed-73fb-8000-5c36e3655e13`
- Continent Caelum — `06a06ea7-0f56-75bd-8000-11b9c0bb79ea`
- Eldoria City — `06a06ea7-1595-7a58-8000-b46bfedc944b`
- Twin City — `06a06ea7-1c4b-792a-8000-37215d8f8bbf`
- Castle Interior — `06a06ea7-22cb-7506-8000-08c0a85c2aa5`

### World B (pure location-based)
**Locations**:
- Region — `06a06ea7-2a0e-76a8-8000-6206b722fdd5`
- City — `06a06ea7-3108-70ec-8000-29272d24326a` (parent: Region)
- District N — `06a06ea7-3823-7ac1-8000-ce1aa3e9fb40` (parent: City)
- District S — `06a06ea7-425d-73c5-8000-d8a90eecd41b` (parent: City)
- Block A — `06a06ea7-4b28-768d-8000-25297284179f` (parent: District N)
- Tavern — `06a06ea7-51f4-7a9f-8000-8fcee277e964` (parent: Block A)
- Castle — `06a06ea7-5e15-725f-8000-d4eaa240e026` (parent: City)

**Maps**:
- Region Overview — `06a06ea7-65e3-7c15-8000-baa162e99b6b` (location: Region)
- City Map — `06a06ea7-6c4b-725e-8000-66d89b18ab78` (location: City)
- Tavern Interior — `06a06ea7-7298-70c4-8000-28e0d5806370` (location: Tavern)
- Castle Map — `06a06ea7-7916-7362-8000-e3e37a099a7f` (location: Castle)

### World C (messy mix)
**Locations**:
- Aurora — `06a06ea7-8058-783c-8000-3f5f2f9597ac` (root)
- Eldoria — `06a06ea7-8725-709c-8000-934c2a5f7ba0` (parent: Aurora)
- Castle — `06a06ea7-8e88-7185-8000-ffe359b9811a` (parent: Eldoria)
- Tavern Loc — `06a06ea7-9519-7999-8000-523125659066` (root)

**Maps**:
- World Overview — `06a06ea7-9bc1-7edf-8000-ebc22427a03c`
- Eldoria City — `06a06ea7-a23c-7fda-8000-af2ea4592bd5` (location: Eldoria)
- Castle Floor 1 — `06a06ea7-a85b-786d-8000-692fbca6c155` (location: Castle, hier 0)
- Castle Floor 2 — `06a06ea7-af18-79f7-8000-79abf1ab1338` (location: Castle, hier 1)
- Throne Room — `06a06ea7-b53d-7b64-8000-052a55d3d8d3` (location: Castle, hier 2)
- Free-floating Tavern — `06a06ea7-bb9a-7341-8000-24d44551ee26` (parent_map: Eldoria City)
- Orphan Map — `06a06ea7-c21e-7b32-8000-955c081218de` (location: Tavern Loc)

Note: the "Broken Child" entry from `world-c.ts` is fixture-only (intentional
dangling parent_map for the algorithm's defense path). Skeld did NOT create
it on the live API and offered to add it via a PATCH-bypass if needed — kept
JSON-fixture-only for now.

## Repro / cleanup

Scripts at `Carrier/Orrery/notes/2026-05-15-atlas-maps-fixtures/`:
- `build_fixtures.py` — recreate worlds (assumes empty)
- `add_images.py` — re-PATCH image_url
- `verify.py` — re-run tree comparison
- `uuids.json` — machine-readable UUID map

## OW API quirks confirmed by Skeld (no schema surprises)

- Write side: `parent_map_id`, `location_id` (with `_id` suffix).
- Read side: nested `{id, name, ...}` objects under `parent_map` and `location`.
- No `world` field on writes (rejected).
- No `element_type` echoed on Map GET responses — same stamp-at-fetch
  pattern as other resources.
- Width/height accepted as plain integers.
- All 31 element creates + 20 image_url PATCHes landed clean — zero retries.
