// What a deleted row keeps: its id, the deleted flag, the ids that link it to its parent,
// and the few non-personal columns the schema requires. Everything else is cleared, so a
// tombstone that syncs (or stays on the server) carries no personal data.

const KEEP: Record<string, readonly string[]> = {
  elder: [],
  medicine: ["elder_id"],
  dose_event: ["medicine_id", "scheduled_at"],
  session: ["elder_id"],
  activity_score: ["session_id"],
  safety_event: ["elder_id", "session_id", "at"],
  consent: ["subject_type", "subject_id", "scope_store", "scope_sync", "recorded_at", "withdrawn_at"],
};
// Required text columns: kept as "" instead of null so the row stays valid.
const EMPTY: Record<string, readonly string[]> = { elder: ["display_name"], medicine: ["name"] };
const ALWAYS = new Set(["id", "deleted", "_v", "hlc", "origin", "created_by"]);

export function scrub<T extends Record<string, unknown>>(table: string, row: T): T {
  const keep = new Set([...(KEEP[table] ?? []), ...ALWAYS]);
  const empty = new Set(EMPTY[table] ?? []);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = keep.has(k) ? v : empty.has(k) ? "" : null;
  return out as T;
}
