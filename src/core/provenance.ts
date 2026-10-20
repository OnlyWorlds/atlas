/**
 * The folder format's provenance lines (spec §4.2, v0.3.9): `source` says
 * where a portable copy came from, `exported_as` which slice of the world it
 * is. Atlas writes both into the world file of a linked world, says the slice
 * wherever it shows a world that carries one, and refuses to put a slice that
 * is not the whole world online as a world of its own. The contract:
 * `Forge/Notes/2026-10-20-s446-provenance-lines.md` (W1-W3, R1, P1, K1).
 */

export interface WorldSource {
  server: string;
  world: string;
  at: string;
}

export type SliceKind = 'owner' | 'member' | 'character' | 'public';

export interface ExportedAs {
  kind: SliceKind;
  role: string | null;
  character: { id: string; name: string } | null;
}

/**
 * W3: the slice from `/me`, as the spec's table maps it. A guest's slice
 * needs its Character by id and name; when either cannot be known the answer
 * is null, and the file carries no line (absent, never guessed).
 */
export function exportedAsFromMe(
  me: { role: string; character?: string | null },
  nameOf: (id: string) => string | undefined,
): ExportedAs | null {
  if (me.role === 'owner') return { kind: 'owner', role: 'owner', character: null };
  if (me.role === 'co_builder' || me.role === 'contributor') return { kind: 'member', role: me.role, character: null };
  if (me.role === 'guest') {
    const id = typeof me.character === 'string' && me.character ? me.character : null;
    const name = id ? nameOf(id) : undefined;
    return id && name ? { kind: 'character', role: 'guest', character: { id, name } } : null;
  }
  return null;
}

/**
 * W2, W3: a linked world's world.json as it goes into its world file. `source`
 * is always fresh; `exported_as` is this export's answer, and an older line is
 * removed when this export cannot know the slice.
 */
export function withProvenance(
  meta: Record<string, unknown>,
  source: WorldSource,
  exportedAs: ExportedAs | null,
): Record<string, unknown> {
  const { exported_as: _old, ...rest } = meta;
  return exportedAs ? { ...rest, source, exported_as: exportedAs } : { ...rest, source };
}

/** The slice a world.json says it is, read defensively (world data is untrusted, conv. 93). */
const NAME_SHOWN_MAX = 80;

export function sliceOf(meta: unknown): { kind: SliceKind; role: string | null; name: string | null; at: string | null; host: string | null } | null {
  if (!meta || typeof meta !== 'object') return null;
  const m = meta as Record<string, unknown>;
  const ex = m.exported_as;
  if (!ex || typeof ex !== 'object') return null;
  const e = ex as Record<string, unknown>;
  const kind = e.kind;
  if (kind !== 'owner' && kind !== 'member' && kind !== 'character' && kind !== 'public') return null;
  const ch = e.character && typeof e.character === 'object' ? e.character as Record<string, unknown> : null;
  const raw = ch && typeof ch.name === 'string' && ch.name.trim() ? ch.name.trim() : null;
  const name = raw && raw.length > NAME_SHOWN_MAX ? `${raw.slice(0, NAME_SHOWN_MAX).trimEnd()}…` : raw;
  const src = m.source && typeof m.source === 'object' ? m.source as Record<string, unknown> : null;
  const at = src && typeof src.at === 'string' ? src.at : null;
  let host: string | null = null;
  if (src && typeof src.server === 'string') {
    try { host = new URL(src.server).host.replace(/^www\./, '') || null; } catch { host = null; }
  }
  return { kind, role: typeof e.role === 'string' ? e.role : null, name, at, host };
}

/** A slice that is not the whole world: a Character's view, or the public one. */
export function isPartialSlice(meta: unknown): boolean {
  const s = sliceOf(meta);
  return s?.kind === 'character' || s?.kind === 'public';
}

function viewOf(s: NonNullable<ReturnType<typeof sliceOf>>): string {
  if (s.kind === 'public') return "the world's public view";
  return s.name ? `${s.name}'s view` : "one Character's view";
}

/** An export's ISO time as a reader's date ("20 October 2026"); null when it is not a date. */
export function exportDate(iso: string): string | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** R1, Settings: where the copy came from and which slice it is; null for a world with no line. */
export function sliceLine(meta: unknown, formatDate: (iso: string) => string | null): string | null {
  const s = sliceOf(meta);
  if (!s) return null;
  const when = s.at ? formatDate(s.at) : null;
  const where = s.host ? `Exported from ${s.host}` : 'Exported';
  const from = when ? `${where} on ${when}` : where;
  if (s.kind === 'owner') return `${from} by its owner: the whole world.`;
  if (s.kind === 'member') return `${from} by ${s.role === 'co_builder' ? 'a co-builder' : s.role === 'contributor' ? 'a contributor' : 'a member'}.`;
  if (s.kind === 'public') return `${from}: the world's public view, not the whole world.`;
  return `${from} as ${viewOf(s)}: only what ${s.name ?? 'that Character'} knows of the world.`;
}

/** R1, Home: one line for a slice that is not the whole world. */
export function partialSliceNote(meta: unknown): string | null {
  const s = sliceOf(meta);
  if (!s || (s.kind !== 'character' && s.kind !== 'public')) return null;
  return s.kind === 'public'
    ? "This is the world's public view, not the whole world."
    : `This is ${viewOf(s)} of the world, not the whole world.`;
}

/** The download button's words: a slice is not "the whole world" (the S446 gate's G8). */
export function downloadLabel(meta: unknown): string {
  return isPartialSlice(meta) ? 'Download this world' : 'Download the whole world';
}

/** P1: why a slice cannot go online as a world of its own; null when it can. */
export function slicePushRefusal(meta: unknown, worldName: string): string | null {
  const s = sliceOf(meta);
  if (!s || (s.kind !== 'character' && s.kind !== 'public')) return null;
  return `This is ${viewOf(s)} of ${worldName}, not the whole world, so it can't go online as a world of its own.`;
}
