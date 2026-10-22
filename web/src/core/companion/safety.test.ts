import { test } from "node:test";
import assert from "node:assert/strict";
import { screenText, SafetyScreen, SilenceTimer, AgitationDetector, silenceThresholdMs } from "./safety.ts";

const level = (s: string, extra?: Parameters<typeof screenText>[1]) => screenText(s, extra).level;

test("explicit calls for help are emergencies in English, Hindi, Hinglish, Marathi, Gujarati", () => {
  for (const s of [
    "help", "Help me please", "HELP!!", "somebody help",
    "bachao", "bachaao koi", "मदद", "मदद करो", "बचाओ", "बचाइए",
    "madad karo", "mujhe madad chahiye", "madat karo",
    "मदत करा", "वाचवा", "મદદ કરો", "બચાવો",
  ]) assert.equal(level(s), "emergency", s);
});

test("falls, breathing trouble, chest pain, fainting, bleeding are emergencies", () => {
  for (const s of [
    "main gir gaya", "gir gayi hoon", "mai gir gyi", "gir pada", "मैं गिर गया", "गिर गई", "गिर गयी",
    "I fell", "I have fallen", "fell down in the bathroom",
    "saans nahi aa rahi", "saans lene mein taklif", "saans phool rahi hai", "साँस नहीं आ रही", "सांस नहीं ले पा रही",
    "can't breathe", "I cannot breathe",
    "seene mein dard", "chhati me dard", "सीने में दर्द", "छाती में दर्द", "chest pain",
    "behosh ho gaye", "बेहोश", "khoon beh raha", "खून बह रहा है", "bleeding",
  ]) assert.equal(level(s), "emergency", s);
});

test("self-harm talk is an emergency", () => {
  for (const s of ["I want to die", "marna chahta hoon", "मैं मरना चाहती हूँ", "kill myself"])
    assert.equal(level(s), "emergency", s);
});

test("pain, fear, wanting to go home and feeling lost are gentle checks", () => {
  for (const s of [
    "dard ho raha hai", "pair mein dard", "दर्द है", "it hurts", "I am in pain",
    "darr lag raha hai", "dar lag raha", "mujhe dar lag rahi hai", "डर लग रहा है", "I'm scared", "I am afraid",
    "mujhe ghar jana hai", "ghar jaana hai", "मुझे घर जाना है", "I want to go home",
    "main kahan hoon", "मैं कहाँ हूँ", "where am I", "I'm lost",
    "saans", "साँस",
  ]) assert.equal(level(s), "check", s);
});

test("matched lists the phrases found, in the order of the rules", () => {
  const r = screenText("bachao, gir gayi hoon");
  assert.equal(r.level, "emergency");
  assert.equal(r.trigger, "keyword");
  assert.ok(r.matched.includes("bachao"), JSON.stringify(r.matched));
  assert.ok(r.matched.includes("gir gayi"), JSON.stringify(r.matched));
});

test("emergency wins over check when both appear", () => {
  assert.equal(level("dard ho raha hai aur saans nahi aa rahi"), "emergency");
});

test("false positives: words that merely contain a keyword do not trigger", () => {
  for (const s of [
    "my son is very helpful",
    "mera beta bahut madadgar hai",
    "girgit deewar par baitha hai",        // lizard, not a fall
    "saansad ji aaye the",                // member of parliament
    "aaj sabzi ki dar kya hai",            // dar = rate/price
    "we sang songs at the mela",
    "हमने होली पर गुजिया बनाई",
    "Diwali par diye jalaye",
    "",
    "   ",
  ]) assert.equal(level(s), "none", s);
});

test("negated pain, fear and going-home do not trigger", () => {
  for (const s of [
    "dard nahi hai", "koi dard nahin", "mujhe dard nahi", "अब दर्द नहीं है", "no pain today",
    "darr nahi lag raha", "mujhe dar nahi lagta", "डर नहीं लग रहा", "I'm not scared",
    "mujhe ghar nahi jana", "मुझे घर नहीं जाना",
  ]) assert.equal(level(s), "none", s);
});

test("negation never hides emergencies: 'saans nahi' and 'help nahi mil rahi' still trigger", () => {
  assert.equal(level("saans nahi aa rahi"), "emergency");
  assert.equal(level("koi help nahi kar raha"), "emergency");
  assert.equal(level("I don't want to live, help"), "emergency");
});

test("caregiver-added words: bare strings are checks, levels can be set", () => {
  const extra = ["Ramu kahan hai", { phrase: "aag", level: "emergency" as const }];
  assert.equal(level("Ramu kahan hai?", extra), "check");
  assert.equal(level("aag lag gayi", extra), "emergency");
  assert.equal(level("Ramu aaya tha", extra), "none");
  assert.deepEqual(screenText("aag!", extra).matched, ["aag"]);
});

test("caregiver words with regex characters are matched literally", () => {
  assert.equal(level("a.b", ["a.b"]), "check");
  assert.equal(level("axb", ["a.b"]), "none");
  assert.equal(level("(maa)", ["(maa)"]), "check");
});

test("punctuation, case and spacing do not hide a keyword", () => {
  assert.equal(level("B-A-C-H-A-O"), "none"); // spelled out letters are not words
  assert.equal(level("Gir   Gaya!!!"), "emergency");
  assert.equal(level("...madad..."), "emergency");
});

test("screenText never calls the network", () => {
  const orig = globalThis.fetch;
  let called = false;
  globalThis.fetch = (() => { called = true; throw new Error("no"); }) as typeof fetch;
  try { screenText("bachao"); screenText("hello"); } finally { globalThis.fetch = orig; }
  assert.equal(called, false);
});

// ---------- silence ----------

test("silence thresholds are stage-dependent with 90 s default for stages 1-3", () => {
  assert.equal(silenceThresholdMs(1), 90_000);
  assert.equal(silenceThresholdMs(3), 90_000);
  assert.equal(silenceThresholdMs(4), 120_000);
  assert.equal(silenceThresholdMs(7), 180_000);
  assert.equal(silenceThresholdMs(null), 120_000);
});

test("silence: nothing before the threshold, check after, emergency after two unanswered checks", () => {
  const s = new SilenceTimer({ thresholdMs: 90_000 });
  s.prompted(0);
  assert.equal(s.tick(89_999).level, "none");
  const c1 = s.tick(90_000);
  assert.equal(c1.level, "check");
  assert.equal(c1.trigger, "silence");
  assert.equal(s.tick(100_000).level, "none"); // waiting on check 1
  assert.equal(s.tick(180_000).level, "check"); // check 1 unanswered → check 2
  const e = s.tick(270_000); // check 2 unanswered
  assert.equal(e.level, "emergency");
  assert.equal(e.trigger, "silence");
  assert.equal(s.tick(400_000).level, "none"); // fires once, then idle
});

test("silence: any response resets the timer and the check count", () => {
  const s = new SilenceTimer({ thresholdMs: 90_000 });
  s.prompted(0);
  assert.equal(s.tick(90_000).level, "check");
  s.responded(95_000);
  assert.equal(s.tick(500_000).level, "none"); // not waiting on anything
  s.prompted(500_000);
  assert.equal(s.tick(590_000).level, "check"); // count restarted at 1
  assert.equal(s.tick(680_000).level, "check");
});

test("silence: no prompt means no timer", () => {
  const s = new SilenceTimer({ thresholdMs: 1000 });
  assert.equal(s.tick(10_000_000).level, "none");
});

// ---------- agitation ----------

test("agitation: 6 taps within 3 s is a check; slow tapping is not", () => {
  const a = new AgitationDetector();
  for (const t of [0, 1000, 2000, 3000, 4000, 5000, 6000]) assert.equal(a.tap(t).level, "none");
  const b = new AgitationDetector();
  const res = [0, 300, 600, 900, 1200, 1500].map(t => b.tap(t));
  assert.deepEqual(res.map(r => r.level), ["none", "none", "none", "none", "none", "check"]);
  assert.equal(res[5]!.trigger, "agitation");
});

test("agitation: a second burst within 60 s escalates to emergency", () => {
  const a = new AgitationDetector();
  for (const t of [0, 100, 200, 300, 400]) a.tap(t);
  assert.equal(a.tap(500).level, "check");
  for (const t of [20_000, 20_100, 20_200, 20_300, 20_400]) a.tap(t);
  assert.equal(a.tap(20_500).level, "emergency");
});

test("agitation: a burst long after the first is a fresh check", () => {
  const a = new AgitationDetector();
  for (const t of [0, 100, 200, 300, 400, 500]) a.tap(t);
  let last;
  for (const t of [90_000, 90_100, 90_200, 90_300, 90_400, 90_500]) last = a.tap(t);
  assert.equal(last!.level, "check");
});

// ---------- combined screen ----------

test("SafetyScreen: text, profile words, silence and taps through one object", () => {
  const s = new SafetyScreen({ stage: 2, customWords: ["Ramu"] });
  assert.equal(s.screen("Ramu").level, "check");
  assert.equal(s.screen("namaste").level, "none");
  s.prompted(0);
  assert.equal(s.tick(90_000).level, "check");
  s.screen("haan", 91_000); // speech counts as a response
  assert.equal(s.tick(400_000).level, "none");
  assert.equal(s.tap(1).level, "none");
});

// ---------- more distress phrasings and negation scope, table-driven ----------
// Each row: [expected level, phrase]. Devanagari, romanised and English.
const REVIEW_FIXTURES: [("check" | "emergency"), string][] = [
  // self-harm
  ["emergency", "jeena nahi chahta"], ["emergency", "मैं जीना नहीं चाहता"], ["emergency", "मैं जीना नहीं चाहती"],
  ["emergency", "zeher kha lunga"], ["emergency", "ज़हर खा लूँगा"], ["emergency", "जहर खा लूंगी"],
  ["emergency", "khudkushi kar lunga"], ["emergency", "ख़ुदकुशी कर लूँगी"], ["emergency", "mar jaunga main"], ["emergency", "मैं मर जाऊँगी"],
  // breathing / suffocation
  ["emergency", "dam ghut raha hai"], ["emergency", "दम घुट रहा है"], ["emergency", "saas nahi aa rahi"],
  ["emergency", "सांस नही आ रही"], ["emergency", "सास नहीं आ रही"], ["emergency", "I am choking"],
  // falls, slipped, can't get up
  ["emergency", "main fisal gayi"], ["emergency", "बाथरूम में फिसल गई"], ["emergency", "uth nahi pa rahi"],
  ["emergency", "उठ नहीं पा रहा"], ["emergency", "उठ नही पा रही"], ["emergency", "girr gaya"],
  ["emergency", "I slipped and can't get up"], ["emergency", "I can't get up"], ["emergency", "I cannot get up"],
  // explicit calls for help
  ["emergency", "doctor ko bulao"], ["emergency", "डॉक्टर को बुलाओ"], ["emergency", "डाक्टर बुलाइए"], ["emergency", "ambulance bulao"],
  ["emergency", "एम्बुलेंस बुलाओ"], ["emergency", "kisi ko bulao"], ["emergency", "koi bulao"], ["emergency", "किसी को बुलाओ"],
  ["emergency", "कोई है? बचा लो"], ["emergency", "call a doctor"], ["emergency", "call an ambulance"], ["emergency", "112 ko phone lagao"],
  // chest / heart
  ["emergency", "sine me dard"], ["emergency", "dil mein dard ho raha"], ["emergency", "दिल में दर्द"], ["emergency", "chest mein dard ho raha hai"],
  // stroke signs
  ["emergency", "haath pair sunn ho gaye"], ["emergency", "हाथ सुन्न हो गया"], ["emergency", "मुंह टेढ़ा हो गया"], ["emergency", "my arm is numb"],
  // check level
  ["check", "chot lagi hai"], ["check", "चोट लगी"], ["check", "chakkar aa raha hai"], ["check", "मुझे चक्कर आ रहा है"], ["check", "I feel dizzy"],
  ["check", "tabiyat theek nahi"], ["check", "तबीयत ठीक नहीं है"], ["check", "tabiyat kharab hai"], ["check", "तबियत ख़राब है"],
  ["check", "I don't feel well"], ["check", "I feel sick"], ["check", "ulti ho rahi hai"], ["check", "उल्टी हो रही है"], ["check", "बुखार है"],
  ["check", "bukhar hai"], ["check", "I have a fever"], ["check", "darr lag rha"], ["check", "bahut dar lagta hai"], ["check", "मुझे डर लगता है"],
  ["check", "ghabrahat ho rahi"], ["check", "मैं कहां हूं"], ["check", "mujhe ghar le chalo"], ["check", "मुझे घर ले चलो"], ["check", "ghar jaana hai mujhe"],
  ["check", "pet me dard"], ["check", "सर दर्द"], ["check", "I hurt myself"],
  // negation that belongs to another verb or clause must not cancel
  ["check", "dard nahi ruk raha"], ["check", "दर्द नहीं रुक रहा"], ["check", "dard kam nahi ho raha"], ["check", "pain is not going away"],
  ["check", "pata nahi main kahan hoon"], ["check", "mujhe nahi pata main kahan hoon"], ["check", "पता नहीं मैं कहाँ हूँ"], ["check", "I don't know where I am"],
  ["check", "nahi nahi, dard ho raha hai"], ["check", "no no it hurts"], ["check", "nahi, mujhe dard hai"], ["check", "nahi aaj dard hai"],
];

test("review fixtures: every missed phrase reaches at least its expected level", () => {
  const rank = { none: 0, check: 1, emergency: 2 } as const;
  const misses = REVIEW_FIXTURES.filter(([want, s]) => rank[screenText(s).level] < rank[want]).map(([w, s]) => `${w}: ${s} → ${screenText(s).level}`);
  assert.deepEqual(misses, []);
});

test("review fixtures: check-level rows do not jump to emergency", () => {
  const jumped = REVIEW_FIXTURES.filter(([want, s]) => want === "check" && screenText(s).level === "emergency").map(([, s]) => s);
  assert.deepEqual(jumped, []);
});

test("scoped negation still clears genuine denials", () => {
  for (const s of [
    "dard nahi hai", "dard to nahi hai", "dard nahi ho raha", "koi dard nahin", "दर्द नहीं है", "no pain", "I am not in pain",
    "bukhar nahi hai", "बुखार नहीं है", "chakkar nahi aa raha", "chot nahi lagi", "I'm not scared", "not dizzy",
  ]) assert.equal(screenText(s).level, "none", s);
});

test("words around the new rules that must stay quiet", () => {
  for (const s of [
    "saas bahu ki kahani", "मेरी सास बहुत अच्छी थीं", "108 baar jaap kiya", "108 मनके की माला", "tabiyat achhi hai",
    "तबीयत अच्छी है", "doctor sahab achhe hain", "dil se shukriya", "sunny day", "fisalpatti par khele",
  ]) assert.equal(screenText(s).level, "none", s);
});

test("nukta letters match whether typed precomposed or decomposed", () => {
  const pre = "ज़हर खा लूँगा"; // ज़ as U+095B
  const dec = "ज़हर खा लूँगा"; // ज + nukta
  assert.equal(screenText(pre).level, "emergency");
  assert.equal(screenText(dec).level, "emergency");
});

// ---------- basic Marathi / Gujarati (needs native review) ----------
test("basic Marathi and Gujarati distress words", () => {
  for (const s of ["मी पडलो", "मी पडले", "छातीत दुखतंय", "मदत करा", "वाचवा"]) assert.equal(screenText(s).level, "emergency", s);
  for (const s of ["હું પડી ગયો", "હું પડી ગઈ", "છાતીમાં દુખાવો", "મદદ", "બચાવો"]) assert.equal(screenText(s).level, "emergency", s);
  for (const s of ["पाय दुखतोय", "દુખાવો થાય છે"]) assert.equal(screenText(s).level, "check", s);
});
