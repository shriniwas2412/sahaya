import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, COOKIE } from "../src/app.ts";
import { runCron, MAX_PUSHES_PER_OWNER } from "../src/cron.ts";
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

/** Record sync consent for elder e1 on the server (rows about an elder need it). */
async function consented(e: Env, cookie: string, subject = "e1") {
  const r = await call(e, "/sync", { cookie, body: { rows: [{ table: "consent", row: consentRow(subject) }] } });
  assert.deepEqual(r.json.rejected, []);
}

/** A consent row for an elder; scope_sync defaults to 1 (sync allowed). */
const consentRow = (subject = "e1", over: Record<string, unknown> = {}, ts = S(1)) =>
  stamp(null, { id: `c-${subject}`, subject_type: "elder", subject_id: subject, given_by: "guardian", method: "digital",
    scope_store: 1, scope_sync: 1, recorded_at: "2026-10-01T00:00:00.000Z", ...over } as Versioned, ts);

test("sync: push then pull returns the row with JSON columns intact", async () => {
  const e = env();
  const cookie = await signedUp(e);
  await consented(e, cookie);
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
  await consented(e, cookie);
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
  await consented(e, cookie);
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
  await consented(e, mine);
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
  await consented(e, cookie);
  const med = stamp(null, { id: "m1", elder_id: "e1", name: "Test Tablet A", times: ["08:00"], escalate_after_min: 30, active: 1 } as Versioned, S(2));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow() }, { table: "medicine", row: med }] } });
  const at = (iso: string) => Date.parse(iso);
  const r1 = await runCron(e, at("2026-10-20T02:35:00Z")); // 08:05 IST
  assert.deepEqual(r1, { due: 1, missed: 0, pushes: 0, skipped: 0 });
  const r2 = await runCron(e, at("2026-10-20T02:40:00Z"));
  assert.deepEqual(r2, { due: 0, missed: 0, pushes: 0, skipped: 0 });
  const r3 = await runCron(e, at("2026-10-20T03:05:00Z")); // 08:35 IST, past 30 min
  assert.deepEqual(r3, { due: 0, missed: 1, pushes: 0, skipped: 0 });
  const r4 = await runCron(e, at("2026-10-20T03:10:00Z"));
  assert.deepEqual(r4, { due: 0, missed: 0, pushes: 0, skipped: 0 });
  const pull = await call(e, "/sync", { cookie, body: { rows: [] } });
  const dose = pull.json.rows.find((x: { table: string }) => x.table === "dose_event").row;
  assert.equal(dose.status, "escalated");
  const ev = pull.json.rows.find((x: { table: string }) => x.table === "safety_event").row;
  assert.equal(ev.trigger, "missed_dose");
});

test("cron: a dose the elder confirmed is never escalated", async () => {
  const e = env();
  const cookie = await signedUp(e);
  await consented(e, cookie);
  const med = stamp(null, { id: "m1", elder_id: "e1", name: "Test Tablet A", times: ["08:00"], escalate_after_min: 30, active: 1 } as Versioned, S(2));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow() }, { table: "medicine", row: med }] } });
  await runCron(e, Date.parse("2026-10-20T02:35:00Z"));
  const taken = stamp(null, { id: "dose:m1:2026-10-20T08:00", medicine_id: "m1", scheduled_at: "2026-10-20T02:30:00.000Z", status: "taken" } as Versioned, S(Date.parse("2026-10-20T02:36:00Z"), "elderphone"));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "dose_event", row: taken }] } });
  assert.deepEqual(await runCron(e, Date.parse("2026-10-20T03:30:00Z")), { due: 0, missed: 0, pushes: 0, skipped: 0 });
});

test("cron pushes to the caregiver's subscriptions and drops gone ones", async () => {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
  const pub = b64url(await crypto.subtle.exportKey("raw", kp.publicKey));
  const priv = (await crypto.subtle.exportKey("jwk", kp.privateKey)).d!;
  const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const p256dh = b64url(await crypto.subtle.exportKey("raw", ua.publicKey));
  const e = env({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: "mailto:test@example.test" });
  const cookie = await signedUp(e);
  await consented(e, cookie);
  for (const endpoint of ["https://fcm.googleapis.com/fcm/send/ok", "https://fcm.googleapis.com/fcm/send/gone"]) {
    assert.equal((await call(e, "/push/subscribe", { cookie, body: { endpoint, keys: { p256dh, auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } } })).status, 201);
  }
  const med = stamp(null, { id: "m1", elder_id: "e1", name: "Test Tablet A", times: ["08:00"], active: 1 } as Versioned, S(2));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow() }, { table: "medicine", row: med }] } });
  const hits: string[] = [];
  const r = await runCron(e, Date.parse("2026-10-20T02:35:00Z"), async (url) => { hits.push(url); return { status: url.endsWith("gone") ? 410 : 201 }; });
  assert.equal(r.pushes, 1);
  assert.equal(hits.length, 2);
  const left = await e.DB.prepare("SELECT endpoint FROM push_sub").all<{ endpoint: string }>();
  assert.deepEqual(left.results.map((x) => x.endpoint), ["https://fcm.googleapis.com/fcm/send/ok"]);
});

test("sync: editing an elder that already has medicines works with foreign keys on", async () => {
  const e = env();
  const cookie = await signedUp(e);
  await consented(e, cookie);
  const med = stamp(null, { id: "m1", elder_id: "e1", name: "Test Tablet A", times: ["08:00"] } as Versioned, S(2));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow() }, { table: "medicine", row: med }] } });
  const edit = stamp(elderRow(), { ...elderRow(), dialect: "Malwi" }, S(10));
  const r = await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: edit }] } });
  assert.deepEqual(r.json.rejected, []);
  assert.equal(r.json.rows.find((x: { table: string }) => x.table === "elder").row.dialect, "Malwi");
  assert.ok(r.json.rows.some((x: { table: string }) => x.table === "medicine"));
});

// --- clock skew and repeated missed-dose alerts ---
const fastStamp = (iso: string, minutesFast: number, node = "elderphone") => S(Date.parse(iso) + minutesFast * 60_000, node);

async function elderWithMed(e: Env, cookie: string) {
  const med = stamp(null, { id: "m1", elder_id: "e1", name: "Test Tablet A", times: ["08:00"], escalate_after_min: 30, active: 1 } as Versioned, S(2));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "consent", row: consentRow() }, { table: "elder", row: elderRow() }, { table: "medicine", row: med }] } });
}

test("sync rejects rows stamped more than 24 h in the future", async () => {
  const e = env();
  const cookie = await signedUp(e);
  const future = stamp(null, { id: "e9", display_name: "Test Elder 9" } as Versioned, S(Date.now() + 2 * 86_400_000, "fast"));
  const r = await call(e, "/sync", { cookie, body: { rows: [{ table: "consent", row: consentRow("e9") }, { table: "elder", row: future }] } });
  assert.deepEqual(r.json.rejected.map((x: { reason: string }) => x.reason), ["future_stamp"]);
});

/** A medicine scheduled 1 minute ago in IST, so real-time server stamps line up with the cron's clock. */
function medDueNow() {
  const now0 = Math.floor(Date.now() / 60_000) * 60_000;
  const ist = new Date(now0 - 60_000 + 330 * 60_000);
  const hhmm = ist.toISOString().slice(11, 16);
  const day = ist.toISOString().slice(0, 10);
  return { now0, hhmm, doseId: `dose:m1:${day}T${hhmm}`, scheduled: new Date(now0 - 60_000).toISOString() };
}

test("a fast phone's early 'missed' does not alert before the server's own deadline, and alerts exactly once", async () => {
  const e = env();
  const cookie = await signedUp(e);
  const { now0, hhmm, doseId, scheduled } = medDueNow();
  const med = stamp(null, { id: "m1", elder_id: "e1", name: "Test Tablet A", times: [hhmm], escalate_after_min: 30, active: 1 } as Versioned, S(2));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "consent", row: consentRow() }, { table: "elder", row: elderRow() }, { table: "medicine", row: med }] } });
  await runCron(e, now0);
  // The elder phone is 23 h fast (inside the 24 h bound) and marks the dose missed right away.
  const early = stamp(null, { id: doseId, medicine_id: "m1", scheduled_at: scheduled, status: "missed" } as Versioned, S(now0 + 23 * 3_600_000, "elderphone"));
  const pushed = await call(e, "/sync", { cookie, body: { rows: [{ table: "dose_event", row: early }] } });
  assert.deepEqual(pushed.json.rejected, []);
  const MIN = 60_000;
  const runs: number[] = [];
  for (const m of [5, 10, 20, 31, 36, 41, 60]) runs.push((await runCron(e, now0 + m * MIN)).missed);
  assert.deepEqual(runs, [0, 0, 0, 1, 0, 0, 0]); // deadline = scheduled + 30 min
  const pull = await call(e, "/sync", { cookie, body: { rows: [] } });
  assert.equal(pull.json.rows.filter((x: { row: { trigger?: string } }) => x.row.trigger === "missed_dose").length, 1);
  assert.equal(pull.json.rows.find((x: { table: string }) => x.table === "dose_event").row.status, "escalated");
});

// --- stopped or rescheduled medicines (server side) ---
test("cron: an inactive medicine gets no reminder; a moved time closes the old dose without an alert", async () => {
  const e = env();
  const cookie = await signedUp(e);
  const { now0, hhmm } = medDueNow();
  const stopped = stamp(null, { id: "m1", elder_id: "e1", name: "Test Tablet A", times: [hhmm], escalate_after_min: 30, active: 0 } as Versioned, S(2));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "consent", row: consentRow() }, { table: "elder", row: elderRow() }, { table: "medicine", row: stopped }] } });
  assert.deepEqual(await runCron(e, now0), { due: 0, missed: 0, pushes: 0, skipped: 0 });
  // Reactivate, let the dose fall due, then move it to another time.
  const active = stamp(stopped, { ...stopped, active: 1 }, S(3));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "medicine", row: active }] } });
  assert.equal((await runCron(e, now0 + 60_000)).due, 1);
  const moved = stamp(active, { ...active, times: ["23:59"] }, S(4));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "medicine", row: moved }] } });
  assert.deepEqual(await runCron(e, now0 + 45 * 60_000), { due: 0, missed: 0, pushes: 0, skipped: 0 });
});

// --- consent scope_sync is enforced on the server ---
test("sync: an elder with no consent row, or with scope_sync=0, is refused with all its child rows", async () => {
  const e = env();
  const cookie = await signedUp(e);
  const med = stamp(null, { id: "m1", elder_id: "e1", name: "Test Tablet A", times: ["08:00"] } as Versioned, S(2));
  const none = await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow() }, { table: "medicine", row: med }] } });
  assert.deepEqual(none.json.rejected.map((r: { reason: string }) => r.reason), ["no_sync_consent", "no_sync_consent"]);
  const no = await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow() }, { table: "consent", row: consentRow("e1", { scope_sync: 0 }) }] } });
  assert.deepEqual(no.json.rejected.map((r: { reason: string }) => r.reason), ["no_sync_consent", "no_sync_consent"]);
  assert.equal((await e.DB.prepare("SELECT COUNT(*) AS n FROM elder").first<{ n: number }>())!.n, 0);
});

test("sync: consent sent in the same batch (even after the elder) allows the elder and its children", async () => {
  const e = env();
  const cookie = await signedUp(e);
  const med = stamp(null, { id: "m1", elder_id: "e1", name: "Test Tablet A", times: ["08:00"] } as Versioned, S(2));
  const r = await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow() }, { table: "medicine", row: med }, { table: "consent", row: consentRow() }] } });
  assert.deepEqual(r.json.rejected, []);
  assert.equal(r.json.accepted, 3);
});

test("sync: withdrawing sync consent later stops new rows for that elder", async () => {
  const e = env();
  const cookie = await signedUp(e);
  await call(e, "/sync", { cookie, body: { rows: [{ table: "consent", row: consentRow() }, { table: "elder", row: elderRow() }] } });
  const off = stamp(consentRow(), { ...consentRow(), scope_sync: 0 }, S(5));
  const r = await call(e, "/sync", { cookie, body: { rows: [{ table: "consent", row: off }, { table: "elder", row: stamp(elderRow(), { ...elderRow(), notes: "x" }, S(6)) }] } });
  assert.deepEqual(r.json.rejected.map((x: { table: string; reason: string }) => `${x.table}:${x.reason}`), ["elder:no_sync_consent"]);
});

test("sync: a child row pointing at another account's elder is refused", async () => {
  const e = env();
  const a = await signedUp(e, "a@example.test");
  const b = await signedUp(e, "b@example.test");
  await call(e, "/sync", { cookie: a, body: { rows: [{ table: "consent", row: consentRow() }, { table: "elder", row: elderRow() }] } });
  const med = stamp(null, { id: "mB", elder_id: "e1", name: "Test Tablet B", times: ["08:00"] } as Versioned, S(2));
  const r = await call(e, "/sync", { cookie: b, body: { rows: [{ table: "medicine", row: med }] } });
  assert.deepEqual(r.json.rejected.map((x: { reason: string }) => x.reason), ["no_sync_consent"]);
});

// --- rate limits on login and register ---
test("login: after 5 wrong passwords for one email, even the right one gets 429 for a while", async () => {
  const e = env();
  await signedUp(e);
  for (let i = 0; i < 5; i++) assert.equal((await call(e, "/auth/login", { body: { email: "caregiver1@example.test", password: "wrong horse 1" } })).status, 401);
  const locked = await call(e, "/auth/login", { body: { email: "caregiver1@example.test", password: "correct horse 1" } });
  assert.equal(locked.status, 429);
  assert.deepEqual(locked.json, { error: "too_many" });
});

test("register: one IP can create at most 5 accounts an hour", async () => {
  const e = env();
  const reg = (i: number) => app.request("/api/auth/register", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
    body: JSON.stringify({ name: "T", email: `t${i}@example.test`, password: "correct horse 1" }),
  }, e);
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await reg(i)).status);
  assert.deepEqual(codes, [201, 201, 201, 201, 201, 429]);
});

test("rate-limit rows store no raw email or IP", async () => {
  const e = env();
  await call(e, "/auth/login", { body: { email: "someone@example.test", password: "wrong horse 1" } });
  const rows = (await e.DB.prepare("SELECT key FROM auth_attempt").all<{ key: string }>()).results.map((r) => r.key).join(" ");
  assert.doesNotMatch(rows, /someone|example/);
});

// --- push subscription limits ---
const sub = (endpoint: string, p256dh = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4") =>
  ({ endpoint, keys: { p256dh, auth: "BTBZMqHH6r4Tts7J_aSIgg" } });

test("push/subscribe accepts only known push services", async () => {
  const e = env();
  const cookie = await signedUp(e);
  assert.equal((await call(e, "/push/subscribe", { cookie, body: sub("https://evil.example.test/x") })).status, 400);
  assert.equal((await call(e, "/push/subscribe", { cookie, body: sub("https://fcm.googleapis.com/fcm/send/abc") })).status, 201);
  assert.equal((await call(e, "/push/subscribe", { cookie, body: sub("https://web.push.apple.com/abc") })).status, 201);
  assert.equal((await call(e, "/push/subscribe", { cookie, body: sub("https://push.apple.com.evil.test/abc") })).status, 400);
});

test("push/subscribe keeps at most 5 subscriptions per account (newest win)", async () => {
  const e = env();
  const cookie = await signedUp(e);
  for (let i = 0; i < 8; i++) await call(e, "/push/subscribe", { cookie, body: sub(`https://fcm.googleapis.com/fcm/send/${i}`) });
  const left = (await e.DB.prepare("SELECT endpoint FROM push_sub").all<{ endpoint: string }>()).results.map((r) => r.endpoint.slice(-1)).sort();
  assert.deepEqual(left, ["3", "4", "5", "6", "7"]);
});

test("/notify is limited to 10 calls an hour per account", async () => {
  const e = env();
  const cookie = await signedUp(e);
  await consented(e, cookie);
  await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow() }] } });
  const codes = [];
  for (let i = 0; i < 11; i++) codes.push((await call(e, "/notify", { cookie, body: { elder_id: "e1", text: "Test" } })).status);
  assert.deepEqual(codes.slice(9), [200, 429]);
});

test("cron spends its push budget fairly: one account with many due doses cannot starve another", async () => {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
  const pub = b64url(await crypto.subtle.exportKey("raw", kp.publicKey));
  const priv = (await crypto.subtle.exportKey("jwk", kp.privateKey)).d!;
  const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const p256dh = b64url(await crypto.subtle.exportKey("raw", ua.publicKey));
  const e = env({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: "mailto:test@example.test" });
  const { now0, hhmm } = medDueNow();
  const setup = async (email: string, elder: string, meds: number) => {
    const cookie = await signedUp(e, email);
    await call(e, "/push/subscribe", { cookie, body: { endpoint: `https://fcm.googleapis.com/fcm/send/${email}`, keys: { p256dh, auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } } });
    const rows = [{ table: "consent", row: consentRow(elder) }, { table: "elder", row: elderRow({ id: elder }) }];
    for (let i = 0; i < meds; i++) rows.push({ table: "medicine", row: stamp(null, { id: `${elder}-m${i}`, elder_id: elder, name: `Test Tablet ${i}`, times: [hhmm], active: 1 } as Versioned, S(2)) });
    await call(e, "/sync", { cookie, body: { rows } });
  };
  await setup("noisy@example.test", "eN", 30);
  await setup("quiet@example.test", "eQ", 1);
  const hits: string[] = [];
  const r = await runCron(e, now0, async (url) => { hits.push(url); return { status: 201 }; });
  assert.ok(hits.some((u) => u.endsWith("quiet@example.test")), "the quiet account still gets its reminder");
  assert.ok(hits.filter((u) => u.endsWith("noisy@example.test")).length <= MAX_PUSHES_PER_OWNER);
  assert.ok(r.skipped > 0);
});

// --- data rights ---
test("a deleted elder is stored without personal data, even if the client sent the old fields", async () => {
  const e = env();
  const cookie = await signedUp(e);
  await consented(e, cookie);
  await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow({ notes: "Likes bhajans" }) }] } });
  const del = stamp(elderRow({ notes: "Likes bhajans" }), { ...elderRow({ notes: "Likes bhajans" }), deleted: true }, S(9));
  await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: del }] } });
  const row = await e.DB.prepare("SELECT display_name, notes, preferences, deleted FROM elder WHERE id = 'e1'").first<Record<string, unknown>>();
  assert.deepEqual({ ...row }, { display_name: "", notes: null, preferences: null, deleted: 1 });
});

test("GET /account/export returns the account and its rows, never the password hash", async () => {
  const e = env();
  const cookie = await signedUp(e);
  await consented(e, cookie);
  await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow() }] } });
  const r = await call(e, "/account/export", { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.json.account.email, "caregiver1@example.test");
  assert.equal(r.json.tables.elder[0].display_name, "Test Elder 1");
  assert.equal(r.json.tables.consent.length, 1);
  assert.doesNotMatch(JSON.stringify(r.json), /pbkdf2/);
});

test("POST /account/delete needs the confirm word, then hard-deletes the account, its rows and push subscriptions", async () => {
  const e = env();
  const cookie = await signedUp(e);
  const other = await signedUp(e, "other@example.test");
  await consented(e, cookie);
  await consented(e, other, "eO");
  await call(e, "/sync", { cookie, body: { rows: [{ table: "elder", row: elderRow() }, { table: "medicine", row: stamp(null, { id: "m1", elder_id: "e1", name: "Test Tablet A", times: ["08:00"] } as Versioned, S(2)) }] } });
  await call(e, "/sync", { cookie: other, body: { rows: [{ table: "elder", row: elderRow({ id: "eO" }) }] } });
  await call(e, "/push/subscribe", { cookie, body: sub("https://fcm.googleapis.com/fcm/send/x") });
  assert.equal((await call(e, "/account/delete", { cookie, body: { confirm: "no" } })).status, 400);
  const r = await call(e, "/account/delete", { cookie, body: { confirm: "DELETE" } });
  assert.equal(r.status, 200);
  const count = async (t: string) => (await e.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n;
  assert.equal(await count("medicine"), 0);
  assert.equal(await count("push_sub"), 0);
  assert.equal(await count("elder"), 1); // the other account's elder stays
  assert.equal(await count("app_user"), 1);
  assert.equal((await call(e, "/auth/me", { cookie })).status, 401);
  assert.equal((await call(e, "/auth/login", { body: { email: "caregiver1@example.test", password: "correct horse 1" } })).status, 401);
});
