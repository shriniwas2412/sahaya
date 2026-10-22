import { test } from "node:test";
import assert from "node:assert/strict";
import { greetingName, sentence, strip } from "./elderText.ts";

test("the greeting drops the (demo) suffix", () => {
  assert.equal(greetingName("Shanti (demo)"), "Shanti");
  assert.equal(greetingName("Test Elder 1"), "Test Elder 1");
});

test("Hindi lines end with ।, English with .", () => {
  assert.equal(sentence(["8 बजे की दवाई", "Demo Tablet A", "नाश्ते के बाद."], "hi"), "8 बजे की दवाई। Demo Tablet A। नाश्ते के बाद।");
  assert.equal(sentence(["8 am medicine", "Demo Tablet A", null], "en"), "8 am medicine. Demo Tablet A.");
});

test("strip: listening lights only the first step", () => {
  assert.deepEqual(strip(null, true).map((s) => [s.key, s.on, s.active]), [["listen", true, true], ["safety", false, false], ["reply", false, false]]);
});

test("strip: a normal turn lights all three, says the safety check was fine and the reply was scripted", () => {
  const s = strip({ heard: "gaana sunao", safetyLevel: "none", source: "scripted", stages: ["safety", "trigger", "prompt", "scripted", "guard"] }, false);
  assert.deepEqual(s.map((x) => [x.key, x.on, x.note]), [["listen", true, undefined], ["safety", true, "ok"], ["reply", true, "scripted"]]);
});

test("strip: an emergency turn shows the safety level", () => {
  const s = strip({ heard: "madad", safetyLevel: "emergency", source: "scripted", stages: ["safety", "emergency"] }, false);
  assert.equal(s[1].note, "emergency");
});

test("strip: the opener (nothing heard) leaves the first step off", () => {
  assert.equal(strip({ heard: "", safetyLevel: "none", source: "scripted", stages: ["scripted"] }, false)[0].on, false);
});
