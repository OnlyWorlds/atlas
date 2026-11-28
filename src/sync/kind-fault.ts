/**
 * A standard field holding a value of a kind OnlyWorlds would not keep as written.
 *
 * keel takes a wrong kind and changes it: an integer field stores `int(value)`
 * (2.5 as 2, "7" as 7) or refuses it (a word), a text field the text of any
 * other value (12 as "12"). The SDK refuses such a value before it sends, with
 * a throw that would stop a whole round, so Atlas asks the SDK's own predicate
 * (`kindFaults`) first. The editors write each kind as its field takes it; a
 * file written by another tool or an older Atlas can still hold another.
 * Where Atlas sends (the push, Make online, Keep this copy), an element holding
 * one is not sent: it is a sync issue naming the field and the value, until
 * the person saves the field again.
 *
 * An empty text in an integer field is unset, as the senders write it (null).
 */
import { kindFaults } from '@onlyworlds/sdk';
import type { ElementType, PerElementFailure } from '../core/types';
import { PlainError } from '../core/plain-error';

export interface KindFault {
  /** The schema field, as the file writes it (`birth_date`). */
  field: string;
  /** The value as a person reads it: `2.5`, `"7" as text`, `12 as a number`, `a list`. */
  value: string;
  /** What the field takes. Absent on a record from 1.125.49, which read integer fields only. */
  kind?: 'integer' | 'text';
}

/** The record's message for an element held for its kind (never shown: the words read `kind_fault`). */
export const KIND_FAULT_MESSAGE = 'a field holds a value of a kind OnlyWorlds would not keep as written, so it was not sent';

/** The record's message for an element held because it links a new one held for its kind (keel would refuse the link). */
export const KIND_WAITS_MESSAGE = 'waits for an element Atlas held back for a value OnlyWorlds would not keep';

/** The value as a person reads it, short. */
export function shownValue(v: unknown): string {
  if (typeof v === 'string') return `"${v.length > 40 ? `${v.slice(0, 40)}…` : v}"`;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return 'a list';
  if (v !== null && typeof v === 'object') return 'a group of fields';
  return String(v);
}

/** The value as the words show it, saying the kind where the value alone would read as right ("7", 12). */
function shownFault(kind: 'integer' | 'text', v: unknown): string {
  if (kind === 'integer' && typeof v === 'string') return `${shownValue(v)} as text`;
  if (kind === 'text' && typeof v === 'number') return `${shownValue(v)} as a number`;
  return shownValue(v);
}

/** The element's first standard field OnlyWorlds would not keep as written, by the SDK's rule, or null. */
export function kindFaultOf(type: ElementType, el: Readonly<Record<string, unknown>>): KindFault | null {
  for (const f of kindFaults(type, el)) {
    if (f.kind === 'integer' && f.value === '') continue;
    return { field: f.field, value: shownFault(f.kind, f.value), kind: f.kind };
  }
  return null;
}

/** The failure record for an element held for its kind. */
export function kindFailure(
  element_id: string, type: ElementType, operation: 'create' | 'update', fault: KindFault,
): PerElementFailure {
  return { element_id, type, operation, message: KIND_FAULT_MESSAGE, source: 'disk', kind_fault: fault };
}

/** The field as the words name it: `birth date`. */
export function faultFieldWords(fault: KindFault): string {
  return fault.field.replace(/_/g, ' ');
}

/** What the field takes, as the words say it. */
export function faultTakes(fault: KindFault): string {
  return fault.kind === 'text' ? 'only text there' : 'only a whole number there, such as 12';
}

/** How the person sets it right, as the words say it. */
export function faultFix(fault: KindFault): string {
  return fault.kind === 'text' ? 'Save it again in its field' : 'Change it to a whole number';
}

/** Thrown where one element is sent alone and the person is told at once (Keep this copy, Make online). */
export class KindFaultError extends PlainError {
  readonly fault: KindFault;
  constructor(fault: KindFault) {
    super(`Its ${faultFieldWords(fault)} field holds ${fault.value}, and OnlyWorlds takes ${faultTakes(fault)}, so nothing was sent. ${faultFix(fault)}, then try again.`);
    this.name = 'KindFaultError';
    this.fault = fault;
  }
}

/** The kind fault a thrown error carries, for a failure record. */
export function kindFaultFrom(err: unknown): { kind_fault?: KindFault; source?: 'disk' } {
  return err instanceof KindFaultError ? { kind_fault: err.fault, source: 'disk' } : {};
}
