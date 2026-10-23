import { test } from "node:test";
import assert from "node:assert/strict";
import { rankVoices, chooseVoice } from "./voiceRank.ts";
import { phrases, normalizeForSpeech, hindiNumber, hindiTime, calmRate, PAUSE } from "./prosody.ts";
import { SarvamTTSProvider, AzureTTSProvider, type FetchLike } from "./neural.ts";
import { ConsentError, withAudioConsent } from "./speech.ts";

const V = (name: string, lang: string, localService = false) => ({ name, lang, localService });

test("ranking prefers neural, then Google, then enhanced Apple voices; drops other languages and eSpeak sinks", () => {
  const voices = [V("eSpeak Hindi", "hi", true), V("Lekha", "hi-IN", true), V("Google हिन्दी", "hi-IN"),
    V("Microsoft Swara Online (Natural) - Hindi (India)", "hi-IN"), V("Samantha", "en-US", true), V("Lekha (Enhanced)", "hi-IN", true)];
  assert.deepEqual(rankVoices(voices, "hi-IN").map((r) => r.voice.name),
    ["Microsoft Swara Online (Natural) - Hindi (India)", "Google हिन्दी", "Lekha (Enhanced)", "Lekha", "eSpeak Hindi"]);
  assert.equal(chooseVoice(voices, "hi-IN", "Lekha")!.name, "Lekha", "the caregiver's choice wins while present");
  assert.equal(chooseVoice(voices, "hi-IN", "Gone voice")!.name, "Microsoft Swara Online (Natural) - Hindi (India)");
  assert.equal(chooseVoice(voices, "mr-IN"), null);
});

test("Hindi numbers, times, dates and rupees become words; emoji and markdown are stripped", () => {
  assert.equal(hindiNumber(0), "शून्य");
  assert.equal(hindiNumber(47), "सैंतालीस");
  assert.equal(hindiNumber(2026), "दो हज़ार छब्बीस");
  assert.equal(hindiTime(8, 30), "सुबह साढ़े आठ बजे");
  assert.equal(hindiTime(20, 0), "रात आठ बजे");
  assert.equal(hindiTime(13, 30), "दोपहर डेढ़ बजे");
  assert.equal(hindiTime(9, 45), "सुबह पौने दस बजे");
  assert.equal(normalizeForSpeech("😊 **दवा** 08:30 पर, ₹2450 → 20/10/2026", "hi-IN"),
    "दवा सुबह साढ़े आठ बजे पर, दो हज़ार चार सौ पचास रुपये बीस अक्टूबर दो हज़ार छब्बीस");
  assert.equal(normalizeForSpeech("Take it at 8:30 🙂", "en-IN"), "Take it at 8:30");
});

test("phrases: short pause at commas, longer at sentence ends, 2.5 s after a question", () => {
  const p = phrases("नमस्ते शांति जी, आज मौसम अच्छा है। आपको कौन सा गाना पसंद है?", "hi-IN");
  assert.deepEqual(p.map((x) => x.pauseMs), [PAUSE.comma, PAUSE.sentence, PAUSE.question]);
  assert.equal(p[2].text.endsWith("?"), true);
  assert.deepEqual(phrases("Hello.", "en-IN"), [{ text: "Hello", pauseMs: 0 }]);
  assert.deepEqual(phrases("🙂 …", "en-IN"), []);
  assert.equal(calmRate(2), 0.9);
  assert.equal(calmRate(5), 0.85);
  assert.equal(calmRate(null), 0.85);
});

function mockFetch(reply: (url: string, init: Parameters<FetchLike>[1]) => { ok?: boolean; status?: number; json?: unknown; bytes?: number[] }) {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const r = reply(url, init);
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.json, arrayBuffer: async () => new Uint8Array(r.bytes ?? [1, 2, 3]).buffer };
  };
  return { f, calls };
}
const YES = { scope_audio_cloud: 1 as const }, NO = { scope_audio_cloud: 0 as const };
const noSleep = async () => {};

test("Sarvam: needs consent and a key or endpoint; sends one request per phrase with the key only in the header", async () => {
  const play = async () => {};
  assert.throws(() => new SarvamTTSProvider({ consent: NO, apiKey: "k", play }), ConsentError);
  assert.throws(() => new SarvamTTSProvider({ consent: YES, play }));
  const { f, calls } = mockFetch(() => ({ json: { audios: [btoa("RIFFxxxx")] } }));
  const played: string[] = [];
  const p = new SarvamTTSProvider({ consent: YES, apiKey: "test-key-123", fetch: f, sleep: noSleep, play: async (a, mime) => { played.push(`${mime}:${a.byteLength}`); } });
  await p.tts("नमस्ते, 08:30 बजे?", "hi-IN", 0.85);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.sarvam.ai/text-to-speech");
  assert.equal(calls[0].init.headers["api-subscription-key"], "test-key-123");
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.target_language_code, "hi-IN");
  assert.equal(body.pace, 0.85);
  assert.match(body.text, /सुबह साढ़े आठ बजे/);
  assert.ok(!calls[0].init.body.includes("test-key-123"));
  assert.deepEqual(played, ["audio/wav:8", "audio/wav:8"]);
  assert.equal((await p.capabilities("hi-IN")).tts, true);
});

test("Sarvam via a server proxy sends no key from the phone; HTTP errors reject", async () => {
  const { f, calls } = mockFetch(() => ({ ok: false, status: 401 }));
  const p = new SarvamTTSProvider({ consent: YES, endpoint: "/api/tts/sarvam", fetch: f, sleep: noSleep, play: async () => {} });
  await assert.rejects(p.tts("नमस्ते", "hi-IN", 0.9), /401/);
  assert.equal(calls[0].url, "/api/tts/sarvam");
  assert.equal(calls[0].init.headers["api-subscription-key"], undefined);
});

test("Azure: SSML with the hi-IN neural voice, escaped text and a slower rate; mp3 played", async () => {
  const { f, calls } = mockFetch(() => ({ bytes: [9, 9] }));
  const mimes: string[] = [];
  const p = new AzureTTSProvider({ consent: YES, apiKey: "az", region: "centralindia", fetch: f, sleep: noSleep, play: async (_a, m) => { mimes.push(m); } });
  await p.tts("Tom & Jerry <3", "en-IN", 0.85);
  assert.equal(calls[0].url, "https://centralindia.tts.speech.microsoft.com/cognitiveservices/v1");
  assert.equal(calls[0].init.headers["Ocp-Apim-Subscription-Key"], "az");
  assert.match(calls[0].init.body, /en-IN-NeerjaNeural/);
  assert.match(calls[0].init.body, /rate="-15%"/);
  assert.match(calls[0].init.body, /Tom &amp; Jerry/);
  assert.deepEqual(mimes, ["audio/mpeg"]);
  assert.match(p.ssml("नमस्ते", "hi-IN", 1), /hi-IN-SwaraNeural.*rate="0%"/);
  assert.equal((await p.capabilities("ta-IN")).tts, false);
});

test("cancel stops further phrases; consent wrapper still refuses without consent", async () => {
  let p!: SarvamTTSProvider;
  const { f, calls } = mockFetch(() => ({ json: { audios: [btoa("a")] } }));
  p = new SarvamTTSProvider({ consent: YES, apiKey: "k", fetch: f, sleep: noSleep, play: async () => { p.cancel(); } });
  await p.tts("एक। दो। तीन।", "hi-IN", 1);
  assert.equal(calls.length, 1);
  const wrapped = withAudioConsent(p, NO);
  await assert.rejects(wrapped.tts("x", "hi-IN", 1), ConsentError);
});
