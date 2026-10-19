import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, COOKIE } from "../src/app.ts";
import { runCron } from "../src/cron.ts";
import { testDb } from "./d1.ts";
import { hashPassword, verifyPassword } from "../src/lib/password.ts";
import { signJwt, verifyJwt } from "../src/lib/jwt.ts";
import { b64url } from "../src/lib/b64.ts";
import { stamp, type Versioned } from "../../web/src/core/sync.ts";
import type { Env } from "../src/env.ts";

const app = createApp();
const SECRET = "test-secret-not-real-0123456789abcdef";

function env(over: Partial<Env> = {}): Env {
  return { DB: testDb(), JWT_SECRET: SECRET, INSECURE_COOKIE: "1", ...over };
}

async function call(e: Env, path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin) headers.origin = init.origin;
  const res = await app.request(`/api${path}`, { method: init.method ?? (init.body ? "POST" : "GET"), headers, body: init.body ? JSON.stringify(init.body) : undefined }, e);
  const set = res.headers.get("set-cookie") ?? "";
  const cookie = set.split(";")[0];
  return { status: res.status, json: await res.json().catch(() => null), cookie, set };
}

async function signedUp(e: Env, email = "caregiver1@example.test") {
  const r = await call(e, "/auth/register", { body: { name: "Test Caregiver 1", email, password: "correct horse 1" } });
  assert.equal(r.status, 201);
  return r.cookie;
}

test("password hash: right password verifies, wrong does not, hash is salted", async () => {
  const h = await hashPassword("correct horse 1", 1000);
  assert.ok(await verifyPassword("correct horse 1", h));
  assert.ok(!(await verifyPassword("correct horse 2", h)));
  assert.notEqual(await hashPassword("correct horse 1", 1000), h);
});

test("jwt: verifies, rejects tampering, rejects expiry and alg none", async () => {
  const t = await signJwt({ sub: "u1", role: "caregiver", exp: 2000 }, SECRET);
  assert.equal((await verifyJwt(t, SECRET, 1000_000))?.sub, "u1");
  assert.equal(await verifyJwt(t, SECRET, 3000_000), null);
  assert.equal(await verifyJwt(t, "other-secret", 1000_000), null);
  const [, body, sig] = t.split(".");
  const none = b64url(new TextEncoder().encode(JSON.stringify({ alg: "none" })));
  assert.equal(await verifyJwt(`${none}.${body}.${sig}`, SECRET, 1000_000), null);
});

test("register sets an httpOnly cookie; me works; duplicate email is refused", async () => {
  const e = env();
  const r = await call(e, "/auth/register", { body: { name: "Test Caregiver 1", email: "Caregiver1@Example.test", password: "correct horse 1" } });
  assert.equal(r.status, 201);
  assert.match(r.set, /HttpOnly/i);
  assert.match(r.set, /SameSite=Lax/i);
  assert.equal(r.json.role, "caregiver");
  const me = await call(e, "/auth/me", { cookie: r.cookie });
  assert.equal(me.json.email, "caregiver1@example.test");
  assert.equal((await call(e, "/auth/register", { body: { name: "X", email: "caregiver1@example.test", password: "correct horse 1" } })).status, 409);
});

test("register refuses bad input; nobody can self-register as admin", async () => {
  const e = env();
  assert.equal((await call(e, "/auth/register", { body: { name: "A", email: "nope", password: "correct horse 1" } })).status, 400);
  assert.equal((await call(e, "/auth/register", { body: { name: "A", email: "a@example.test", password: "short" } })).status, 400);
  const r = await call(e, "/auth/register", { body: { name: "A", email: "a@example.test", password: "correct horse 1", role: "admin" } });
  assert.equal(r.json.role, "caregiver");
});

test("login: right password works; wrong password and unknown email give the same 401", async () => {
  const e = env();
  await signedUp(e);
  assert.equal((await call(e, "/auth/login", { body: { email: "caregiver1@example.test", password: "correct horse 1" } })).status, 200);
  const wrong = await call(e, "/auth/login", { body: { email: "caregiver1@example.test", password: "wrong horse 1" } });
  const unknown = await call(e, "/auth/login", { body: { email: "nobody@example.test", password: "wrong horse 1" } });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.json, unknown.json);
});

test("protected routes need a session; writes from another origin are refused", async () => {
  const e = env({ APP_ORIGIN: "https://app.example.test" });
  assert.equal((await call(e, "/sync", { body: { rows: [] } })).status, 401);
  assert.equal((await call(e, "/auth/login", { body: {}, origin: "https://evil.example.test" })).status, 403);
});

const S = (wall: number, node = "dev1") => `${String(wall).padStart(15, "0")}:00000:${node}`;
const elderRow = (over: Record<string, unknown> = {}, ts = S(1)) =>
  stamp(null, { id: "e1", display_name: "Test Elder 1", gds_stage: 4, language: "hi-IN", preferences: ["bhajan"], family_contacts: [], persona_name: "Sahaya", ...over } as Versioned, ts);

test("sync: push then pull returns the row with JSON columns intact", async () => {
  const e = env();
  const cookie = await signedUp(e);
  const r = await call(e, "/sync", { cookie, body: { since: "", rows: [{ table: "elder", row: elderRow() }] } });
  assert.equal(r.status, 200);
  assert.equal(r.json.accepted, 1);
  const row = r.json.rows.find((x: { table: string }) => x.table === "elder").row;
  assert.deepEqual(row.preferences, ["bhajan"]);
  assert.equal(row.gds_stage, 4);
  const again = await call(e, "/sync", { cookie, body: { since: r.json.cursor, rows: [] } });
  assert.deepEqual(again.json.rows, []);
});

test("sync: concurrent edits from two devices merge field by field", async () => {
  const e = env();
  const cookie = await signedUp(e);
  await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow() }] } });
  const a = stamp(elderRow(), { ...elderRow(), dialect: "Bundeli" }, S(5, "devA"));
  const b = stamp(elderRow(), { ...elderRow(), notes: "Likes bhajans" }, S(6, "devB"));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: a }] } });
  const r = await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: b }] } });
  const row = r.json.rows.find((x: { table: string }) => x.table === "elder").row;
  assert.equal(row.dialect, "Bundeli");
  assert.equal(row.notes, "Likes bhajans");
});

test("sync: a slow-clock device's write is still pulled by a device that synced later", async () => {
  const e = env();
  const cookie = await signedUp(e);
  const first = await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow({}, S(9_000_000_000)) }] } });
  const late = stamp(null, { id: "m1", elder_id: "e1", name: "Test Tablet A", times: ["08:00"] } as Versioned, S(1, "slow"));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "medicine", row: late }] } });
  const r = await call(e, "/sync", { cookie, body: { since: first.json.cursor, rows: [] } });
  assert.deepEqual(r.json.rows.map((x: { table: string }) => x.table), ["medicine"]);
});

test("sync: another account cannot read or overwrite my rows; unknown tables and columns are dropped", async () => {
  const e = env();
  const mine = await signedUp(e, "one@example.test");
  const theirs = await signedUp(e, "two@example.test");
  await call(e, "/sync", { cookie: mine, body: { rows: [{ table: "elder", row: elderRow() }] } });
  const steal = await call(e, "/sync", { cookie: theirs, body: { rows: [
    { table: "elder", row: stamp(elderRow(), { ...elderRow(), display_name: "Hacked" }, S(99)) },
    { table: "app_user", row: { id: "x", _v: {} } },
  ] } });
  assert.deepEqual(steal.json.rejected.map((r: { reason: string }) => r.reason), ["forbidden", "unknown"]);
  assert.deepEqual(steal.json.rows, []);
  const evil = stamp(null, { id: "m2", elder_id: "e1", name: "Test Tablet B", times: [], "name) VALUES (1);--": "x" } as Versioned, S(3));
  const ok = await call(e, "/sync", { cookie: mine, body: { rows: [{ table: "medicine", row: evil }] } });
  assert.equal(ok.json.accepted, 1);
  const me = await call(e, "/sync", { cookie: mine, body: { rows: [] } });
  assert.equal(me.json.rows.find((x: { row: { display_name?: string } }) => x.row.display_name)?.row.display_name, "Test Elder 1");
});

test("cron: creates and marks a dose due, then escalates it once when unconfirmed", async () => {
  const e = env({ VAPID_PUBLIC_KEY: undefined });
  const cookie = await signedUp(e);
  const med = stamp(null, { id: "m1", elder_id: "e1", name: "Test Tablet A", times: ["08:00"], escalate_after_min: 30, active: 1 } as Versioned, S(2));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow() }, { table: "medicine", row: med }] } });
  const at = (iso: string) => Date.parse(iso);
  const r1 = await runCron(e, at("2026-10-20T02:35:00Z")); // 08:05 IST
  assert.deepEqual(r1, { due: 1, missed: 0, pushes: 0 });
  const r2 = await runCron(e, at("2026-10-20T02:40:00Z"));
  assert.deepEqual(r2, { due: 0, missed: 0, pushes: 0 });
  const r3 = await runCron(e, at("2026-10-20T03:05:00Z")); // 08:35 IST, past 30 min
  assert.deepEqual(r3, { due: 0, missed: 1, pushes: 0 });
  const r4 = await runCron(e, at("2026-10-20T03:10:00Z"));
  assert.deepEqual(r4, { due: 0, missed: 0, pushes: 0 });
  const pull = await call(e, "/sync", { cookie, body: { rows: [] } });
  const dose = pull.json.rows.find((x: { table: string }) => x.table === "dose_event").row;
  assert.equal(dose.status, "escalated");
  const ev = pull.json.rows.find((x: { table: string }) => x.table === "safety_event").row;
  assert.equal(ev.trigger, "missed_dose");
});

test("cron: a dose the elder confirmed is never escalated", async () => {
  const e = env();
  const cookie = await signedUp(e);
  const med = stamp(null, { id: "m1", elder_id: "e1", name: "Test Tablet A", times: ["08:00"], escalate_after_min: 30, active: 1 } as Versioned, S(2));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow() }, { table: "medicine", row: med }] } });
  await runCron(e, Date.parse("2026-10-20T02:35:00Z"));
  const taken = stamp(null, { id: "dose:m1:2026-10-20T08:00", medicine_id: "m1", scheduled_at: "2026-10-20T02:30:00.000Z", status: "taken" } as Versioned, S(Date.parse("2026-10-20T02:36:00Z"), "elderphone"));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "dose_event", row: taken }] } });
  assert.deepEqual(await runCron(e, Date.parse("2026-10-20T03:30:00Z")), { due: 0, missed: 0, pushes: 0 });
});

test("cron pushes to the caregiver's subscriptions and drops gone ones", async () => {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
  const pub = b64url(await crypto.subtle.exportKey("raw", kp.publicKey));
  const priv = (await crypto.subtle.exportKey("jwk", kp.privateKey)).d!;
  const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const p256dh = b64url(await crypto.subtle.exportKey("raw", ua.publicKey));
  const e = env({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: "mailto:test@example.test" });
  const cookie = await signedUp(e);
  for (const endpoint of ["https://push.example.test/ok", "https://push.example.test/gone"]) {
    assert.equal((await call(e, "/push/subscribe", { cookie, body: { endpoint, keys: { p256dh, auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } } })).status, 201);
  }
  const med = stamp(null, { id: "m1", elder_id: "e1", name: "Test Tablet A", times: ["08:00"], active: 1 } as Versioned, S(2));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow() }, { table: "medicine", row: med }] } });
  const hits: string[] = [];
  const r = await runCron(e, Date.parse("2026-10-20T02:35:00Z"), async (url) => { hits.push(url); return { status: url.endsWith("gone") ? 410 : 201 }; });
  assert.equal(r.pushes, 1);
  assert.equal(hits.length, 2);
  const left = await e.DB.prepare("SELECT endpoint FROM push_sub").all<{ endpoint: string }>();
  assert.deepEqual(left.results.map((x) => x.endpoint), ["https://push.example.test/ok"]);
});

test("sync: editing an elder that already has medicines works with foreign keys on", async () => {
  const e = env();
  const cookie = await signedUp(e);
  const med = stamp(null, { id: "m1", elder_id: "e1", name: "Test Tablet A", times: ["08:00"] } as Versioned, S(2));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow() }, { table: "medicine", row: med }] } });
  const edit = stamp(elderRow(), { ...elderRow(), dialect: "Malwi" }, S(10));
  const r = await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: edit }] } });
  assert.deepEqual(r.json.rejected, []);
  assert.equal(r.json.rows.find((x: { table: string }) => x.table === "elder").row.dialect, "Malwi");
  assert.ok(r.json.rows.some((x: { table: string }) => x.table === "medicine"));
});
