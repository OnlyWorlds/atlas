/**
 * Dev-only API base override.
 *
 * Lets a dev build point the whole sync surface (Make-Online, sync engine,
 * v2 element CRUD) at a non-production OnlyWorlds backend — e.g. keel-staging:
 *
 *   localStorage.setItem('atlas_dev_api_base', 'https://keel-staging.onrender.com')
 *
 * The stored value is an ORIGIN (gate 10.7): atlas derives every path prefix
 * from it (`/api/v2` for element CRUD, `/api/worldapi` for the v1 worlds.get
 * validation, `/api/worldsync` for create-world-external). Legacy stored
 * values that include a `/api/worldapi` or `/api/v2` suffix are normalized.
 *
 * Returns null in production builds unconditionally: the override cannot
 * leak past `import.meta.env.DEV`.
 */
export function devApiOrigin(): string | null {
  if (!import.meta.env.DEV) return null;
  try {
    const v = localStorage.getItem('atlas_dev_api_base');
    if (!v || !v.trim()) return null;
    return v.trim()
      .replace(/\/+$/, '')
      .replace(/\/api\/(worldapi|worldsync|v2)$/, '');
  } catch {
    return null;
  }
}

/** Dev override for the v2 element API base, or null. */
export function devV2Base(): string | null {
  const origin = devApiOrigin();
  return origin ? `${origin}/api/v2` : null;
}

/** Dev override for the v1 worldapi base (worlds.get validation), or null. */
export function devWorldapiBase(): string | null {
  const origin = devApiOrigin();
  return origin ? `${origin}/api/worldapi` : null;
}

/** @deprecated legacy alias — returns the v1 worldapi base. */
export function devApiBase(): string | null {
  return devWorldapiBase();
}
