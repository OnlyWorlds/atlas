/**
 * A shared world reviews before it overwrites (B12 Q1, the Captain's (a),
 * h20 #8007; contract `Forge/Notes/2026-10-20-s437-shared-world-review-default.md`).
 *
 * In a world others can write to, Local wins would put this copy's version of
 * an element over a collaborator's newer words without a word. So a shared
 * world syncs as pause-and-review (both changed: held for the person to
 * choose) and pulls when it opens; a person working alone keeps the policy
 * Settings names. The person can turn the rule off per world, and Settings
 * says so wherever the rule overrides their choice.
 *
 * Pure: the attach (`sync-attach.ts`) learns `shared_with_others` from keel's
 * roster and asks these for the engine's policy and the pull on open.
 */
import type { OwMember } from '@onlyworlds/sdk';
import type { WorldRegistryEntry, WorldsRegistry } from '../core/types';

export type SyncPolicy = 'local-wins' | 'pause-and-review';

/** Someone besides the owner can write here: an active person or agent. A player (keel's no-account link, view only) does not count. */
export function rosterIsShared(rows: readonly OwMember[]): boolean {
  return rows.some(r => r.status === 'active' && (r.kind === 'person' || r.kind === 'agent') && r.role !== 'player');
}

/** The shared rule holds for this world now: the roster said shared and the person has not turned it off. */
export function sharedRuleHolds(entry: WorldRegistryEntry | undefined): boolean {
  return !!entry && entry.shared_with_others === true && entry.shared_keep_policy !== true;
}

/**
 * The policy a world's engine runs. `reviewFirst`: a world restored from a
 * world file reviews its first round (1.17). `settling`: the attach has not
 * heard the roster yet, so nothing is overwritten until it has.
 */
export function worldSyncPolicy(
  entry: WorldRegistryEntry | undefined,
  reg: WorldsRegistry,
  opts: { reviewFirst?: boolean; settling?: boolean } = {},
): SyncPolicy {
  if (opts.reviewFirst || opts.settling || sharedRuleHolds(entry)) return 'pause-and-review';
  return reg.sync_default_policy ?? 'local-wins';
}

/** Pull when the world opens: the person asked for it everywhere, or the world is shared. */
export function worldPullsOnOpen(entry: WorldRegistryEntry | undefined, reg: WorldsRegistry): boolean {
  return !!reg.sync_pull_on_activate || sharedRuleHolds(entry);
}

const POLICY_LABEL: Record<SyncPolicy, string> = { 'local-wins': 'Local wins', 'pause-and-review': 'Pause and review' };

/** Settings, This world: the line a shared world shows, or null for a world alone (or not yet known). */
export function sharedWorldLine(entry: WorldRegistryEntry, reg: WorldsRegistry): string | null {
  if (entry.shared_with_others !== true || entry.api?.read_only) return null;
  if (sharedRuleHolds(entry)) {
    return 'Shared with others. When an element changed both here and online, Atlas holds it for you to choose. While sync is on, it also pulls the latest changes each time this world opens.';
  }
  const policy = reg.sync_default_policy ?? 'local-wins';
  return policy === 'local-wins'
    ? `Shared with others, and following Settings, Storage: ${POLICY_LABEL[policy]}. Your edits replace the online copy, a collaborator's words included.`
    : `Shared with others, and following Settings, Storage: ${POLICY_LABEL[policy]}.`;
}
