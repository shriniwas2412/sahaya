import { test } from "node:test";
import assert from "node:assert/strict";
import { EmergencyFlow, parseYesNo, telUrl, whatsappUrl, type EmergencyAction } from "./emergency.ts";
import type { ElderProfile } from "./types.ts";
import type { SafetyResult } from "./safety.ts";

// Synthetic test profile. Numbers are reserved-looking placeholders, not real people.
const profile: ElderProfile = {
  displayName: "Test Elder",
  gdsStage: 4,
  language: "hi",
  familyContacts: [
    { name: "Second", phone: "90000 00002", whatsapp: false, order: 2 },
    { name: "First", phone: "+91 90000-00001", whatsapp: true, order: 1 },
  ],
  ngoHelpline: "1800 000 0000",
};
const EMERG: SafetyResult = { level: "emergency", matched: ["bachao"], trigger: "keyword", categories: ["help"] };
const CHECK: SafetyResult = { level: "check", matched: ["dard"], trigger: "keyword", categories: ["pain"] };

const types = (a: EmergencyAction[]) => a.map(x => x.type);
const speech = (a: EmergencyAction[]) => a.filter(x => x.type === "speak").map(x => (x as { text: string }).text).join(" ");
const calls = (a: EmergencyAction[]) => a.flatMap(x => (x.type === "call" ? [x.url] : []));

test("yes/no parsing in Hindi, Hinglish and English", () => {
  for (const s of ["haan", "Haan ji", "ha", "जी हाँ", "हां", "bula do", "bulao", "yes", "okay please"]) assert.equal(parseYesNo(s), "yes", s);
  for (const s of ["nahi", "nahin", "na", "नहीं", "mat bulao", "मत बुलाओ", "no", "no thanks", "don't call"]) assert.equal(parseYesNo(s), "no", s);
  for (const s of ["", "kya?", "aaj khana achha tha", "haan nahi"]) assert.equal(parseYesNo(s), "unclear", s);
});

test("phone URLs: tel keeps +, wa.me gets digits with 91 for 10-digit Indian mobiles", () => {
  assert.equal(telUrl("+91 90000-00001"), "tel:+919000000001");
  assert.equal(telUrl("1800 000 0000"), "tel:18000000000");
  assert.equal(telUrl("abc"), null);
  assert.equal(whatsappUrl("90000 00002", "hi there"), "https://wa.me/919000000002?text=hi%20there");
  assert.equal(whatsappUrl("+91 90000-00001", "x"), "https://wa.me/919000000001?text=x");
  assert.equal(whatsappUrl("09000000002", "x"), "https://wa.me/919000000002?text=x");
  assert.equal(whatsappUrl("12", "x"), null);
});

test("start: logs the event and speaks the scripted reassure-and-ask line", () => {
  const f = new EmergencyFlow(profile);
  const a = f.start(EMERG, 0);
  assert.deepEqual(types(a), ["log", "speak"]);
  assert.equal(speech(a), "मैं यहीं हूँ, Test जी। क्या किसी को बुलाऊँ?");
  const log = a[0] as Extract<EmergencyAction, { type: "log" }>;
  assert.deepEqual(log.event, { trigger: "keyword", matched: "bachao", action: "reassure_ask", at: "1970-01-01T00:00:00.000Z" });
  assert.equal(f.phase, "asking");
});

test("start with level none does nothing", () => {
  const f = new EmergencyFlow(profile);
  assert.deepEqual(f.start({ level: "none", matched: [] }, 0), []);
  assert.equal(f.phase, "idle");
});

test("yes → call contact #1 (by order), WhatsApp them, notify caregiver", () => {
  const f = new EmergencyFlow(profile);
  f.start(EMERG, 0);
  const a = f.answer("haan", 3000);
  assert.deepEqual(calls(a), ["tel:+919000000001"]);
  assert.ok(types(a).includes("whatsapp"));
  assert.ok(types(a).includes("notify_caregiver"));
  assert.match(speech(a), /First/);
  assert.equal(f.phase, "calling");
});

test("no answer for 20 s at emergency level → connects anyway", () => {
  const f = new EmergencyFlow(profile);
  f.start(EMERG, 0);
  assert.deepEqual(f.tick(19_999), []);
  const a = f.tick(20_000);
  assert.deepEqual(calls(a), ["tel:+919000000001"]);
  assert.match(speech(a), /अभी फ़ोन लगा रहे हैं/);
  assert.deepEqual(f.tick(60_000), [], "ticking while calling does nothing");
});

test("no answer at check level never auto-calls", () => {
  const f = new EmergencyFlow(profile);
  f.start(CHECK, 0);
  assert.deepEqual(f.tick(120_000), []);
  assert.equal(f.phase, "asking");
});

test("check upgraded to emergency while asking: urgent line, 20 s rule starts then", () => {
  const f = new EmergencyFlow(profile);
  f.start(CHECK, 0);
  const up = f.start(EMERG, 50_000);
  assert.match(speech(up), /अभी फ़ोन लगा रहे हैं|ठीक है\?/);
  assert.deepEqual(f.tick(69_999), []);
  assert.deepEqual(calls(f.tick(70_000)), ["tel:+919000000001"]);
});

test("unanswered calls go #1 → #2 → NGO helpline → exhausted", () => {
  const f = new EmergencyFlow(profile);
  f.start(EMERG, 0);
  f.answer("yes", 1);
  assert.deepEqual(calls(f.callUnanswered(2)), ["tel:9000000002"]);
  const h = f.callUnanswered(3);
  assert.deepEqual(calls(h), ["tel:18000000000"]);
  assert.match(speech(h), /हेल्पलाइन/);
  const ex = f.callUnanswered(4);
  assert.ok(types(ex).includes("exhausted"));
  assert.equal(f.phase, "exhausted");
});

test("connected → reassure afterwards, log, done", () => {
  const f = new EmergencyFlow(profile);
  f.start(EMERG, 0);
  f.answer("haan", 1);
  const a = f.callConnected(5);
  assert.deepEqual(types(a), ["speak", "log"]);
  assert.equal(speech(a), "आप अकेले नहीं हैं, Test जी। मैं यहीं हूँ।");
  assert.equal(f.phase, "done");
});

test("'no' at check level: reassure and stop, no calls", () => {
  const f = new EmergencyFlow(profile);
  f.start(CHECK, 0);
  const a = f.answer("nahi", 1);
  assert.deepEqual(calls(a), []);
  assert.ok(!types(a).includes("notify_caregiver"));
  assert.equal(f.phase, "done");
});

test("'no' at emergency level: no call, but the caregiver is still told", () => {
  const f = new EmergencyFlow(profile);
  f.start(EMERG, 0);
  const a = f.answer("mat bulao", 1);
  assert.deepEqual(calls(a), []);
  assert.ok(types(a).includes("notify_caregiver"));
  assert.equal(f.phase, "done");
});

test("a fresh distress word as the answer counts as yes", () => {
  const f = new EmergencyFlow(profile);
  f.start(CHECK, 0);
  assert.deepEqual(calls(f.answer("bachao!", 1)), ["tel:+919000000001"]);
});

test("unclear answer re-asks and keeps the 20 s clock running", () => {
  const f = new EmergencyFlow(profile);
  f.start(EMERG, 0);
  const a = f.answer("kya?", 10_000);
  assert.match(speech(a), /हाँ या ना/);
  assert.deepEqual(calls(f.tick(20_000)), ["tel:+919000000001"]);
});

test("fall adds the don't-get-up-quickly line", () => {
  const f = new EmergencyFlow(profile);
  const a = f.start({ level: "emergency", matched: ["gir gayi"], trigger: "keyword", categories: ["fall"] }, 0);
  assert.match(speech(a), /जल्दी से उठने की कोशिश मत कीजिए/);
});

test("English profile speaks English; no contacts and no helpline → exhausted right away", () => {
  const f = new EmergencyFlow({ displayName: "Test", gdsStage: 2, language: "en-IN" });
  assert.equal(speech(f.start(EMERG, 0)), "I'm right here, Test. Shall I call someone for you?");
  const a = f.answer("yes", 1);
  assert.ok(types(a).includes("exhausted"));
  assert.deepEqual(calls(a), []);
});

test("helpline is only used when the caregiver entered one (never guessed)", () => {
  const f = new EmergencyFlow({ ...profile, ngoHelpline: null, familyContacts: [profile.familyContacts![1]!] });
  f.start(EMERG, 0);
  f.answer("haan", 1);
  assert.ok(types(f.callUnanswered(2)).includes("exhausted"));
});

test("cancel by caregiver resolves the flow and logs who resolved it", () => {
  const f = new EmergencyFlow(profile);
  f.start(EMERG, 0);
  const a = f.cancel("caregiver", 1000);
  const log = a.find(x => x.type === "log") as Extract<EmergencyAction, { type: "log" }>;
  assert.equal(log.event.action, "resolved");
  assert.equal(log.event.resolvedBy, "caregiver");
  assert.equal(f.phase, "done");
  assert.deepEqual(f.tick(100_000), []);
});

test("a finished flow can start again for a new event", () => {
  const f = new EmergencyFlow(profile);
  f.start(CHECK, 0);
  f.answer("nahi", 1);
  assert.deepEqual(types(f.start(EMERG, 2)), ["log", "speak"]);
});
