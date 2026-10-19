// TriggerFilter and topic weights.
//
// - Caregiver triggers ("no mention of illness") and topics marked "avoid" in
//   feedback are matched as whole phrases. A hit means the companion does not
//   engage with it; it gently redirects to a liked topic, and the model never sees that turn.
// - Topic weights start equal, go up for preferences and "keep" feedback, and
//   drop to zero for "avoid" feedback. The scripted companion and the prompt
//   generator both read them.

import type { ElderProfile, FeedbackEntry, TopicId } from "./types.ts";
import { TOPICS } from "./types.ts";
import { normalize } from "./safety.ts";

/** Words a caregiver might type for each topic chip (en + hi, romanised and Devanagari). */
const SYNONYMS: Record<TopicId, string[]> = {
  reminiscence: ["reminiscence", "memories", "childhood", "old days", "purani baatein", "bachpan", "बचपन", "पुरानी बातें", "यादें"],
  music: ["music", "songs", "song", "singing", "bhajan", "bhajans", "gaana", "gaane", "geet", "संगीत", "गाना", "गाने", "भजन", "गीत"],
  festivals: ["festival", "festivals", "tyohar", "tyohaar", "त्योहार", "त्यौहार"],
  food: ["food", "cooking", "recipes", "khana", "khaana", "खाना", "पकवान"],
  weather: ["weather", "seasons", "rain", "mausam", "मौसम", "बारिश"],
  life_story: ["life story", "family", "family stories", "parivar", "परिवार", "जीवन"],
};

const L = "\\p{L}\\p{M}\\p{N}";

/** Whole-phrase matches of `phrases` in `text`, after normalising both. */
export function matchPhrases(text: string, phrases: readonly string[]): string[] {
  const t = normalize(text);
  if (!t) return [];
  const out: string[] = [];
  for (const raw of phrases) {
    const p = normalize(raw);
    if (!p) continue;
    const re = new RegExp(`(?<![${L}])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![${L}])`, "u");
    if (re.test(t) && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Which topic a caregiver's word refers to, if any. */
export function topicOf(word: string): TopicId | null {
  const w = normalize(word);
  for (const id of TOPICS) if (id === w.replace(/ /g, "_") || SYNONYMS[id].some(s => normalize(s) === w)) return id;
  return null;
}

export interface TopicPlan {
  /** Weight per topic; 0 means never offer it. */
  weights: Record<TopicId, number>;
  /** Free-text phrases to avoid: profile triggers + feedback "avoid" not later kept. */
  avoid: string[];
  /** Free-text "keep" phrases from feedback, most mentioned first. */
  keep: string[];
  /** Average of the last three mood ratings, or null. */
  recentMood: number | null;
}

/** Fold the profile and caregiver feedback (oldest first) into a topic plan. */
export function topicPlan(profile: ElderProfile, feedback: readonly FeedbackEntry[] = []): TopicPlan {
  const weights = Object.fromEntries(TOPICS.map(t => [t, 1])) as Record<TopicId, number>;
  if (!(profile.lifeStory ?? "").trim()) weights.life_story = 0;

  for (const p of profile.preferences ?? []) {
    const id = topicOf(p);
    if (id && weights[id] > 0) weights[id] += 1;
  }

  const fbAvoid = new Set<string>();
  const keepCount = new Map<string, number>();
  for (const f of feedback) {
    for (const k of f.keep ?? []) {
      const n = normalize(k);
      if (!n) continue;
      fbAvoid.delete(n);
      keepCount.set(n, (keepCount.get(n) ?? 0) + 1);
    }
    for (const a of f.avoid ?? []) {
      const n = normalize(a);
      if (!n) continue;
      fbAvoid.add(n);
      keepCount.delete(n);
    }
  }
  for (const [k, c] of keepCount) {
    const id = topicOf(k);
    if (id && weights[id] > 0) weights[id] += c;
  }
  for (const a of fbAvoid) {
    const id = topicOf(a);
    if (id) weights[id] = 0;
  }

  const profileTriggers = (profile.triggers ?? []).map(normalize).filter(Boolean);
  for (const t of profileTriggers) {
    const id = topicOf(t);
    if (id) weights[id] = 0;
  }
  const avoid = [...new Set([...profileTriggers, ...fbAvoid])];
  const keep = [...keepCount.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

  const moods = feedback.map(f => f.mood).filter((m): m is 1 | 2 | 3 | 4 | 5 => typeof m === "number").slice(-3);
  const recentMood = moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null;
  return { weights, avoid, keep, recentMood };
}

/**
 * Deterministic weighted rotation: topic for a given turn. Higher weight topics
 * appear proportionally more often. `allowed` narrows the choice (e.g. calming
 * topics in the evening); if nothing allowed has weight, any weighted topic is used.
 */
export function topicForTurn(weights: Record<TopicId, number>, turn: number, allowed?: readonly TopicId[]): TopicId {
  const pick = (ids: readonly TopicId[]) => {
    const wheel: TopicId[] = [];
    for (const id of ids) for (let i = 0; i < weights[id]; i++) wheel.push(id);
    return wheel;
  };
  let wheel = pick(allowed ?? TOPICS);
  if (!wheel.length) wheel = pick(TOPICS);
  if (!wheel.length) return "music";
  // spread repeats apart: stride through the wheel with a step coprime to its length
  const n = wheel.length;
  let step = Math.max(1, Math.floor(n / 2) + 1);
  while (gcd(step, n) !== 1) step++;
  return wheel[(turn * step) % n]!;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export interface TriggerCheck {
  redirect: boolean;
  matched: string[];
  /** Topic to move to when redirecting. */
  topic: TopicId | null;
}

/** TriggerFilter: does this utterance touch something the caregiver asked to avoid? */
export function checkTriggers(text: string, plan: TopicPlan, turn = 0): TriggerCheck {
  const matched = matchPhrases(text, plan.avoid);
  if (!matched.length) return { redirect: false, matched, topic: null };
  return { redirect: true, matched, topic: topicForTurn(plan.weights, turn) };
}
