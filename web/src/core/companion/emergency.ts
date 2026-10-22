// EmergencyFlow: a scripted state machine. No model is involved at any step.
//
//   idle ─start→ asking ─yes / 20 s silence at emergency→ calling ─connected→ done
//                  │                                        └─unanswered→ next target … → exhausted
//                  └─no→ done (caregiver still told at emergency level)
//
// It only returns actions. The UI speaks the lines, opens the tel:/wa.me URLs,
// writes the safety_event row and sends the caregiver push.

import type { ElderProfile, Lang } from "./types.ts";
import { addressName, baseLang, fill } from "./types.ts";
import { normalize, screenText, type SafetyCategory, type SafetyResult } from "./safety.ts";

export type EmergencyPhase = "idle" | "asking" | "calling" | "exhausted" | "done";

export interface CallTarget {
  kind: "family" | "helpline";
  name: string;
  phone: string;
}

/** Draft of a `safety_event` row (server/migrations); the UI adds ids, elder_id and session_id. */
export interface SafetyEventDraft {
  trigger: "keyword" | "silence" | "agitation" | "manual";
  matched: string;
  action: string;
  at: string;
  resolvedBy?: string;
}

export type EmergencyAction =
  | { type: "speak"; text: string; lang: Lang }
  | { type: "call"; url: string; target: CallTarget }
  | { type: "whatsapp"; url: string; target: CallTarget }
  | { type: "notify_caregiver"; text: string }
  | { type: "log"; event: SafetyEventDraft }
  | { type: "exhausted" };

export const NO_ANSWER_MS = 20_000;

// ---------- copy (scripted, spoken slowly; hi uses honorific plural, gender-neutral "हम" forms) ----------

type Line = "ask" | "reask" | "urgent" | "calling" | "declined" | "connected" | "exhausted" | "fall" | "notify";
const COPY: Record<"hi" | "en", Record<Line, string>> = {
  hi: {
    ask: "मैं यहीं हूँ, {name}। क्या किसी को बुलाऊँ?",
    reask: "क्या मैं किसी अपने को बुलाऊँ? बस हाँ या ना कहिए।",
    urgent: "कोई अपना मदद करेगा, {name}। अभी फ़ोन लगा रहे हैं, ठीक है?",
    calling: "ठीक है। अभी {who} को फ़ोन लगा रहे हैं।",
    declined: "ठीक है, {name}। मैं यहीं हूँ, आपके साथ।",
    connected: "आप अकेले नहीं हैं, {name}। मैं यहीं हूँ।",
    exhausted: "मैं यहीं हूँ, {name}। आप आराम से बैठिए, हम फिर कोशिश करते हैं।",
    fall: "जल्दी से उठने की कोशिश मत कीजिए।",
    notify: "{elder} को मदद की ज़रूरत हो सकती है। सहाया ऐप से संदेश। कारण: {reason}",
  },
  en: {
    ask: "I'm right here, {name}. Shall I call someone for you?",
    reask: "Shall I call someone close to you? Just say yes or no.",
    urgent: "Someone kind can help, {name}. I'm connecting you now, okay?",
    calling: "All right. I'm calling {who} now.",
    declined: "All right, {name}. I'm right here with you.",
    connected: "You're not alone, {name}. I'm right here.",
    exhausted: "I'm right here, {name}. Please sit and rest; we'll try again.",
    fall: "Please don't try to get up quickly.",
    notify: "{elder} may need help. Message from the Sahaya app. Reason: {reason}",
  },
};

const HELPLINE_NAME = { hi: "हेल्पलाइन", en: "the helpline" };

const REASON: Record<"hi" | "en", Partial<Record<SafetyCategory, string>>> = {
  hi: {
    help: "मदद माँगी", fall: "गिरने की बात", breathing: "साँस की तकलीफ़", chest: "सीने में दर्द", faint: "बेहोशी की बात",
    bleeding: "खून बहने की बात", self_harm: "खुद को नुकसान की बात", pain: "दर्द", fear: "डर", home: "घर जाना चाहते हैं",
    lost: "भ्रमित / खोए हुए", stroke: "सुन्नपन / चेहरा टेढ़ा", injury: "चोट", dizzy: "चक्कर",
    unwell: "तबीयत ख़राब", sick: "उल्टी / बुखार", custom: "आपका चुना शब्द", silence: "लंबी चुप्पी", agitation: "बेचैनी (बार-बार टैप)",
  },
  en: {
    help: "asked for help", fall: "mentioned a fall", breathing: "breathing trouble", chest: "chest pain", faint: "fainting",
    bleeding: "bleeding", self_harm: "talk of self-harm", pain: "pain", fear: "fear", home: "wants to go home",
    lost: "confused / lost", stroke: "numbness / drooping face", injury: "an injury", dizzy: "dizziness",
    unwell: "feeling unwell", sick: "vomiting / fever", custom: "a word you added", silence: "long silence", agitation: "agitation (rapid taps)",
  },
};

// ---------- phone URLs ----------

/** tel: URL, keeping a leading +. null when there are too few digits to be a number. */
export function telUrl(raw: string): string | null {
  const s = String(raw ?? "").trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return `tel:${s.startsWith("+") ? "+" : ""}${digits}`;
}

/**
 * wa.me needs the full international number as digits. A bare 10-digit number
 * starting 6-9 (or 0 + 10 digits) is an Indian mobile, so 91 is added.
 */
export function whatsappUrl(raw: string, text: string): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (/^0[6-9]\d{9}$/.test(d)) d = d.slice(1);
  if (/^[6-9]\d{9}$/.test(d)) d = `91${d}`;
  if (d.length < 8) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

// ---------- yes / no ----------

const YES = new Set(["haan", "han", "ha", "haa", "haanji", "ji", "yes", "yeah", "yep", "ok", "okay", "sure", "please",
  "theek", "thik", "bulao", "bula", "bulaiye", "bulaao", "call", "हाँ", "हां", "जी", "ठीक", "बुलाओ", "बुलाइए", "बुला"]);
const NO = new Set(["nahi", "nahin", "nhi", "na", "mat", "no", "nope", "dont", "नहीं", "नही", "ना", "मत"]);
const NO_CALL = /(?:^| )(?:mat|na|nahi|nahin|dont|do not|मत|ना|नहीं) (?:bula\S*|call|बुला\S*)/u;

export function parseYesNo(text: string): "yes" | "no" | "unclear" {
  const t = normalize(text);
  if (!t) return "unclear";
  if (NO_CALL.test(t)) return "no";
  const words = t.split(" ");
  const y = words.some(w => YES.has(w));
  const n = words.some(w => NO.has(w));
  if (y && !n) return "yes";
  if (n && !y) return "no";
  return "unclear";
}

// ---------- flow ----------

export class EmergencyFlow {
  private readonly profile: ElderProfile;
  private readonly lang: Lang;
  private readonly copy: Record<Line, string>;
  private readonly noAnswerMs: number;
  private state: EmergencyPhase = "idle";
  private level: "check" | "emergency" = "check";
  private event: SafetyResult | null = null;
  private askedAt = 0;
  private targets: CallTarget[] = [];
  private idx = 0;

  constructor(profile: ElderProfile, opts: { noAnswerMs?: number } = {}) {
    this.profile = profile;
    this.lang = baseLang(profile.language);
    this.copy = COPY[this.lang === "en" ? "en" : "hi"];
    this.noAnswerMs = opts.noAnswerMs ?? NO_ANSWER_MS;
  }

  get phase(): EmergencyPhase { return this.state; }

  /** Begin (or upgrade) the flow for a safety result. */
  start(result: SafetyResult, now: number): EmergencyAction[] {
    if (result.level === "none") return [];
    if (this.state === "calling" || this.state === "exhausted") return [];
    if (this.state === "asking") {
      if (this.level === "emergency" || result.level !== "emergency") return [];
      this.level = "emergency";
      this.event = result;
      this.askedAt = now;
      return [this.log("escalated", now), this.say("urgent")];
    }
    this.state = "asking";
    this.level = result.level;
    this.event = result;
    this.askedAt = now;
    const out: EmergencyAction[] = [this.log("reassure_ask", now)];
    if (result.categories?.includes("fall")) out.push(this.say("fall"));
    out.push(this.say("ask"));
    return out;
  }

  /** The person's reply while the flow is asking. */
  answer(text: string, now: number): EmergencyAction[] {
    if (this.state !== "asking") return [];
    const fresh = screenText(text, this.profile.customDistressWords);
    const yn = fresh.level === "emergency" ? "yes" : parseYesNo(text);
    if (yn === "yes") return this.beginCalling(now, false);
    if (yn === "no") {
      this.state = "done";
      const out: EmergencyAction[] = [this.say("declined"), this.log("declined", now)];
      if (this.level === "emergency") out.push(this.notify());
      return out;
    }
    return [this.say("reask")];
  }

  /** Call periodically. Applies the 20 s no-answer rule at emergency level. */
  tick(now: number): EmergencyAction[] {
    if (this.state !== "asking" || this.level !== "emergency") return [];
    if (now - this.askedAt < this.noAnswerMs) return [];
    return this.beginCalling(now, true);
  }

  callConnected(now: number): EmergencyAction[] {
    if (this.state !== "calling") return [];
    this.state = "done";
    return [this.say("connected"), this.log("connected", now)];
  }

  callUnanswered(now: number): EmergencyAction[] {
    if (this.state !== "calling") return [];
    this.idx += 1;
    return this.dialCurrent(now);
  }

  /** Caregiver (or the UI) closes the event. */
  cancel(by: string, now: number): EmergencyAction[] {
    if (this.state === "idle" || this.state === "done") return [];
    this.state = "done";
    return [{ type: "log", event: { ...this.draft("resolved", now), resolvedBy: by } }];
  }

  // ---- internals ----

  private beginCalling(now: number, urgent: boolean): EmergencyAction[] {
    this.state = "calling";
    this.targets = this.callTargets();
    this.idx = 0;
    const out: EmergencyAction[] = [];
    if (urgent) out.push(this.say("urgent"));
    out.push(this.notify());
    return [...out, ...this.dialCurrent(now, !urgent)];
  }

  private dialCurrent(now: number, announce = true): EmergencyAction[] {
    const target = this.targets[this.idx];
    if (!target) {
      this.state = "exhausted";
      return [this.say("exhausted"), this.log("exhausted", now), { type: "exhausted" }];
    }
    const out: EmergencyAction[] = [];
    const who = target.kind === "helpline" ? HELPLINE_NAME[this.lang === "en" ? "en" : "hi"] : target.name;
    if (announce) out.push(this.say("calling", { who }));
    const tel = telUrl(target.phone);
    if (tel) out.push({ type: "call", url: tel, target });
    const contact = this.profile.familyContacts?.find(c => c.phone === target.phone);
    if (target.kind === "family" && contact?.whatsapp) {
      const wa = whatsappUrl(target.phone, this.notifyText());
      if (wa) out.push({ type: "whatsapp", url: wa, target });
    }
    out.push(this.log(`call_${target.kind}_${this.idx + 1}`, now));
    return out;
  }

  private callTargets(): CallTarget[] {
    const family = [...(this.profile.familyContacts ?? [])]
      .filter(c => telUrl(c.phone))
      .sort((a, b) => a.order - b.order)
      .map(c => ({ kind: "family" as const, name: c.name, phone: c.phone }));
    const help = (this.profile.ngoHelpline ?? "").trim();
    return help && telUrl(help) ? [...family, { kind: "helpline", name: "helpline", phone: help }] : family;
  }

  private say(line: Line, vars: Record<string, string> = {}): EmergencyAction {
    return { type: "speak", lang: this.lang, text: fill(this.copy[line], { name: addressName(this.profile, this.lang), ...vars }) };
  }

  private notifyText(): string {
    const l = this.lang === "en" ? "en" : "hi";
    const reasons = (this.event?.categories ?? []).map(c => REASON[l][c]).filter(Boolean);
    return fill(this.copy.notify, { elder: this.profile.displayName, reason: reasons.join(", ") || "—" });
  }

  private notify(): EmergencyAction {
    return { type: "notify_caregiver", text: this.notifyText() };
  }

  private draft(action: string, now: number): SafetyEventDraft {
    return {
      trigger: this.event?.trigger ?? "manual",
      matched: (this.event?.matched ?? []).join(", "),
      action,
      at: new Date(now).toISOString(),
    };
  }

  private log(action: string, now: number): EmergencyAction {
    return { type: "log", event: this.draft(action, now) };
  }
}
