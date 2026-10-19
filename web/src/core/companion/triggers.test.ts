import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPhrases, topicOf, topicPlan, topicForTurn, checkTriggers } from "./triggers.ts";
import type { ElderProfile } from "./types.ts";

const base: ElderProfile = { displayName: "Test Elder", gdsStage: 4, language: "hi" };

test("matchPhrases is whole-phrase, case- and punctuation-insensitive", () => {
  assert.deepEqual(matchPhrases("Hospital mein kab jaana hai?", ["hospital"]), ["hospital"]);
  assert.deepEqual(matchPhrases("hospitality was great", ["hospital"]), []);
  assert.deepEqual(matchPhrases("अस्पताल की बात", ["अस्पताल"]), ["अस्पताल"]);
  assert.deepEqual(matchPhrases("anything", ["", "  "]), []);
});

test("topicOf maps caregiver chips in English and Hindi to topics", () => {
  assert.equal(topicOf("Songs"), "music");
  assert.equal(topicOf("भजन"), "music");
  assert.equal(topicOf("khana"), "food");
  assert.equal(topicOf("life_story"), "life_story");
  assert.equal(topicOf("cricket"), null);
});

test("plan: equal weights, life story off without notes", () => {
  const p = topicPlan(base);
  assert.deepEqual(p.weights, { reminiscence: 1, music: 1, festivals: 1, food: 1, weather: 1, life_story: 0 });
  assert.deepEqual(p.avoid, []);
  assert.equal(p.recentMood, null);
});

test("plan: preferences and keep feedback raise weights; avoid zeroes them", () => {
  const p = topicPlan({ ...base, preferences: ["bhajan"], lifeStory: "notes" }, [
    { keep: ["music"], avoid: ["food"], mood: 4 },
    { keep: ["music", "garden"], mood: 2 },
  ]);
  assert.equal(p.weights.music, 1 + 1 + 2);
  assert.equal(p.weights.food, 0);
  assert.equal(p.weights.life_story, 1);
  assert.deepEqual(p.keep, ["music", "garden"]);
  assert.deepEqual(p.avoid, ["food"]);
  assert.equal(p.recentMood, 3);
});

test("plan: a later keep cancels an earlier feedback avoid; profile triggers always stay", () => {
  const p = topicPlan({ ...base, triggers: ["Hospital", "festivals"] }, [{ avoid: ["weather"] }, { keep: ["weather"] }]);
  assert.equal(p.weights.weather, 2);
  assert.equal(p.weights.festivals, 0);
  assert.deepEqual(p.avoid, ["hospital", "festivals"]);
});

test("recent mood averages the last three ratings only", () => {
  const p = topicPlan(base, [{ mood: 5 }, { mood: 1 }, { mood: 1 }, { mood: 1 }]);
  assert.equal(p.recentMood, 1);
});

test("topicForTurn: deterministic, proportional, never picks a zero-weight topic", () => {
  const w = { reminiscence: 1, music: 3, festivals: 0, food: 1, weather: 1, life_story: 0 };
  const seq = Array.from({ length: 12 }, (_, i) => topicForTurn(w, i));
  assert.deepEqual(seq, Array.from({ length: 12 }, (_, i) => topicForTurn(w, i)), "deterministic");
  assert.ok(!seq.includes("festivals") && !seq.includes("life_story"));
  assert.equal(seq.filter(t => t === "music").length, 6, "music is half the wheel");
  assert.notEqual(seq[0], seq[1], "repeats are spread apart");
});

test("topicForTurn: allowed narrows the choice, falls back when nothing allowed has weight", () => {
  const w = { reminiscence: 1, music: 1, festivals: 1, food: 1, weather: 0, life_story: 0 };
  for (let i = 0; i < 5; i++) assert.equal(topicForTurn(w, i, ["music"]), "music");
  assert.notEqual(topicForTurn(w, 0, ["weather"]), "weather");
});

test("checkTriggers redirects to a weighted topic when an avoid phrase is said", () => {
  const plan = topicPlan({ ...base, triggers: ["hospital"], preferences: ["music"] });
  const r = checkTriggers("mujhe hospital jaana hai", plan, 0);
  assert.equal(r.redirect, true);
  assert.deepEqual(r.matched, ["hospital"]);
  assert.ok(r.topic && plan.weights[r.topic] > 0);
  assert.deepEqual(checkTriggers("aaj mausam achha hai", plan), { redirect: false, matched: [], topic: null });
});
