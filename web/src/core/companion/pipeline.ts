// Turn pipeline. The order below is fixed, and pipeline.test.ts checks it:
//
//   text → SafetyScreen ── hit → EmergencyFlow (scripted, no model)
//        → TriggerFilter ── hit → scripted redirect (no model)
//        → PromptGenerator → LLM ── fail/timeout → ScriptedCompanion
//        → OutputGuard → lines to speak (UI calls TTS with `rate`)
//
// STT and TTS stay in the UI; this module is pure logic plus one awaited
// provider call. Conversation history lives in memory only.

import type { ElderProfile, FeedbackEntry, Lang, TopicId } from "./types.ts";
import { baseLang } from "./types.ts";
import { NONE, SafetyScreen, type SafetyResult } from "./safety.ts";
import { EmergencyFlow, type EmergencyAction } from "./emergency.ts";
import { checkTriggers, topicForTurn, topicPlan, type TopicPlan } from "./triggers.ts";
import { buildSystemPrompt, lengthRule } from "./prompt.ts";
import { guardOutput, type GuardReason } from "./outputGuard.ts";
import { ScriptedCompanion } from "./scripted.ts";
import { ScriptedProvider, type ChatMessage, type LLMProvider } from "./llm.ts";
import { speechRate } from "../speech/speech.ts";

export type PipelineStep = "safety" | "emergency" | "trigger" | "prompt" | "llm" | "scripted" | "guard";

export interface PipelineDeps {
  profile: ElderProfile;
  /** Caregiver feedback, oldest first. */
  feedback?: readonly FeedbackEntry[];
  /** Defaults to the offline ScriptedProvider. */
  llm?: LLMProvider;
  /** Local "HH:MM". */
  clock?: () => string;
  now?: () => number;
  /** Observes each step in order (tests, debugging). */
  trace?: (step: PipelineStep) => void;
}

export type TurnSource = "llm" | "scripted" | "redirect" | "emergency" | "silence" | "opener";

export interface TurnResult {
  /** Lines to speak, in order. */
  say: string[];
  lang: Lang;
  rate: number;
  source: TurnSource;
  safety: SafetyResult;
  /** Non-speech emergency actions (call, whatsapp, log, notify_caregiver, exhausted). */
  actions: EmergencyAction[];
  topic?: TopicId | null;
  guard?: GuardReason[];
  /** Why the model was not used, when it fell back. */
  fallback?: string;
}

export class CompanionPipeline {
  private readonly profile: ElderProfile;
  private readonly lang: Lang;
  private readonly rate: number;
  private readonly plan: TopicPlan;
  private readonly safety: SafetyScreen;
  private readonly flow: EmergencyFlow;
  private readonly scripted: ScriptedCompanion;
  private readonly llm: LLMProvider;
  private readonly feedback: readonly FeedbackEntry[];
  private readonly clock: () => string;
  private readonly now: () => number;
  private readonly trace: (s: PipelineStep) => void;
  private history: ChatMessage[] = [];
  private turnNo = 0;
  private readonly topics = new Set<TopicId>();

  constructor(deps: PipelineDeps) {
    this.profile = deps.profile;
    this.lang = baseLang(deps.profile.language);
    this.rate = speechRate(deps.profile.gdsStage);
    this.feedback = deps.feedback ?? [];
    this.plan = topicPlan(deps.profile, this.feedback);
    this.safety = new SafetyScreen({ stage: deps.profile.gdsStage, customWords: deps.profile.customDistressWords });
    this.flow = new EmergencyFlow(deps.profile);
    this.scripted = new ScriptedCompanion(deps.profile, { plan: this.plan });
    this.llm = deps.llm ?? new ScriptedProvider(this.scripted);
    this.clock = deps.clock ?? (() => {
      const d = new Date();
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    });
    this.now = deps.now ?? (() => Date.now());
    this.trace = deps.trace ?? (() => {});
  }

  get emergencyPhase() { return this.flow.phase; }

  /** Topics touched this session (for the caregiver feedback chips). */
  sessionTopics(): TopicId[] { return [...this.topics]; }

  /** First line of a session. */
  opener(): TurnResult {
    const r = this.scripted.opener(this.clock());
    this.history.push({ role: "assistant", content: r.text });
    this.safety.prompted(this.now());
    return this.result("opener", [r.text], NONE);
  }

  /** One utterance from the person (STT text or a tapped choice). */
  async turn(text: string): Promise<TurnResult> {
    const now = this.now();

    // 1. safety, always first
    this.trace("safety");
    const s = this.safety.screen(text, now);

    // an open emergency flow consumes the turn
    const phase = this.flow.phase;
    if (phase === "asking") {
      this.trace("emergency");
      return this.fromFlow(s.level !== "none" ? [...this.flow.start(s, now), ...this.flow.answer(text, now)] : this.flow.answer(text, now), s);
    }
    if (phase === "calling" || phase === "exhausted") {
      this.trace("emergency");
      // a call is already under way: stay present, no model
      return this.result("emergency", [this.scripted.comfort(this.turnNo)], s);
    }
    if (s.level !== "none") {
      this.trace("emergency");
      return this.fromFlow(this.flow.start(s, now), s);
    }

    // 2. caregiver triggers → scripted redirect, no model
    this.trace("trigger");
    const tc = checkTriggers(text, this.plan, this.turnNo);
    if (tc.redirect) {
      this.trace("scripted");
      const r = this.scripted.reply({ text, turn: this.turnNo, clock: this.clock(), redirectTo: tc.topic });
      return this.finish(text, r.text, "redirect", r.topic, s);
    }

    // 3. prompt → 4. model (or scripted fallback)
    this.trace("prompt");
    const clock = this.clock();
    const system = buildSystemPrompt({ profile: this.profile, clock, plan: this.plan });
    const messages: ChatMessage[] = [...this.history, { role: "user", content: text }];
    let raw: string;
    let source: TurnSource = this.llm.id === "scripted" ? "scripted" : "llm";
    let fallback: string | undefined;
    let topic: TopicId | null = null;
    this.trace(source === "llm" ? "llm" : "scripted");
    try {
      raw = await this.llm.complete(system, messages, { maxTokens: lengthRule(this.profile.gdsStage).maxTokens, clock });
      if (this.llm instanceof ScriptedProvider) topic = this.llm.lastTopic;
    } catch (e) {
      fallback = e instanceof Error ? e.message : String(e);
      source = "scripted";
      this.trace("scripted");
      const r = this.scripted.reply({ text, turn: this.turnNo, clock });
      raw = r.text;
      topic = r.topic;
    }

    // 5. output guard; a blocked reply becomes a scripted redirect
    this.trace("guard");
    const g = guardOutput(raw, { stage: this.profile.gdsStage, lang: this.lang, avoid: this.plan.avoid });
    let out = g.text;
    if (out === null) {
      const r = this.scripted.reply({ text, turn: this.turnNo, clock, redirectTo: topicForTurn(this.plan.weights, this.turnNo) });
      out = r.text;
      topic = r.topic;
      source = "scripted";
    }
    const res = this.finish(text, out, source, topic, s);
    res.guard = g.reasons;
    if (fallback) res.fallback = fallback;
    return res;
  }

  /** Call about once a second: silence timer and the 20 s no-answer rule. */
  tick(): TurnResult | null {
    const now = this.now();
    if (this.flow.phase === "asking") {
      const a = this.flow.tick(now);
      return a.length ? this.fromFlow(a, NONE) : null;
    }
    if (this.flow.phase !== "idle" && this.flow.phase !== "done") return null;
    const s = this.safety.tick(now);
    if (s.level === "none") return null;
    if (s.level === "check") {
      // gentle warm prompt, not the emergency script
      const r = this.scripted.reply({ text: "", turn: this.turnNo, clock: this.clock() });
      return { ...this.result("silence", [r.text], s), topic: r.topic };
    }
    return this.fromFlow(this.flow.start(s, now), s);
  }

  /** Each tap on the elder screen (agitation detection). */
  tap(): TurnResult | null {
    const now = this.now();
    const s = this.safety.tap(now);
    if (s.level === "none") return null;
    return this.fromFlow(this.flow.start(s, now), s);
  }

  /** The Help button. */
  help(): TurnResult {
    const s: SafetyResult = { level: "emergency", matched: ["help button"], trigger: "keyword", categories: ["help"] };
    this.safety.responded(this.now());
    return this.fromFlow(this.flow.start(s, this.now()), s);
  }

  callConnected(): TurnResult { return this.fromFlow(this.flow.callConnected(this.now()), NONE); }
  callUnanswered(): TurnResult { return this.fromFlow(this.flow.callUnanswered(this.now()), NONE); }
  resolveEmergency(by: string): TurnResult { return this.fromFlow(this.flow.cancel(by, this.now()), NONE); }

  // ---- internals ----

  private finish(userText: string, out: string, source: TurnSource, topic: TopicId | null, s: SafetyResult): TurnResult {
    this.history.push({ role: "user", content: userText }, { role: "assistant", content: out });
    this.history = this.history.slice(-16);
    this.turnNo += 1;
    if (topic) this.topics.add(topic);
    this.safety.prompted(this.now());
    return { ...this.result(source, [out], s), topic };
  }

  private fromFlow(actions: EmergencyAction[], s: SafetyResult): TurnResult {
    const say = actions.flatMap(a => (a.type === "speak" ? [a.text] : []));
    const rest = actions.filter(a => a.type !== "speak");
    return { ...this.result("emergency", say, s), actions: rest };
  }

  private result(source: TurnSource, say: string[], s: SafetyResult): TurnResult {
    return { say, lang: this.lang, rate: this.rate, source, safety: s, actions: [] };
  }
}
