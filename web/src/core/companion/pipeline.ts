// Turn pipeline. The order below is fixed, and pipeline.test.ts checks it:
//
//   text → SafetyScreen ── hit → EmergencyFlow (scripted, no model)
//        → TriggerFilter ── hit → scripted redirect (no model)
//        → PromptGenerator → LLM ── fail/timeout → ScriptedCompanion
//        → OutputGuard → lines to speak (UI calls TTS with `rate`)
//
// STT and TTS stay in the UI; this module is pure logic plus one awaited
// provider call. Conversation history lives in memory only.
//
// A remote model runs only with consent.scope_llm_cloud; it then gets the
// minimal prompt and the last 4 exchanges (REMOTE_MODEL_DISCLOSURE). Every
// result carries a `trace` the UI can show: heard → safety → reply.

import type { ElderProfile, FeedbackEntry, Lang, TopicId } from "./types.ts";
import { baseLang } from "./types.ts";
import { NONE, SafetyScreen, type SafetyLevel, type SafetyResult } from "./safety.ts";
import { EmergencyFlow, type EmergencyAction } from "./emergency.ts";
import { checkTriggers, topicForTurn, topicPlan, type TopicPlan } from "./triggers.ts";
import { buildSystemPrompt, lengthRule } from "./prompt.ts";
import { guardOutput, type GuardReason } from "./outputGuard.ts";
import { ScriptedCompanion } from "./scripted.ts";
import {
  REMOTE_HISTORY_EXCHANGES, ScriptedProvider, remoteModelAllowed, type ChatMessage, type LLMProvider, type ModelConsent,
} from "./llm.ts";
import { speechRate } from "../speech/speech.ts";

export type PipelineStep = "safety" | "emergency" | "trigger" | "prompt" | "llm" | "scripted" | "guard";

export interface PipelineDeps {
  profile: ElderProfile;
  /** Caregiver feedback, oldest first. */
  feedback?: readonly FeedbackEntry[];
  /** Defaults to the offline ScriptedProvider. A remote one also needs `consent`. */
  llm?: LLMProvider;
  /** The elder's consent row; a remote model needs scope_llm_cloud = 1. */
  consent?: ModelConsent | null;
  /** Local "HH:MM". */
  clock?: () => string;
  now?: () => number;
  /** Observes each step in order (tests, debugging). */
  trace?: (step: PipelineStep) => void;
}

export type TurnSource = "llm" | "scripted" | "redirect" | "emergency" | "silence" | "opener";

/** What the UI shows for a turn: सुन रहे हैं → सुरक्षा जांच → जवाब. */
export interface TurnTrace {
  /** The text the turn started from ("" for opener, silence, taps, Help). */
  heard: string;
  safetyLevel: SafetyLevel;
  /** "model" only when a model's reply was spoken; everything else is scripted. */
  source: "scripted" | "model";
  /** Steps passed, in order. */
  stages: PipelineStep[];
}

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
  trace: TurnTrace;
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
  private readonly observer: (s: PipelineStep) => void;
  private readonly blocked: string | null;
  private stages: PipelineStep[] = [];
  private heard = "";
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
    const wanted = deps.llm ?? null;
    if (wanted && wanted.remote && !remoteModelAllowed(deps.consent)) {
      this.blocked = `${wanted.id}: an online model needs the scope_llm_cloud consent; using the offline companion`;
      this.llm = new ScriptedProvider(this.scripted);
    } else {
      this.blocked = null;
      this.llm = wanted ?? new ScriptedProvider(this.scripted);
    }
    this.clock = deps.clock ?? (() => {
      const d = new Date();
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    });
    this.now = deps.now ?? (() => Date.now());
    this.observer = deps.trace ?? (() => {});
  }

  /** Why a configured model is not being used (missing consent), else null. */
  get modelBlocked(): string | null { return this.blocked; }

  private trace(step: PipelineStep): void {
    this.stages.push(step);
    this.observer(step);
  }

  private begin(heard: string): void {
    this.stages = [];
    this.heard = heard;
  }

  get emergencyPhase() { return this.flow.phase; }

  /** Topics touched this session (for the caregiver feedback chips). */
  sessionTopics(): TopicId[] { return [...this.topics]; }

  /** First line of a session. */
  opener(): TurnResult {
    this.begin("");
    const r = this.scripted.opener(this.clock());
    this.history.push({ role: "assistant", content: r.text });
    this.safety.prompted(this.now());
    return this.result("opener", [r.text], NONE);
  }

  /** One utterance from the person (STT text or a tapped choice). */
  async turn(text: string): Promise<TurnResult> {
    this.begin(text);
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
    const remote = this.llm.remote;
    const system = buildSystemPrompt({ profile: this.profile, clock, plan: this.plan, minimal: remote });
    const past = remote ? this.history.slice(-REMOTE_HISTORY_EXCHANGES * 2) : this.history;
    const messages: ChatMessage[] = [...past, { role: "user", content: text }];
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
    this.begin("");
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
    this.begin("");
    const now = this.now();
    const s = this.safety.tap(now);
    if (s.level === "none") return null;
    return this.fromFlow(this.flow.start(s, now), s);
  }

  /** The Help button. */
  help(): TurnResult {
    this.begin("");
    const s: SafetyResult = { level: "emergency", matched: ["help button"], trigger: "keyword", categories: ["help"] };
    this.safety.responded(this.now());
    return this.fromFlow(this.flow.start(s, this.now()), s);
  }

  callConnected(): TurnResult { this.begin(""); return this.fromFlow(this.flow.callConnected(this.now()), NONE); }
  callUnanswered(): TurnResult { this.begin(""); return this.fromFlow(this.flow.callUnanswered(this.now()), NONE); }
  resolveEmergency(by: string): TurnResult { this.begin(""); return this.fromFlow(this.flow.cancel(by, this.now()), NONE); }

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
    const trace: TurnTrace = {
      heard: this.heard,
      safetyLevel: s.level,
      source: source === "llm" ? "model" : "scripted",
      stages: [...this.stages],
    };
    return { say, lang: this.lang, rate: this.rate, source, safety: s, actions: [], trace };
  }
}
