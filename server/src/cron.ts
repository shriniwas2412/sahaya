// One cron trigger, every 5 minutes. Per caregiver account:
//   - create today's dose rows (same deterministic ids as the devices) and advance them,
//   - pending -> due: push "medicine time" to the account's devices,
//   - unconfirmed past the escalation delay -> missed: push the caregiver alert, log a
//     safety_event (missed_dose) and mark the dose escalated.
// CPU stays small: a few queries and at most a handful of pushes per run.

import type { Env } from "./env.ts";
import { planTick } from "../../web/src/core/doseTick.ts";
import { step, deadline, missedDoseMessage, DEFAULT_ESCALATE_MIN, type DoseEvent, type Medicine } from "../../web/src/core/doses.ts";
import { ulid } from "../../web/src/core/ids.ts";
import { serverWrite } from "./sync.ts";
import { prune } from "./lib/rateLimit.ts";
import { pushToUser } from "./app.ts";
import type { Fetch } from "./lib/webpush.ts";

const parse = <T>(s: unknown, d: T): T => { try { return typeof s === "string" ? JSON.parse(s) : d; } catch { return d; } };

export interface CronReport { due: number; missed: number; pushes: number; skipped: number }

// Workers cap outbound requests per invocation, so the run has a push budget.
// Each push call reaches at most MAX_SUBS_PER_USER devices.
export const MAX_PUSH_CALLS_PER_RUN = 8;
export const MAX_PUSHES_PER_OWNER = 3;

export async function runCron(env: Env, now = Date.now(), f?: Fetch): Promise<CronReport> {
  const tz = Number(env.TZ_OFFSET_MIN ?? 330);
  const report: CronReport = { due: 0, missed: 0, pushes: 0, skipped: 0 };
  let calls = 0;
  const perOwner = new Map<string, number>();
  /** True when this owner may get one more push in this run. */
  const budget = (owner: string) => {
    const n = perOwner.get(owner) ?? 0;
    if (calls >= MAX_PUSH_CALLS_PER_RUN || n >= MAX_PUSHES_PER_OWNER) { report.skipped++; return false; }
    calls++;
    perOwner.set(owner, n + 1);
    return true;
  };
  const meds = (await env.DB.prepare(
    `SELECT m.*, e.display_name AS elder_name, e.language AS elder_lang, sm.owner AS owner
       FROM medicine m JOIN elder e ON e.id = m.elder_id JOIN sync_meta sm ON sm.tbl = 'medicine' AND sm.id = m.id
      WHERE m.deleted = 0 AND m.active = 1 AND e.deleted = 0`,
  ).all<Record<string, unknown>>()).results;
  if (!meds.length) return report;

  // Open doses from the last two days only, to keep the run small.
  const from = new Date(now - 2 * 86400_000).toISOString();
  const open = (await env.DB.prepare(
    "SELECT * FROM dose_event WHERE deleted = 0 AND status IN ('pending','due','snoozed','missed') AND scheduled_at >= ?",
  ).bind(from).all<DoseEvent>()).results;
  const existing = new Set((await env.DB.prepare("SELECT id FROM dose_event WHERE scheduled_at >= ?").bind(from).all<{ id: string }>()).results.map((r) => r.id));

  const medList: Medicine[] = meds.map((m) => ({ ...(m as unknown as Medicine), times: parse<string[]>(m.times, []) }));
  const byMed = new Map(meds.map((m) => [m.id as string, m]));
  // Known-but-closed doses are passed as taken so planTick does not recreate them.
  const known: DoseEvent[] = [...open, ...[...existing].filter((id) => !open.some((o) => o.id === id))
    .map((id) => ({ id, medicine_id: id.split(":")[1], scheduled_at: "", status: "taken" as const }))];

  const changed = planTick(medList, known, now, tz);
  // Doses a device already marked missed still need the caregiver alert.
  for (const o of open) if (o.status === "missed" && !changed.some((c) => c.id === o.id)) changed.push(o);

  // Missed-dose alerts first, then reminders; owners interleaved so no account starves another.
  const ownerOf = (ev: DoseEvent) => String(byMed.get(ev.medicine_id)?.owner ?? "");
  const queues = new Map<string, DoseEvent[]>();
  for (const ev of [...changed].sort((a, b) => (a.status === "missed" ? 0 : 1) - (b.status === "missed" ? 0 : 1))) {
    queues.set(ownerOf(ev), [...(queues.get(ownerOf(ev)) ?? []), ev]);
  }
  const ordered: DoseEvent[] = [];
  while ([...queues.values()].some((q) => q.length)) for (const q of queues.values()) { const ev = q.shift(); if (ev) ordered.push(ev); }

  for (const ev of ordered) {
    const m = byMed.get(ev.medicine_id);
    if (!m) continue;
    const owner = m.owner as string;
    const lang = String(m.elder_lang ?? "").startsWith("en") ? "en" : "hi";
    if (ev.status === "due") {
      report.due++;
      if (budget(owner)) report.pushes += await pushToUser(env, owner, {
        title: lang === "hi" ? "दवाई का समय" : "Medicine time", body: `${m.elder_name}: ${m.name}`, tag: ev.id,
      }, f);
      await serverWrite(env.DB, owner, "dose_event", { ...ev }, now);
    } else if (ev.status === "missed") {
      // Trust the server's clock, not the phone's: no alert before the real deadline.
      if (now < deadline(ev, Number(m.escalate_after_min ?? DEFAULT_ESCALATE_MIN))) continue;
      // At most one alert per dose, whatever the merged status says later.
      const sent = await env.DB.prepare("SELECT 1 AS x FROM dose_alert WHERE dose_id = ?").bind(ev.id).first();
      if (sent) {
        await serverWrite(env.DB, owner, "dose_event", { ...step(ev, { type: "escalated" }, now) }, now);
        continue;
      }
      if (!budget(owner)) continue; // retried on the next run
      await env.DB.prepare("INSERT INTO dose_alert (dose_id, owner, at) VALUES (?, ?, ?)").bind(ev.id, owner, new Date(now).toISOString()).run();
      report.missed++;
      const text = missedDoseMessage(String(m.elder_name), String(m.name), ev.scheduled_at, tz, lang);
      report.pushes += await pushToUser(env, owner, { title: "Sahaya", body: text, tag: `missed:${ev.id}`, urgent: true }, f);
      await serverWrite(env.DB, owner, "safety_event", {
        id: ulid(now), elder_id: m.elder_id, session_id: null, at: new Date(now).toISOString(), trigger: "missed_dose",
        matched: ev.id, action: "caregiver_push", resolved_at: null, resolved_by: null,
      }, now);
      await serverWrite(env.DB, owner, "dose_event", { ...step(ev, { type: "escalated" }, now) }, now);
    } else {
      await serverWrite(env.DB, owner, "dose_event", { ...ev }, now);
    }
  }
  if (report.skipped) console.warn(`cron: push budget reached, ${report.skipped} pushes left for the next run`);
  await prune(env.DB, now);
  return report;
}
