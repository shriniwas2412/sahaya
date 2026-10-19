import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreSession, baseline, flags, median, type Scores, type ScoredSession } from "./scoring.ts";

const S = (date: string, scores: Scores = {}): ScoredSession => ({ date, scores: { orientation: 5, immediate: 5, delayed: 4, forward: 6, backward: 4, fluency: 15, symbol: 15, ...scores } });

test("scoreSession counts ticks, keeps skipped tasks null", () => {
  const s = scoreSession({
    orientation: [true, true, false, true, true], immediate: [true, true, true, false, false],
    forward: 5, fluency: 12,
    symbol: [{ correct: true, ms: 900 }, { correct: false, ms: 400 }, { correct: true, ms: 1300 }],
  });
  assert.deepEqual(s, { orientation: 4, immediate: 3, delayed: null, forward: 5, backward: null, fluency: 12, symbol: 2, symbolMedianMs: 1100 });
});

test("median handles odd, even and empty", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test("baseline is the mean of the first two sessions that have the domain", () => {
  const b = baseline([S("2026-03-01", { fluency: 14 }), S("2026-01-01", { fluency: null }), S("2026-02-01", { fluency: 16 }), S("2026-04-01", { fluency: 2 })]);
  assert.equal(b.fluency, 15); // 2026-02 (16) and 2026-03 (14); Jan had none
  assert.equal(b.orientation, 5);
});

test("low orientation today raises an acute flag even on the first session", () => {
  assert.deepEqual(flags([S("2026-01-01", { orientation: 3 })]), [{ kind: "acute", domain: "orientation", value: 3 }]);
});

test("one bad session does not raise a decline flag; two in a row do", () => {
  const base = [S("2026-01-01"), S("2026-02-01"), S("2026-03-01")];
  assert.deepEqual(flags([...base, S("2026-04-01", { delayed: 1 })]), []);
  const two = flags([...base, S("2026-04-01", { delayed: 2 }), S("2026-05-01", { delayed: 1 })]);
  assert.deepEqual(two, [{ kind: "decline", domain: "delayed", baseline: 4, value: 1 }]);
});

test("fluency decline uses 70% of baseline", () => {
  const list = [S("2026-01-01"), S("2026-02-01"), S("2026-03-01", { fluency: 10 }), S("2026-04-01", { fluency: 10 })];
  assert.deepEqual(flags(list).map(f => f.domain), ["fluency"]); // 10 <= floor(15*0.7)=10
});
