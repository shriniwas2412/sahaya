import { test } from "node:test";
import assert from "node:assert/strict";
import { prf, sentences, stageMetrics } from "./metrics.ts";
import { SAFETY_SET } from "./safety_set.ts";
import { evalSafety, evalStages } from "./run.ts";

test("prf counts tp/fp/fn and handles empty denominators", () => {
  assert.deepEqual(prf([[true, true], [true, false], [false, true], [false, false]]), { precision: 0.5, recall: 0.5, f1: 0.5, support: 2, tp: 1, fp: 1, fn: 1 });
  assert.equal(prf([]).f1, 0);
});

test("sentences split on Latin and Devanagari stops; stage metrics flag quizzing", () => {
  assert.deepEqual(sentences("नमस्ते। कैसे हैं? Good."), ["नमस्ते।", "कैसे हैं?", "Good."]);
  const m = stageMetrics(["Do you remember your school? Tell me.", "Lovely."], "en", 1);
  assert.equal(m.banned, 1);
  assert.equal(m.withinLimits, 0.5);
});

test("safety set is well-formed: no duplicates, every language and label present", () => {
  assert.equal(new Set(SAFETY_SET.map((s) => s.text)).size, SAFETY_SET.length);
  for (const l of ["en", "hi", "hi-rom", "hinglish", "mr", "gu"]) assert.ok(SAFETY_SET.some((s) => s.lang === l), l);
  for (const t of ["negation", "misspelling", "code-mix"]) assert.ok(SAFETY_SET.some((s) => s.tag === t), t);
});

// Regression floors, set below the measured values: a drop means a real change, not noise.
test("safety screen stays above its measured floors and never misses a plain Hindi emergency", () => {
  const r = evalSafety();
  assert.ok(r.anyAlert.recall >= 0.75, `alert recall ${r.anyAlert.recall}`);
  assert.ok(r.emergency.precision >= 0.9, `emergency precision ${r.emergency.precision}`);
  assert.equal(r.falseNegatives.filter((f) => (f.lang === "hi" || f.lang === "hi-rom") && f.tag === "plain").length, 0);
});

test("offline companion never quizzes or corrects, asks at most one question per turn at every stage", async () => {
  for (const s of Object.values(await evalStages())) {
    assert.equal(s.banned, 0);
    assert.ok(s.maxQuestions <= 1);
  }
});
