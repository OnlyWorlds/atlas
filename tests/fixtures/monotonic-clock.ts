/**
 * MonotonicClock — strictly-increasing ISO timestamp generator for tests.
 *
 * Wallclock with millisecond precision collides under fast successive calls.
 * SyncEngine logic depends on `local_updated_at > server_updated_at` being
 * meaningful, so tests pass a shared monotonic clock to both the folder and
 * the api client.
 *
 * The clock advances exactly 1ms per call.
 */

export class MonotonicClock {
  private epochMs: number;

  constructor(startIso?: string) {
    this.epochMs = startIso ? Date.parse(startIso) : Date.now();
  }

  /** Return the next ISO timestamp (strictly greater than the previous). */
  next = (): string => {
    this.epochMs += 1;
    return new Date(this.epochMs).toISOString();
  };
}
