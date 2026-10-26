/**
 * keel #519, the proposed change (conv. 163; a contract of
 * 2026-10-22).
 *
 * On a world whose keeper reviews AI seats (`agent_writes_proposed`), a seat's
 * PATCH, PUT or link edit answers 202 `{proposal}` and the element does not
 * change. The adapter throws `OwProposed` for any 202 that carries a proposal,
 * so a caller that does not know about proposals treats it as a failure and
 * never stamps a proposal as the element (P1). It has no `status`, so no auth,
 * transient or not-found test can read it as one of theirs.
 */
import type { Conflict, ProposedEdit } from '../core/types';

/** keel's Proposal component, the fields Atlas reads. */
export interface ProposalRow {
  id: string;
  element_type?: string;
  element_id?: string;
  state: 'open' | 'lapsed' | 'accepted' | 'declined' | string;
  decline_reason?: string | null;
}

export class OwProposed extends Error {
  readonly proposal: ProposalRow;
  constructor(proposal: ProposalRow) {
    super(`keel took the write as a proposal (${proposal.id})`);
    this.name = 'OwProposed';
    this.proposal = proposal;
  }
}

/** Duck-typed, for errors that crossed a module boundary. */
export function isOwProposed(err: unknown): err is OwProposed {
  return err instanceof Error && err.name === 'OwProposed'
    && typeof (err as OwProposed).proposal?.id === 'string';
}

/** A 202 body that names a proposal, or null. */
export function proposalOf(body: unknown): ProposalRow | null {
  const p = (body as { proposal?: unknown } | null)?.proposal as ProposalRow | undefined;
  return p && typeof p === 'object' && typeof p.id === 'string' ? p : null;
}

/** The entry an element's newest proposal leaves in sync-state (P2: one per element, the newest wins). */
export function withProposed(list: ProposedEdit[] | undefined, entry: ProposedEdit): ProposedEdit[] {
  return [...(list ?? []).filter(e => e.element_id !== entry.element_id), entry];
}

/** P3: the version an entry names was sent once; an edit after it is a new version. */
export function alreadyProposed(list: ProposedEdit[] | undefined, id: string, localUpdatedAt: string): boolean {
  return (list ?? []).some(e => e.element_id === id && e.local_updated_at === localUpdatedAt);
}

export type Settlement =
  | { kind: 'open' }
  | { kind: 'accepted' }
  | { kind: 'refused'; proposal: NonNullable<Conflict['proposal']> };

/**
 * P5: what keel's queue says of one entry. Rows are the caller's own
 * (`GET /world/proposals?state=all`); a row missing from them was withdrawn
 * (or its element deleted, which drops undecided rows).
 */
export function settle(entry: ProposedEdit, rows: ProposalRow[], complete = true): Settlement {
  const row = rows.find(r => r.id === entry.proposal_id);
  // A walk cut short may simply not have reached the row: still open.
  if (!row) return complete ? { kind: 'refused', proposal: { outcome: 'withdrawn' } } : { kind: 'open' };
  if (row.state === 'accepted') return { kind: 'accepted' };
  if (row.state === 'declined') {
    const reason = typeof row.decline_reason === 'string' && row.decline_reason.trim() ? row.decline_reason.trim() : undefined;
    return { kind: 'refused', proposal: { outcome: 'declined', ...(reason ? { reason } : {}) } };
  }
  if (row.state === 'lapsed') return { kind: 'refused', proposal: { outcome: 'lapsed' } };
  return { kind: 'open' };
}

/** keel's 403 `proposed_only`: a seat on a reviewed world deletes only what it made (P6). Never a dead key. */
export function isProposedOnly(err: unknown): boolean {
  return err instanceof Error && (err as { code?: unknown }).code === 'proposed_only';
}
