/**
 * Dev-only API base override.
 *
 * Lets a dev build point the whole sync surface (Make-Online, sync engine)
 * at a non-production OnlyWorlds API — e.g. keel-staging — via:
 *
 *   localStorage.setItem('atlas_dev_api_base', 'https://keel-staging.onrender.com/api/worldapi')
 *
 * Returns null in production builds unconditionally: the override cannot
 * leak past `import.meta.env.DEV`.
 */
export function devApiBase(): string | null {
  if (!import.meta.env.DEV) return null;
  try {
    const v = localStorage.getItem('atlas_dev_api_base');
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}
