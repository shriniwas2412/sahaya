// HTTP API (Hono). Mounted under /api.
//   POST /auth/register  {name, email, password}      -> sets cookie
//   POST /auth/login     {email, password}            -> sets cookie
//   POST /auth/logout
//   GET  /auth/me
//   POST /sync           {since, rows: [{table,row}]}  -> {rows, cursor, more, rejected}
//   GET  /push/key       -> VAPID public key (or null)
//   POST /push/subscribe <PushSubscription JSON>
//   POST /notify         {elder_id, text}              -> push to the caregiver's devices
//   POST /tts/sarvam     {text, target_language_code, …} -> Sarvam TTS with the server's key (optional)

import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "./env.ts";
import { hashPassword, verifyPassword, validPassword } from "./lib/password.ts";
import { signJwt, verifyJwt, type Claims } from "./lib/jwt.ts";
import { pushChanges, pullChanges, exportOwner, deleteOwner } from "./sync.ts";
import { sendPush, type PushSubscriptionJson } from "./lib/webpush.ts";
import { ulid } from "../../web/src/core/ids.ts";
import { LIMITS, limitKey, overLimit, record, clear } from "./lib/rateLimit.ts";

const ipOf = (c: C) => c.req.header("cf-connecting-ip") ?? "unknown";
const tooMany = (c: C) => c.json({ error: "too_many" }, 429);

// Web Push services browsers actually use: anything else is refused.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];
export const MAX_SUBS_PER_USER = 5;
export function allowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
}

type Vars = { user: Claims };
type C = Context<{ Bindings: Env; Variables: Vars }>;

export const COOKIE = "sahaya_session";
const SESSION_DAYS = 30;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Vars }>().basePath("/api");

  // CORS for the configured web origin only, and an Origin check on writes (CSRF).
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    const allowed = c.env.APP_ORIGIN;
    if (c.req.method !== "GET" && origin && allowed && origin !== allowed) return c.json({ error: "origin" }, 403);
    if (c.req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(allowed, origin) });
    }
    await next();
    for (const [k, v] of Object.entries(corsHeaders(allowed, origin))) c.res.headers.set(k, v);
  });

  const session = async (c: C, user: { id: string; role: string }) => {
    const token = await signJwt({ sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400 }, c.env.JWT_SECRET);
    setCookie(c, COOKIE, token, {
      httpOnly: true, secure: c.env.INSECURE_COOKIE !== "1", sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 86400,
    });
  };

  app.post("/auth/register", async (c) => {
    const b = await c.req.json<{ name?: string; email?: string; password?: string }>().catch(() => ({} as Record<string, string>));
    const name = String(b.name ?? "").trim().slice(0, 120);
    const email = String(b.email ?? "").trim().toLowerCase();
    const ipKey = await limitKey(c.env.JWT_SECRET, "register-ip", ipOf(c));
    if (await overLimit(c.env.DB, ipKey, LIMITS.registerPerIp)) return tooMany(c);
    await record(c.env.DB, ipKey);
    if (!name || !EMAIL.test(email) || !validPassword(b.password)) return c.json({ error: "invalid" }, 400);
    const exists = await c.env.DB.prepare("SELECT id FROM app_user WHERE email = ?").bind(email).first();
    if (exists) return c.json({ error: "exists" }, 409);
    const id = ulid();
    const now = new Date().toISOString();
    // Self sign-up is always a caregiver; admin and field_worker roles are set by an admin.
    await c.env.DB.prepare("INSERT INTO app_user (id, hlc, role, name, email, password_hash, created_at) VALUES (?, ?, 'caregiver', ?, ?, ?, ?)")
      .bind(id, now, name, email, await hashPassword(b.password!), now).run();
    await session(c, { id, role: "caregiver" });
    return c.json({ id, name, email, role: "caregiver" }, 201);
  });

  app.post("/auth/login", async (c) => {
    const b = await c.req.json<{ email?: string; password?: string }>().catch(() => ({} as Record<string, string>));
    const email = String(b.email ?? "").trim().toLowerCase();
    // Checked before any password work, so a flood costs no PBKDF2 time.
    const emailKey = await limitKey(c.env.JWT_SECRET, "login-email", email);
    const ipKey = await limitKey(c.env.JWT_SECRET, "login-ip", ipOf(c));
    if (await overLimit(c.env.DB, emailKey, LIMITS.loginFailPerEmail) || await overLimit(c.env.DB, ipKey, LIMITS.loginPerIp)) return tooMany(c);
    await record(c.env.DB, ipKey);
    const u = await c.env.DB.prepare("SELECT id, name, email, role, password_hash FROM app_user WHERE email = ? AND deleted = 0")
      .bind(email).first<{ id: string; name: string; email: string; role: string; password_hash: string }>();
    // Same work and the same answer whether or not the email exists.
    const ok = await verifyPassword(String(b.password ?? ""), u?.password_hash ?? "pbkdf2_sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    if (!u || !ok) {
      await record(c.env.DB, emailKey);
      return c.json({ error: "credentials" }, 401);
    }
    await clear(c.env.DB, emailKey);
    await session(c, u);
    return c.json({ id: u.id, name: u.name, email: u.email, role: u.role });
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // Everything below needs a session.
  app.use("*", async (c, next) => {
    const claims = await verifyJwt(getCookie(c, COOKIE), c.env.JWT_SECRET);
    if (!claims) return c.json({ error: "auth" }, 401);
    // A deleted account's cookie must not keep working until it expires.
    const alive = await c.env.DB.prepare("SELECT 1 AS x FROM app_user WHERE id = ? AND deleted = 0").bind(claims.sub).first();
    if (!alive) return c.json({ error: "auth" }, 401);
    c.set("user", claims);
    await next();
  });

  app.get("/auth/me", async (c) => {
    const u = await c.env.DB.prepare("SELECT id, name, email, role FROM app_user WHERE id = ? AND deleted = 0").bind(c.get("user").sub).first();
    return u ? c.json(u) : c.json({ error: "auth" }, 401);
  });

  app.post("/sync", async (c) => {
    const b = await c.req.json<{ since?: string; rows?: unknown[] }>().catch(() => null);
    if (!b || !Array.isArray(b.rows ?? [])) return c.json({ error: "invalid" }, 400);
    const owner = c.get("user").sub;
    const pushed = await pushChanges(c.env.DB, owner, (b.rows ?? []) as never[]);
    const pulled = await pullChanges(c.env.DB, owner, typeof b.since === "string" ? b.since : "");
    return c.json({ ...pulled, accepted: pushed.accepted, rejected: pushed.rejected });
  });

  app.get("/account/export", async (c) => {
    const owner = c.get("user").sub;
    const account = await c.env.DB.prepare("SELECT id, name, email, role, created_at FROM app_user WHERE id = ?").bind(owner).first();
    const subs = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM push_sub WHERE user_id = ?").bind(owner).first<{ n: number }>();
    return c.json({ app: "sahaya", exported_at: new Date().toISOString(), account, push_subscriptions: subs?.n ?? 0, tables: await exportOwner(c.env.DB, owner) });
  });

  app.post("/account/delete", async (c) => {
    const b = await c.req.json<{ confirm?: string }>().catch(() => ({} as Record<string, string>));
    if (b.confirm !== "DELETE") return c.json({ error: "confirm" }, 400);
    const rows = await deleteOwner(c.env.DB, c.get("user").sub);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true, rows });
  });

  app.get("/push/key", (c) => c.json({ key: c.env.VAPID_PUBLIC_KEY ?? null }));

  app.post("/push/subscribe", async (c) => {
    const s = await c.req.json<PushSubscriptionJson>().catch(() => null);
    if (!s || typeof s.endpoint !== "string" || !allowedPushEndpoint(s.endpoint) || s.endpoint.length > 1000
      || typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string" || s.keys.p256dh.length > 200 || s.keys.auth.length > 100) {
      return c.json({ error: "invalid" }, 400);
    }
    const user = c.get("user").sub;
    await c.env.DB.prepare("DELETE FROM push_sub WHERE endpoint = ?").bind(s.endpoint).run();
    await c.env.DB.prepare("INSERT INTO push_sub (id, user_id, endpoint, keys, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ulid(), user, s.endpoint, JSON.stringify({ p256dh: s.keys.p256dh, auth: s.keys.auth }), new Date().toISOString()).run();
    // Keep only the newest few per account.
    await c.env.DB.prepare(`DELETE FROM push_sub WHERE user_id = ? AND id NOT IN
      (SELECT id FROM push_sub WHERE user_id = ? ORDER BY id DESC LIMIT ?)`).bind(user, user, MAX_SUBS_PER_USER).run();
    return c.json({ ok: true }, 201);
  });

  app.post("/notify", async (c) => {
    const b = await c.req.json<{ elder_id?: string; text?: string }>().catch(() => ({} as Record<string, string>));
    const owner = c.get("user").sub;
    const nKey = await limitKey(c.env.JWT_SECRET, "notify-user", owner);
    if (await overLimit(c.env.DB, nKey, LIMITS.notifyPerUser)) return tooMany(c);
    await record(c.env.DB, nKey);
    const meta = await c.env.DB.prepare("SELECT owner FROM sync_meta WHERE tbl = 'elder' AND id = ?").bind(String(b.elder_id ?? "")).first<{ owner: string }>();
    if (!meta || meta.owner !== owner) return c.json({ error: "not found" }, 404);
    const sent = await pushToUser(c.env, owner, { title: "Sahaya", body: String(b.text ?? "").slice(0, 300), tag: `help:${b.elder_id}`, urgent: true });
    return c.json({ sent });
  });

  // Optional natural voice with a key held by the server (SARVAM_API_KEY), so phones
  // never see it. Signed-in users only, rate-limited, short text, fixed upstream URL.
  app.post("/tts/sarvam", async (c) => {
    const key = c.env.SARVAM_API_KEY;
    if (!key) return c.json({ error: "not_configured" }, 404);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const text = typeof b.text === "string" ? b.text.slice(0, 500) : "";
    const lang = typeof b.target_language_code === "string" && /^[a-z]{2}-IN$/.test(b.target_language_code) ? b.target_language_code : "";
    if (!text || !lang) return c.json({ error: "bad_request" }, 400);
    const k = await limitKey(c.env.JWT_SECRET, "tts-user", c.get("user").sub);
    if (await overLimit(c.env.DB, k, LIMITS.ttsPerUser)) return tooMany(c);
    await record(c.env.DB, k);
    const pace = typeof b.pace === "number" && b.pace >= 0.5 && b.pace <= 2 ? b.pace : 0.9;
    const speaker = typeof b.speaker === "string" && /^[a-z]{2,20}$/.test(b.speaker) ? b.speaker : "anushka";
    const up = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST", headers: { "content-type": "application/json", "api-subscription-key": key },
      body: JSON.stringify({ text, target_language_code: lang, speaker, model: "bulbul:v2", pace, speech_sample_rate: 22050 }),
    }).catch(() => null);
    if (!up || !up.ok) return c.json({ error: "upstream", status: up?.status ?? 0 }, 502);
    const body = (await up.json().catch(() => ({}))) as { audios?: string[] };
    return c.json({ audios: Array.isArray(body.audios) ? body.audios.slice(0, 1) : [] });
  });

  return app;
}

function corsHeaders(allowed: string | undefined, origin: string | undefined): Record<string, string> {
  if (!allowed || origin !== allowed) return {};
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "origin",
  };
}

/** Push to every subscription of a user; drops subscriptions the push service says are gone. */
export async function pushToUser(env: Env, userId: string, msg: Parameters<typeof sendPush>[1], f?: Parameters<typeof sendPush>[3]): Promise<number> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return 0;
  const vapid = { subject: env.VAPID_SUBJECT ?? "mailto:admin@example.invalid", publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  const subs = (await env.DB.prepare("SELECT id, endpoint, keys FROM push_sub WHERE user_id = ?").bind(userId).all<{ id: string; endpoint: string; keys: string }>()).results;
  let sent = 0;
  for (const s of subs) {
    try {
      const status = await sendPush({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, msg, vapid, f);
      if (status === 404 || status === 410) await env.DB.prepare("DELETE FROM push_sub WHERE id = ?").bind(s.id).run();
      else if (status < 300) sent++;
    } catch { /* one bad subscription must not stop the others */ }
  }
  return sent;
}
