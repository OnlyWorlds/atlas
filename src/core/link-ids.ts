/** A multi-link value as ids: string arrays, `{id}` objects and a lone id string all read (S360, conv. 94). */
export function linkIdsOf(raw: unknown): string[] {
  if (typeof raw === 'string') return raw ? [raw] : [];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && v) out.push(v);
    else if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string') out.push((v as { id: string }).id);
  }
  return out;
}
