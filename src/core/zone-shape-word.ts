/**
 * Until the schema carries a zone's shape (the Captain's Q1 (c), motion #362),
 * other tools cannot tell an area from a line by anything on the wire. The
 * Captain's interim (h20 #6839): a new zone whose supertype the user left
 * empty gets the shape's word there, `polygon` or `line`. A supertype the user
 * typed is theirs and is never touched (ZD6). Atlas itself reads the shape
 * from `atlas_shape`, never from this word.
 */
export function supertypeForNewZone(typed: string | undefined, shape: 'polygon' | 'line'): string {
  const own = (typed ?? '').trim();
  return own || shape;
}
