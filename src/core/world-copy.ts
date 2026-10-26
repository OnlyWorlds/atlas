/**
 * A view-only copy of a world (#527's second half, conv. 177;
 * contract: a copy-beside design note).
 *
 * A world file whose world is already here can open BESIDE it as a copy, by
 * the folder spec's snapshot rule (§4.2): a fresh world id, `snapshot_of`
 * naming the world it copies, `snapshot_at` only when the file said a time,
 * and `writable: false`. The name stays the source's, verbatim; surfaces
 * compose "copy" from these keys. Any world.json carrying `writable: false`,
 * whoever wrote it, opens view-only here (the first reader to honour it).
 *
 * The registry mirrors it as `copy_of` so the worlds list can name a copy
 * without opening it; the activation heals the mirror from world.json.
 */

export interface CopyOf {
  /** The world this is a copy of (`snapshot_of`), when the file says. */
  world_id?: string;
  /** When the copied world was as this copy holds it (`snapshot_at`), when the file says. */
  at?: string;
}

const isTime = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Number.isFinite(Date.parse(v));
const isId = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** The copy a world.json declares, or null for a world that is its own. */
export function copyOfMeta(meta: unknown): CopyOf | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const m = meta as Record<string, unknown>;
  if (m.writable !== false) return null;
  return {
    ...(isId(m.snapshot_of) ? { world_id: m.snapshot_of } : {}),
    ...(isTime(m.snapshot_at) ? { at: m.snapshot_at } : {}),
  };
}

/** The time a world file says it was taken: its own `snapshot_at`, else its export's `source.at`. Never one Atlas makes up. */
function fileTimeOf(m: Record<string, unknown>): string | undefined {
  if (isTime(m.snapshot_at)) return m.snapshot_at;
  const src = m.source as { at?: unknown } | undefined;
  return src && typeof src === 'object' && isTime(src.at) ? src.at : undefined;
}

/**
 * The copy's world.json from the file's: every key kept verbatim (§4.1's
 * no-drop), and four set: a fresh `id`, `snapshot_of`, `snapshot_at` (only
 * from a time the file said) and `writable: false`. A copy of a copy names
 * the original, never the copy it was made from.
 */
export function copyWorldJson(fileMeta: Record<string, unknown>, freshId: string): Record<string, unknown> {
  const of = fileMeta.writable === false && isId(fileMeta.snapshot_of) ? fileMeta.snapshot_of : fileMeta.id;
  const at = fileTimeOf(fileMeta);
  // A copy is never linked: an `api` block (a world file never carries one,
  // a hand-made one might) would point it at the world it copies.
  const { snapshot_at: _at, api: _link, ...rest } = fileMeta;
  return {
    ...rest,
    id: freshId,
    snapshot_of: of,
    ...(at ? { snapshot_at: at } : {}),
    writable: false,
  };
}

/** The copy's day for people: "24 October 2026" (the reader's own calendar day). */
export function copyDay(at: string | undefined): string | null {
  if (!isTime(at)) return null;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** The worlds list's chip: "copy, 24 Oct", or "copy" with no day. */
export function copyChip(copy: CopyOf): string {
  if (!isTime(copy.at)) return 'copy';
  return `copy, ${new Date(copy.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

/** The same copy already here: same world, same time. A copy with no time is never "the same" as another. */
export function sameCopy(a: CopyOf | undefined | null, b: CopyOf | null): boolean {
  return !!a && !!b && !!a.world_id && a.world_id === b.world_id && !!a.at && a.at === b.at;
}

/** Is this registry row the world a copy copies? (Its own id, as its handle key holds it, or its link's server id.) */
export function worldIsCopiedBy(w: { folder?: { handle_key?: string }; api?: { world_id?: string } }, copy: CopyOf): boolean {
  if (!copy.world_id) return false;
  return w.folder?.handle_key === `world-${copy.world_id}` || w.api?.world_id === copy.world_id;
}

/** The copy line on Home and in the right pane: what this is, and where the world itself is. */
export function copyLine(name: string, copy: CopyOf, worldHere: boolean): string {
  const day = copyDay(copy.at);
  const what = day ? `A copy of ${name} from ${day}, view only.` : `A copy of ${name}, view only.`;
  return worldHere ? `${what} The world itself is ${name} in your list of worlds.` : what;
}
