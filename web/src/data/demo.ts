// Demo mode: seven clearly synthetic residents (see demoGen.ts) with contacts, medicines,
// dose history, sessions, activity scores and one incident, so every screen has something to show.
// In the browser the demo lives in its own IndexedDB database (see demoMode.ts).
// Demo rows never sync, never dial a real number, and are removed without a trace
// by clearDemo(). Every value here is made up; none comes from a real person.

import type { Repo, Table } from "./repo.ts";
import { hashPin } from "../core/pin.ts";
import { generateDemo } from "./demoGen.ts";

export const DEMO_PIN = "1234";
export const DEMO_PREFIX = "demo-";
export const DEMO_ELDER_ID = "demo-elder";
export const isDemoId = (id: unknown) => typeof id === "string" && id.startsWith(DEMO_PREFIX);

export async function isDemo(repo: Repo): Promise<boolean> {
  return (await repo.backend.getMeta<boolean>("demo")) === true;
}

/** Build-time switch: the hosted demo opens straight into demo mode. */
export const DEMO_BUILD: boolean = (() => {
  try { return (import.meta as unknown as { env?: { VITE_DEMO?: string } }).env?.VITE_DEMO === "1"; } catch { return false; }
})();

export async function loadDemo(repo: Repo, now: number = Date.now(), pinIterations?: number): Promise<void> {
  // Flags first, so the first reload after a save already sees demo mode.
  await repo.backend.setMeta("demo", true);
  await repo.backend.setMeta("demo_cleared", false);
  const g = generateDemo(now);
  for (const t of ["elder", "consent", "medicine", "dose_event", "session", "activity_score", "safety_event"] as const) {
    for (const row of g[t]) await repo.save(t, row as { id: string });
  }
  await repo.backend.setMeta("demo_conversations", g.conversations);
  await repo.backend.setMeta("active_elder", DEMO_ELDER_ID);
  await repo.backend.setMeta("pin_hash", await hashPin(DEMO_PIN, pinIterations));
  for (const e of g.elder) await repo.backend.setMeta(`distress:${e.id}`, []);
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
  const demoElders = (await repo.backend.all("elder")).map((e) => e.id).filter(isDemoId);
  await repo.backend.setMeta("demo", false);
  await repo.backend.setMeta("demo_cleared", true);
  let n = 0;
  for (const t of TABLES) {
    const ids = (await repo.backend.all(t)).filter((r) => belongs(t, r, demoSessions)).map((r) => r.id);
    await repo.purge(t, ids);
    n += ids.length;
  }
  for (const k of ["pin_hash", "elder_mode_session", "demo_conversations", "active_elder"]) await repo.backend.setMeta(k, null);
  for (const id of demoElders) for (const k of [`distress:${id}`, `photo:${id}`]) await repo.backend.setMeta(k, null);
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

/** "+919000000001" -> "+91 9XXXX XXX01 (demo)": the demo numbers are fictional, and look it. */
export function maskNumber(n: string): string {
  const d = n.replace(/[^\d+]/g, "");
  const tail = d.slice(-2);
  return d.startsWith("+91") && d.length === 13 ? `+91 ${d[3]}XXXX XXX${tail} (demo)` : `${d.slice(0, 2)}${"X".repeat(Math.max(0, d.length - 4))}${tail} (demo)`;
}

export function dialAction(href: string, demo: boolean): Dial {
  if (!demo) return { kind: "open", href };
  if (href.startsWith("tel:")) return { kind: "preview", href, label: maskNumber(href.slice(4)) };
  if (href.startsWith("https://wa.me/")) return { kind: "preview", href, label: `wa.me/${maskNumber("+" + href.slice(14).split("?")[0])}` };
  return { kind: "preview", href, label: href };
}
