/**
 * World B — Pure location-based (TTRPG city).
 * Maps anchor to Locations only; no explicit parent_map. Tests
 * location-inferred placement, including the algorithm's ability to hop
 * over intermediate locations that have no maps.
 *
 * Locations form a chain: Region → City → District N → Block A → Tavern,
 * plus a side branch: City → District S, and City → Castle.
 *
 * Maps exist for: Region, City, Tavern, Castle. District N, District S,
 * Block A have NO maps. The algorithm walks past them transparently.
 *
 * Expected tree:
 *   Region Overview
 *   └── City Map
 *       ├── Castle Map        (chain: Castle → City)
 *       └── Tavern Interior   (chain: Tavern → Block A → District N → City)
 */

import { mkMap, mkLocation } from './shared';

export const WORLD_B = {
  locations: [
    mkLocation({ id: 'b-loc-region', name: 'Region' }),
    mkLocation({ id: 'b-loc-city', name: 'City', parent_location: 'b-loc-region' }),
    mkLocation({ id: 'b-loc-distN', name: 'District N', parent_location: 'b-loc-city' }),
    mkLocation({ id: 'b-loc-distS', name: 'District S', parent_location: 'b-loc-city' }),
    mkLocation({ id: 'b-loc-blockA', name: 'Block A', parent_location: 'b-loc-distN' }),
    mkLocation({ id: 'b-loc-tavern', name: 'Tavern', parent_location: 'b-loc-blockA' }),
    mkLocation({ id: 'b-loc-castle', name: 'Castle', parent_location: 'b-loc-city' }),
  ],
  maps: [
    mkMap({ id: 'b-m-region', name: 'Region Overview', location: 'b-loc-region', hierarchy: 0 }),
    mkMap({ id: 'b-m-city', name: 'City Map', location: 'b-loc-city', hierarchy: 0 }),
    mkMap({ id: 'b-m-tavern', name: 'Tavern Interior', location: 'b-loc-tavern', hierarchy: 0 }),
    mkMap({ id: 'b-m-castle', name: 'Castle Map', location: 'b-loc-castle', hierarchy: 0 }),
  ],
} as const;
