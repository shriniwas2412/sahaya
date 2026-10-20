import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSafety } from "./safetyText.ts";
import { STRINGS } from "./i18n.ts";

test("safety log reads as plain words, not internal codes", () => {
  const en = STRINGS.en, hi = STRINGS.hi;
  assert.equal(describeSafety(en, "manual", "reassure_ask"), "Help button · Asked if they want someone called");
  assert.equal(describeSafety(en, "keyword", "call_family_2"), "Words heard · Called contact 2");
  assert.equal(describeSafety(en, "silence", "call_helpline_3"), "Long silence · Called the helpline");
  assert.equal(describeSafety(hi, "missed_dose", "caregiver_push"), "दवा की पुष्टि नहीं · देखभाल करने वाले को सूचना भेजी");
  for (const a of ["reassure_ask", "escalated", "declined", "connected", "exhausted", "resolved", "caregiver_push"]) {
    assert.doesNotMatch(describeSafety(hi, "manual", a), /_/, a);
  }
});
