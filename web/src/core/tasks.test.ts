import { test } from "node:test";
import assert from "node:assert/strict";
import { rng, digitSequence, spanStart, spanNext, expectedAnswer, symbolTrial, listForSession, orientationItems, WORD_LISTS } from "./tasks.ts";

test("seeded rng is repeatable", () => {
  const a = rng(42), b = rng(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("digit sequences use 1-9 with no back-to-back repeats", () => {
  const r = rng(1);
  for (let n = 2; n <= 9; n++) {
    const d = digitSequence(n, r);
    assert.equal(d.length, n);
    d.forEach((x, i) => { assert.ok(x >= 1 && x <= 9); if (i) assert.notEqual(x, d[i - 1]); });
  }
});

test("span staircase: pass, then two fails at a length ends with the last passed length", () => {
  let s = spanStart("forward");             // length 3
  s = spanNext(s, true);                     // 3 passed -> 4
  s = spanNext(s, false);                    // 4 trial 1 fail
  assert.equal(s.done, false);
  s = spanNext(s, true);                     // 4 trial 2 pass -> 5
  assert.equal(s.best, 4);
  s = spanNext(spanNext(s, false), false);   // 5 failed twice
  assert.equal(s.done, true);
  assert.equal(s.best, 4);
});

test("span stops at the top length", () => {
  let s = spanStart("backward");
  for (let i = 0; i < 4; i++) s = spanNext(s, true); // 2,3,4,5
  assert.equal(s.done, true);
  assert.equal(s.best, 5);
});

test("backward span expects the reversed digits", () => {
  assert.deepEqual(expectedAnswer([1, 2, 3], "backward"), [3, 2, 1]);
  assert.deepEqual(expectedAnswer([1, 2, 3], "forward"), [1, 2, 3]);
});

test("symbol trial: 4 distinct options containing the target", () => {
  const r = rng(9);
  for (let i = 0; i < 50; i++) {
    const t = symbolTrial(r);
    assert.equal(new Set(t.options).size, 4);
    assert.ok(t.options.includes(t.target));
  }
});

test("word lists rotate and have 5 Hindi and 5 English words", () => {
  assert.equal(listForSession(0).id, "A");
  assert.equal(listForSession(4).id, "B");
  for (const l of WORD_LISTS) { assert.equal(l.hi.length, 5); assert.equal(l.en.length, 5); }
});

test("orientation answers come from the date", () => {
  const items = orientationItems(new Date(2026, 9, 16), "Testpur Home", "hi");
  assert.equal(items.find((i) => i.id === "day")!.answer, "शुक्रवार");
  assert.equal(items.find((i) => i.id === "month")!.answer, "अक्टूबर");
  assert.equal(items.find((i) => i.id === "place")!.answer, "Testpur Home");
});
