import { test } from "node:test";
import assert from "node:assert/strict";
import { latestConsent, withScope, isDeleteWord, type ConsentRow } from "./consent.ts";

const c = (over: Partial<ConsentRow> = {}): ConsentRow => ({
  id: "c1", subject_type: "elder", subject_id: "e1", given_by: "guardian", method: "verbal_recorded",
  scope_store: 1, scope_sync: 0, scope_audio_cloud: 0, scope_contact_share: 0, scope_research_aggregate: 0,
  language: "hi", recorded_at: "2026-10-01T00:00:00.000Z", ...over,
});

test("the newest consent for the subject is the one in force", () => {
  const rows = [c(), c({ id: "c2", recorded_at: "2026-10-05T00:00:00.000Z", scope_sync: 1 }), c({ id: "x", subject_id: "e2", recorded_at: "2026-10-09T00:00:00.000Z" })];
  assert.equal(latestConsent(rows, "e1")?.id, "c2");
  assert.equal(latestConsent(rows, "e9"), null);
});

test("changing a scope appends a new row and keeps the rest", () => {
  const n = withScope(c(), "scope_sync", true, "2026-10-22T00:00:00.000Z", "c3");
  assert.equal(n.id, "c3");
  assert.equal(n.scope_sync, 1);
  assert.equal(n.scope_audio_cloud, 0);
  assert.equal(n.method, "digital");
  assert.equal(n.recorded_at, "2026-10-22T00:00:00.000Z");
});

test("delete needs the exact confirmation word, in English or Hindi", () => {
  for (const ok of ["DELETE", "delete", " DELETE ", "हटाएँ"]) assert.ok(isDeleteWord(ok), ok);
  for (const no of ["", "del", "yes", "हटा"]) assert.ok(!isDeleteWord(no), no);
});
