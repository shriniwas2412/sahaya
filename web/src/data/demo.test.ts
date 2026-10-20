import { test } from "node:test";
import assert from "node:assert/strict";
import { Repo, memoryBackend } from "./repo.ts";
import { loadDemo, clearDemo, autoLoadDemo, isDemo, dialAction, DEMO_PIN, DEMO_ELDER_ID } from "./demo.ts";
import { syncOnce } from "./syncClient.ts";
import { verifyPin } from "../core/pin.ts";
import { validateElder, type ElderRow } from "../core/profile.ts";
import { flags } from "../core/scoring.ts";

let n = 0;
const open = () => Repo.open(memoryBackend(), () => `dev${++n}`);
const NOW = Date.parse("2026-10-20T06:00:00Z");

test("loadDemo creates a valid, clearly labelled demo profile with no helpline", async () => {
  const r = await open();
  await loadDemo(r, NOW, 1000);
  const e = (await r.get<ElderRow>("elder", DEMO_ELDER_ID))!;
  assert.match(e.display_name, /\(demo\)/);
  assert.equal(e.gds_stage, 4);
  assert.equal(e.ngo_helpline, null);
  assert.deepEqual(validateElder(e, true), []);
  assert.ok(e.family_contacts.every((c) => /^\+91 90000 0000\d$/.test(c.phone)), "only obviously fake numbers");
  assert.equal(await isDemo(r), true);
  assert.ok(await verifyPin(DEMO_PIN, (await r.backend.getMeta<string>("pin_hash"))!));
});

test("demo has medicines, past feedback and activity history", async () => {
  const r = await open();
  await loadDemo(r, NOW, 1000);
  assert.equal((await r.list("medicine")).length, 2);
  const sessions = await r.list<{ mode: string; feedback_mood: number | null; started_at: string }>("session");
  assert.equal(sessions.filter((s) => s.mode === "companion" && s.feedback_mood).length, 3);
  assert.equal(sessions.filter((s) => s.mode === "memory_activity").length, 4);
  assert.ok(sessions.every((s) => Date.parse(s.started_at) < NOW));
  assert.equal((await r.list("activity_score")).length, 16);
});

test("demo activity history raises no made-up alarm flags", async () => {
  const r = await open();
  await loadDemo(r, NOW, 1000);
  const sessions = await r.list<{ id: string; mode: string; started_at: string }>("session");
  const scores = await r.list<{ session_id: string; task: string; score: number }>("activity_score");
  const hist = sessions.filter((s) => s.mode === "memory_activity").map((s) => ({
    date: s.started_at.slice(0, 10),
    scores: Object.fromEntries(scores.filter((x) => x.session_id === s.id).map((x) => [x.task, x.score])),
  }));
  assert.deepEqual(flags(hist), []);
});

test("clearDemo removes demo rows, rows made during the demo, the PIN, and leaves no tombstones", async () => {
  const r = await open();
  await loadDemo(r, NOW, 1000);
  await r.save("dose_event", { id: "dose:demo-med-1:2026-10-20T08:00", medicine_id: "demo-med-1", status: "taken" });
  await r.save("session", { id: "S1", elder_id: DEMO_ELDER_ID, mode: "companion" });
  await r.save("activity_score", { id: "A1", session_id: "S1", task: "orientation", score: 4 });
  await r.save("safety_event", { id: "X1", elder_id: DEMO_ELDER_ID, at: "x" });
  await r.save("elder", { id: "real-1", display_name: "Test Elder 1" }); // a non-demo row stays
  await clearDemo(r);
  for (const t of ["medicine", "dose_event", "session", "activity_score", "safety_event", "consent"] as const) {
    assert.deepEqual(await r.backend.all(t), [], t);
  }
  assert.deepEqual((await r.backend.all("elder")).map((e) => e.id), ["real-1"]);
  assert.equal(await r.backend.getMeta("pin_hash"), null);
  assert.equal(await isDemo(r), false);
});

test("autoLoadDemo: only for a demo build, only on an empty device, never again after a clear", async () => {
  const r = await open();
  assert.equal(await autoLoadDemo(r, false), false);
  assert.equal(await autoLoadDemo(r, true), true);
  assert.equal(await autoLoadDemo(r, true), false); // already has an elder
  await clearDemo(r);
  assert.equal(await autoLoadDemo(r, true), false); // visitor cleared it
});

test("sync refuses to run in demo mode, so demo rows never reach a server", async () => {
  const r = await open();
  await loadDemo(r, NOW, 1000);
  let called = false;
  await assert.rejects(syncOnce(r, async () => { called = true; return { rows: [], cursor: "" }; }), /demo/);
  assert.equal(called, false);
});

test("in demo mode call and WhatsApp links are previews, never opened", () => {
  assert.deepEqual(dialAction("tel:+919000000001", false), { kind: "open", href: "tel:+919000000001" });
  const tel = dialAction("tel:+919000000001", true);
  assert.equal(tel.kind, "preview");
  assert.equal(tel.kind === "preview" && tel.label, "📞 +919000000001");
  const wa = dialAction("https://wa.me/919000000001?text=Hi", true);
  assert.equal(wa.kind === "preview" && wa.label, "💬 wa.me/919000000001");
});

test("listeners hear about demo load and clear after the flags are set", async () => {
  const r = await open();
  const seen: boolean[] = [];
  r.onChange(() => { r.backend.getMeta<boolean>("demo").then((d) => seen.push(d === true)); });
  await loadDemo(r, NOW, 1000);
  await new Promise((res) => setTimeout(res, 0));
  assert.equal(seen.at(-1), true);
  await clearDemo(r);
  await new Promise((res) => setTimeout(res, 0));
  assert.equal(seen.at(-1), false);
});
