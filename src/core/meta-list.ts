/**
 * A world's list fields (`time_format_names`, `time_format_equivalents`) as
 * Atlas reads them, from keel, a folder or an import. The standard types the
 * equivalents as whole numbers and keel stores them so since ca181a3 (h29
 * #2723); older worlds hold strings. Both are kept as they are, so a
 * round trip never changes a world's shape; anything else in the list is
 * dropped. One reader for sync, the calendar offer and the import: three
 * string-only filters read [1, 7, 30, 365] as an empty list.
 */
export type MetaListItem = string | number;

export function metaList(v: unknown): MetaListItem[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is MetaListItem =>
    typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x)));
}
