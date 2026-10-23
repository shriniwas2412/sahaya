import { test } from "node:test";
import assert from "node:assert/strict";
import { CompanionPipeline, type PipelineStep } from "./pipeline.ts";
import { GroqProvider, type ChatMessage, type LLMProvider } from "./llm.ts";
import type { ElderProfile } from "./types.ts";

// Synthetic profile; placeholder numbers.
const profile = (over: Partial<ElderProfile> = {}): ElderProfile => ({
  displayName: "Test Elder", gdsStage: 2, language: "en", triggers: ["hospital"],
  familyContacts: [{ name: "First", phone: "9000000001", whatsapp: true, order: 1 }],
  ...over,
});

/** A fake model that records every call and the log of steps it saw. */
function spyLLM(reply: string | (() => Promise<string>) = "That sounds lovely. Tell me more?") {
  const calls: { system: string; messages: readonly ChatMessage[] }[] = [];
  const llm: LLMProvider = {
    id: "spy", remote: true,
    async complete(system, messages) {
      calls.push({ system, messages });
      return typeof reply === "string" ? reply : reply();
    },
  };
  return { llm, calls };
}

function setup(over: Partial<ElderProfile> = {}, llm?: LLMProvider) {
  let t = 0;
  const steps: PipelineStep[] = [];
  // tests that pass a model opt in to it; the no-consent path has its own tests below
  const p = new CompanionPipeline({ profile: profile(over), llm, consent: { scope_llm_cloud: 1 }, clock: () => "10:00", now: () => t, trace: s => steps.push(s) });
  return { p, steps, advance: (ms: number) => { t += ms; } };
}

test("fixed order for a normal turn: safety → trigger → prompt → llm → guard", async () => {
  const { llm, calls } = spyLLM();
  const { p, steps } = setup({}, llm);
  const r = await p.turn("we used to fly kites");
  assert.deepEqual(steps, ["safety", "trigger", "prompt", "llm", "guard"]);
  assert.equal(calls.length, 1);
  assert.equal(r.source, "llm");
  assert.deepEqual(r.say, ["That sounds lovely. Tell me more?"]);
});

test("safety runs before any model call, on every turn", async () => {
  const order: string[] = [];
  const llm: LLMProvider = { id: "spy", remote: true, async complete() { order.push("llm"); return "Nice."; } };
  let t = 0;
  const p = new CompanionPipeline({ profile: profile(), llm, consent: { scope_llm_cloud: 1 }, clock: () => "10:00", now: () => t++, trace: s => { if (s === "safety") order.push("safety"); } });
  for (const s of ["hello", "kites", "mangoes"]) await p.turn(s);
  assert.deepEqual(order, ["safety", "llm", "safety", "llm", "safety", "llm"]);
});

test("distress text never reaches the model: scripted emergency flow instead", async () => {
  const { llm, calls } = spyLLM();
  const { p, steps } = setup({}, llm);
  const r = await p.turn("help me, I fell");
  assert.deepEqual(steps, ["safety", "emergency"]);
  assert.equal(calls.length, 0);
  assert.equal(r.source, "emergency");
  assert.equal(r.safety.level, "emergency");
  assert.deepEqual(r.say, ["Please don't try to get up quickly.", "I'm right here, Test. Shall I call someone for you?"]);
  assert.ok(r.actions.some(a => a.type === "log"));
  assert.equal(p.emergencyPhase, "asking");
});

test("the answer to 'shall I call someone' goes to the flow, not the model", async () => {
  const { llm, calls } = spyLLM();
  const { p } = setup({}, llm);
  await p.turn("bachao");
  const r = await p.turn("yes");
  assert.equal(calls.length, 0);
  assert.ok(r.actions.some(a => a.type === "call" && a.url === "tel:9000000001"));
  const during = await p.turn("are they coming");
  assert.equal(calls.length, 0, "no model while a call is under way");
  assert.equal(during.say.length, 1);
  p.callConnected();
  assert.equal(p.emergencyPhase, "done");
});

test("emergency turns are kept out of the model's history", async () => {
  const { llm, calls } = spyLLM();
  const { p } = setup({}, llm);
  await p.turn("bachao");
  await p.turn("no");
  await p.turn("tell me a story");
  assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify(calls[0]!.messages).includes("bachao"));
});

test("20 s with no answer at emergency level connects via tick()", () => {
  const { p, advance } = setup();
  p.help();
  advance(19_999);
  assert.equal(p.tick(), null);
  advance(1);
  const r = p.tick()!;
  assert.ok(r.actions.some(a => a.type === "call"));
});

test("caregiver trigger → scripted redirect, no model", async () => {
  const { llm, calls } = spyLLM();
  const { p, steps } = setup({}, llm);
  const r = await p.turn("when do I go to the hospital?");
  assert.deepEqual(steps, ["safety", "trigger", "scripted"]);
  assert.equal(calls.length, 0);
  assert.equal(r.source, "redirect");
  assert.match(r.say[0]!, /^Let's talk about something nice\./);
});

test("model failure falls back to the scripted companion", async () => {
  const { llm } = spyLLM(async () => { throw new Error("HTTP 500"); });
  const { p, steps } = setup({}, llm);
  const r = await p.turn("hello");
  assert.deepEqual(steps, ["safety", "trigger", "prompt", "llm", "scripted", "guard"]);
  assert.equal(r.source, "scripted");
  assert.equal(r.fallback, "HTTP 500");
  assert.ok(r.say[0]!.length > 5);
});

test("model timeout (real provider, short timeout) falls back to scripted", async () => {
  const hang = new GroqProvider({ apiKey: "k", model: "m", timeoutMs: 20, fetch: () => new Promise(() => {}) });
  const { p } = setup({}, hang);
  const r = await p.turn("hello");
  assert.equal(r.source, "scripted");
  assert.match(r.fallback!, /no reply in 20 ms/);
});

test("model medical advice is replaced by the safe line", async () => {
  const { llm } = spyLLM("You should take two tablets of paracetamol.");
  const { p } = setup({}, llm);
  const r = await p.turn("my head feels heavy today");
  assert.deepEqual(r.say, ["Your family or doctor will help with medicines. Let's talk about something nice."]);
  assert.ok(r.guard?.includes("medical"));
});

test("model bringing up an avoided topic is replaced by a scripted redirect", async () => {
  const { llm } = spyLLM("Do you remember the hospital?");
  const { p } = setup({}, llm);
  const r = await p.turn("hello");
  assert.equal(r.source, "scripted");
  assert.doesNotMatch(r.say[0]!, /hospital/i);
});

test("model output is capped to the stage length and stripped of markdown", async () => {
  const { llm } = spyLLM("**Wonderful!** One. Two. Three. Four.");
  const { p } = setup({ gdsStage: 6 }, llm);
  const r = await p.turn("kites");
  assert.deepEqual(r.say, ["Wonderful!"]);
  assert.equal(r.rate, 0.85);
});

test("the system prompt sent to the model is stage-aware", async () => {
  const { llm, calls } = spyLLM();
  const { p } = setup({ gdsStage: 5 }, llm);
  await p.turn("hello");
  assert.match(calls[0]!.system, /Never ask about recent events/, "stage-5 guidance (the number itself is not sent to a remote model)");
  assert.match(calls[0]!.system, /Never bring up: hospital/);
});

test("default provider is scripted and offline", async () => {
  const orig = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; throw new Error("no"); }) as typeof fetch;
  try {
    const { p, steps } = setup({ language: "hi" });
    const r = await p.turn("namaste");
    assert.equal(r.source, "scripted");
    assert.deepEqual(steps, ["safety", "trigger", "prompt", "scripted", "guard"]);
    assert.equal(r.lang, "hi");
    assert.equal(r.rate, 0.9);
  } finally { globalThis.fetch = orig; }
  assert.equal(called, false);
});

test("silence: gentle prompt first, emergency flow after two unanswered checks", () => {
  const { p, advance } = setup();
  p.opener();
  advance(90_000);
  const c1 = p.tick()!;
  assert.equal(c1.source, "silence");
  assert.equal(p.emergencyPhase, "idle");
  advance(90_000);
  assert.equal(p.tick()!.source, "silence");
  advance(90_000);
  const e = p.tick()!;
  assert.equal(e.source, "emergency");
  assert.equal(e.safety.trigger, "silence");
  assert.equal(p.emergencyPhase, "asking");
});

test("speaking resets the silence timer", async () => {
  const { p, advance } = setup();
  p.opener();
  advance(80_000);
  await p.turn("kites");
  advance(80_000);
  assert.equal(p.tick(), null);
});

test("rapid taps start the flow (agitation)", () => {
  const { p, advance } = setup();
  let r = null;
  for (let i = 0; i < 6; i++) { r = p.tap(); advance(100); }
  assert.equal(r!.safety.trigger, "agitation");
  assert.equal(p.emergencyPhase, "asking");
});

test("session topics are collected for the feedback form", async () => {
  const { p } = setup();
  for (let i = 0; i < 5; i++) await p.turn("ok");
  assert.ok(p.sessionTopics().length >= 2);
});

// ---------- remote-model opt-in ----------
test("a remote model is not used without scope_llm_cloud consent: scripted instead, nothing sent", async () => {
  const { llm, calls } = spyLLM();
  let t = 0;
  const p = new CompanionPipeline({ profile: profile(), llm, clock: () => "10:00", now: () => t++ });
  const r = await p.turn("we flew kites");
  assert.equal(calls.length, 0);
  assert.equal(r.source, "scripted");
  assert.equal(r.trace.source, "scripted");
  assert.match(p.modelBlocked ?? "", /scope_llm_cloud/);
});

test("with consent, the remote model gets the minimal prompt and at most 4 exchanges", async () => {
  const { llm, calls } = spyLLM();
  let t = 0;
  const p = new CompanionPipeline({
    profile: profile({ displayName: "Test Elder Surname", gdsStage: 4 }), llm, consent: { scope_llm_cloud: 1 },
    clock: () => "10:00", now: () => t++,
  });
  for (let i = 0; i < 7; i++) await p.turn(`kites ${i}`);
  const last = calls.at(-1)!;
  assert.doesNotMatch(last.system, /Surname|GDS/);
  assert.ok(last.messages.length <= 9, String(last.messages.length)); // 4 exchanges + the new message
  assert.equal(last.messages.at(-1)!.content, "kites 6");
  assert.equal(p.modelBlocked, null);
});

test("a local model (not remote) needs no cloud consent and gets the full prompt", async () => {
  const calls: string[] = [];
  const local: LLMProvider = { id: "local", remote: false, async complete(system) { calls.push(system); return "Nice."; } };
  let t = 0;
  const p = new CompanionPipeline({ profile: profile({ gdsStage: 4 }), llm: local, clock: () => "10:00", now: () => t++ });
  const r = await p.turn("kites");
  assert.equal(r.source, "llm");
  assert.match(calls[0]!, /Stage: GDS 4/);
});

// ---------- turn trace for the UI ----------
test("trace: heard text, safety level, scripted vs model, and the stages passed", async () => {
  const { llm } = spyLLM();
  let t = 0;
  const p = new CompanionPipeline({ profile: profile(), llm, consent: { scope_llm_cloud: true }, clock: () => "10:00", now: () => t++ });
  const ok = await p.turn("we used to fly kites");
  assert.deepEqual(ok.trace, { heard: "we used to fly kites", safetyLevel: "none", source: "model", stages: ["safety", "trigger", "prompt", "llm", "guard"] });
  const help = await p.turn("bachao");
  assert.deepEqual(help.trace, { heard: "bachao", safetyLevel: "emergency", source: "scripted", stages: ["safety", "emergency"] });
});

test("trace: scripted default, redirect, and non-turn results", async () => {
  const { p } = setup({ language: "en" });
  assert.deepEqual(p.opener().trace, { heard: "", safetyLevel: "none", source: "scripted", stages: [] });
  const r = await p.turn("hello");
  assert.deepEqual(r.trace, { heard: "hello", safetyLevel: "none", source: "scripted", stages: ["safety", "trigger", "prompt", "scripted", "guard"] });
  const red = await p.turn("hospital");
  assert.deepEqual(red.trace.stages, ["safety", "trigger", "scripted"]);
  assert.equal(p.help().trace.safetyLevel, "emergency");
});

test("trace: a failed model call shows the fallback to scripted", async () => {
  const { llm } = spyLLM(async () => { throw new Error("HTTP 500"); });
  let t = 0;
  const p = new CompanionPipeline({ profile: profile(), llm, consent: { scope_llm_cloud: 1 }, clock: () => "10:00", now: () => t++ });
  const r = await p.turn("hello");
  assert.equal(r.trace.source, "scripted");
  assert.deepEqual(r.trace.stages, ["safety", "trigger", "prompt", "llm", "scripted", "guard"]);
});
