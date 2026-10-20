// Demo mode: one clearly synthetic elder ("Shanti (demo)") with contacts, medicines,
// past sessions and activity scores, so every screen has something to show.
// Demo rows never sync, never dial a real number, and are removed without a trace
// by clearDemo(). Every value here is made up; none comes from a real person.

import type { Repo, Table } from "./repo.ts";
import { hashPin } from "../core/pin.ts";
import { localDay, IST_OFFSET_MIN } from "../core/doseTick.ts";

export const DEMO_PIN = "1234";
export const DEMO_PREFIX = "demo-";
export const DEMO_ELDER_ID = "demo-elder";
export const isDemoId = (id: unknown) => typeof id === "string" && id.startsWith(DEMO_PREFIX);

const DAY = 86_400_000;

export async function isDemo(repo: Repo): Promise<boolean> {
  return (await repo.backend.getMeta<boolean>("demo")) === true;
}

/** Build-time switch: the hosted demo opens straight into demo mode. */
export const DEMO_BUILD: boolean = (() => {
  try { return (import.meta as unknown as { env?: { VITE_DEMO?: string } }).env?.VITE_DEMO === "1"; } catch { return false; }
})();

/** Session start times on recent days (local IST morning), oldest first. */
function pastIso(now: number, daysAgo: number, hhmm: string): string {
  const day = localDay(now - daysAgo * DAY, IST_OFFSET_MIN);
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - IST_OFFSET_MIN * 60_000).toISOString();
}

export async function loadDemo(repo: Repo, now: number = Date.now(), pinIterations?: number): Promise<void> {
  // Flags first, so the first reload after a save already sees demo mode.
  await repo.backend.setMeta("demo", true);
  await repo.backend.setMeta("demo_cleared", false);
  await repo.save("elder", {
    id: DEMO_ELDER_ID,
    display_name: "Shanti (demo)",
    age: null,
    birth_decade: 1950,
    gds_stage: 4,
    language: "hi-IN",
    dialect: null,
    preferences: ["पुराने फ़िल्मी गाने", "खाना बनाना"],
    triggers: ["अस्पताल की बात"],
    energy_pattern: "सुबह शांत, शाम को थकान",
    sundown_start: "17:00",
    sundown_end: "19:00",
    facility: "Demo Ghar",
    family_contacts: [
      { name: "Demo Beta", relation: "बेटा", phone: "+91 90000 00001", whatsapp: true, order: 1 },
      { name: "Demo Beti", relation: "बेटी", phone: "+91 90000 00002", whatsapp: true, order: 2 },
    ],
    ngo_helpline: null, // deliberately empty: the caregiver sets a verified local helpline
    persona_name: "Sahaya",
    source: "app",
    notes: "नमूना कहानी: शांति जी को रसोई में नई चीज़ें बनाना और रेडियो पर पुराने गाने सुनना अच्छा लगता था।",
  });
  await repo.save("medicine", {
    id: "demo-med-1", elder_id: DEMO_ELDER_ID, name: "Demo Tablet A", dose: "1 (demo)", times: ["08:00", "20:00"],
    instructions: "नाश्ते के बाद", escalate_after_min: 30, alert_user_id: null, active: 1,
  });
  await repo.save("medicine", {
    id: "demo-med-2", elder_id: DEMO_ELDER_ID, name: "Demo Tablet B", dose: "1 (demo)", times: ["14:00"],
    instructions: "खाने के बाद", escalate_after_min: 30, alert_user_id: null, active: 1,
  });

  // Three past companion sessions with caregiver feedback.
  const talks = [
    { d: 6, mood: 3, keep: ["music"], avoid: [], topics: ["music", "reminiscence"], notes: "नमूना: शुरू में थोड़ी उलझन, गाने से मन लगा।" },
    { d: 4, mood: 4, keep: ["music", "food"], avoid: ["weather"], topics: ["food", "music", "weather"], notes: null },
    { d: 1, mood: 5, keep: ["food"], avoid: [], topics: ["food", "festivals"], notes: "नमूना: दिवाली की मिठाइयों की बात पर मुस्कुराईं।" },
  ];
  for (const [i, s] of talks.entries()) {
    const start = pastIso(now, s.d, "10:30");
    await repo.save("session", {
      id: `demo-talk-${i + 1}`, elder_id: DEMO_ELDER_ID, mode: "companion", started_at: start,
      ended_at: new Date(Date.parse(start) + 15 * 60_000).toISOString(), stage_at_session: 4, language: "hi-IN",
      topics: s.topics, feedback_mood: s.mood, feedback_keep: s.keep, feedback_avoid: s.avoid, feedback_notes: s.notes,
    });
  }

  // Four past memory activities, so the history table is not empty.
  const acts = [
    { d: 21, orientation: 4, immediate: 3, delayed: 2, fluency: 10 },
    { d: 14, orientation: 5, immediate: 4, delayed: 3, fluency: 11 },
    { d: 7, orientation: 4, immediate: 3, delayed: 2, fluency: 9 },
    { d: 2, orientation: 4, immediate: 3, delayed: 2, fluency: 10 },
  ];
  const max: Record<string, number | null> = { orientation: 5, immediate: 5, delayed: 5, fluency: null };
  for (const [i, a] of acts.entries()) {
    const sid = `demo-act-${i + 1}`;
    const start = pastIso(now, a.d, "11:00");
    await repo.save("session", {
      id: sid, elder_id: DEMO_ELDER_ID, mode: "memory_activity", started_at: start, ended_at: start, stage_at_session: 4,
      language: "hi-IN", topics: [], feedback_mood: null, feedback_keep: [], feedback_avoid: [], feedback_notes: null,
    });
    for (const task of ["orientation", "immediate", "delayed", "fluency"] as const) {
      await repo.save("activity_score", { id: `${sid}-${task}`, session_id: sid, task, score: a[task], max_score: max[task] });
    }
  }

  await repo.save("consent", {
    id: "demo-consent", subject_type: "elder", subject_id: DEMO_ELDER_ID, given_by: "guardian", method: "digital",
    scope_store: 1, scope_sync: 0, scope_audio_cloud: 1, scope_contact_share: 0, scope_research_aggregate: 0,
    language: "hi", recorded_at: new Date(now - 30 * DAY).toISOString(),
  });

  await repo.backend.setMeta("pin_hash", await hashPin(DEMO_PIN, pinIterations));
  await repo.backend.setMeta(`distress:${DEMO_ELDER_ID}`, []);
  repo.changed();
}

const TABLES: Table[] = ["elder", "medicine", "dose_event", "session", "activity_score", "safety_event", "consent"];

/** True for any row that belongs to the demo elder, directly or through a parent. */
function belongs(table: Table, row: Record<string, unknown>, sessions: Set<string>): boolean {
  if (isDemoId(row.id)) return true;
  switch (table) {
    case "dose_event": return isDemoId(row.medicine_id);
    case "session": case "safety_event": return isDemoId(row.elder_id);
    case "activity_score": return isDemoId(row.session_id) || sessions.has(row.session_id as string);
    case "consent": return isDemoId(row.subject_id);
    default: return false;
  }
}

/** Remove every demo row (and rows made while trying the demo) from this device. */
export async function clearDemo(repo: Repo): Promise<number> {
  const demoSessions = new Set(
    (await repo.backend.all("session")).filter((s) => isDemoId(s.elder_id) || isDemoId(s.id)).map((s) => s.id),
  );
  await repo.backend.setMeta("demo", false);
  await repo.backend.setMeta("demo_cleared", true);
  let n = 0;
  for (const t of TABLES) {
    const ids = (await repo.backend.all(t)).filter((r) => belongs(t, r, demoSessions)).map((r) => r.id);
    await repo.purge(t, ids);
    n += ids.length;
  }
  for (const k of ["pin_hash", `distress:${DEMO_ELDER_ID}`, `photo:${DEMO_ELDER_ID}`, "elder_mode_session"]) await repo.backend.setMeta(k, null);
  repo.changed();
  return n;
}

/** Hosted demo build: load the demo on first open, unless the visitor cleared it. */
export async function autoLoadDemo(repo: Repo, enabled = DEMO_BUILD): Promise<boolean> {
  if (!enabled) return false;
  if ((await repo.backend.getMeta<boolean>("demo_cleared")) === true) return false;
  if ((await repo.list("elder")).length) return false;
  await loadDemo(repo);
  return true;
}

/**
 * Whether a call/WhatsApp link may be opened. In demo mode nothing is dialled:
 * the screen shows what would happen instead.
 */
export type Dial = { kind: "open"; href: string } | { kind: "preview"; href: string; label: string };
export function dialAction(href: string, demo: boolean): Dial {
  if (!demo) return { kind: "open", href };
  const label = href.startsWith("tel:") ? `📞 ${href.slice(4)}` : href.startsWith("https://wa.me/") ? `💬 wa.me/${href.slice(14).split("?")[0]}` : href;
  return { kind: "preview", href, label };
}
