/**
 * What to tell the user when elements fail to sync.
 *
 * The old toast said "Check console or test connection in settings" for every
 * failure. For the commonest persistent ones that advice is wrong (the
 * connection test passes) and the real cause sat in the console:
 *   - an element id that already belongs to ANOTHER OnlyWorlds world (a copied
 *     or imported folder, the tour world, a world unlinked and taken online
 *     again). keel answers 409 and a read-back in this world 404s.
 *   - more than 64 KB of extension fields on one element (keel's cap).
 * Both repeat every round until the user acts, so each distinct set is
 * toasted once per session, not on every autosave.
 */
import type { PerElementFailure } from '../core/types';
import { isFileBusyError } from '../store/fs-utils';

export type FailureKind = 'foreign_id' | 'too_large' | 'file_busy' | 'not_yours' | 'other';

/** Chromium's stock text for a file another program holds; the name is the real signal. */
const HELD_FILE_TEXT = /operation that depends on state cached in an interface object/i;

export function classifyFailure(f: PerElementFailure): FailureKind {
  const m = f.message ?? '';
  if (isFileBusyError({ name: f.error_name }) || HELD_FILE_TEXT.test(m)) return 'file_busy';
  // Evidence only: a 409 whose read-back FAILED says nothing about
  // which world holds the id, so its message no longer matches here.
  if (/already exists in another world|a copied world folder needs fresh ids/i.test(m)) return 'foreign_id';
  if (/Extension fields may hold at most/i.test(m)) return 'too_large';
  // A member seat's refusals (#104): by keel's code, never its text.
  if (f.status === 403 && (f.code === 'not_author' || f.code === 'owner_only')) return 'not_yours';
  return 'other';
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * One plain sentence per failure kind present, most actionable first. Every
 * place word is true for where the world keeps its files (1.17): in this
 * browser only another Atlas tab holds a file, never OneDrive.
 */
export function describeFailures(failures: readonly PerElementFailure[], where: 'folder' | 'browser' = 'folder'): string {
  const inBrowser = where === 'browser';
  const byKind = new Map<FailureKind, PerElementFailure[]>();
  for (const f of failures) {
    const k = classifyFailure(f);
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(f);
  }
  const parts: string[] = [];
  const foreign = byKind.get('foreign_id');
  if (foreign) {
    parts.push(`${plural(foreign.length, 'element', 'elements')} could not upload because ${foreign.length === 1 ? 'its id already belongs' : 'their ids already belong'} to another OnlyWorlds world. This happens with ${inBrowser ? 'an imported world' : 'a copied or imported folder'}, or a world taken online a second time. ${foreign.length === 1 ? 'It stays safe' : 'They stay safe'} ${inBrowser ? 'in this browser' : 'on your disk'}, and Settings can give ${foreign.length === 1 ? 'it a new id' : 'them new ids'}.`);
  }
  const large = byKind.get('too_large');
  if (large) {
    parts.push(`${plural(large.length, 'element holds', 'elements hold')} more than 64 KB of custom fields, which is more than OnlyWorlds accepts per element. Shorten a custom field to let ${large.length === 1 ? 'it' : 'them'} sync.`);
  }
  // Counted by element: the world's own sync record can report twice in one
  // round (the world step and the round's end), and it is one change.
  // An upload's held file is retried by the engine; a held file on the pull
  // side (operation `read`) waits for the next refresh.
  const busyPull = [...new Set(byKind.get('file_busy')?.filter(f => f.operation === 'read').map(f => f.element_id) ?? [])];
  if (busyPull.length > 0) {
    parts.push(inBrowser
      ? `${plural(busyPull.length, 'newer copy', 'newer copies')} from OnlyWorlds could not be saved because another Atlas tab was saving to this world. Refresh in a moment to try again.`
      : `${plural(busyPull.length, 'newer copy', 'newer copies')} from OnlyWorlds could not be saved because another program was using ${busyPull.length === 1 ? 'its file' : 'their files'} in this world's folder. A cloud sync app such as OneDrive or Dropbox, or antivirus, often does this. Refresh in a moment to try again.`);
  }
  const busy = [...new Set(byKind.get('file_busy')?.filter(f => f.operation !== 'read').map(f => f.element_id) ?? [])];
  if (busy.length > 0) {
    parts.push(inBrowser
      ? `${plural(busy.length, 'change', 'changes')} could not sync yet because another Atlas tab was saving to this world. ${busy.length === 1 ? 'It is' : 'They are'} saved in this browser, and Atlas will try again in a moment.`
      : `${plural(busy.length, 'change', 'changes')} could not sync yet because another program was using ${busy.length === 1 ? 'its file' : 'their files'} in this world's folder. A cloud sync app such as OneDrive or Dropbox, or antivirus, often does this. ${busy.length === 1 ? 'It is' : 'They are'} saved on your disk, and Atlas will try again in a moment.`);
  }
  const notYours = byKind.get('not_yours');
  if (notYours) {
    const place = inBrowser ? 'in this browser' : 'on your disk';
    const world = notYours.filter(f => f.type === 'world').length > 0;
    const els = notYours.filter(f => f.type !== 'world').length;
    if (els > 0) parts.push(`${plural(els, 'change', 'changes')} could not sync because this world lets Atlas change only what it made: ${els === 1 ? 'that element was' : 'those elements were'} made by someone else. ${els === 1 ? 'The change stays' : 'The changes stay'} ${place}.`);
    if (world) parts.push(`This world's details changed here, and only its owner can change them on OnlyWorlds. The change stays ${place}.`);
  }
  const other = byKind.get('other');
  if (other) {
    // The cause stays out of the sentence: it was raw browser or
    // server text. It rides in the toast's Details instead (sync-attach).
    parts.push(`${plural(other.length, 'change', 'changes')} could not sync. Atlas will try again with your next save.`);
  }
  return parts.join(' ');
}

const shownThisSession = new Set<string>();

/**
 * The toast text for this round's failures, or null when this exact set was
 * already shown this session (a persistent failure retried every autosave).
 */
export function failureToastOnce(failures: readonly PerElementFailure[], where: 'folder' | 'browser' = 'folder'): string | null {
  // One round's result reaches this twice (the engine's result handler, then
  // the attach flush or Make online): the second call must not undo the
  // quiet first busy failure.
  // Keyed on the failure objects, which a filtered copy of the list shares.
  const fresh = failures.filter(f => !decided.has(f));
  for (const f of fresh) decided.add(f);
  // A held file is usually let go within seconds and the engine retries on
  // its own, so an element's FIRST busy failure stays quiet; it is
  // said only if that element meets a held file again.
  const toShow = fresh.filter(f => {
    if (classifyFailure(f) !== 'file_busy' || busySeen.has(f.element_id)) return true;
    busySeen.add(f.element_id);
    return false;
  });
  if (toShow.length === 0) return null;
  const key = toShow.map(f => `${classifyFailure(f)}:${f.element_id}`).sort().join('|');
  if (shownThisSession.has(key)) return null;
  shownThisSession.add(key);
  return describeFailures(toShow, where);
}

const busySeen = new Set<string>();
const decided = new WeakSet<PerElementFailure>();

/** Test seam. */
export function __resetFailureToasts(): void {
  shownThisSession.clear();
  busySeen.clear();
}
