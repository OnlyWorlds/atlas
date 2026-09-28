/**
 * Import subsystem types. See DESIGN_IMPORT.md.
 *
 * The reconcile core is pure: it turns a parsed payload + the target world's
 * existing elements into an ImportPlan. The applier (B2) walks the plan and
 * writes to the FolderStore.
 */

import type { ElementType, WorldMeta } from '../core/types';

/** A raw element record from a parsed import (bare/disk-ish field shape). */
export type RawRecord = Record<string, unknown>;

export type ImportFormat = 'full-world' | 'loose';

/** Result of parsing + detecting an import payload. */
export interface ParseResult {
  ok: boolean;
  /** Set when the payload isn't recognizable OnlyWorlds data. */
  error?: string;
  format?: ImportFormat;
  /**
   * True when the payload is the keel `onlyworlds-world-export` envelope
   * (spec §8c). An envelope reader MUST ignore unknown top-level keys AND
   * unknown element fields rather than reject — so envelope imports keep
   * unknown first-class fields (a future additive schema bump) and suppress
   * the unknown-field warning class that hand-pasted JSON still gets.
   */
  envelope?: boolean;
  /** Raw World block (full-world only). */
  world?: RawRecord;
  /** Element records grouped by lowercased element type. */
  byType: Map<ElementType, RawRecord[]>;
  /** Top-level keys that weren't a known element type (warned, not imported). */
  unknownBuckets: string[];
  totalElements: number;
}

/** A user-fixable validation issue. Shape carries all six fields the fix-prompt needs. */
export interface ValidationIssue {
  path: string;        // "Character[2].birthplace"
  field: string;
  value: unknown;
  issue: string;
  expected: string;
  suggestion: string;
}

export type ConflictResolution = 'skip' | 'overwrite';

export interface ReconcileOptions {
  /** Match incoming → existing by normalized name+type (in addition to id). Default true. */
  matchByName?: boolean;
  /** What a matched (existing) element does. Default 'skip' (non-destructive). */
  onConflict?: ConflictResolution;
  /** On overwrite, union multi-link arrays instead of replacing. Default false. */
  mergeMultiLinks?: boolean;
  /** UUID generator for inserts without a valid id. Default crypto.randomUUID. Inject for deterministic tests. */
  genId?: () => string;
  /**
   * The payload is THIS world's own export (its world id matched the target,
   * S362). Then an id match is the same element even when the names differ:
   * the realistic cause of same id + different name is a rename on one side,
   * and the name guard used to turn every rename into a duplicate.
   */
  sameWorld?: boolean;
}

export interface DroppedLink {
  type: ElementType;
  /** Name of the referring element. */
  element: string;
  field: string;
  /** The unresolved name value. */
  value: string;
}

export interface ImportReport {
  created: number;
  updated: number;
  skipped: number;
  /** Records dropped for being structurally invalid (no usable name). */
  invalidRecords: number;
  /** Count of unknown fields stripped across all records. */
  unknownFieldsDropped: number;
  /** Relation values that couldn't be resolved to an id (name not found). */
  droppedLinks: DroppedLink[];
  /** (type, name) pairs appearing 2+ times in the import — name refs bind to one arbitrarily. */
  ambiguousNames: Array<{ type: ElementType; name: string }>;
}

export interface ImportPlan {
  creates: Array<{ type: ElementType; data: RawRecord }>;
  updates: Array<{ type: ElementType; id: string; patch: RawRecord }>;
  skips: Array<{ type: ElementType; id: string; name: string }>;
  /** Full-world only: world metadata to apply to a new (or target) world. */
  worldMeta?: Partial<WorldMeta>;
  report: ImportReport;
}
