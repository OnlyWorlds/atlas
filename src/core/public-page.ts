/**
 * A world's public page on onlyworlds.com (Keel #471, PRs 173 and 176; D155;
 * Skeld h29 #11219): keel serves it at `/w/<slug>`, or `/w/<world id>` when the
 * world has no slug, once its owner turns it on. Atlas only links to it: the
 * page is keel's, read by anyone with the address, and whether it is on is
 * keel's setting, read live from `GET /world`, never kept in the folder.
 *
 * Pure: keel's world body in, the page's address out, or null when the page
 * is off or the body says nothing about it.
 */
export const PUBLIC_PAGE_ORIGIN = 'https://www.onlyworlds.com';

export function publicPageUrl(world: Record<string, unknown> | null | undefined): string | null {
  if (!world) return null;
  const page = world.public_page;
  if (!page || typeof page !== 'object' || (page as Record<string, unknown>).on !== true) return null;
  const slug = typeof world.slug === 'string' ? world.slug.trim() : '';
  const id = typeof world.id === 'string' ? world.id.trim() : '';
  const at = slug || id;
  return at ? `${PUBLIC_PAGE_ORIGIN}/w/${encodeURIComponent(at)}` : null;
}
