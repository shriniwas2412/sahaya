import { test } from "node:test";
import assert from "node:assert/strict";
import { step, dosesForDay, localToUtcIso, doseId, currentReminder, missedDoseMessage, deadline, type DoseEvent, type Medicine } from "./doses.ts";

const IST = 330;
const MIN = 60_000;
const at = (iso: string) => Date.parse(iso);
const ev = (over: Partial<DoseEvent> = {}): DoseEvent => ({
  id: "dose:m1:2026-10-20T08:00",
  medicine_id: "m1",
  scheduled_at: "2026-10-20T02:30:00.000Z", // 08:00 IST
  status: "pending",
  ...over,
});
const T0 = at("2026-10-20T02:30:00.000Z");

test("pending stays pending before its time and becomes due at its time", () => {
  assert.equal(step(ev(), { type: "tick" }, T0 - MIN).status, "pending");
  assert.equal(step(ev(), { type: "tick" }, T0).status, "due");
});

test("due -> taken records who confirmed and when", () => {
  const e = step(step(ev(), { type: "tick" }, T0), { type: "take", by: "elder" }, T0 + 5 * MIN);
  assert.equal(e.status, "taken");
  assert.equal(e.confirmed_by, "elder");
  assert.equal(e.confirmed_at, new Date(T0 + 5 * MIN).toISOString());
});

test("snoozed -> due again after the snooze", () => {
  const due = step(ev(), { type: "tick" }, T0);
  const sn = step(due, { type: "snooze", minutes: 10 }, T0 + MIN);
  assert.equal(sn.status, "snoozed");
  assert.equal(step(sn, { type: "tick" }, T0 + 5 * MIN).status, "snoozed");
  assert.equal(step(sn, { type: "tick" }, T0 + 11 * MIN).status, "due");
});

test("no confirmation by the deadline -> missed -> escalated", () => {
  const due = step(ev(), { type: "tick" }, T0);
  assert.equal(step(due, { type: "tick" }, T0 + 29 * MIN).status, "due");
  const missed = step(due, { type: "tick" }, T0 + 30 * MIN);
  assert.equal(missed.status, "missed");
  const esc = step(missed, { type: "escalated" }, T0 + 31 * MIN);
  assert.equal(esc.status, "escalated");
  assert.equal(esc.escalated_at, new Date(T0 + 31 * MIN).toISOString());
});

test("snoozing never moves the caregiver alert past the deadline", () => {
  let e = step(ev(), { type: "tick" }, T0);
  e = step(e, { type: "snooze", minutes: 120 }, T0 + 25 * MIN);
  assert.equal(e.snoozed_until, new Date(deadline(e)).toISOString());
  assert.equal(step(e, { type: "tick" }, T0 + 30 * MIN).status, "missed");
});

test("custom escalation delay is respected", () => {
  const due = step(ev(), { type: "tick" }, T0, 60);
  assert.equal(step(due, { type: "tick" }, T0 + 45 * MIN, 60).status, "due");
  assert.equal(step(due, { type: "tick" }, T0 + 60 * MIN, 60).status, "missed");
});

test("a pending dose found long after its deadline goes straight to missed", () => {
  assert.equal(step(ev(), { type: "tick" }, T0 + 3 * 60 * MIN).status, "missed");
});

test("taking late after escalation is still recorded", () => {
  const e = step(ev({ status: "escalated" }), { type: "take", by: "caregiver" }, T0 + 90 * MIN);
  assert.equal(e.status, "taken");
});

test("invalid actions change nothing (same object back)", () => {
  const taken = ev({ status: "taken" });
  assert.equal(step(taken, { type: "take", by: "x" }, T0), taken);
  assert.equal(step(taken, { type: "tick" }, T0 + 99 * MIN), taken);
  const pending = ev();
  assert.equal(step(pending, { type: "snooze" }, T0 - MIN), pending);
  assert.equal(step(pending, { type: "escalated" }, T0), pending);
  const skipped = step(pending, { type: "skip", by: "caregiver" }, T0);
  assert.equal(skipped.status, "skipped");
  assert.equal(step(skipped, { type: "take", by: "x" }, T0), skipped);
});

test("08:00 IST is 02:30 UTC; dose ids are deterministic per medicine, day and time", () => {
  assert.equal(localToUtcIso("2026-10-20", "08:00", IST), "2026-10-20T02:30:00.000Z");
  assert.equal(localToUtcIso("2026-10-20", "02:00", IST), "2026-10-19T20:30:00.000Z");
  assert.equal(doseId("m1", "2026-10-20", "20:00"), "dose:m1:2026-10-20T20:00");
});

test("dosesForDay: sorted, deduplicated, invalid times dropped, inactive gives none", () => {
  const med: Medicine = { id: "m1", elder_id: "e1", name: "Test Tablet A", times: ["20:00", "08:00", "08:00", "25:00"] };
  const list = dosesForDay(med, "2026-10-20", IST);
  assert.deepEqual(list.map((d) => d.id), ["dose:m1:2026-10-20T08:00", "dose:m1:2026-10-20T20:00"]);
  assert.ok(list.every((d) => d.status === "pending"));
  assert.deepEqual(dosesForDay({ ...med, active: 0 }, "2026-10-20", IST), []);
});

test("currentReminder picks the earliest open dose that needs attention", () => {
  const list = [
    ev({ id: "b", scheduled_at: "2026-10-20T14:30:00.000Z", status: "due" }),
    ev({ id: "a", scheduled_at: "2026-10-20T02:30:00.000Z", status: "missed" }),
    ev({ id: "c", status: "taken" }),
    ev({ id: "d", status: "pending" }),
  ];
  assert.equal(currentReminder(list)?.id, "a");
  assert.equal(currentReminder([ev({ status: "taken" })]), null);
});

test("missed-dose message names the time and gives no advice", () => {
  const hi = missedDoseMessage("Test Elder 1", "Test Tablet A", "2026-10-20T02:30:00.000Z", IST, "hi");
  assert.equal(hi, "Test Elder 1 ने 8 बजे की दवाई (Test Tablet A) की पुष्टि नहीं की। कृपया एक बार बात कर लें।");
  const en = missedDoseMessage("Test Elder 1", "Test Tablet A", "2026-10-20T14:45:00.000Z", IST, "en");
  assert.equal(en, "Test Elder 1 has not confirmed the 8:15 pm medicine (Test Tablet A). Please check in with them.");
  assert.doesNotMatch(hi + en, /dose|mg|double|extra|खुराक/i);
});
