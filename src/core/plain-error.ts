/**
 * An error whose message is already written for the user (S368).
 *
 * The one class of error the UI may show verbatim: `problemFor` passes its
 * message through as the sentence. Every other error is classified and
 * worded by `core/problems.ts`, never shown raw.
 *
 * Its own module with no imports, on purpose: store and sync classes extend
 * it at module load, and a base class that sat inside a larger module's
 * import cycle would be undefined at that moment.
 */
export class PlainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlainError';
  }
}

/** True for a PlainError and every subclass. */
export function isPlainError(err: unknown): err is PlainError {
  return err instanceof PlainError;
}
