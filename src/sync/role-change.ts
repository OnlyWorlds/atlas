/**
 * A member's role moved: the copy keeps what it has, and the person is told
 * once (B12 Q2, the Captain h20 #8014; conv. 151; contract
 * `Forge/Notes/2026-10-20-s439-role-change-keeps-the-copy.md`).
 *
 * keel's `GET /me` names the key's role. The engine reads it when a resync or
 * a guest's 404 needs it and reports it in the round's result; the attach
 * records it on the registry entry (`api.member_role`) and says a change from
 * a known role once. Pure: the words, and whether a move is worth a line.
 */
import type { WorldRegistryEntry } from '../core/types';

const RANK: Record<string, number> = { guest: 0, contributor: 1, co_builder: 2, owner: 3 };

/** The role a person reads: "a guest", "a contributor", "a co-builder", "the owner". */
function roleWords(role: string): string | null {
  switch (role) {
    case 'guest': return 'a guest';
    case 'contributor': return 'a contributor';
    case 'co_builder': return 'a co-builder';
    case 'owner': return 'the owner';
    default: return null;
  }
}

/**
 * The once-said line for a role that moved from a known role, or null (first
 * sight, no move, a role keel may add later). `readOnly`: the world opened on
 * a read key, so a raise needs a key that edits.
 */
export function roleChangeLine(worldName: string, from: string | undefined, to: string, readOnly: boolean): string | null {
  if (from === undefined || from === to) return null;
  const words = roleWords(to);
  if (!words || RANK[from] === undefined) return null;
  const lowered = RANK[to] < RANK[from];
  const keeps = ' Your copy keeps everything you had.';
  switch (to) {
    case 'guest':
      // A copy opened to read takes no edits, so it promises none (the S439 gate's G8).
      return readOnly
        ? `You are now a guest in ${worldName}.${keeps} What you no longer see online stays here as it is.`
        : `You are now a guest in ${worldName}.${keeps} What you no longer see online stays here as it is, and changes you make to it stay here too.`;
    case 'contributor':
      return `You are now a contributor in ${worldName}: you can add to it and change what you add.${lowered ? keeps : editTail(readOnly)}`;
    case 'co_builder':
      return `You are now a co-builder in ${worldName}: you can change everything in it.${editTail(readOnly)}`;
    default:
      return `You are now the owner of ${worldName}.${editTail(readOnly)}`;
  }
}

function editTail(readOnly: boolean): string {
  return readOnly ? ' This copy opened to read: Settings, This world can give it a key that edits.' : '';
}

/** Local edits to elements this key no longer sees: said once per element per session. */
export function keptEditsLine(worldName: string, n: number): string {
  return n === 1
    ? `Your change to 1 element stays here: OnlyWorlds no longer shows it to you in ${worldName}.`
    : `Your changes to ${n} elements stay here: OnlyWorlds no longer shows them to you in ${worldName}.`;
}

/** A resync kept elements and no role line said so (the role was not known before). */
export function keptLine(worldName: string, n: number): string {
  return n === 1
    ? `1 element of ${worldName} is no longer shown to you online. Your copy keeps it as it is, and it no longer syncs.`
    : `${n} elements of ${worldName} are no longer shown to you online. Your copy keeps them as they are, and they no longer sync.`;
}

/**
 * Settings, This world: what a member's key may do, and what is kept. Null
 * for the owner, a role not yet read, and nothing kept.
 */
export function memberRoleLine(entry: WorldRegistryEntry, keptCount: number): string | null {
  const role = entry.api?.member_role;
  const parts: string[] = [];
  // Under "can only read", the role alone: the copy takes no edits (the S439 gate's G8).
  const reads = !!entry.api?.read_only;
  if (role === 'guest') parts.push(reads ? 'You are a guest in this world.' : 'You are a guest in this world: you can add to it and change what you made.');
  else if (role === 'contributor') parts.push(reads ? 'You are a contributor in this world.' : 'You are a contributor in this world: you can add to it and change what you add.');
  else if (role === 'co_builder') parts.push(reads ? 'You are a co-builder in this world.' : 'You are a co-builder in this world: you can change everything in it.');
  if (keptCount > 0) {
    parts.push(keptCount === 1
      ? '1 element here is kept from before: OnlyWorlds no longer shows it to you, so it no longer syncs.'
      : `${keptCount} elements here are kept from before: OnlyWorlds no longer shows them to you, so they no longer sync.`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}
