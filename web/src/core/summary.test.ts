import { test } from "node:test";
import assert from "node:assert/strict";
import { weekSummary, summaryText, groupIncidents } from "./summary.ts";

const IST = 330;
const NOW = Date.parse("2026-10-22T12:00:00.000Z"); // 17:30 IST, 22 Oct
const dose = (day: string, status: string) => ({ id: `dose:m1:${day}T08:00`, medicine_id: "m1", scheduled_at: `${day}T02:30:00.000Z`, status });

test("an empty week is all zeros with no mood, never made-up numbers", () => {
  const s = weekSummary({ doses: [], sessions: [], safety: [] }, NOW, IST);
  assert.deepEqual({ ...s, days: undefined }, { days: undefined, taken: 0, missed: 0, escalated: 0, skipped: 0, sessions: 0, minutes: 0, mood: null, moodCount: 0, incidents: 0, empty: true });
  assert.equal(s.days.length, 7);
});

test("counts only the last 7 local days, and only doses that were due", () => {
  const s = weekSummary({
    doses: [dose("2026-10-22", "taken"), dose("2026-10-21", "missed"), dose("2026-10-20", "escalated"), dose("2026-10-16", "taken"),
      dose("2026-10-15", "taken"), { ...dose("2026-10-22", "pending"), id: "later", scheduled_at: "2026-10-22T14:30:00.000Z" }],
    sessions: [], safety: [],
  }, NOW, IST);
  assert.equal(s.taken, 2); // 22nd and 16th; the 15th is outside the window
  assert.equal(s.missed, 1);
  assert.equal(s.escalated, 1);
  assert.equal(s.days.at(-1)!.day, "2026-10-22");
  assert.deepEqual(s.days.at(-1), { day: "2026-10-22", taken: 1, missed: 0 });
  assert.deepEqual(s.days.find((d) => d.day === "2026-10-20"), { day: "2026-10-20", taken: 0, missed: 1 });
});

test("sessions: count, minutes from start to end, and the mean caregiver mood", () => {
  const s = weekSummary({
    doses: [], safety: [],
    sessions: [
      { id: "a", mode: "companion", started_at: "2026-10-21T05:00:00.000Z", ended_at: "2026-10-21T05:15:00.000Z", feedback_mood: 4 },
      { id: "b", mode: "companion", started_at: "2026-10-22T05:00:00.000Z", ended_at: null, feedback_mood: 5 },
      { id: "c", mode: "memory_activity", started_at: "2026-10-22T06:00:00.000Z", ended_at: "2026-10-22T06:10:00.000Z", feedback_mood: null },
      { id: "d", mode: "companion", started_at: "2026-10-01T05:00:00.000Z", ended_at: "2026-10-01T06:00:00.000Z", feedback_mood: 1 },
    ],
  }, NOW, IST);
  assert.equal(s.sessions, 2);
  assert.equal(s.minutes, 15);
  assert.equal(s.mood, 4.5);
  assert.equal(s.moodCount, 2);
});

test("safety events of one incident (same session, minutes apart) count once", () => {
  const ev = (id: string, session: string | null, at: string) => ({ id, session_id: session, at });
  const s = weekSummary({
    doses: [], sessions: [],
    safety: [ev("1", "s1", "2026-10-21T10:00:00.000Z"), ev("2", "s1", "2026-10-21T10:00:20.000Z"), ev("3", "s1", "2026-10-21T10:02:00.000Z"),
      ev("4", "s1", "2026-10-21T12:00:00.000Z"), ev("5", null, "2026-10-22T03:00:00.000Z")],
  }, NOW, IST);
  assert.equal(s.incidents, 3);
});

test("the share text states counts only", () => {
  const s = weekSummary({ doses: [dose("2026-10-22", "taken")], sessions: [], safety: [] }, NOW, IST);
  assert.equal(summaryText(s, "Shanti", "en"), "Sahaya, last 7 days for Shanti: medicines taken 1, not confirmed 0 (caregiver alerted 0); sessions 0 (0 min); average mood not recorded; safety alerts 0.");
});

test("groupIncidents: one card per incident, newest first, steps in order", () => {
  const ev = (id: string, session: string | null, at: string) => ({ id, session_id: session, at });
  const g = groupIncidents([ev("2", "s1", "2026-10-21T10:00:20.000Z"), ev("1", "s1", "2026-10-21T10:00:00.000Z"), ev("4", "s2", "2026-10-22T09:00:00.000Z")]);
  assert.deepEqual(g.map((x) => x.map((e) => e.id)), [["4"], ["1", "2"]]);
});
