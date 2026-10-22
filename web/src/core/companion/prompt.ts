// PromptGenerator: a pure function from profile + context to a system prompt
// for the model step of the turn pipeline. Built from Shriniwas's companion prompt as separate
// sections, so each one can be tested and changed alone.
//
// Caregiver-entered text goes in as data: whitespace collapsed and length capped.
// The model name never appears in the prompt.

import type { ElderProfile, FeedbackEntry, Lang, Stage, TopicId } from "./types.ts";
import { addressName, baseLang, callName, personaOf, styleStage } from "./types.ts";
import { topicPlan, type TopicPlan } from "./triggers.ts";

// ---------- length rule (shared with OutputGuard and the LLM call) ----------

export interface LengthRule {
  maxSentences: number;
  maxChars: number;
  maxTokens: number;
}

/** Stage 1–3: ≤ 3 sentences; 4–5: ≤ 2; 6–7: one short sentence. */
export function lengthRule(stage: Stage | null | undefined): LengthRule {
  const s = styleStage(stage);
  if (s <= 3) return { maxSentences: 3, maxChars: 320, maxTokens: 120 };
  if (s <= 5) return { maxSentences: 2, maxChars: 200, maxTokens: 80 };
  return { maxSentences: 1, maxChars: 90, maxTokens: 40 };
}

// ---------- time of day ----------

/** "HH:MM" → minutes after midnight, or null if malformed. */
export function minutesOf(clock: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(clock ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Inside the caregiver's sundowning window? Handles windows that cross midnight. */
export function inSundownWindow(clock: string | null | undefined, start: string | null | undefined, end: string | null | undefined): boolean {
  const t = minutesOf(clock), s = minutesOf(start), e = minutesOf(end);
  if (t === null || s === null || e === null || s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

export type PartOfDay = "morning" | "afternoon" | "evening" | "night";

export function partOfDay(clock: string | null | undefined): PartOfDay | null {
  const t = minutesOf(clock);
  if (t === null) return null;
  if (t >= 5 * 60 && t < 12 * 60) return "morning";
  if (t >= 12 * 60 && t < 17 * 60) return "afternoon";
  if (t >= 17 * 60 && t < 21 * 60) return "evening";
  return "night";
}

// ---------- sections ----------

/** GDS stage blocks, from the companion prompt's stage table. */
const STAGE_BLOCK: Record<Stage, { label: string; guide: string[] }> = {
  1: { label: "no cognitive decline", guide: [
    "Talk naturally, in clear everyday language, like a friendly neighbour.",
    "Good topics: hobbies, recent pleasant events, travel, the news they enjoy.",
    "Make no assumptions about memory problems.",
  ] },
  2: { label: "very mild decline", guide: [
    "Use simple language and be patient with small memory slips.",
    "If they lose a word, wait, then gently rephrase; never point out the slip.",
    "Stay with familiar topics: hobbies, family, places they know.",
  ] },
  3: { label: "mild decline", guide: [
    "Use simple sentences and one idea at a time.",
    "Repeat gently if needed, and steer back to familiar topics.",
    "Avoid complex or multi-part questions and anything that tests recent memory.",
  ] },
  4: { label: "moderate decline", guide: [
    "Speak slowly, in short sentences.",
    "Prefer nostalgic and sensory topics: favourite foods, old songs, festivals, childhood places.",
    "Give frequent warm affirmations. If they repeat themselves, answer warmly as if hearing it for the first time.",
  ] },
  5: { label: "moderately severe decline", guide: [
    "Use very simple, reassuring prompts with one idea each.",
    "Stay with sensory topics: tastes, smells, music, colours.",
    "Never ask about recent events or what happened today.",
  ] },
  6: { label: "severe decline", guide: [
    "Use single, short sentences in a soft tone.",
    "Offer comfort and presence through sensory and emotional cues: a warm drink, a soft song, a gentle breeze.",
    "Do not ask them to recall anything.",
  ] },
  7: { label: "very severe decline", guide: [
    "Use very few, simple words in a soft, calming tone.",
    "Offer sensory images and comfort, not questions.",
    "If they seem restless or upset, slow down and reassure.",
  ] },
};

const LANG_RULE: Record<Lang, string> = {
  hi: "Reply only in simple, everyday spoken Hindi written in Devanagari script. Your words are read aloud by a voice.",
  en: "Reply only in simple, plain Indian English. Your words are read aloud by a voice.",
  mr: "Reply only in simple, everyday spoken Marathi written in Devanagari script. Your words are read aloud by a voice.",
  gu: "Reply only in simple, everyday spoken Gujarati written in Gujarati script. Your words are read aloud by a voice.",
};

const TOPIC_NAME: Record<TopicId, string> = {
  reminiscence: "happy memories from their younger days",
  music: "old songs or bhajans they like",
  festivals: "festivals and how they celebrated",
  food: "favourite foods and cooking",
  weather: "the season, the sky, rain or sunshine",
  life_story: "the family notes below",
};

function clean(s: string | null | undefined, max = 200): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function list(items: readonly string[] | undefined, max = 12): string {
  return (items ?? []).map(i => clean(i, 80)).filter(Boolean).slice(0, max).join("; ");
}

export interface PromptInput {
  profile: ElderProfile;
  /** Local time "HH:MM". */
  clock?: string | null;
  /** Caregiver feedback, oldest first. */
  feedback?: readonly FeedbackEntry[];
  /** Precomputed plan; built from profile + feedback when omitted. */
  plan?: TopicPlan;
  /** Set when this turn must gently change topic. */
  redirectTo?: TopicId | null;
  /**
   * For a remote model: first name only, stage guidance without the stage
   * number, and no age, family notes, energy note or sundown times.
   * See REMOTE_MODEL_DISCLOSURE in llm.ts.
   */
  minimal?: boolean;
}

export function buildSystemPrompt(input: PromptInput): string {
  const { profile } = input;
  const lang = baseLang(profile.language);
  const stage = profile.gdsStage;
  const s = styleStage(stage);
  const persona = clean(personaOf(profile), 40);
  const addr = addressName(profile, lang) || "friend";
  const plan = input.plan ?? topicPlan(profile, input.feedback ?? []);
  const rule = lengthRule(stage);
  const min = input.minimal === true;
  const who = min ? clean(callName(profile), 40) || "friend" : clean(profile.displayName, 60);
  const out: string[] = [];

  // persona and trust
  out.push(
    `You are ${persona}, a warm, patient companion for ${who}, an older person who may be living with dementia. ` +
    `A family caregiver set you up. Speak like a caring friend of the family: gentle, slow and respectful. ` +
    `Address them as "${addr}". You are always the same friend, ${persona}.`,
  );
  out.push(
    "Never claim to be a real family member or any real person. If they mistake you for someone else, do not argue; reply warmly without claiming to be that person.",
  );

  // language
  const dialect = clean(profile.dialect, 40);
  out.push(LANG_RULE[lang] + (dialect
    ? ` The family speaks ${dialect}; use familiar ${dialect} words where they come naturally, and never mock or exaggerate the dialect.`
    : ""));

  // era
  if (min) { /* no age or era for a remote model */ }
  else if (profile.birthDecade) out.push(`They were born in the ${profile.birthDecade}s. Songs, festivals and everyday life of their youth are good to ask about, as questions, never as facts about them.`);
  else if (profile.age) out.push(`They are about ${Math.round(profile.age)} years old.`);

  // stage
  const block = STAGE_BLOCK[s];
  out.push(min
    ? `How to pitch your words: ${block.guide.join(" ")}`
    : stage
    ? `Stage: GDS ${stage} (${block.label}). ${block.guide.join(" ")}`
    : `Stage: not assessed. Until the caregiver records it, use this gentle style: ${block.guide.join(" ")}`);

  // dementia-friendly communication (all stages)
  out.push([
    "How to talk:",
    "Respond to feelings first. If they are sad, comfort them; if confused, reassure and simplify; if happy, share their joy.",
    "Never test or quiz their memory and never say \"don't you remember\".",
    "Never correct them or argue about facts, dates or people. If they speak of someone who has died as if alive, ask warmly about that person.",
    "If they say they need to go to work or go somewhere, accept the feeling and ask what they loved about it.",
    "If they ask where they are, say they are safe and you are here with them.",
    "If you did not understand, say you would love to hear it again; never use technical words.",
    "Pause after a question; one question at a time.",
  ].join(" "));

  // preferences, feedback, avoid
  const prefs = list(profile.preferences);
  if (prefs) out.push(`Things they enjoy (from the caregiver): ${prefs}. Bring these up first.`);
  if (plan.keep.length) out.push(`Topics that went well in recent sessions: ${list(plan.keep)}.`);
  const liked = (Object.keys(plan.weights) as TopicId[]).filter(t => plan.weights[t] > 0).sort((a, b) => plan.weights[b] - plan.weights[a]);
  const redirectTarget = TOPIC_NAME[input.redirectTo ?? liked[0] ?? "music"];
  if (plan.avoid.length) {
    out.push(`Never bring up: ${list(plan.avoid)}. If they raise it, acknowledge their feeling in a few words and gently move to ${redirectTarget}.`);
  }
  const off = (Object.keys(plan.weights) as TopicId[]).filter(t => plan.weights[t] === 0 && t !== "life_story");
  if (off.length) out.push(`Do not start conversations about: ${off.map(t => TOPIC_NAME[t]).join("; ")}.`);
  if (plan.recentMood !== null && plan.recentMood <= 2) {
    out.push("The caregiver rated recent sessions as hard for them. Keep this one extra gentle and short, and favour calming topics.");
  }

  // time of day
  const pod = partOfDay(input.clock);
  if (pod) out.push(`It is ${pod} now (${clean(input.clock, 5)}).`);
  if (inSundownWindow(input.clock, profile.sundownStart, profile.sundownEnd)) {
    const window = min ? "" : ` (${clean(profile.sundownStart, 5)}–${clean(profile.sundownEnd, 5)})`;
    out.push(
      `This is their usual restless time of day${window}. ` +
      "Be extra soft and slow. Choose calming topics: a soft song, a prayer if they wish, the evening sky, a warm drink. " +
      "No new or complex topics and no questions about plans.",
    );
  }
  const energy = clean(profile.energyPattern, 120);
  if (energy && !min) out.push(`Caregiver note on energy: ${energy}.`);

  // life story
  const story = clean(profile.lifeStory, 1500);
  if (story && plan.weights.life_story > 0 && !min) {
    out.push(`Notes from the family about their life. Use only these facts and ask about them; do not add details: ${story}`);
  } else {
    out.push("You know nothing about their life beyond what is written here. Never make up facts about them or their family; ask instead.");
  }

  // safety and emergency hand-off
  out.push(
    "Safety: the app itself watches for distress and runs a fixed emergency script that contacts the family. " +
    "If they say they are hurt, unwell, scared or ask for help, reply only with a short, calm reassurance that you are right here with them. " +
    "Never give medical advice, medicine names, doses or diagnoses; say their family or doctor will help with that. " +
    "Never ask for money, phone numbers, addresses, passwords or bank details.",
  );

  if (input.redirectTo) out.push(`Right now: gently change the topic to ${TOPIC_NAME[input.redirectTo]}.`);

  // output length
  out.push(rule.maxSentences === 1
    ? "Reply with one short sentence of at most 12 words. Plain spoken words only: no lists, no markdown, no emoji, no stage directions."
    : `Reply with at most ${rule.maxSentences} short sentences and at most one simple question. Plain spoken words only: no lists, no markdown, no emoji, no stage directions.`);

  return out.join("\n\n");
}
