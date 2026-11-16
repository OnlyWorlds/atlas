/**
 * The web host's "Blocked" page, the one test Atlas reads it by (conv. 191).
 *
 * The host in front of keel answers some writes 403 with its own HTML page
 * titled "Blocked" when their text holds a shell command right after a code
 * mark, a semicolon or a pipe; keel never sees them. The SDK's
 * `OwApiError.isHostBlocked` reads the same page (its test is not exported).
 *
 * The guards on the answer: a 403, a body that is not a JSON object or list
 * (so no keel envelope either: keel answers every error in its JSON
 * envelope, an object), and an HTML title that says "Blocked". Read on the
 * whole body.
 */
export function isHostBlockedPage(status: number, body: string): boolean {
  if (status !== 403) return false;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === 'object') return false;
  } catch { /* not JSON: the host's page, perhaps */ }
  return /<title[^>]*>[^<]*\bBlocked\b[^<]*<\/title>/i.test(body);
}
