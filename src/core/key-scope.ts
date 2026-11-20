/**
 * What a world key can do, by its shape, and the PIN that may go beside it.
 *
 * keel names a key by its scope: `ow_r_` reads, `ow_w_` writes. A classic
 * ten-digit key in the demo range reads; every other classic key writes. A
 * PIN proves who may write, so it goes only beside a key that writes: keel
 * does not read one sent beside a read key, and while it still does, a wrong
 * one there counts against the account the PIN belongs to.
 *
 * Its own module with one leaf import, so the wire clients (the adapter, the
 * sharing client, the SDK handoffs) can all ask it.
 */
import { isDemoKey } from './constants';

/** True when the key can only read: an `ow_r_` key, or a demo-range classic key. */
export function readsOnlyByShape(apiKey: string): boolean {
  const key = apiKey.trim();
  return key.startsWith('ow_r_') || isDemoKey(key);
}

/** The PIN to send beside this key: none beside a key that can only read. */
export function pinBeside(apiKey: string, pin: string | null | undefined): string {
  if (!pin || readsOnlyByShape(apiKey)) return '';
  return pin;
}
