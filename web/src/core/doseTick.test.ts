import { test } from "node:test";
import assert from "node:assert/strict";
import { planTick, localDay } from "./doseTick.ts";
import type { Medicine } from "./doses.ts";

const med: Medicine = { id: "m1", elder_id: "e1", name: "Test Tablet A", times: ["08:00", "20:00"], escalate_after_min: 30 };
const at = (iso: string) => Date.parse(iso);

test("localDay uses the IST calendar day", () => {
  assert.equal(localDay(at("2026-10-19T20:00:00Z"), 330), "2026-10-20"); // 01:30 IST next day
});

test("first tick of the day creates today's doses; the due one is marked due", () => {
  const out = planTick([med], [], at("2026-10-20T02:35:00Z")); // 08:05 IST
  const byId = Object.fromEntries(out.map((e) => [e.id, e.status]));
  assert.deepEqual(byId, { "dose:m1:2026-10-20T08:00": "due", "dose:m1:2026-10-20T20:00": "pending" });
});

test("an unconfirmed dose becomes missed after the escalation delay", () => {
  const first = planTick([med], [], at("2026-10-20T02:35:00Z"));
  const later = planTick([med], first, at("2026-10-20T03:01:00Z")); // 08:31 IST
  assert.deepEqual(later.map((e) => [e.id, e.status]), [["dose:m1:2026-10-20T08:00", "missed"]]);
});

test("nothing to write when nothing changed; taken doses are left alone", () => {
  const first = planTick([med], [], at("2026-10-20T02:35:00Z"));
  const taken = first.map((e) => (e.status === "due" ? { ...e, status: "taken" as const } : e));
  assert.deepEqual(planTick([med], taken, at("2026-10-20T02:40:00Z")), []);
});

// --- a stopped or rescheduled medicine stops reminding ---
test("stopping a medicine closes its open doses as skipped (schedule_change)", () => {
  const first = planTick([med], [], at("2026-10-20T02:35:00Z")); // 08:00 due, 20:00 pending
  const stopped = { ...med, active: 0 };
  const out = planTick([stopped], first, at("2026-10-20T14:31:00Z")); // 20:01 IST
  const byId = Object.fromEntries(out.map((e) => [e.id, e]));
  assert.equal(byId["dose:m1:2026-10-20T20:00"].status, "skipped");
  assert.equal(byId["dose:m1:2026-10-20T20:00"].confirmed_by, "schedule_change");
  assert.equal(byId["dose:m1:2026-10-20T08:00"].status, "skipped");
});

test("moving 20:00 to 21:00 closes the old 20:00 dose and creates 21:00", () => {
  const first = planTick([med], [], at("2026-10-20T02:35:00Z"));
  const taken = first.map((e) => (e.id.endsWith("08:00") ? { ...e, status: "taken" as const } : e));
  const moved = { ...med, times: ["08:00", "21:00"] };
  const out = planTick([moved], taken, at("2026-10-20T14:31:00Z"));
  const byId = Object.fromEntries(out.map((e) => [e.id, e.status]));
  assert.equal(byId["dose:m1:2026-10-20T20:00"], "skipped");
  assert.equal(byId["dose:m1:2026-10-20T21:00"], "pending");
  assert.equal(byId["dose:m1:2026-10-20T08:00"], undefined); // taken stays as it was
});

test("an already missed dose is not hidden by a schedule change", () => {
  const missed = [{ id: "dose:m1:2026-10-20T08:00", medicine_id: "m1", scheduled_at: "2026-10-20T02:30:00.000Z", status: "missed" as const }];
  assert.deepEqual(planTick([{ ...med, active: 0 }], missed, at("2026-10-20T04:00:00Z")), []);
});
