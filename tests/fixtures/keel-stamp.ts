/**
 * keel's stamp, as keel writes it: Python `isoformat()` in UTC, `+00:00`, six-digit
 * microseconds, no fraction at all when the microseconds are 0 (keel
 * `elements/serialize.py`, `bulk.py`, `changes.py`). Atlas writes `toISOString()`
 * (`.sssZ`), so a fake that stamped `Z` let every text comparison of the two forms
 * pass by luck.
 *
 * `keelStampClock` wraps whatever clock a suite injects: the clock still decides the
 * millisecond, and a counter fills the microseconds below it (1 to 999, then 0 on
 * every thousandth write), so an answer is seldom on a millisecond and, now and then,
 * on a whole second with no fraction. A value the wrapper cannot read as a time
 * passes through as it is.
 */
import { instantOf } from '@onlyworlds/sdk';

/** keel's text for an instant: `YYYY-MM-DDTHH:MM:SS[.ffffff]+00:00`. */
export function keelIsoformat(seconds: number, microseconds: number): string {
  const head = new Date(seconds * 1000).toISOString().slice(0, 19);
  return microseconds === 0 ? `${head}+00:00` : `${head}.${String(microseconds).padStart(6, '0')}+00:00`;
}

/** Any readable time in keel's form, the instant kept to the microsecond; anything else as it is. */
export function keelForm(value: string): string {
  const at = instantOf(value);
  return at ? keelIsoformat(at.seconds, at.microseconds) : value;
}

/** A clock that answers in keel's form, with microseconds from a counter below the clock's millisecond. */
export function keelStampClock(clock: () => string): () => string {
  let n = 0;
  return () => {
    const raw = clock();
    const at = instantOf(raw);
    if (!at) return raw;
    n += 1;
    // A clock that already gives microseconds keeps them; a millisecond clock gets the counter's.
    const micro = at.microseconds % 1000 === 0 ? at.microseconds + (n % 1000) : at.microseconds;
    return keelIsoformat(at.seconds, micro);
  };
}
