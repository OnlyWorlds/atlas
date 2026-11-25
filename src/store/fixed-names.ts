/**
 * The folder format's three fixed names: `world.json`, `elements/` and
 * `spatial/` (folder spec 4.8). A world folder that holds one of them only
 * in another case (`Elements/` and no `elements/`) is refused with that
 * cause, on every disk. Atlas reaches the three by name, so on a disk that
 * tells capitals apart such a folder read as an empty world, and the first
 * new element made `elements/` beside `Elements/`: the old elements unread,
 * the new ones in the other folder.
 *
 * The rule and the fold are the SDK's (`misnamedFixedName`, its folder
 * reader, from 4.204.0): NFC, then simple case folding, so `spatial/` with a
 * long s first is `spatial/` in another case. That function is not exported
 * at the root yet, so this is its copy over the SDK's own fold; it goes when
 * the root exports it.
 */

import { nfc, simpleCaseFold } from '@onlyworlds/sdk';
import { PlainError } from '../core/plain-error';

const FIXED_NAMES = [['world.json', false], ['elements', true], ['spatial', true]] as const;

export interface Misnamed {
  /** The name as the folder writes it (a folder's with its `/`). */
  found: string;
  /** The name the folder format gives it. */
  wanted: string;
}

/**
 * The first fixed name these entries hold only in another case, or null. A
 * name held as written, as the right kind (a file or a folder), is never
 * misnamed, whatever sits beside it.
 */
export function misnamedFixedName(entries: Iterable<{ name: string; folder: boolean }>): Misnamed | null {
  const firsts = new Map<string, boolean>();
  for (const e of entries) firsts.set(e.name, (firsts.get(e.name) ?? false) || e.folder);
  for (const [name, isFolder] of FIXED_NAMES) {
    if (firsts.get(name) === isFolder) continue;
    for (const [first, folder] of firsts) {
      if (folder === isFolder && first !== name && simpleCaseFold(nfc(first)) === name) {
        return isFolder ? { found: `${first}/`, wanted: `${name}/` } : { found: first, wanted: name };
      }
    }
  }
  return null;
}

/** The refusal, in the SDK's words for a folder. */
export function misnamedSentence(m: Misnamed): string {
  return `This world folder holds ${m.found} where the folder format names ${m.wanted}, so Atlas does not open it: rename it ${m.wanted} and open it again.`;
}

/** Lists the folder's own entries and throws the refusal when a fixed name is held only in another case. */
export async function refuseMisnamedFolder(dir: FileSystemDirectoryHandle): Promise<void> {
  const entries: { name: string; folder: boolean }[] = [];
  // @ts-expect-error `values()` is part of the File System Access API, not yet in lib.dom
  for await (const entry of dir.values()) entries.push({ name: entry.name, folder: entry.kind === 'directory' });
  const misnamed = misnamedFixedName(entries);
  if (misnamed) throw new PlainError(misnamedSentence(misnamed));
}
