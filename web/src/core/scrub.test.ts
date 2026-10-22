import { test } from "node:test";
import assert from "node:assert/strict";
import { scrub } from "./scrub.ts";

test("a deleted elder keeps only its id and the flag; required text columns become empty", () => {
  const r = scrub("elder", { id: "e1", display_name: "Test Elder 1", notes: "Likes bhajans", family_contacts: [{ name: "Test Son", phone: "9000000002" }], gds_stage: 4, deleted: true });
  assert.deepEqual(r, { id: "e1", display_name: "", notes: null, family_contacts: null, gds_stage: null, deleted: true });
});

test("child rows keep the ids that link them, and nothing personal", () => {
  assert.deepEqual(scrub("medicine", { id: "m1", elder_id: "e1", name: "Test Tablet A", dose: "1", times: ["08:00"], deleted: true }),
    { id: "m1", elder_id: "e1", name: "", dose: null, times: null, deleted: true });
  const s = scrub("safety_event", { id: "x", elder_id: "e1", at: "t", matched: "madad", action: "call_family_1", deleted: true });
  assert.equal(s.matched, null);
  assert.equal(s.at, "t");
});
