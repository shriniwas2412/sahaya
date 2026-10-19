import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, lengthRule, inSundownWindow, partOfDay, minutesOf } from "./prompt.ts";
import type { ElderProfile, Stage } from "./types.ts";

// Synthetic profile only.
const synthetic = (stage: Stage | null): ElderProfile => ({
  displayName: "Test Elder",
  gdsStage: stage,
  language: "hi",
  dialect: "Bundeli",
  birthDecade: 1950,
  preferences: ["bhajan", "gardening"],
  triggers: ["hospital"],
  sundownStart: "17:30",
  sundownEnd: "20:00",
});

for (const stage of [1, 2, 3, 4, 5, 6, 7] as Stage[]) {
  test(`stage ${stage} prompt snapshot`, t => {
    const p = buildSystemPrompt({ profile: synthetic(stage), clock: "10:00" });
    assert.match(p, new RegExp(`Stage: GDS ${stage} \\(`));
    t.assert.snapshot(p);
  });
}

test("length rule by stage: 1-3 ≤3 sentences, 4-5 ≤2, 6-7 one", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(s => lengthRule(s as Stage).maxSentences), [3, 3, 3, 2, 2, 1, 1]);
  assert.equal(lengthRule(null).maxSentences, 2, "unassessed uses the stage-4 style");
  assert.match(buildSystemPrompt({ profile: synthetic(2) }), /at most 3 short sentences/);
  assert.match(buildSystemPrompt({ profile: synthetic(5) }), /at most 2 short sentences/);
  assert.match(buildSystemPrompt({ profile: synthetic(7) }), /one short sentence of at most 12 words/);
});

test("stage blocks follow the GDS table: late stages avoid recall, stage 1 makes no assumptions", () => {
  assert.match(buildSystemPrompt({ profile: synthetic(1) }), /no assumptions about memory/);
  assert.match(buildSystemPrompt({ profile: synthetic(5) }), /Never ask about recent events/);
  assert.match(buildSystemPrompt({ profile: synthetic(6) }), /Do not ask them to recall anything/);
  assert.match(buildSystemPrompt({ profile: synthetic(7) }), /very few, simple words/);
});

test("stage not assessed is said plainly and never guessed as a number", () => {
  const p = buildSystemPrompt({ profile: synthetic(null) });
  assert.match(p, /Stage: not assessed/);
  assert.doesNotMatch(p, /GDS \d/);
});

test("persona defaults to Sahaya, can be renamed, and the source prompt's name never leaks", () => {
  const p = buildSystemPrompt({ profile: synthetic(3) });
  assert.match(p, /You are Sahaya,/);
  assert.doesNotMatch(p, /Gork/i);
  assert.match(buildSystemPrompt({ profile: { ...synthetic(3), personaName: "Saathi" } }), /You are Saathi,/);
});

test("language and dialect rules", () => {
  const hi = buildSystemPrompt({ profile: synthetic(3) });
  assert.match(hi, /Hindi written in Devanagari/);
  assert.match(hi, /Bundeli words/);
  assert.match(hi, /"Test जी"/);
  const en = buildSystemPrompt({ profile: { ...synthetic(3), language: "en-IN", dialect: null } });
  assert.match(en, /plain Indian English/);
  assert.match(en, /"Test"/);
  assert.doesNotMatch(en, /dialect/);
  assert.match(buildSystemPrompt({ profile: { ...synthetic(3), language: "gu" } }), /Gujarati script/);
});

test("sundowning window: softer evening block only inside the window, including across midnight", () => {
  assert.match(buildSystemPrompt({ profile: synthetic(4), clock: "18:00" }), /usual restless time of day \(17:30–20:00\)/);
  assert.doesNotMatch(buildSystemPrompt({ profile: synthetic(4), clock: "10:00" }), /restless time/);
  assert.equal(inSundownWindow("23:30", "22:00", "02:00"), true);
  assert.equal(inSundownWindow("01:59", "22:00", "02:00"), true);
  assert.equal(inSundownWindow("02:00", "22:00", "02:00"), false);
  assert.equal(inSundownWindow("18:00", null, "20:00"), false);
  assert.equal(inSundownWindow("bad", "17:00", "20:00"), false);
});

test("time helpers", () => {
  assert.equal(minutesOf("07:05"), 425);
  assert.equal(minutesOf("24:00"), null);
  assert.deepEqual(["06:00", "13:00", "18:00", "23:00", "03:00"].map(partOfDay), ["morning", "afternoon", "evening", "night", "night"]);
  assert.equal(partOfDay(undefined), null);
});

test("preferences, triggers and caregiver feedback shape the prompt", () => {
  const p = buildSystemPrompt({
    profile: synthetic(4),
    feedback: [{ keep: ["music"], avoid: ["food"], mood: 2 }, { mood: 1 }],
  });
  assert.match(p, /Things they enjoy \(from the caregiver\): bhajan; gardening/);
  assert.match(p, /Never bring up: hospital; food/);
  assert.match(p, /gently move to old songs or bhajans/);
  assert.match(p, /Topics that went well in recent sessions: music/);
  assert.match(p, /Do not start conversations about: favourite foods/);
  assert.match(p, /rated recent sessions as hard/);
});

test("life story: only the family's notes, and an explicit no-invention rule otherwise", () => {
  const withStory = buildSystemPrompt({ profile: { ...synthetic(3), lifeStory: "Taught in a village school." } });
  assert.match(withStory, /Use only these facts .*Taught in a village school\./);
  assert.match(buildSystemPrompt({ profile: synthetic(3) }), /Never make up facts about them/);
});

test("safety hand-off, no medical advice, no personal data requests are always present", () => {
  for (const s of [1, 4, 7] as Stage[]) {
    const p = buildSystemPrompt({ profile: synthetic(s) });
    assert.match(p, /fixed emergency script/);
    assert.match(p, /Never give medical advice/);
    assert.match(p, /Never ask for money/);
  }
});

test("redirect turn asks for a gentle topic change", () => {
  assert.match(buildSystemPrompt({ profile: synthetic(4), redirectTo: "weather" }), /Right now: gently change the topic to the season/);
});

test("caregiver text is flattened and capped", () => {
  const p = buildSystemPrompt({ profile: { ...synthetic(3), preferences: ["line1\n\nline2", "x".repeat(500)] } });
  assert.match(p, /line1 line2/);
  assert.doesNotMatch(p, /x{81}/);
});

test("pure: same input, same output", () => {
  const i = { profile: synthetic(4), clock: "18:00", feedback: [{ keep: ["music"] }] };
  assert.equal(buildSystemPrompt(i), buildSystemPrompt(i));
});
