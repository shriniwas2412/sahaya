import { test } from "node:test";
import assert from "node:assert/strict";
import { generateDemo, rng } from "./demoGen.ts";
import { validateElder } from "../core/profile.ts";
import { guardOutput } from "../core/companion/outputGuard.ts";
import { screenText } from "../core/companion/safety.ts";
import { uiLang } from "../core/profile.ts";

const NOW = Date.parse("2026-10-20T06:00:00Z");
const DAY = 86_400_000;

test("same seed and day give identical data; another seed differs", () => {
  assert.deepEqual(generateDemo(NOW), generateDemo(NOW));
  assert.notDeepEqual(generateDemo(NOW, 1).dose_event, generateDemo(NOW).dose_event);
  const a = rng(7), b = rng(7);
  assert.equal(a(), b());
});

test("residents: 6-8, stages 2-6, Hindi dialects, English and Marathi, all valid and labelled demo", () => {
  const g = generateDemo(NOW);
  assert.ok(g.elder.length >= 6 && g.elder.length <= 8);
  assert.deepEqual([...new Set(g.elder.map((e) => e.gds_stage))].sort(), [2, 3, 4, 5, 6]);
  const langs = new Set(g.elder.map((e) => `${e.language}/${e.dialect ?? ""}`));
  for (const l of ["hi-IN/Bundeli", "hi-IN/Malwi", "en-IN/", "mr-IN/Varhadi"]) assert.ok(langs.has(l), l);
  for (const e of g.elder) {
    assert.match(e.display_name, /\(demo\)$/);
    assert.deepEqual(validateElder(e, true), []);
    assert.equal(e.ngo_helpline, null);
    assert.ok(e.family_contacts.every((c) => /^\+91 90000 0000\d$/.test(c.phone)));
    assert.ok(e.preferences.length > 0);
  }
  assert.ok(g.elder.some((e) => e.triggers.length > 0));
});

test("dose history: 14-30 days per resident, a few missed doses escalate with a caregiver alert", () => {
  const g = generateDemo(NOW);
  for (const e of g.elder) {
    const meds = g.medicine.filter((m) => m.elder_id === e.id).map((m) => m.id);
    const ev = g.dose_event.filter((d) => meds.includes(d.medicine_id));
    const days = new Set(ev.map((d) => new Date(Date.parse(d.scheduled_at) + 330 * 60_000).toISOString().slice(0, 10)));
    assert.ok(days.size >= 14 && days.size <= 30, `${e.id}: ${days.size} days`);
    assert.ok(ev.every((d) => Date.parse(d.scheduled_at) < NOW - 0 && d.status !== "pending"));
  }
  const esc = g.dose_event.filter((d) => d.status === "escalated");
  assert.ok(esc.length >= 3 && esc.length <= 21);
  for (const d of esc) assert.ok(g.safety_event.some((s) => s.trigger === "missed_dose" && String(s.id).startsWith(d.id.replace(/:/g, "-"))));
  assert.ok(g.dose_event.filter((d) => d.status === "taken").length > esc.length * 10);
  assert.ok(g.dose_event.every((d) => Date.parse(d.scheduled_at) > NOW - 31 * DAY));
});

test("one worked incident: keyword -> ask -> call family 1 -> connected -> resolved", () => {
  const g = generateDemo(NOW);
  const inc = g.safety_event.filter((s) => s.trigger === "keyword").map((s) => s.action);
  assert.deepEqual(inc, ["reassure_ask", "call_family_1", "connected", "resolved"]);
});

test("each resident's latest talk has a sample conversation that passes the output guard and trips no safety rule on Sahaya's lines", () => {
  const g = generateDemo(NOW);
  for (const e of g.elder) {
    const talks = g.session.filter((s) => s.elder_id === e.id && s.mode === "companion" && String(s.id).includes("-talk-") && !String(s.id).endsWith("incident"));
    const latest = talks.at(-1)!;
    const conv = g.conversations[String(latest.id)];
    assert.ok(conv?.length >= 4, e.id);
    for (const l of conv.filter((x) => x.who === "sahaya")) {
      const lang = e.language === "en-IN" ? "en" : e.language === "mr-IN" ? "mr" : uiLang(e.language);
      const r = guardOutput(l.text, { stage: e.gds_stage, lang: lang as "hi" | "en" | "mr", avoid: e.triggers });
      assert.equal(r.text !== null, true, `${e.id}: ${l.text}`);
      assert.equal(screenText(l.text).level, "none", l.text);
    }
  }
});

test("feedback: every companion session has a mood 1-5 and dates in the past", () => {
  const g = generateDemo(NOW);
  for (const s of g.session.filter((x) => x.mode === "companion")) {
    assert.ok(Number(s.feedback_mood) >= 1 && Number(s.feedback_mood) <= 5);
    assert.ok(Date.parse(String(s.started_at)) < NOW);
  }
});
