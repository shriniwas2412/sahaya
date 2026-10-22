// SafetyScreen: deterministic distress detection. Runs before any model call
// and never touches the network, so it also works offline.
//
// Three inputs feed it:
//  - text: keyword and phrase rules in English and Hindi (Devanagari and
//    romanised), a basic Marathi and Gujarati list, and the caregiver's own words;
//  - silence: a stage-dependent timer driven by timestamps the caller passes in;
//  - agitation: bursts of fast repeated taps.
//
// This is a hand-written list and will miss phrasings it has not seen; the Help
// button and the silence checks are the backstop. Known phrasings are pinned
// as fixtures in safety.test.ts.
//
// Bias: a missed emergency is worse than an extra "shall I call someone?",
// so emergency phrases are never cancelled by a nearby "nahi"/"not". Only the
// softer "check" phrases honour negation, and only a negation that belongs to
// them: same clause, right next to the phrase, not "pata nahi" (don't know),
// not a repeated "nahi nahi", and not one that negates a following verb
// ("dard nahi ruk raha" = the pain is not stopping).

import type { CustomDistressWord, Stage } from "./types.ts";
import { styleStage } from "./types.ts";

export type SafetyLevel = "none" | "check" | "emergency";
export type SafetyTrigger = "keyword" | "silence" | "agitation";
export type SafetyCategory =
  | "help" | "fall" | "breathing" | "chest" | "faint" | "bleeding" | "self_harm" | "stroke"
  | "pain" | "injury" | "dizzy" | "unwell" | "sick" | "fear" | "home" | "lost"
  | "custom" | "silence" | "agitation";

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

// Normalised text: NFC, lower case, apostrophes removed ("can't" → "cant"),
// clause punctuation kept as "|", every other non-letter replaced by one space.
const RULES: Rule[] = [
  // ---- emergency ----
  { category: "help", level: "emergency", patterns: [
    "help", "bacha+o+n?", "bacha+iy?e", "bacha lo", "madad", "madat",
    "मदद", "बचाओ", "बचाइए", "बचाइये", "बचा लो",
    // someone, a doctor or an ambulance to be called
    "(doctor|docter|daktar|dactor|ambulance|kisi|koi) (ko )?bula\\w*",
    "(डॉक्टर|डाक्टर|एम्बुलेंस|एंबुलेंस|किसी|कोई) (को )?बुला\\S*",
    "(call|get) (?:(?:a|an|the|my) )?(doctor|ambulance)",
    "(112|108) (?:(?:ko|pe|par|को|पर) )?(call|phone|फ़ोन|फोन|bula\\w*|बुला\\S*|lagao|लगाओ|milao|मिलाओ|karo|करो)",
  ] },
  { category: "fall", level: "emergency", patterns: [
    "gir+ (gaya|gayi|gai|gya|gyi|gaye|gayee|pada|padi|padaa|padee)",
    "गिर (गया|गई|गयी|गए|गये|पड़ा|पड़ी|पडा|पडी)",
    "fisa?l (gaya|gayi|gai|gya|gyi|gaye|gayee)", "फिसल (गया|गई|गयी|गए|गये)",
    "uth nahi?n? pa\\w*", "उठ (नहीं|नही) पा\\S*",
    "i fell", "i (have|ve) fallen", "ive fallen", "fell down", "i slipped", "slipped and fell",
    "cant get up", "cannot get up", "can not get up",
  ] },
  { category: "breathing", level: "emergency", patterns: [
    "saa?ns (nahi|nahin|nhi|na)", "saa?s (nahi|nahin|nhi) (aa (rahi|raha|rhi|rha)|le pa\\w*)",
    "saa?ns (lene|lena) (me|mein|main|mai) (taklif|takleef|dikkat|pareshani)", "saa?ns phool",
    "सा[ँं]स (नहीं|नही|ना)", "सास (नहीं|नही) (आ (रही|रहा)|ले पा\\S*)",
    "सा[ँं]स (लेने|लेना) में (तकलीफ|तकलीफ़|दिक्कत|परेशानी)", "सा[ँं]स फूल",
    "dam ghut\\w*", "दम घुट\\S*",
    "cant breathe", "cannot breathe", "can not breathe", "not breathing", "short of breath", "breathless", "choking", "suffocat\\w*",
  ] },
  { category: "chest", level: "emergency", patterns: [
    "(seen[ae]|sine|chh?aa?ti|chest|dil) (me|mein|main|mai|mei) dard", "(सीने|छाती|दिल) में दर्द", "chest pain", "heart attack",
  ] },
  { category: "stroke", level: "emergency", patterns: [
    "sunn", "सुन्न", "(munh|muh|mooh|मुंह|मुँह) (tedha|tedhaa|टेढ़ा|टेढा)", "numb", "face (is )?drooping", "slurred",
  ] },
  { category: "faint", level: "emergency", patterns: ["behosh", "बेहोश", "unconscious", "fainted", "passed out"] },
  { category: "bleeding", level: "emergency", patterns: ["kh?oon (beh|bah|nikal)", "खून (बह|निकल)", "bleeding"] },
  { category: "self_harm", level: "emergency", patterns: [
    "want to die", "kill myself", "end my life", "suicide", "dont want to live",
    "mar(na|ne|jana) chaht[aie]", "मर(ना|ने) चाहत\\S*", "मर जाना चाहत\\S*", "jaan de (dun|doon|du)", "आत्महत्या",
    "jee?na nahi?n? chaht\\w*", "जीना (नहीं|नही) चाहत\\S*", "(zinda|jinda) nahi?n? rehna", "(ज़िंदा|जिंदा|ज़िन्दा|जिन्दा) (नहीं|नही) रहना",
    "(ze|za|ja)h[ae]r", "(ज़|ज)हर", "khudkushi", "(ख़|ख)ुदकुशी",
    "mar (jaunga|jaungi|jaun|jaoonga|jaoongi)", "मर (जाऊ|जाउ)\\S*",
  ] },
  // Basic Marathi and Gujarati: common, certain words only. Needs native review.
  { category: "fall", level: "emergency", patterns: ["पडलो", "पडले", "પડી (ગયો|ગઈ|ગયા)"] },
  { category: "chest", level: "emergency", patterns: ["छातीत दुख\\S*", "છાતીમાં (દુખાવો|દુખે\\S*)"] },
  { category: "help", level: "emergency", patterns: ["मदत", "वाचवा", "મદદ", "બચાવો"] },

  // ---- check ----
  { category: "pain", level: "check", negatable: true, patterns: ["dard", "दर्द", "pain", "hurts", "hurting", "hurt"] },
  // Marathi दुखतंय/दुखतोय, Hindi दुखता; Gujarati દુખાવો/દુખે. Basic, needs native review.
  { category: "pain", level: "check", negatable: true, patterns: ["दुखत\\S*", "દુખાવો", "દુખે\\S*"] },
  { category: "injury", level: "check", negatable: true, patterns: ["chot", "चोट", "injured"] },
  { category: "dizzy", level: "check", negatable: true, patterns: ["chakk?ar", "चक्कर", "dizzy", "giddy"] },
  { category: "sick", level: "check", negatable: true, patterns: ["ulti", "उल्टी", "vomit\\w*", "bukhar", "बुखार", "fever"] },
  { category: "unwell", level: "check", patterns: [
    "tabiy?at (kharab|theek nahi?n?|thik nahi?n?|theek nhi|thik nhi)", "(तबीयत|तबियत) (ख़राब|खराब|ठीक नहीं|ठीक नही)",
    "dont feel well", "not feeling well", "feel (sick|unwell|ill)", "im sick", "i am sick", "unwell",
  ] },
  { category: "fear", level: "check", negatable: true, patterns: [
    "da+r+ (lag\\w*|lg\\w*)", "डर (लग\\S*)", "ghabra\\w*", "घबरा\\S*", "scared", "afraid", "frightened", "terrified",
  ] },
  { category: "home", level: "check", negatable: true, patterns: [
    "ghar ja+na", "घर जाना", "ghar le cha?lo", "घर ले चलो", "want to go home", "take me home",
  ] },
  { category: "lost", level: "check", negatable: true, patterns: [
    "(main|mai|me|mein) (kahan|kahaan|kaha) (hoon|hu|hun|hoo)", "मैं कहा[ँं] हू[ँं]",
    "where am i", "dont know where i am", "do not know where i am", "im lost", "i am lost", "lost my way", "rasta bhool", "रास्ता भूल",
  ] },
  { category: "breathing", level: "check", patterns: ["saa?ns", "सा[ँं]स"] },
];

const L = "\\p{L}\\p{M}\\p{N}";
const wrap = (src: string) => `(?<![${L}])(?:${src})(?![${L}])`;

// Patterns are NFC-normalised like the input, so nukta letters (ज़, ड़) match either way they are typed.
const COMPILED = RULES.map(r => ({ ...r, res: r.patterns.map(p => new RegExp(wrap(p.normalize("NFC")), "gu")) }));

const NEGATIONS = new Set(["nahi", "nahin", "nhi", "na", "mat", "no", "not", "never", "नहीं", "ना", "मत", "नही"]);
/** Words that may sit between a negation and the phrase it negates ("not in pain", "koi dard nahi"). */
const FILLERS = new Set(["in", "really", "very", "at", "all", "koi", "bilkul", "ab", "to", "toh", "bhi", "तो", "अब", "भी", "कोई", "बिलकुल", "बिल्कुल"]);
/** Words that may sit between the phrase and a following negation ("dard to nahi", "pain is not"). */
const AFTER_SKIP = new Set(["to", "toh", "bilkul", "koi", "ab", "is", "hai", "bhi", "तो", "अब", "है", "बिलकुल", "बिल्कुल", "भी"]);
/** "pata nahi" / "nahi pata" / "don't know" is not a negation of the phrase. */
const KNOW = new Set(["pata", "पता", "know", "maloom", "malum", "मालूम"]);
/** A negation followed by one of these negates that verb: "dard nahi ruk raha", "pain is not going away". */
const CONTINUING = /^(ruk|ja|jaa|jat|gay|kam|band|ghat|going|stop|better|getting|रुक|जा|गय|गई|कम|बंद|घट)/u;

export function normalize(text: string): string {
  return String(text ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

/** Like normalize(), but clause punctuation becomes a "|" token so negation stays inside its clause. */
function normalizeClauses(text: string): string {
  return String(text ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[,;:.!?।॥\n]+/gu, " | ")
    .replace(/[^\p{L}\p{M}\p{N}|]+/gu, " ")
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const isNeg = (w: string | undefined) => w !== undefined && NEGATIONS.has(w);

/** Does a negation in the same clause belong to the phrase at [start, end)? */
function negated(text: string, start: number, end: number): boolean {
  const before = text.slice(0, start).split("|").pop()!.trim().split(" ").filter(Boolean);
  const after = text.slice(end).split("|")[0]!.trim().split(" ").filter(Boolean);

  // before: "no pain", "not in pain"; but not "no no it hurts" or "pata nahi main kahan hoon"
  let i = before.length - 1;
  if (i >= 0 && FILLERS.has(before[i]!) && isNeg(before[i - 1])) i -= 1;
  if (isNeg(before[i])) {
    const prev = before[i - 1];
    if (!isNeg(prev) && !(prev && KNOW.has(prev))) return true;
  }

  // after: "dard nahi hai", "dard to nahi"; but not "dard nahi ruk raha" or a closing tag "hai na"
  let j = 0;
  if (after[j] && AFTER_SKIP.has(after[j]!)) j += 1;
  if (isNeg(after[j])) {
    const next = after[j + 1];
    if (after[j] === "na" && next === undefined) return false;
    if (next && (KNOW.has(next) || CONTINUING.test(next))) return false;
    return true;
  }
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
  const tc = normalizeClauses(text);
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
      for (const m of tc.matchAll(re)) {
        const start = m.index ?? 0;
        if (rule.negatable && negated(tc, start, start + m[0].length)) continue;
        // a bare "saans" only counts if no stronger breathing rule already matched it
        if (rule.category === "breathing" && rule.level === "check" && categories.includes("breathing")) continue;
        hit(rule.level, m[0], rule.category);
      }
    }
  }
  // caregiver words match across punctuation, exactly as typed
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
