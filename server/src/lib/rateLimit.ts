// Fixed-window counters in D1 (table auth_attempt). Keys are HMAC-SHA256 of the email,
// IP or user id with the server secret, so no raw email or IP is stored.

import type { D1Database } from "../env.ts";
import { b64url, utf8 } from "./b64.ts";

export interface Limit { max: number; windowMs: number }
export const LIMITS = {
  loginFailPerEmail: { max: 5, windowMs: 15 * 60_000 },
  loginPerIp: { max: 30, windowMs: 15 * 60_000 },
  registerPerIp: { max: 5, windowMs: 60 * 60_000 },
  notifyPerUser: { max: 10, windowMs: 60 * 60_000 },
} satisfies Record<string, Limit>;

export async function limitKey(secret: string, kind: string, value: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", utf8(secret) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${kind}:${b64url(await crypto.subtle.sign("HMAC", k, utf8(value.toLowerCase()) as BufferSource)).slice(0, 32)}`;
}

export async function overLimit(db: D1Database, key: string, l: Limit, now = Date.now()): Promise<boolean> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM auth_attempt WHERE key = ? AND at > ?").bind(key, now - l.windowMs).first<{ n: number }>();
  return (r?.n ?? 0) >= l.max;
}

export async function record(db: D1Database, key: string, now = Date.now()): Promise<void> {
  await db.prepare("INSERT INTO auth_attempt (key, at) VALUES (?, ?)").bind(key, now).run();
}

export async function clear(db: D1Database, key: string): Promise<void> {
  await db.prepare("DELETE FROM auth_attempt WHERE key = ?").bind(key).run();
}

/** Drop counters older than a day (called from the cron). */
export async function prune(db: D1Database, now = Date.now()): Promise<void> {
  await db.prepare("DELETE FROM auth_attempt WHERE at < ?").bind(now - 86_400_000).run();
}
