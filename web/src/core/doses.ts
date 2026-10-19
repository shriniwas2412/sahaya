// Medicine reminders as a small state machine.
//
//   pending --(time reached)--> due --(take)--> taken
//                                  \--(snooze)--> snoozed --(snooze over)--> due
//                                  \--(no confirmation by the deadline)--> missed --(caregiver alerted)--> escalated
//   any open state --(caregiver skips)--> skipped
//
// The deadline is scheduled_at + escalate_after_min and never moves: snoozing
// cannot push a missed dose past the caregiver alert.
// This is a reminder. It never suggests, changes or explains a dose.

export type DoseStatus = "pending" | "due" | "taken" | "snoozed" | "missed" | "escalated" | "skipped";

export interface DoseEvent {
  id: string;
  medicine_id: string;
  scheduled_at: string; // ISO, UTC
  status: DoseStatus;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
  escalated_at?: string | null;
  snoozed_until?: string | null;
}

export interface Medicine {
  id: string;
  elder_id: string;
  name: string;
  dose?: string | null;
  times: string[]; // local "HH:MM"
  instructions?: string | null;
  escalate_after_min?: number | null;
  alert_user_id?: string | null;
  active?: boolean | number | null;
}

export type DoseAction =
  | { type: "tick" }
  | { type: "take"; by: string }
  | { type: "snooze"; minutes?: number }
  | { type: "skip"; by: string }
  | { type: "escalated" };

export const DEFAULT_ESCALATE_MIN = 30;
export const DEFAULT_SNOOZE_MIN = 10;

const CLOSED: ReadonlySet<DoseStatus> = new Set(["taken", "skipped"]);
const MIN = 60_000;

export const isOpen = (s: DoseStatus) => !CLOSED.has(s);

export function deadline(ev: DoseEvent, escalateAfterMin: number = DEFAULT_ESCALATE_MIN): number {
  return Date.parse(ev.scheduled_at) + escalateAfterMin * MIN;
}

/**
 * Apply one action at time `now` (ms). Returns the same object when the action
 * does not apply, so callers can check `next === ev` to see that nothing changed.
 */
export function step(ev: DoseEvent, action: DoseAction, now: number, escalateAfterMin: number = DEFAULT_ESCALATE_MIN): DoseEvent {
  const at = new Date(now).toISOString();
  switch (action.type) {
    case "tick": {
      const sched = Date.parse(ev.scheduled_at);
      if (ev.status === "pending" && now >= sched) return tickAgain({ ...ev, status: "due" }, now, escalateAfterMin);
      if ((ev.status === "due" || ev.status === "snoozed") && now >= deadline(ev, escalateAfterMin)) {
        return { ...ev, status: "missed", snoozed_until: null };
      }
      if (ev.status === "snoozed" && ev.snoozed_until && now >= Date.parse(ev.snoozed_until)) {
        return { ...ev, status: "due", snoozed_until: null };
      }
      return ev;
    }
    case "take":
      if (!isOpen(ev.status)) return ev;
      return { ...ev, status: "taken", confirmed_at: at, confirmed_by: action.by, snoozed_until: null };
    case "snooze": {
      if (ev.status !== "due") return ev;
      const until = Math.min(now + (action.minutes ?? DEFAULT_SNOOZE_MIN) * MIN, deadline(ev, escalateAfterMin));
      return { ...ev, status: "snoozed", snoozed_until: new Date(until).toISOString() };
    }
    case "skip":
      if (!isOpen(ev.status)) return ev;
      return { ...ev, status: "skipped", confirmed_at: at, confirmed_by: action.by, snoozed_until: null };
    case "escalated":
      if (ev.status !== "missed") return ev;
      return { ...ev, status: "escalated", escalated_at: at };
  }
}

// A pending dose that is already past its deadline goes straight to missed in one tick.
function tickAgain(ev: DoseEvent, now: number, esc: number): DoseEvent {
  return now >= deadline(ev, esc) ? { ...ev, status: "missed" } : ev;
}

/** "HH:MM" on a local calendar day -> UTC ISO, for a fixed UTC offset in minutes (IST = 330). */
export function localToUtcIso(day: string, hhmm: string, tzOffsetMin: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - tzOffsetMin * MIN).toISOString();
}

/** Deterministic id, so two devices that create the same dose merge instead of duplicating. */
export const doseId = (medicineId: string, day: string, hhmm: string) => `dose:${medicineId}:${day}T${hhmm}`;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isValidTime = (t: string) => TIME_RE.test(t);

/** Dose events for one local day. Inactive medicines get none. */
export function dosesForDay(med: Medicine, day: string, tzOffsetMin: number): DoseEvent[] {
  if (med.active === false || med.active === 0) return [];
  return [...new Set(med.times.filter(isValidTime))].sort().map((t) => ({
    id: doseId(med.id, day, t),
    medicine_id: med.id,
    scheduled_at: localToUtcIso(day, t, tzOffsetMin),
    status: "pending" as const,
  }));
}

/** The dose to show on the elder screen right now: due first, then the earliest snoozed one that is over. */
export function currentReminder(events: DoseEvent[]): DoseEvent | null {
  const open = events.filter((e) => e.status === "due" || e.status === "missed" || e.status === "escalated");
  open.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  return open[0] ?? null;
}

/** Local "8 baje" style label for a UTC ISO time. */
export function localClock(iso: string, tzOffsetMin: number): { h: number; m: number } {
  const t = new Date(Date.parse(iso) + tzOffsetMin * MIN);
  return { h: t.getUTCHours(), m: t.getUTCMinutes() };
}

/** Text for the caregiver alert. Says what was missed; gives no advice. */
export function missedDoseMessage(elderName: string, medicineName: string, iso: string, tzOffsetMin: number, lang: "hi" | "en"): string {
  const { h, m } = localClock(iso, tzOffsetMin);
  const h12 = ((h + 11) % 12) + 1;
  const mm = m ? `:${String(m).padStart(2, "0")}` : "";
  if (lang === "hi") return `${elderName} ने ${h12}${mm} बजे की दवाई (${medicineName}) की पुष्टि नहीं की। कृपया एक बार बात कर लें।`;
  const ampm = h < 12 ? "am" : "pm";
  return `${elderName} has not confirmed the ${h12}${mm} ${ampm} medicine (${medicineName}). Please check in with them.`;
}
