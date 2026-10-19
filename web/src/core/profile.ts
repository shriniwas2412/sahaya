// The elder profile as stored (the `elder` table, snake_case) and as the companion
// core reads it (ElderProfile, camelCase). Unknown values stay null.

import type { ElderProfile, FamilyContact, Stage } from "./companion/types.ts";
import { isStage } from "./gds.ts";
import { isValidPhone } from "./contacts.ts";
import { isValidTime } from "./doses.ts";

export const LANGUAGES = [
  { code: "hi-IN", dialect: null, label: "हिन्दी" },
  { code: "hi-IN", dialect: "Bundeli", label: "बुंदेली" },
  { code: "hi-IN", dialect: "Malwi", label: "मालवी" },
  { code: "hi-IN", dialect: "Chhattisgarhi", label: "छत्तीसगढ़ी" },
  { code: "mr-IN", dialect: "Varhadi", label: "मराठी (वऱ्हाडी)" },
  { code: "gu-IN", dialect: null, label: "ગુજરાતી" },
  { code: "en-IN", dialect: null, label: "English" },
] as const;

export interface ElderRow {
  id: string;
  display_name: string;
  age: number | null;
  birth_decade: number | null;
  gds_stage: Stage | null;
  language: string | null;
  dialect: string | null;
  preferences: string[];
  triggers: string[];
  energy_pattern: string | null;
  sundown_start: string | null;
  sundown_end: string | null;
  facility: string | null;
  family_contacts: FamilyContact[];
  ngo_helpline: string | null;
  persona_name: string;
  source: "app";
  notes: string | null;
  deleted?: boolean;
}

export function emptyElder(id: string): ElderRow {
  return {
    id, display_name: "", age: null, birth_decade: null, gds_stage: null, language: "hi-IN", dialect: null,
    preferences: [], triggers: [], energy_pattern: null, sundown_start: null, sundown_end: null, facility: null,
    family_contacts: [], ngo_helpline: null, persona_name: "Sahaya", source: "app", notes: null,
  };
}

export type ElderError = "display_name" | "gds_stage" | "age" | "birth_decade" | "sundown" | "contact_phone" | "ngo_helpline" | "persona_name";

/**
 * Name is required. The stage must be chosen explicitly: a number 1-7, or null for
 * "not assessed" (`stageChosen` tells the two apart, so null is never a silent default).
 */
export function validateElder(e: ElderRow, stageChosen: boolean): ElderError[] {
  const out: ElderError[] = [];
  if (!e.display_name.trim()) out.push("display_name");
  if (!stageChosen || (e.gds_stage !== null && !isStage(e.gds_stage))) out.push("gds_stage");
  if (e.age !== null && !(Number.isInteger(e.age) && e.age >= 40 && e.age <= 120)) out.push("age");
  if (e.birth_decade !== null && !(e.birth_decade % 10 === 0 && e.birth_decade >= 1900 && e.birth_decade <= 1990)) out.push("birth_decade");
  const s = e.sundown_start, t = e.sundown_end;
  if ((s || t) && !(s && t && isValidTime(s) && isValidTime(t))) out.push("sundown");
  if (e.family_contacts.some((c) => !c.name.trim() || !isValidPhone(c.phone))) out.push("contact_phone");
  if (e.ngo_helpline && !isValidPhone(e.ngo_helpline)) out.push("ngo_helpline");
  if (!e.persona_name.trim()) out.push("persona_name");
  return out;
}

/** Split "a, b\nc" chip input into a clean, de-duplicated list. */
export function splitList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const v = raw.trim();
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
  }
  return out;
}

/** Renumber call order 1..n in the current list order. */
export const renumber = (cs: FamilyContact[]): FamilyContact[] => cs.map((c, i) => ({ ...c, order: i + 1 }));

export function toProfile(e: ElderRow, extra: { customDistressWords?: string[]; lifeStory?: string | null } = {}): ElderProfile {
  return {
    displayName: e.display_name,
    age: e.age,
    birthDecade: e.birth_decade,
    gdsStage: e.gds_stage,
    language: e.language ?? "hi-IN",
    dialect: e.dialect,
    preferences: e.preferences,
    triggers: e.triggers,
    energyPattern: e.energy_pattern,
    sundownStart: e.sundown_start,
    sundownEnd: e.sundown_end,
    familyContacts: e.family_contacts,
    ngoHelpline: e.ngo_helpline,
    personaName: e.persona_name || "Sahaya",
    lifeStory: extra.lifeStory ?? e.notes,
    customDistressWords: extra.customDistressWords ?? [],
  };
}

/** "hi" or "en" for app UI strings (other languages use Hindi UI until translated). */
export const uiLang = (language: string | null | undefined): "hi" | "en" => (language?.startsWith("en") ? "en" : "hi");
