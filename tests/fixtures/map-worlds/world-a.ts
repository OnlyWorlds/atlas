/**
 * World A — Pure parent_map nesting (sci-fi multiverse).
 * No Location elements. Tests the explicit-parent_map code path in buildMapTree.
 *
 * Expected tree:
 *   Multiverse
 *   ├── Universe Alpha
 *   │   ├── Continent Aurora
 *   │   │   ├── Eldoria City
 *   │   │   │   └── Castle Interior
 *   │   │   └── Twin City
 *   │   └── Continent Borealis
 *   └── Universe Beta
 *       └── Continent Caelum
 */

import { mkMap } from './shared';

export const WORLD_A = {
  locations: [],
  maps: [
    mkMap({ id: 'a-multiverse', name: 'Multiverse', hierarchy: 0 }),
    mkMap({ id: 'a-alpha', name: 'Universe Alpha', parent_map: 'a-multiverse', hierarchy: 0 }),
    mkMap({ id: 'a-beta', name: 'Universe Beta', parent_map: 'a-multiverse', hierarchy: 1 }),
    mkMap({ id: 'a-aurora', name: 'Continent Aurora', parent_map: 'a-alpha', hierarchy: 0 }),
    mkMap({ id: 'a-borealis', name: 'Continent Borealis', parent_map: 'a-alpha', hierarchy: 1 }),
    mkMap({ id: 'a-caelum', name: 'Continent Caelum', parent_map: 'a-beta', hierarchy: 0 }),
    mkMap({ id: 'a-eldoria', name: 'Eldoria City', parent_map: 'a-aurora', hierarchy: 0 }),
    mkMap({ id: 'a-twin', name: 'Twin City', parent_map: 'a-aurora', hierarchy: 1 }),
    mkMap({ id: 'a-castle', name: 'Castle Interior', parent_map: 'a-eldoria', hierarchy: 0 }),
  ],
} as const;
