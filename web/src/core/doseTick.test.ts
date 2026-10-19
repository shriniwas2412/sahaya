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
