// What to write when the clock moves: create today's dose rows that do not exist yet,
// and advance open ones (pending -> due -> missed). Pure: the caller saves the result.
// The device and the server run the same function; deterministic ids keep them in step.

import { dosesForDay, step, isOpen, type DoseEvent, type Medicine, DEFAULT_ESCALATE_MIN } from "./doses.ts";

export const IST_OFFSET_MIN = 330;

/** Local calendar day "YYYY-MM-DD" for a UTC instant and a fixed offset. */
export function localDay(now: number, tzOffsetMin: number): string {
  return new Date(now + tzOffsetMin * 60_000).toISOString().slice(0, 10);
}

export function planTick(meds: Medicine[], events: DoseEvent[], now: number, tzOffsetMin: number = IST_OFFSET_MIN): DoseEvent[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const medById = new Map(meds.map((m) => [m.id, m]));
  const out: DoseEvent[] = [];
  const today = localDay(now, tzOffsetMin);
  for (const m of meds) {
    for (const d of dosesForDay(m, today, tzOffsetMin)) if (!byId.has(d.id)) byId.set(d.id, d), out.push(d);
  }
  for (const e of byId.values()) {
    if (!isOpen(e.status)) continue;
    const m = medById.get(e.medicine_id);
    if (!m) continue;
    // A stopped medicine, or a time the caregiver removed, closes the dose that has not
    // been missed yet; a real miss stays visible to the caregiver.
    const time = e.id.slice(-5);
    const stillScheduled = m.active !== false && m.active !== 0 && m.times.includes(time);
    if (!stillScheduled) {
      if (e.status === "pending" || e.status === "due" || e.status === "snoozed") {
        const closed = { ...e, status: "skipped" as const, confirmed_by: "schedule_change", confirmed_at: new Date(now).toISOString(), snoozed_until: null };
        const i = out.indexOf(e);
        if (i >= 0) out[i] = closed;
        else out.push(closed);
      }
      continue;
    }
    const next = step(e, { type: "tick" }, now, m.escalate_after_min ?? DEFAULT_ESCALATE_MIN);
    if (next !== e) {
      const i = out.indexOf(e);
      if (i >= 0) out[i] = next;
      else out.push(next);
    }
  }
  return out;
}
