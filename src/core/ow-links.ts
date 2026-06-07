/**
 * Canonical OW link patterns — `ow://<type>/<uuid>` is how element chips
 * round-trip through markdown (convention #48). One source for atlas; the
 * chip module (parsing a single href), the load + derive modules (scanning
 * markdown), and the knowledge room all import from here.
 *
 * Lives in core/ (not middle/) so TipTap-free consumers (the relation derive,
 * the knowledge room) can import without pulling the editor bundle in —
 * keeping the TipTap code-split intact.
 *
 * Two flavors, different use cases:
 *   - {@link OW_LINK_HREF_RE} is anchored (`^…$`) for "does this href match
 *     the ow:// scheme?" predicates.
 *   - {@link createOwLinkScanner} returns a FRESH `/g` regex per call —
 *     never share a stateful global regex across scans (lastIndex bites).
 *
 * Match groups (both): `[1]` = element type, `[2]` = uuid.
 */

export const OW_LINK_HREF_RE = /^ow:\/\/([a-z_]+)\/([\w-]+)$/i;

export function createOwLinkScanner(): RegExp {
  return /ow:\/\/([a-z_]+)\/([\w-]+)/gi;
}
