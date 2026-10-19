// SafetyScreen: deterministic distress detection. Runs before any model call
// and never touches the network, so it also works offline.
//
// Three inputs feed it:
//  - text: keyword and phrase rules in English, Hindi (Devanagari and
//    romanised), plus a few Marathi and Gujarati calls for help, and the
//    caregiver's own words;
//  - silence: a stage-dependent timer driven by timestamps the caller passes in;
//  - agitation: bursts of fast repeated taps.
//
// Bias: a missed emergency is worse than an extra "shall I call someone?",
// so explicit emergency phrases are never cancelled by a nearby "nahi"/"not".
// Only the softer "check" phrases (pain, fear, going home, feeling lost) honour
// negation, so "dard nahi hai" does not start the flow.

import type { CustomDistressWord, Stage } from "./types.ts";
import { styleStage } from "./types.ts";

export type SafetyLevel = "none" | "check" | "emergency";
export type SafetyTrigger = "keyword" | "silence" | "agitation";
export type SafetyCategory =
  | "help" | "fall" | "breathing" | "chest" | "faint" | "bleeding" | "self_harm"
  | "pain" | "fear" | "home" | "lost" | "custom" | "silence" | "agitation";

export interface SafetyResult {
  level: SafetyLevel;
  /** The phrases (normalised) or signals that matched. Empty when level is "none". */
  matched: string[];
  trigger?: SafetyTrigger;
  categories?: SafetyCategory[];
}

export const NONE: SafetyResult = Object.freeze({ level: "none", matched: [] }) as SafetyResult;

interface Rule {
  category: SafetyCategory;
  level: Exclude<SafetyLevel, "none">;
  /** Regex sources over normalised text. Word boundaries are added around each. */
  patterns: string[];
  negatable?: boolean;
}

// Normalised text: lower case, apostrophes removed ("can't" → "cant"),
// every other non-letter replaced by one space.
const RULES: Rule[] = [
  // ---- emergency ----
  { category: "help", level: "emergency", patterns: [
    "help", "bacha+o+n?", "bacha+iy?e", "bacha lo", "madad", "madat",
    "मदद", "बचाओ", "बचाइए", "बचाइये", "बचा लो",
    "मदत", "वाचवा", // Marathi
    "મદદ", "બચાવો", // Gujarati
  ] },
  { category: "fall", level: "emergency", patterns: [
    "gir (gaya|gayi|gai|gya|gyi|gaye|gayee|pada|padi|padaa|padee)",
    "गिर (गया|गई|गयी|गए|गये|पड़ा|पड़ी|पडा|पडी)",
    "i fell", "i (have|ve) fallen", "ive fallen", "fell down",
  ] },
  { category: "breathing", level: "emergency", patterns: [
    "saa?ns (nahi|nahin|nhi|na)", "saa?ns (lene|lena) (me|mein|main|mai) (taklif|takleef|dikkat|pareshani)", "saa?ns phool",
    "सा[ँं]स (नहीं|ना)", "सा[ँं]स (लेने|लेना) में (तकलीफ|तकलीफ़|दिक्कत|परेशानी)", "सा[ँं]स फूल",
    "cant breathe", "cannot breathe", "can not breathe", "not breathing", "short of breath", "breathless",
  ] },
  { category: "chest", level: "emergency", patterns: [
    "(seen[ae]|chh?aa?ti) (me|mein|main|mai) dard", "(सीने|छाती) में दर्द", "chest pain", "heart attack",
  ] },
  { category: "faint", level: "emergency", patterns: ["behosh", "बेहोश", "unconscious", "fainted", "passed out"] },
  { category: "bleeding", level: "emergency", patterns: ["kh?oon (beh|bah|nikal)", "खून (बह|निकल)", "bleeding"] },
  { category: "self_harm", level: "emergency", patterns: [
    "want to die", "kill myself", "end my life", "suicide", "dont want to live",
    "mar(na|ne|jana) chaht[aie]", "मर(ना|ने) चाहत\\S*", "मर जाना चाहत\\S*", "jaan de (dun|doon|du)", "आत्महत्या",
  ] },
  // ---- check ----
  { category: "pain", level: "check", negatable: true, patterns: ["dard", "दर्द", "pain", "hurts", "hurting"] },
  { category: "fear", level: "check", negatable: true, patterns: [
    "da+r+ (lag|lg)", "डर (लग|लगता)", "ghabra\\w*", "घबरा\\S*", "scared", "afraid", "frightened", "terrified",
  ] },
  { category: "home", level: "check", negatable: true, patterns: [
    "ghar ja+na", "घर जाना", "want to go home", "take me home",
  ] },
  { category: "lost", level: "check", negatable: true, patterns: [
    "(main|mai|me|mein) (kahan|kahaan|kaha) (hoon|hu|hun|hoo)", "मैं कहा[ँं] हू[ँं]",
    "where am i", "im lost", "i am lost", "lost my way", "rasta bhool", "रास्ता भूल",
  ] },
  { category: "breathing", level: "check", patterns: ["saa?ns", "सा[ँं]स"] },
];

const L = "\\p{L}\\p{M}\\p{N}";
const wrap = (src: string) => `(?<![${L}])(?:${src})(?![${L}])`;

const COMPILED = RULES.map(r => ({ ...r, res: r.patterns.map(p => new RegExp(wrap(p), "gu")) }));

const NEGATIONS = new Set(["nahi", "nahin", "nhi", "na", "mat", "no", "not", "never", "नहीं", "ना", "मत", "नही"]);
const PARTICLES = new Set(["to", "toh", "bilkul", "koi", "ab", "तो", "बिलकुल", "बिल्कुल", "अब"]);

export function normalize(text: string): string {
  return String(text ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when a negation word sits just before (≤2 words) or just after the match. */
function negated(text: string, start: number, end: number): boolean {
  const before = text.slice(0, start).trim().split(" ").filter(Boolean).slice(-2);
  if (before.some(w => NEGATIONS.has(w))) return true;
  const after = text.slice(end).trim().split(" ").filter(Boolean);
  if (after[0] && NEGATIONS.has(after[0])) return true;
  if (after[0] && PARTICLES.has(after[0]) && after[1] && NEGATIONS.has(after[1])) return true;
  return false;
}

function customRules(words: CustomDistressWord[] | undefined) {
  return (words ?? []).flatMap(w => {
    const phrase = normalize(typeof w === "string" ? w : w.phrase);
    if (!phrase) return [];
    const level = typeof w === "string" ? "check" : w.level;
    return [{ level, re: new RegExp(wrap(escapeRegex(phrase)), "gu") }];
  });
}

/** Screen one utterance. Pure: same input, same output. */
export function screenText(text: string, customWords?: CustomDistressWord[]): SafetyResult {
  const t = normalize(text);
  if (!t) return NONE;
  let level: SafetyLevel = "none";
  const matched: string[] = [];
  const categories: SafetyCategory[] = [];
  const hit = (lvl: Exclude<SafetyLevel, "none">, phrase: string, cat: SafetyCategory) => {
    if (lvl === "emergency" || level === "none") level = lvl;
    if (!matched.includes(phrase)) matched.push(phrase);
    if (!categories.includes(cat)) categories.push(cat);
  };

  for (const rule of COMPILED) {
    for (const re of rule.res) {
      for (const m of t.matchAll(re)) {
        const start = m.index ?? 0;
        if (rule.negatable && negated(t, start, start + m[0].length)) continue;
        // a bare "saans" only counts if no stronger breathing rule already matched it
        if (rule.category === "breathing" && rule.level === "check" && categories.includes("breathing")) continue;
        hit(rule.level, m[0], rule.category);
      }
    }
  }
  for (const c of customRules(customWords)) {
    for (const m of t.matchAll(c.re)) hit(c.level, m[0], "custom");
  }
  if (level === "none") return NONE;
  return { level, matched, trigger: "keyword", categories };
}

// ---------- silence ----------

/** How long to wait for any response after the companion speaks. */
export function silenceThresholdMs(stage: Stage | null | undefined): number {
  const s = styleStage(stage);
  if (s <= 3) return 90_000;
  if (s <= 5) return 120_000;
  return 180_000;
}

/**
 * Pure timer. The caller says when the companion prompted and when the person
 * responded, and calls tick(now) periodically. After the threshold it returns
 * a "check"; two unanswered checks return "emergency" once.
 */
export class SilenceTimer {
  private readonly thresholdMs: number;
  private waitingSince: number | null = null;
  private checks = 0;

  constructor(opts: { stage?: Stage | null; thresholdMs?: number } = {}) {
    this.thresholdMs = opts.thresholdMs ?? silenceThresholdMs(opts.stage ?? null);
  }

  prompted(now: number): void {
    this.waitingSince = now;
  }

  responded(_now: number): void {
    this.waitingSince = null;
    this.checks = 0;
  }

  tick(now: number): SafetyResult {
    if (this.waitingSince === null || now - this.waitingSince < this.thresholdMs) return NONE;
    if (this.checks >= 2) {
      this.waitingSince = null;
      this.checks = 0;
      return { level: "emergency", matched: ["silence after 2 checks"], trigger: "silence", categories: ["silence"] };
    }
    this.checks += 1;
    this.waitingSince = now; // the check itself is a new prompt
    return { level: "check", matched: [`silence check ${this.checks}`], trigger: "silence", categories: ["silence"] };
  }
}

// ---------- agitation ----------

export class AgitationDetector {
  private readonly taps: number;
  private readonly windowMs: number;
  private readonly escalateWithinMs: number;
  private recent: number[] = [];
  private lastBurstAt: number | null = null;

  constructor(opts: { taps?: number; windowMs?: number; escalateWithinMs?: number } = {}) {
    this.taps = opts.taps ?? 6;
    this.windowMs = opts.windowMs ?? 3000;
    this.escalateWithinMs = opts.escalateWithinMs ?? 60_000;
  }

  tap(now: number): SafetyResult {
    this.recent = this.recent.filter(t => now - t < this.windowMs);
    this.recent.push(now);
    if (this.recent.length < this.taps) return NONE;
    this.recent = [];
    const escalate = this.lastBurstAt !== null && now - this.lastBurstAt <= this.escalateWithinMs;
    this.lastBurstAt = now;
    return {
      level: escalate ? "emergency" : "check",
      matched: [escalate ? "repeated tap bursts" : "rapid taps"],
      trigger: "agitation",
      categories: ["agitation"],
    };
  }
}

// ---------- combined ----------

export interface SafetyScreenOptions {
  stage?: Stage | null;
  customWords?: CustomDistressWord[];
  silenceMs?: number;
}

/** One object per session: text, silence and taps. */
export class SafetyScreen {
  private readonly customWords: CustomDistressWord[];
  private readonly silence: SilenceTimer;
  private readonly agitation = new AgitationDetector();

  constructor(opts: SafetyScreenOptions = {}) {
    this.customWords = opts.customWords ?? [];
    this.silence = new SilenceTimer({ stage: opts.stage ?? null, thresholdMs: opts.silenceMs });
  }

  /** Screen an utterance. Passing `now` also counts it as a response for the silence timer. */
  screen(text: string, now?: number): SafetyResult {
    if (now !== undefined && normalize(text)) this.silence.responded(now);
    return screenText(text, this.customWords);
  }

  prompted(now: number): void { this.silence.prompted(now); }
  responded(now: number): void { this.silence.responded(now); }
  tick(now: number): SafetyResult { return this.silence.tick(now); }
  tap(now: number): SafetyResult { return this.agitation.tap(now); }
}
