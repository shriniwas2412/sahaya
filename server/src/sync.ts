// Server side of sync. Rows are merged field by field with the same LWW-CRDT the
// devices use, then written into the normal tables. sync_meta keeps the per-field
// versions and a server change stamp, so `since` pulls never miss a row written
// by a device whose clock was behind.

import { rowStamp, createClock, type Versioned } from "../../web/src/core/sync.ts";
import { mergeRow } from "../../web/src/core/merge.ts";
import { decode } from "../../web/src/core/sync.ts";

/** A device clock may run ahead, but not by more than this (the same bound Kisan uses). */
export const MAX_FUTURE_MS = 24 * 3_600_000;
import type { D1Database } from "./env.ts";

// Columns a client may write, per table. Anything else in a row is dropped.
export const COLUMNS: Record<string, string[]> = {
  elder: ["display_name", "age", "birth_decade", "gds_stage", "language", "dialect", "preferences", "triggers", "energy_pattern",
    "sundown_start", "sundown_end", "facility", "caregiver_id", "family_contacts", "ngo_helpline", "persona_name", "source", "source_ref", "notes"],
  medicine: ["elder_id", "name", "dose", "times", "instructions", "escalate_after_min", "alert_user_id", "active"],
  dose_event: ["medicine_id", "scheduled_at", "status", "confirmed_at", "confirmed_by", "escalated_at", "snoozed_until"],
  session: ["elder_id", "mode", "started_at", "ended_at", "stage_at_session", "language", "topics", "feedback_mood", "feedback_keep",
    "feedback_avoid", "feedback_notes", "source", "source_ref"],
  activity_score: ["session_id", "task", "score", "max_score"],
  safety_event: ["elder_id", "session_id", "at", "trigger", "matched", "action", "resolved_at", "resolved_by"],
  consent: ["subject_type", "subject_id", "given_by", "guardian_name", "guardian_relation", "method", "scope_store", "scope_sync",
    "scope_audio_cloud", "scope_contact_share", "scope_research_aggregate", "language", "recorded_at", "evidence_ref", "withdrawn_at"],
};
const JSON_COLS = new Set(["preferences", "triggers", "family_contacts", "times", "topics", "feedback_keep", "feedback_avoid"]);
const SYNCED = ["origin", "deleted"];

export interface Change { table: string; row: Versioned }

const toDb = (k: string, v: unknown) =>
  v === undefined ? null : JSON_COLS.has(k) ? (v == null ? null : JSON.stringify(v)) : typeof v === "boolean" ? (v ? 1 : 0) : v;
const fromDb = (k: string, v: unknown) => (JSON_COLS.has(k) && typeof v === "string" ? safeJson(v) : v);
function safeJson(s: string) { try { return JSON.parse(s); } catch { return s; } }

async function serverClock(db: D1Database, now?: () => number) {
  const top = await db.prepare("SELECT MAX(hlc) AS h FROM sync_meta").first<{ h: string | null }>();
  const clock = createClock("server", now);
  if (top?.h) clock.observe(top.h);
  return clock;
}

async function loadRow(db: D1Database, table: string, id: string): Promise<{ row: Versioned; owner: string } | null> {
  const meta = await db.prepare("SELECT owner, versions FROM sync_meta WHERE tbl = ? AND id = ?").bind(table, id).first<{ owner: string; versions: string }>();
  if (!meta) return null;
  const r = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!r) return null;
  const row: Versioned = { id };
  for (const k of [...COLUMNS[table], ...SYNCED]) if (k in r) row[k] = k === "deleted" ? !!r[k] : fromDb(k, r[k]);
  row._v = JSON.parse(meta.versions);
  return { row, owner: meta.owner };
}


// ---- consent gate ----
// Rows about an elder reach the server only when that elder's newest, non-withdrawn
// consent (owned by the same account) says scope_sync = 1. The elder must also belong
// to the account, so nobody can attach rows to someone else's elder.

const ELDER_TABLES = new Set(["elder", "medicine", "dose_event", "session", "activity_score", "safety_event", "consent"]);

async function elderOf(db: D1Database, table: string, row: Versioned): Promise<string | null> {
  switch (table) {
    case "elder": return row.id;
    case "consent": return (row.subject_id as string) ?? null;
    case "medicine": case "session": case "safety_event": return (row.elder_id as string) ?? null;
    case "dose_event": {
      const m = await db.prepare("SELECT elder_id FROM medicine WHERE id = ?").bind(row.medicine_id ?? "").first<{ elder_id: string }>();
      return m?.elder_id ?? null;
    }
    case "activity_score": {
      const s = await db.prepare("SELECT elder_id FROM session WHERE id = ?").bind(row.session_id ?? "").first<{ elder_id: string }>();
      return s?.elder_id ?? null;
    }
    default: return null;
  }
}

export async function syncConsented(db: D1Database, owner: string, elderId: string): Promise<boolean> {
  const c = await db.prepare(
    `SELECT c.scope_sync AS s FROM consent c JOIN sync_meta m ON m.tbl = 'consent' AND m.id = c.id
      WHERE c.subject_id = ? AND m.owner = ? AND c.deleted = 0 AND c.withdrawn_at IS NULL
      ORDER BY c.recorded_at DESC LIMIT 1`,
  ).bind(elderId, owner).first<{ s: number }>();
  if (c?.s !== 1) return false;
  const e = await db.prepare("SELECT owner FROM sync_meta WHERE tbl = 'elder' AND id = ?").bind(elderId).first<{ owner: string }>();
  return !e || e.owner === owner;
}

export interface PushResult { accepted: number; rejected: { table: string; id: string; reason: string }[] }

export async function pushChanges(db: D1Database, owner: string, changes: Change[], now?: () => number, trusted = false): Promise<PushResult> {
  const out: PushResult = { accepted: 0, rejected: [] };
  const clock = await serverClock(db, now);
  // Consent rows first, so an elder sent in the same batch as its consent is accepted.
  const ordered = changes.slice(0, 2000).map((c, i) => ({ c, i }))
    .sort((x, y) => (x.c.table === "consent" ? 0 : 1) - (y.c.table === "consent" ? 0 : 1) || x.i - y.i).map((x) => x.c);
  for (const c of ordered) {
    const cols = Object.hasOwn(COLUMNS, c.table) ? COLUMNS[c.table] : undefined;
    const id = c.row?.id;
    if (!cols || typeof id !== "string" || id.length > 200) { out.rejected.push({ table: String(c.table), id: String(id), reason: "unknown" }); continue; }
    const allowed = new Set([...cols, ...SYNCED]);
    const clean: Versioned = { id, _v: {} };
    for (const [k, v] of Object.entries(c.row)) if (allowed.has(k)) clean[k] = v;
    for (const [k, ts] of Object.entries(c.row._v ?? {})) if (allowed.has(k) && typeof ts === "string" && ts.length < 100) clean._v![k] = ts;
    // A stamp far in the future would win every later merge and freeze the field.
    const limit = (now ?? Date.now)() + MAX_FUTURE_MS;
    if (!trusted && Object.values(clean._v!).some((ts) => !(decode(ts).wall <= limit))) { out.rejected.push({ table: c.table, id, reason: "future_stamp" }); continue; }

    const prev = await loadRow(db, c.table, id);
    if (prev && prev.owner !== owner) { out.rejected.push({ table: c.table, id, reason: "forbidden" }); continue; }
    const merged = mergeRow(c.table, prev?.row, clean);
    if (!trusted && ELDER_TABLES.has(c.table)) {
      const elderId = await elderOf(db, c.table, merged);
      const ok = !!elderId && (c.table === "consent"
        // A consent row is stored when it allows sync, or when it updates one the server
        // already has (so a later "stop syncing" reaches the server).
        ? (merged.scope_sync === 1 && !merged.withdrawn_at) || !!prev
        : await syncConsented(db, owner, elderId));
      if (!ok) { out.rejected.push({ table: c.table, id, reason: "no_sync_consent" }); continue; }
    }
    const names = ["id", ...cols, "origin", "deleted", "created_by", "hlc"];
    const values = [id, ...cols.map((k) => toDb(k, merged[k])), merged.origin ?? null, merged.deleted ? 1 : 0, owner, rowStamp(merged) || clock.tick()];
    try {
      await db.batch([
        db.prepare(`INSERT OR REPLACE INTO ${c.table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).bind(...values),
        db.prepare("INSERT OR REPLACE INTO sync_meta (tbl, id, owner, versions, hlc) VALUES (?, ?, ?, ?, ?)")
          .bind(c.table, id, owner, JSON.stringify(merged._v ?? {}), clock.tick()),
      ]);
      out.accepted++;
    } catch (e) {
      out.rejected.push({ table: c.table, id, reason: /constraint/i.test(String((e as Error).message)) ? "invalid_row" : "error" });
    }
  }
  return out;
}

export async function pullChanges(db: D1Database, owner: string, since: string, limit = 1000): Promise<{ rows: Change[]; cursor: string; more: boolean }> {
  const metas = (await db.prepare("SELECT tbl, id, hlc FROM sync_meta WHERE owner = ? AND hlc > ? ORDER BY hlc LIMIT ?")
    .bind(owner, since, limit + 1).all<{ tbl: string; id: string; hlc: string }>()).results;
  const more = metas.length > limit;
  const page = metas.slice(0, limit);
  const rows: Change[] = [];
  for (const m of page) {
    const r = await loadRow(db, m.tbl, m.id);
    if (r) rows.push({ table: m.tbl, row: r.row });
  }
  return { rows, cursor: page.at(-1)?.hlc ?? since, more };
}

/** Write a row on the server's own behalf (cron), through the same merge path. */
export async function serverWrite(db: D1Database, owner: string, table: string, row: Record<string, unknown>, now?: number): Promise<void> {
  const clock = await serverClock(db, now === undefined ? undefined : () => now);
  const prev = await loadRow(db, table, row.id as string);
  const ts = clock.tick();
  const v: Record<string, string> = { ...(prev?.row._v ?? {}) };
  for (const k of Object.keys(row)) if (k !== "id" && JSON.stringify(prev?.row[k]) !== JSON.stringify(row[k])) v[k] = ts;
  // The server's own writes are trusted: the device clock bound does not apply to them.
  await pushChanges(db, owner, [{ table, row: { ...(prev?.row ?? {}), ...row, id: row.id as string, _v: v } }], now === undefined ? undefined : () => now, true);
}
