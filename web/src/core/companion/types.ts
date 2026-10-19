// Shared domain types for the companion core.
// Field names follow the `elder` and `session` tables in server/migrations,
// in camelCase. Unknown values stay null; nothing here is ever guessed.

/** Languages with their own content banks. mr/gu fall back to hi until written. */
export type Lang = "hi" | "en" | "mr" | "gu";

/** Global Deterioration Scale stage (Reisberg 1982). */
export type Stage = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface FamilyContact {
  name: string;
  relation?: string | null;
  phone: string;
  whatsapp?: boolean;
  /** Call order: 1 is called first. */
  order: number;
}

/** A caregiver-added distress word. A bare string means level "check". */
export type CustomDistressWord = string | { phrase: string; level: "check" | "emergency" };

export interface ElderProfile {
  displayName: string;
  age?: number | null;
  birthDecade?: number | null;
  /** null when the stage was not assessed. Never guessed. */
  gdsStage: Stage | null;
  /** "hi", "en", "mr", "gu" or a locale like "hi-IN". */
  language: string;
  /** Free text, e.g. "Bundeli", "Malwi", "Varhadi". */
  dialect?: string | null;
  preferences?: string[];
  /** Topics to avoid, as entered by the caregiver. */
  triggers?: string[];
  energyPattern?: string | null;
  /** "HH:MM" local time. The window may cross midnight. */
  sundownStart?: string | null;
  sundownEnd?: string | null;
  familyContacts?: FamilyContact[];
  ngoHelpline?: string | null;
  /** Defaults to "Sahaya". */
  personaName?: string | null;
  /** Caregiver-written notes about the person's life, used as-is in life-story mode. */
  lifeStory?: string | null;
  customDistressWords?: CustomDistressWord[];
}

/** One caregiver feedback form (session.feedback_* columns). */
export interface FeedbackEntry {
  mood?: 1 | 2 | 3 | 4 | 5 | null;
  keep?: string[];
  avoid?: string[];
  notes?: string | null;
}

/** Topic categories the scripted companion and the topic weights share. */
export type TopicId = "reminiscence" | "music" | "festivals" | "food" | "weather" | "life_story";

export const TOPICS: readonly TopicId[] = ["reminiscence", "music", "festivals", "food", "weather", "life_story"];

export const DEFAULT_PERSONA = "Sahaya";

/** Reduce "hi-IN", "HI", "hindi" etc. to a content language. Unknown → "en". */
export function baseLang(language: string | null | undefined): Lang {
  const l = String(language ?? "").trim().toLowerCase();
  if (l.startsWith("hi")) return "hi";
  if (l.startsWith("mr") || l.startsWith("marathi")) return "mr";
  if (l.startsWith("gu")) return "gu";
  if (l.startsWith("en")) return "en";
  return "en";
}

/**
 * Stage used to choose communication style only. When the stage was not
 * assessed we use the stage-4 style (short, slow, gentle): the safer side.
 * This value is never stored back on the profile.
 */
export function styleStage(stage: Stage | null | undefined): Stage {
  return stage ?? 4;
}

export function personaOf(p: ElderProfile): string {
  const n = (p.personaName ?? "").trim();
  return n || DEFAULT_PERSONA;
}

/** First word of the display name, as people are usually addressed. */
export function callName(p: ElderProfile): string {
  return (p.displayName ?? "").trim().split(/\s+/)[0] ?? "";
}

/** How the companion addresses the person: "Kamla" in English, "कमला जी" in Hindi-family languages. */
export function addressName(p: ElderProfile, lang: Lang): string {
  const n = callName(p);
  if (!n) return "";
  return lang === "en" ? n : `${n} जी`;
}

/** Fill {key} placeholders; unknown keys become "". Leftover ", ." from an empty name is tidied. */
export function fill(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "")
    .replace(/,\s*([।.?!])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
