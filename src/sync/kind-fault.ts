/**
 * A standard integer field holding what OnlyWorlds would not keep as written.
 *
 * keel answers a number that is not whole in an integer field with a 200 and
 * stores it cut, so a folder holding 2.5 and the online world holding 2 would
 * part without a word. The editors refuse such a number (1.125.48); a file
 * written by another tool, an import or an older Atlas can still hold one.
 * Where Atlas sends (the push, Make online, Keep this copy), an element
 * holding one is not sent: it is a sync issue naming the field and the value,
 * until the person makes it whole.
 *
 * A whole number written as text ("7", "7.0") is sent: keel stores the same
 * number. A fraction, a word, a yes or no, a list or a group of fields is not.
 */
import type { ElementType, PerElementFailure } from '../core/types';
import { PlainError } from '../core/plain-error';
import { scalarKindsFor } from '../editor/field-schema';

export interface KindFault {
  /** The schema field, as the file writes it (`birth_date`). */
  field: string;
  /** The value as a person reads it: `2.5`, `"tall"`, `a list`. */
  value: string;
}

/** The record's message for an element held for its kind (never shown: the words read `kind_fault`). */
export const KIND_FAULT_MESSAGE = 'an integer field holds a value OnlyWorlds would not keep as written, so it was not sent';

/** The record's message for a create held because it links one held for its kind (keel would refuse the link). */
export const KIND_WAITS_MESSAGE = 'waits for an element Atlas held back for a value OnlyWorlds would not keep';

/** A whole number as text, as keel reads it into the same integer. */
const WHOLE_TEXT = /^\s*[-+]?\d+(\.0*)?\s*$/;

/** Whether keel keeps this value in an integer field as written (absent and empty are unset). */
export function keepsAsWhole(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (typeof v === 'number') return Number.isInteger(v);
  if (typeof v === 'string') return WHOLE_TEXT.test(v);
  return false;
}

/** The value as a person reads it, short. */
export function shownValue(v: unknown): string {
  if (typeof v === 'string') return `"${v.length > 40 ? `${v.slice(0, 40)}…` : v}"`;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return 'a list';
  if (v !== null && typeof v === 'object') return 'a group of fields';
  return String(v);
}

/** The element's first integer field OnlyWorlds would not keep as written, in the schema's order, or null. */
export function kindFaultOf(type: ElementType, el: Readonly<Record<string, unknown>>): KindFault | null {
  for (const [field, kind] of scalarKindsFor(type)) {
    if (kind !== 'integer') continue;
    const v = el[field];
    if (!keepsAsWhole(v)) return { field, value: shownValue(v) };
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

/** Thrown where one element is sent alone and the person is told at once (Keep this copy, Make online). */
export class KindFaultError extends PlainError {
  readonly fault: KindFault;
  constructor(fault: KindFault) {
    super(`Its ${faultFieldWords(fault)} field holds ${fault.value}, and OnlyWorlds takes only a whole number there, such as 12, so nothing was sent. Change it to a whole number, then try again.`);
    this.name = 'KindFaultError';
    this.fault = fault;
  }
}

/** The kind fault a thrown error carries, for a failure record. */
export function kindFaultFrom(err: unknown): { kind_fault?: KindFault; source?: 'disk' } {
  return err instanceof KindFaultError ? { kind_fault: err.fault, source: 'disk' } : {};
}
