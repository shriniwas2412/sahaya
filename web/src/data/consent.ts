// Consent records are append-only: a change writes a new row with its own recorded_at,
// and the newest row for a subject is the one in force.

import { ulid } from "../core/ids.ts";

export interface ConsentRow {
  id: string; subject_type: "elder"; subject_id: string; given_by: string; method: string;
  scope_store: 0 | 1; scope_sync: 0 | 1; scope_audio_cloud: 0 | 1; scope_llm_cloud?: 0 | 1;
  scope_contact_share: 0 | 1; scope_research_aggregate: 0 | 1; language: string | null; recorded_at: string; withdrawn_at?: string | null;
}

export function latestConsent(rows: ConsentRow[], subjectId: string): ConsentRow | null {
  return rows.filter((c) => c.subject_id === subjectId).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0] ?? null;
}

export type Scope = "scope_sync" | "scope_audio_cloud" | "scope_llm_cloud";

/** A new consent row equal to the current one with one scope changed. */
export function withScope(cur: ConsentRow, scope: Scope, on: boolean, now: string, id: string = ulid()): ConsentRow {
  return { ...cur, id, [scope]: on ? 1 : 0, method: "digital", recorded_at: now, withdrawn_at: null };
}

/** Typed confirmation for "Delete all": the English or the Hindi word. */
export function isDeleteWord(s: string): boolean {
  const w = s.trim();
  return w.toUpperCase() === "DELETE" || w === "हटाएँ";
}
