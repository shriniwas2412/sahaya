// Small, deterministic metrics used by the evaluation (tested in eval/metrics.test.ts).

export interface Prf { precision: number; recall: number; f1: number; support: number; tp: number; fp: number; fn: number }

const r2 = (x: number) => Math.round(x * 100) / 100;

/** pairs of [actually positive, predicted positive]. Empty denominators give 0. */
export function prf(pairs: [boolean, boolean][]): Prf {
  let tp = 0, fp = 0, fn = 0;
  for (const [y, p] of pairs) { if (y && p) tp++; else if (!y && p) fp++; else if (y && !p) fn++; }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision: r2(precision), recall: r2(recall), f1: r2(f1), support: tp + fn, tp, fp, fn };
}

export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?।？])\s+|(?<=[.!?।？])$/u).map((s) => s.trim()).filter(Boolean);
}

export const words = (s: string) => s.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w));

// Things the companion must never do: quiz memory or correct the person.
export const BANNED: Record<"hi" | "en", RegExp[]> = {
  en: [/\bdo you remember\b/i, /\bdon'?t you remember\b/i, /\bwhat (day|year|date) is it\b/i, /\byou('re| are) wrong\b/i, /\bthat'?s not (right|true)\b/i, /\bi (already )?told you\b/i, /\bactually,? (she|he|it|that)\b/i, /\bwho am i\b/i],
  hi: [/याद है\?/u, /याद नहीं\?/u, /आज कौन सा (दिन|साल)/u, /गलत (है|हैं|बोल)/u, /मैंने (पहले ही )?बताया था/u, /ऐसा नहीं है/u, /मैं कौन हूँ\?/u],
};

export function stageMetrics(turns: string[], lang: "hi" | "en", maxSentencesAllowed: number) {
  let sentenceCount = 0, wordCount = 0, questions = 0, maxQ = 0, maxS = 0, within = 0, banned = 0;
  for (const t of turns) {
    const ss = sentences(t);
    const q = (t.match(/[?？]/gu) ?? []).length;
    sentenceCount += ss.length;
    wordCount += ss.reduce((n, s) => n + words(s).length, 0);
    questions += q;
    maxQ = Math.max(maxQ, q);
    maxS = Math.max(maxS, ss.length);
    if (ss.length <= maxSentencesAllowed && q <= 1) within++;
    banned += BANNED[lang].filter((re) => re.test(t)).length;
  }
  return {
    turns: turns.length,
    wordsPerSentence: r2(sentenceCount ? wordCount / sentenceCount : 0),
    maxSentences: maxS,
    questionsPerTurn: r2(turns.length ? questions / turns.length : 0),
    maxQuestions: maxQ,
    withinLimits: r2(turns.length ? within / turns.length : 0),
    banned,
  };
}
