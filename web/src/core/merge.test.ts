import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeRow } from "./merge.ts";
import { stamp, type Versioned } from "./sync.ts";

const S = (wall: number, node: string) => `${String(wall).padStart(15, "0")}:00000:${node}`;
const base = { id: "dose:m1:2026-10-20T08:00", medicine_id: "m1", scheduled_at: "2026-10-20T02:30:00.000Z" };

test("a 'taken' from a phone with a slow clock still beats the server's later 'due'", () => {
  const server = stamp(null, { ...base, status: "due" } as Versioned, S(2000, "server"));
  const phone = stamp(null, { ...base, status: "taken", confirmed_by: "elder", confirmed_at: "x" } as Versioned, S(1500, "phone"));
  for (const m of [mergeRow("dose_event", server, phone), mergeRow("dose_event", phone, server)]) {
    assert.equal(m.status, "taken");
    assert.equal(m.confirmed_by, "elder");
  }
});

test("'taken' also beats a later 'missed' or 'escalated'", () => {
  const phone = stamp(null, { ...base, status: "taken" } as Versioned, S(1, "phone"));
  for (const st of ["missed", "escalated", "snoozed", "pending"]) {
    const server = stamp(null, { ...base, status: st } as Versioned, S(9, "server"));
    assert.equal(mergeRow("dose_event", server, phone).status, "taken", st);
  }
});

test("between two closed or two open statuses, the later write still wins", () => {
  const a = stamp(null, { ...base, status: "taken" } as Versioned, S(1, "a"));
  const b = stamp(null, { ...base, status: "skipped" } as Versioned, S(2, "b"));
  assert.equal(mergeRow("dose_event", a, b).status, "skipped");
  const c = stamp(null, { ...base, status: "due" } as Versioned, S(1, "a"));
  const d = stamp(null, { ...base, status: "missed" } as Versioned, S(2, "b"));
  assert.equal(mergeRow("dose_event", d, c).status, "missed");
});

test("other tables are plain last-writer-wins", () => {
  const a = stamp(null, { id: "e1", status: "taken" } as Versioned, S(1, "a"));
  const b = stamp(null, { id: "e1", status: "due" } as Versioned, S(2, "b"));
  assert.equal(mergeRow("elder", a, b).status, "due");
});
