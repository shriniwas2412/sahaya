// Caregiver weekly summary: counts of stored rows over the last 7 local days.
// Nothing is estimated or filled in: no rows means zeros and "not recorded".

const DAY = 86_400_000;

interface DoseLike { scheduled_at: string; status: string }
interface SessionLike { id?: string; mode: string; started_at: string | null; ended_at: string | null; feedback_mood: number | null }
interface SafetyLike { id: string; session_id: string | null; at: string }

export interface DaySummary { day: string; taken: number; missed: number }
export interface WeekSummary {
  days: DaySummary[];
  taken: number; missed: number; escalated: number; skipped: number;
  sessions: number; minutes: number;
  mood: number | null; moodCount: number;
  incidents: number;
  empty: boolean;
}

const localDay = (ms: number, tz: number) => new Date(ms + tz * 60_000).toISOString().slice(0, 10);

/** Safety events of one incident: same session (or none), each within 10 min of the previous. */
export const INCIDENT_GAP_MS = 10 * 60_000;

export function weekSummary(
  rows: { doses: DoseLike[]; sessions: SessionLike[]; safety: SafetyLike[] },
  now: number,
  tzOffsetMin: number,
): WeekSummary {
  const days: DaySummary[] = Array.from({ length: 7 }, (_, i) => ({ day: localDay(now - (6 - i) * DAY, tzOffsetMin), taken: 0, missed: 0 }));
  const inWindow = (iso: string | null | undefined) => {
    if (!iso) return null;
    const ms = Date.parse(iso);
    if (!(ms <= now)) return null;
    return days.find((d) => d.day === localDay(ms, tzOffsetMin)) ?? null;
  };
  const s: WeekSummary = { days, taken: 0, missed: 0, escalated: 0, skipped: 0, sessions: 0, minutes: 0, mood: null, moodCount: 0, incidents: 0, empty: true };

  for (const d of rows.doses) {
    const day = inWindow(d.scheduled_at);
    if (!day) continue;
    if (d.status === "taken") { s.taken++; day.taken++; }
    else if (d.status === "missed") { s.missed++; day.missed++; }
    else if (d.status === "escalated") { s.escalated++; day.missed++; }
    else if (d.status === "skipped") s.skipped++;
  }

  let moodSum = 0;
  for (const x of rows.sessions) {
    if (x.mode !== "companion" || !inWindow(x.started_at)) continue;
    s.sessions++;
    if (x.ended_at) s.minutes += Math.max(0, Math.round((Date.parse(x.ended_at) - Date.parse(x.started_at!)) / 60_000));
    if (typeof x.feedback_mood === "number") { moodSum += x.feedback_mood; s.moodCount++; }
  }
  s.mood = s.moodCount ? Math.round((moodSum / s.moodCount) * 10) / 10 : null;

  const events = rows.safety.filter((e) => inWindow(e.at)).sort((a, b) => a.at.localeCompare(b.at));
  const last = new Map<string, number>();
  for (const e of events) {
    const key = e.session_id ?? `none:${e.id}`;
    const at = Date.parse(e.at);
    const prev = last.get(key);
    if (prev === undefined || at - prev > INCIDENT_GAP_MS) s.incidents++;
    last.set(key, at);
  }

  s.empty = !(s.taken || s.missed || s.escalated || s.skipped || s.sessions || s.incidents);
  return s;
}

/** Plain text for "Share on WhatsApp" and print: counts only. */
export function summaryText(s: WeekSummary, name: string, lang: "hi" | "en"): string {
  const mood = s.mood === null ? (lang === "hi" ? "दर्ज नहीं" : "not recorded") : `${s.mood}/5`;
  return lang === "hi"
    ? `सहाया, ${name} के पिछले 7 दिन: दवा ली ${s.taken}, पुष्टि नहीं ${s.missed + s.escalated} (सूचना भेजी ${s.escalated}); बातचीत ${s.sessions} (${s.minutes} मिनट); औसत मूड ${mood}; सुरक्षा सूचनाएँ ${s.incidents}।`
    : `Sahaya, last 7 days for ${name}: medicines taken ${s.taken}, not confirmed ${s.missed + s.escalated} (caregiver alerted ${s.escalated}); sessions ${s.sessions} (${s.minutes} min); average mood ${mood}; safety alerts ${s.incidents}.`;
}

/** Safety events grouped into incidents (same rule as the summary), newest incident first. */
export function groupIncidents<T extends SafetyLike>(events: T[]): T[][] {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const open = new Map<string, T[]>();
  const out: T[][] = [];
  for (const e of sorted) {
    const key = e.session_id ?? `none:${e.id}`;
    const cur = open.get(key);
    if (cur && Date.parse(e.at) - Date.parse(cur[cur.length - 1].at) <= INCIDENT_GAP_MS) cur.push(e);
    else { const g = [e]; open.set(key, g); out.push(g); }
  }
  return out.reverse();
}
