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

export type FailureKind = 'foreign_id' | 'id_in_use' | 'too_large' | 'file_busy' | 'host_refused' | 'not_yours' | 'keeper_only' | 'review_mark' | 'replaced_held' | 'other';

/** Chromium's stock text for a file another program holds; the name is the real signal. */
const HELD_FILE_TEXT = /operation that depends on state cached in an interface object/i;

/**
 * A held file, by the error's name or, where a wrapper lost the name, by
 * Chromium's text. The engine's timed retry and the words read this one
 * test, so a retry is armed for every failure the words call busy.
 */
export function isBusyFailure(f: Pick<PerElementFailure, 'error_name' | 'message'>): boolean {
  return isFileBusyError({ name: f.error_name }) || HELD_FILE_TEXT.test(f.message ?? '');
}

export function classifyFailure(f: PerElementFailure): FailureKind {
  const m = f.message ?? '';
  if (isBusyFailure(f)) return 'file_busy';
  // The web host in front of keel refused the write for its text: a 403 with
  // no keel code (keel names every refusal). By status and the absent code,
  // never the page's text.
  if (f.status === 403 && !f.code) return 'host_refused';
  // Evidence only: a 409 whose read-back FAILED says nothing about
  // which world holds the id, so its message no longer matches here.
  if (/already exists in another world|a copied world folder needs fresh ids/i.test(m)) return 'foreign_id';
  // keel's words for an id a membership holds (the engine's `ID_IN_USE_LINE`, or keel's own): a new id is the
  // way out, as for another world's, but nothing about another world is true.
  if (f.code === 'id_conflict' && /\bis already in use\b/i.test(m)) return 'id_in_use';
  if (/Extension fields may hold at most/i.test(m)) return 'too_large';
  // A member seat's refusals (#104): by keel's code, never its text.
  if (f.status === 403 && (f.code === 'not_author' || f.code === 'owner_only')) return 'not_yours';
  // keel's keeper rule: a world's Charter Laws, every Object a Law's text names, and the charter mark
  // (`x_charter_of`) are changed only by the owner and co-builders; anyone else's write is 403 `keeper_only`.
  if (f.status === 403 && f.code === 'keeper_only') return 'keeper_only';
  // A create sent create-only that keel answered 200 (replaced what it held): never counted as sent.
  if (f.status === 200 && f.operation === 'create') return 'replaced_held';
  // Below co-builder, keel takes a review mark only as the element already holds it or with the writer's own id as its `by`
  // (403 `review_by_another`): a folder's pack-written mark names a Character, so it goes up through the owner or a co-builder.
  if (f.status === 403 && f.code === 'review_by_another') return 'review_mark';
  return 'other';
}

/**
 * The usual cause of the web host's "Blocked" page and what to do (R6): a
 * command right after a code mark. Said only for that page (`host_blocked`).
 * Never the key, the PIN or signing in: nothing is wrong with them.
 * `oneLine`: what was refused is a one-line name, where a code block cannot
 * be written, so the only way out said is the marks left off.
 */
export function hostRefusalCause(then: string, oneLine = false): string {
  const way = oneLine ? 'write it without the marks' : 'write it without the marks, or in a code block that names its language';
  return `A command written between code marks, such as \`python -m\`, is the usual cause: ${way}, ${then}.`;
}

export const HOST_REFUSAL_CAUSE = hostRefusalCause('and it goes up');

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
    parts.push(`${plural(foreign.length, 'element', 'elements')} could not upload because ${foreign.length === 1 ? 'its id already belongs' : 'their ids already belong'} to another OnlyWorlds world. This happens with ${inBrowser ? 'a copied or imported world' : 'a copied or imported folder'}, or a world taken online a second time. ${foreign.length === 1 ? 'It stays safe' : 'They stay safe'} ${inBrowser ? 'in this browser' : 'on your disk'}, and Settings, under This world, can give ${foreign.length === 1 ? 'it a new id' : 'them new ids'}.`);
  }
  const inUse = byKind.get('id_in_use');
  if (inUse) {
    parts.push(`${plural(inUse.length, 'element', 'elements')} could not upload because ${inUse.length === 1 ? 'its id is' : 'their ids are'} already in use on OnlyWorlds. ${inUse.length === 1 ? 'It stays safe' : 'They stay safe'} ${inBrowser ? 'in this browser' : 'on your disk'}, and Settings, under This world, can give ${inUse.length === 1 ? 'it a new id' : 'them new ids'}.`);
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
  // An upload's held file: "in a moment" only where the round armed the
  // retry (`retry_armed`), else the next save. A held file after OnlyWorlds
  // took the change (a note step) says OnlyWorlds has it; the two steps no
  // round redoes point at Settings, where each says what it needs.
  const busyUp = byKind.get('file_busy')?.filter(f => f.operation !== 'read') ?? [];
  const ids = (fs: PerElementFailure[]): string[] => [...new Set(fs.map(f => f.element_id))];
  const heldBy = (n: number): string => inBrowser
    ? 'another Atlas tab was saving to this world'
    : `another program was using ${n === 1 ? 'its file' : 'their files'} in this world's folder. A cloud sync app such as OneDrive or Dropbox, or antivirus, often does this`;
  const againFor = (fs: PerElementFailure[]): string => fs.every(f => f.retry_armed)
    ? 'Atlas tries again in a moment.' : 'Atlas tries again with your next save.';
  const place = inBrowser ? 'in this browser' : 'on your disk';
  const noted = busyUp.filter(f => f.local_step === 'note');
  const notedEdits = busyUp.filter(f => f.local_step === 'note_edit');
  const putBack = busyUp.filter(f => f.local_step === 'put_back');
  const unredone = busyUp.filter(f => f.local_step === 'restore_links' || f.local_step === 'remove');
  const busy = busyUp.filter(f => f.local_step === undefined);
  if (noted.length > 0) {
    const n = ids(noted).length;
    parts.push(`OnlyWorlds has ${plural(n, 'change', 'changes')}, but Atlas could not note ${n === 1 ? 'it' : 'them'} ${place} because ${heldBy(n)}. ${againFor(noted)}`);
  }
  // An edit sent: the next round can read keel's newer stamp as a conflict, so no promise to resend.
  if (notedEdits.length > 0) {
    const n = ids(notedEdits).length;
    parts.push(`OnlyWorlds has ${plural(n, 'edit', 'edits')}, but Atlas could not note ${n === 1 ? 'it' : 'them'} ${place} because ${heldBy(n)}. The next sync may list ${n === 1 ? 'it' : 'them'} as a conflict; both copies hold your change.`);
  }
  // OnlyWorlds refused the delete and kept the element; putting it back here is what failed.
  if (putBack.length > 0) {
    const n = ids(putBack).length;
    parts.push(`OnlyWorlds kept ${plural(n, 'element', 'elements')} when ${n === 1 ? 'it was' : 'they were'} deleted here, but Atlas could not put ${n === 1 ? 'it' : 'them'} back ${place} because ${heldBy(n)}. ${againFor(putBack)}`);
  }
  if (unredone.length > 0) {
    const n = ids(unredone).length;
    parts.push(`Atlas could not finish ${plural(n, 'change', 'changes')} from OnlyWorlds ${place} because ${heldBy(n)}. Settings, under This world, says what happened.`);
  }
  if (busy.length > 0) {
    const n = ids(busy).length;
    parts.push(`${plural(n, 'change', 'changes')} could not sync yet because ${heldBy(n)}. ${n === 1 ? 'It is' : 'They are'} saved ${inBrowser ? 'in this browser' : 'on your disk'}. ${againFor(busy)}`);
  }
  const hostRefused = byKind.get('host_refused');
  if (hostRefused) {
    const place = inBrowser ? 'in this browser' : 'on your disk';
    // Two tiers: the "Blocked" page names its usual cause; any other refusal by the host is said without a guess.
    for (const blocked of [true, false]) {
      const tier = hostRefused.filter(f => (f.host_blocked === true) === blocked);
      const n = new Set(tier.filter(f => f.type !== 'world').map(f => f.element_id)).size;
      const cause = blocked ? ` ${HOST_REFUSAL_CAUSE}` : '';
      if (n > 0) parts.push(`${plural(n, 'change was', 'changes were')} refused by the web host in front of OnlyWorlds before ${n === 1 ? 'it' : 'they'} reached OnlyWorlds.${cause} Nothing was lost: ${n === 1 ? 'the change stays' : 'the changes stay'} ${place}.`);
      if (tier.some(f => f.type === 'world')) parts.push(`A change to this world's details was refused by the web host in front of OnlyWorlds before it reached OnlyWorlds.${cause} Nothing was lost: the change stays ${place}.`);
    }
  }
  const notYours = byKind.get('not_yours');
  if (notYours) {
    const place = inBrowser ? 'in this browser' : 'on your disk';
    const world = notYours.filter(f => f.type === 'world').length > 0;
    const els = notYours.filter(f => f.type !== 'world').length;
    if (els > 0) parts.push(`${plural(els, 'change', 'changes')} could not sync because this world lets Atlas change only what it made: ${els === 1 ? 'that element was' : 'those elements were'} made by someone else. ${els === 1 ? 'The change stays' : 'The changes stay'} ${place}.`);
    if (world) parts.push(`This world's details changed here, and only its owner can change them on OnlyWorlds. The change stays ${place}.`);
  }
  const keeper = byKind.get('keeper_only');
  if (keeper) {
    const n = new Set(keeper.map(f => f.element_id)).size;
    parts.push(`${plural(n, 'change', 'changes')} could not sync because only the world's owner and co-builders can change ${n === 1 ? 'that element' : 'those elements'}. Ask one of them. ${n === 1 ? 'The change stays' : 'The changes stay'} ${inBrowser ? 'in this browser' : 'on your disk'}.`);
  }
  // Not counted as sent, so the next round sends it again as a create: keel answers that it holds it,
  // and Atlas compares the two copies (adopts the same content, holds other content for the person).
  const replaced = byKind.get('replaced_held');
  if (replaced) {
    const n = new Set(replaced.map(f => f.element_id)).size;
    parts.push(`OnlyWorlds answered as if it had replaced ${n === 1 ? 'an element' : `${n} elements`} it already held, though Atlas asked it only to create. ${n === 1 ? 'The copy here is' : 'The copies here are'} unchanged and not marked as sent; your next save sends ${n === 1 ? 'it' : 'them'} again.`);
  }
  const reviewMark = byKind.get('review_mark');
  if (reviewMark) {
    const n = new Set(reviewMark.map(f => f.element_id)).size;
    parts.push(`${plural(n, 'element', 'elements')} could not sync because ${n === 1 ? 'it carries a review mark' : 'they carry review marks'} made by someone else, and only the world's owner or a co-builder can send such a mark. Settings, under This world, ${n === 1 ? 'names it' : 'names them'}. ${n === 1 ? 'It stays' : 'They stay'} ${inBrowser ? 'in this browser' : 'on your disk'}.`);
  }
  const other = byKind.get('other');
  if (other) {
    // The cause stays out of the sentence: it was raw browser or
    // server text. It rides in the toast's Details instead (sync-attach).
    parts.push(`${plural(other.length, 'change', 'changes')} could not sync. Atlas tries again with your next save.`);
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
