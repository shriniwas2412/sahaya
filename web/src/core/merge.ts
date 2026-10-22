// Table-aware merge on top of the field-wise LWW CRDT.
//
// dose_event: a confirmed dose (taken / skipped) beats an open status (pending, due,
// snoozed, missed, escalated) whatever the timestamps say, and "escalated" (the caregiver
// was alerted) beats "missed", so a phone with a fast clock cannot undo the escalation. Otherwise a phone whose clock
// runs behind could lose its "taken" to the server's earlier "due" and trigger a false
// missed-dose alert. The rule is symmetric, so merge stays commutative and idempotent.

import { mergeRecord, type Versioned } from "./sync.ts";

const CLOSED = new Set(["taken", "skipped"]);
const CONFIRM_FIELDS = ["status", "confirmed_at", "confirmed_by"];

export function mergeRow<T extends Versioned>(table: string, a: T | null | undefined, b: T | null | undefined): T {
  const m = mergeRecord(a, b);
  if (table !== "dose_event" || !a || !b) return m;
  const aDone = CLOSED.has(a.status as string), bDone = CLOSED.has(b.status as string);
  if (!aDone && !bDone) {
    const esc = a.status === "escalated" ? a : b.status === "escalated" ? b : null;
    const other = esc === a ? b : a;
    if (esc && other.status === "missed") return { ...m, status: "escalated", escalated_at: esc.escalated_at ?? m.escalated_at } as T;
    return m;
  }
  if (aDone === bDone) return m;
  const done = aDone ? a : b;
  const out = { ...m } as Versioned;
  for (const k of CONFIRM_FIELDS) if (k in done) out[k] = done[k];
  // _v keeps the newest stamp per field from the plain merge.
  return out as T;
}
