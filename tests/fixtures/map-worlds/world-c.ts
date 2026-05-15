/**
 * World C — Messy mix.
 *
 * Combines: explicit parent_map override, orphan loc-bound (Aurora has no
 * map), hierarchy ordering among siblings, multi-map location (Castle has
 * three), dangling parent_map (a non-existent uuid).
 *
 * Locations:
 *   Aurora                    (no parent)
 *   ├── Eldoria (parent=Aurora)
 *   │   └── Castle (parent=Eldoria)
 *   Tavern Loc                (orphan root branch)
 *
 * Maps:
 *   World Overview            (no location, no parent_map)
 *   Eldoria City              (location=Eldoria; chain hits Aurora which has no map → root + chip)
 *   Castle Floor 1            (location=Castle; chain Castle→Eldoria → Eldoria City inferred parent)
 *   Castle Floor 2            (location=Castle, hierarchy=1; sibling)
 *   Throne Room               (location=Castle, hierarchy=2; sibling)
 *   Free-floating Tavern      (parent_map=Eldoria City; explicit override, no location)
 *   Orphan Map                (location=Tavern Loc; ancestor chain has no maps → root + chip)
 *   Broken Child              (parent_map=<nonexistent uuid>; → root + brokenParent)
 *
 * Expected tree (4 roots, alpha + hierarchy sorted):
 *   Broken Child  [brokenParent]
 *   Eldoria City  [inferred not relevant — placed at root by location chain miss]
 *   ├── Castle Floor 1  [inferred]
 *   ├── Castle Floor 2  [inferred]
 *   ├── Throne Room     [inferred]
 *   └── Free-floating Tavern   (explicit parent_map)
 *   Orphan Map  [orphan chain]
 *   World Overview
 *
 * Note on root sort: hierarchy=0 ties break by alpha. All roots have hierarchy 0,
 * so they sort alphabetically: "Broken Child" → "Eldoria City" → "Orphan Map" → "World Overview".
 */

import { mkMap, mkLocation } from './shared';

export const WORLD_C = {
  locations: [
    mkLocation({ id: 'c-loc-aurora', name: 'Aurora' }),
    mkLocation({ id: 'c-loc-eldoria', name: 'Eldoria', parent_location: 'c-loc-aurora' }),
    mkLocation({ id: 'c-loc-castle', name: 'Castle', parent_location: 'c-loc-eldoria' }),
    mkLocation({ id: 'c-loc-tavern', name: 'Tavern Loc' }),
  ],
  maps: [
    mkMap({ id: 'c-m-world', name: 'World Overview', hierarchy: 0 }),
    mkMap({ id: 'c-m-eldoria', name: 'Eldoria City', location: 'c-loc-eldoria', hierarchy: 0 }),
    mkMap({ id: 'c-m-castle1', name: 'Castle Floor 1', location: 'c-loc-castle', hierarchy: 0 }),
    mkMap({ id: 'c-m-castle2', name: 'Castle Floor 2', location: 'c-loc-castle', hierarchy: 1 }),
    mkMap({ id: 'c-m-throne', name: 'Throne Room', location: 'c-loc-castle', hierarchy: 2 }),
    mkMap({ id: 'c-m-floating-tavern', name: 'Free-floating Tavern', parent_map: 'c-m-eldoria', hierarchy: 0 }),
    mkMap({ id: 'c-m-orphan', name: 'Orphan Map', location: 'c-loc-tavern', hierarchy: 0 }),
    mkMap({ id: 'c-m-broken', name: 'Broken Child', parent_map: 'c-DOES-NOT-EXIST', hierarchy: 0 }),
  ],
} as const;
