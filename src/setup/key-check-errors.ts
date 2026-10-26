/**
 * A failed key check, in words.
 *
 * Three flows ask OnlyWorlds "is this key good?" before they touch a folder:
 * link a world, view a shared world (`linkExistingApiWorldInRoot`) and Make
 * online's link route. Each used to read the error's text with a regex and
 * rethrow the raw text when no pattern matched. This names the cases Atlas
 * can explain as `PlainError`s and hands every other error back unchanged,
 * so the catch site words it with `problemFor` / `showProblem`.
 *
 * The status comes from `OwV2Error.status`, or from the legacy
 * "API Error NNN:" prefix: never from a digit run anywhere in the text.
 */
import { PlainError } from '../core/plain-error';
import { classifyError } from '../core/problems';

/** Said when the check could not reach OnlyWorlds at all. */
export const CANNOT_REACH_LINE = 'Atlas could not reach OnlyWorlds. Check your connection, then try again.';

function statusOf(err: unknown): number | null {
  const s = (err as { status?: unknown } | null)?.status;
  if (typeof s === 'number') return s;
  if (!(err instanceof Error)) return null;
  const m = /^API Error (\d{3})\b/.exec(err.message);
  return m ? Number(m[1]) : null;
}

/**
 * The error a failed key check should throw: a `PlainError` for a refused
 * key, an unknown world or no connection; otherwise `err` itself.
 */
export function keyCheckError(err: unknown, opts: { readOnly?: boolean } = {}): unknown {
  const status = statusOf(err);
  // keel names the half it refused: a right key with a wrong PIN is
  // invalid_credentials with param "API-Pin" ("Incorrect PIN."), a wrong key
  // has none (#417's live walk: a wrong PIN was told as a wrong key).
  const param = (err as { param?: unknown } | null)?.param;
  if (status === 401 && !opts.readOnly && typeof param === 'string' && param.toLowerCase() === 'api-pin') {
    return new PlainError('OnlyWorlds did not accept that PIN. Check it, then try again.');
  }
  if (status === 401 || status === 403) {
    return new PlainError(opts.readOnly
      ? 'OnlyWorlds did not accept that read key. Check it, then try again.'
      : 'OnlyWorlds did not accept that API key. Check it, then try again.');
  }
  if (status === 404) {
    return new PlainError('OnlyWorlds has no world for that key. Check the key, then try again.');
  }
  if (classifyError(err) === 'offline') return new PlainError(CANNOT_REACH_LINE);
  return err;
}
