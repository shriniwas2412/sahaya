import { test } from "node:test";
import assert from "node:assert/strict";
import { ScriptedCompanion, BANKS, bandOf, bankFor, storyLines } from "./scripted.ts";
import { guardOutput } from "./outputGuard.ts";
import { lengthRule } from "./prompt.ts";
import { TOPICS, type ElderProfile, type Lang, type Stage } from "./types.ts";

const profile = (over: Partial<ElderProfile> = {}): ElderProfile => ({ displayName: "Test Elder", gdsStage: 4, language: "hi", ...over });

test("stage bands: 1-3 early, 4-5 middle, 6-7 late, unassessed middle", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(s => bandOf(s as Stage)), ["early", "early", "early", "middle", "middle", "late", "late"]);
  assert.equal(bandOf(null), "middle");
});

test("every bank has every topic × band, at least 3 lines each", () => {
  for (const lang of Object.keys(BANKS) as Lang[]) {
    const b = BANKS[lang]!;
    for (const t of TOPICS) {
      if (t === "life_story") continue;
      for (const band of ["early", "middle", "late"] as const) assert.ok(b.topics[t][band].length >= 3, `${lang}/${t}/${band}`);
    }
  }
});

test("bank lines already fit their stage band and pass the output guard untouched", () => {
  const stageOf = { early: 3, middle: 5, late: 7 } as const;
  for (const lang of ["hi", "en"] as const) {
    for (const t of TOPICS) {
      if (t === "life_story") continue;
      for (const band of ["early", "middle", "late"] as const) {
        for (const line of BANKS[lang]!.topics[t][band]) {
          const g = guardOutput(line, { stage: stageOf[band], lang });
          assert.equal(g.text, line, `${lang}/${t}/${band}: ${line}`);
          assert.ok(line.length <= lengthRule(stageOf[band]).maxChars);
        }
      }
    }
  }
});

test("late-stage lines are comfort and sensory statements, not questions", () => {
  for (const lang of ["hi", "en"] as const)
    for (const t of TOPICS) {
      if (t === "life_story") continue;
      for (const line of BANKS[lang]!.topics[t].late) assert.ok(!line.includes("?"), line);
    }
});

test("Hindi persona lines stay gender-neutral (no आई/गई/रही for the companion)", () => {
  const hi = BANKS.hi!;
  const own = [...Object.values(hi.greet), hi.listening, ...hi.comfort, ...hi.calm, hi.redirect];
  for (const l of own) assert.doesNotMatch(l, /(आई|गई|रही|रहा|आया|गया) हूँ/, l);
});

test("mr and gu fall back to the Hindi bank until written", () => {
  assert.equal(bankFor("mr"), BANKS.hi);
  assert.equal(bankFor("gu"), BANKS.hi);
  assert.equal(new ScriptedCompanion(profile({ language: "mr" })).lang, "mr");
});

test("opener greets by name with जी in Hindi and the persona in Devanagari", () => {
  assert.equal(new ScriptedCompanion(profile({ gdsStage: 2 })).opener().text, "नमस्ते Test जी। मैं सहाया हूँ। आज आप कैसा महसूस कर रहे हैं?");
  assert.equal(new ScriptedCompanion(profile({ language: "en", gdsStage: 2, personaName: "Saathi" })).opener().text, "Hello Test. I'm Saathi. How are you feeling today?");
  assert.equal(new ScriptedCompanion(profile({ gdsStage: 7 })).opener().text, "नमस्ते Test जी। मैं यहीं हूँ, आपके साथ।");
});

test("reply: acknowledgement + one topic line, within the stage's sentence limit", () => {
  const c = new ScriptedCompanion(profile({ language: "en", gdsStage: 4 }));
  for (let turn = 0; turn < 10; turn++) {
    const r = c.reply({ text: "we used to go to the river", turn });
    assert.ok(r.topic);
    assert.equal(guardOutput(r.text, { stage: 4, lang: "en" }).text, r.text, r.text);
  }
});

test("reply: late stage gives exactly one short sentence", () => {
  const c = new ScriptedCompanion(profile({ gdsStage: 7 }));
  for (let turn = 0; turn < 6; turn++) {
    const r = c.reply({ text: "haan", turn });
    assert.equal(r.text.split("।").filter(Boolean).length, 1, r.text);
  }
});

test("sad words get comfort first; empty input gets the listening line", () => {
  const c = new ScriptedCompanion(profile({ language: "en", gdsStage: 3 }));
  assert.match(c.reply({ text: "I feel so lonely", turn: 0 }).text, /^I'm right here with you, Test\./);
  assert.match(c.reply({ text: "", turn: 1 }).text, /^I love listening to you, Test\./);
  const late = new ScriptedCompanion(profile({ gdsStage: 6 }));
  assert.equal(late.reply({ text: "मैं बहुत उदास हूँ", turn: 0 }).text, "मैं यहीं हूँ, Test जी, आपके साथ।");
});

test("topics rotate without repeating a line back-to-back, and avoid-topics never appear", () => {
  const c = new ScriptedCompanion(profile({ language: "en", triggers: ["food"] }));
  const out = Array.from({ length: 12 }, (_, i) => c.reply({ text: "ok", turn: i }));
  assert.ok(out.every(r => r.topic !== "food"));
  for (let i = 1; i < out.length; i++) assert.notEqual(out[i]!.text, out[i - 1]!.text);
  assert.ok(new Set(out.map(r => r.topic)).size >= 3);
});

test("feedback 'keep' makes a topic come up more often", () => {
  const count = (c: ScriptedCompanion) => Array.from({ length: 20 }, (_, i) => c.reply({ text: "ok", turn: i })).filter(r => r.topic === "music").length;
  const plain = count(new ScriptedCompanion(profile()));
  const liked = count(new ScriptedCompanion(profile(), { feedback: [{ keep: ["music"] }, { keep: ["songs"] }] }));
  assert.ok(liked > plain, `${liked} > ${plain}`);
});

test("sundowning window: calm lead line and only calming topics", () => {
  const c = new ScriptedCompanion(profile({ language: "en", gdsStage: 3, sundownStart: "17:00", sundownEnd: "20:00" }));
  for (let i = 0; i < 6; i++) {
    const r = c.reply({ text: "ok", turn: i, clock: "18:30" });
    assert.ok(r.topic === "music" || r.topic === "weather", r.topic!);
    assert.match(r.text, /^(Let's breathe slowly together\.|All is well, Test\.)/);
  }
  assert.equal(c.opener("18:30").text, "Hello Test. I'm right here with you.");
});

test("redirect: says 'something else' and moves to the requested topic", () => {
  const c = new ScriptedCompanion(profile({ language: "en" }));
  const r = c.reply({ text: "hospital", turn: 0, redirectTo: "weather" });
  assert.equal(r.topic, "weather");
  assert.match(r.text, /^Let's talk about something nice\./);
});

test("life-story mode asks only about the caregiver's own notes, verbatim", () => {
  const notes = "Taught in a village school. Grew roses";
  assert.deepEqual(storyLines(notes), ["Taught in a village school", "Grew roses"]);
  const c = new ScriptedCompanion(profile({ language: "en", gdsStage: 3, lifeStory: notes }));
  const asked = Array.from({ length: 20 }, (_, i) => c.reply({ text: "ok", turn: i })).filter(r => r.topic === "life_story").map(r => r.text);
  assert.ok(asked.length >= 2);
  assert.ok(asked.some(t => t.endsWith("Tell me more about this: Taught in a village school")));
  assert.ok(asked.some(t => t.endsWith("Tell me more about this: Grew roses")));
});

test("no life-story questions without notes, or at late stages", () => {
  const none = new ScriptedCompanion(profile({ language: "en" }));
  const late = new ScriptedCompanion(profile({ language: "en", gdsStage: 7, lifeStory: "Taught in a village school." }));
  for (let i = 0; i < 20; i++) {
    assert.notEqual(none.reply({ text: "ok", turn: i }).topic, "life_story");
    assert.notEqual(late.reply({ text: "ok", turn: i }).topic, "life_story");
  }
});

test("scripted replies never contain medical words", () => {
  for (const lang of ["hi", "en"]) {
    const c = new ScriptedCompanion(profile({ language: lang, gdsStage: 3 }));
    for (let i = 0; i < 30; i++) {
      const r = c.reply({ text: "ok", turn: i });
      assert.ok(!guardOutput(r.text, { stage: 3, lang: lang as Lang }).reasons.includes("medical"), r.text);
    }
  }
});
