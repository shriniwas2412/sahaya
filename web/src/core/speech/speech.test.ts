import { test } from "node:test";
import assert from "node:assert/strict";
import {
  speechRate, speechLocale, audioCloudAllowed, withAudioConsent, ConsentError, SpeechUnavailableError,
  type SpeechProvider, type SpeechCapabilities,
} from "./speech.ts";
import {
  WebSpeechProvider, type WebSpeechEnv, type RecognitionLike, type RecognitionCtor, type Availability,
  type VoiceLike, type UtteranceLike, type SynthLike,
} from "./webSpeech.ts";
import { TapOnlyProvider, TAP_CHOICES } from "./tapOnly.ts";
import { SarvamProvider, ElevenLabsProvider, NotEnabledError } from "./stubs.ts";

const YES = { scope_audio_cloud: 1 as const };
const NO = { scope_audio_cloud: 0 as const };

// ---------- fakes ----------

function fakeEnv(opts: { available?: Availability | null; voices?: VoiceLike[]; noRec?: boolean; noSynth?: boolean; lateVoices?: boolean } = {}) {
  const made: RecognitionLike[] = [];
  const spoken: UtteranceLike[] = [];
  const availCalls: unknown[] = [];
  class FakeRec implements RecognitionLike {
    lang = ""; continuous = true; interimResults = true; maxAlternatives = 5; processLocally?: boolean;
    onresult: RecognitionLike["onresult"] = null; onerror: RecognitionLike["onerror"] = null; onend: RecognitionLike["onend"] = null;
    started = false; aborted = false; stopped = false;
    constructor() { made.push(this); }
    start() { this.started = true; }
    stop() { this.stopped = true; this.onend?.(); }
    abort() { this.aborted = true; }
    // test helpers
    say(text: string, isFinal = true) { this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] }); }
    end() { this.onend?.(); }
  }
  const Rec = FakeRec as unknown as RecognitionCtor;
  if (opts.available !== null) {
    Rec.available = async o => { availCalls.push(o); return opts.available ?? "available"; };
  }
  let voices = opts.voices ?? [];
  const listeners: (() => void)[] = [];
  const synth: SynthLike = {
    speak(u) { spoken.push(u); queueMicrotask(() => u.onend?.()); },
    cancel() {},
    getVoices: () => (opts.lateVoices && !listeners.length ? [] : voices),
    addEventListener: (_t, fn) => { listeners.push(fn); if (opts.lateVoices) queueMicrotask(fn); },
    removeEventListener: () => {},
  };
  class Utter implements UtteranceLike {
    lang = ""; rate = 1; voice: VoiceLike | null = null; onend: (() => void) | null = null; onerror: UtteranceLike["onerror"] = null;
    text: string;
    constructor(text: string) { this.text = text; }
  }
  const env: WebSpeechEnv = {
    SpeechRecognition: opts.noRec ? undefined : Rec,
    speechSynthesis: opts.noSynth ? undefined : synth,
    SpeechSynthesisUtterance: opts.noSynth ? undefined : (Utter as unknown as WebSpeechEnv["SpeechSynthesisUtterance"]),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  return { env, made: made as unknown as (RecognitionLike & { say(t: string, f?: boolean): void; end(): void; started: boolean; aborted: boolean })[], spoken, availCalls, setVoices: (v: VoiceLike[]) => { voices = v; } };
}

const LOCAL_HI: VoiceLike = { lang: "hi-IN", name: "Local Hindi", localService: true };
const CLOUD_HI: VoiceLike = { lang: "hi-IN", name: "Cloud Hindi", localService: false };
const LOCAL_EN: VoiceLike = { lang: "en_IN", name: "Local English", localService: true };

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const t of it) out.push(t);
  return out;
}

// ---------- shared rules ----------

test("speech rate is 0.85× for stages 4-7 and when not assessed", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(s => speechRate(s as 1)), [1, 1, 1, 0.85, 0.85, 0.85, 0.85]);
  assert.equal(speechRate(null), 0.85);
});

test("speech locale from profile language; dialects use Hindi voices", () => {
  assert.equal(speechLocale("hi"), "hi-IN");
  assert.equal(speechLocale("Bundeli"), "hi-IN");
  assert.equal(speechLocale("en"), "en-IN");
  assert.equal(speechLocale("mr"), "mr-IN");
  assert.equal(speechLocale("gu"), "gu-IN");
  assert.equal(speechLocale("en-GB"), "en-GB");
});

test("audio consent accepts true or 1 only", () => {
  assert.equal(audioCloudAllowed(YES), true);
  assert.equal(audioCloudAllowed({ scope_audio_cloud: true }), true);
  assert.equal(audioCloudAllowed(NO), false);
  assert.equal(audioCloudAllowed(null), false);
});

test("withAudioConsent blocks a cloud provider without consent and passes it with consent", async () => {
  let ttsCalls = 0;
  const cloud: SpeechProvider = {
    id: "cloudy", sttLeavesDevice: true, ttsLeavesDevice: true,
    capabilities: async (): Promise<SpeechCapabilities> => ({ stt: true, sttOnDevice: false, tts: true, ttsVoiceForLang: true, audioLeavesDevice: true }),
    async *stt() { yield "x"; },
    async tts() { ttsCalls++; },
    cancel() {},
  };
  const blocked = withAudioConsent(cloud, NO);
  await assert.rejects(blocked.tts("hi", "hi", 1), ConsentError);
  await assert.rejects(collect(blocked.stt("hi")), ConsentError);
  const caps = await blocked.capabilities("hi");
  assert.equal(caps.stt, false);
  assert.equal(caps.tts, false);
  assert.equal(caps.audioLeavesDevice, false);
  assert.equal(ttsCalls, 0);
  const allowed = withAudioConsent(cloud, YES);
  await allowed.tts("hi", "hi", 1);
  assert.deepEqual(await collect(allowed.stt("hi")), ["x"]);
  assert.equal(ttsCalls, 1);
});

// ---------- WebSpeechProvider ----------

test("capabilities: no consent + on-device pack → STT on device, local voice only", async () => {
  const { env, availCalls } = fakeEnv({ available: "available", voices: [CLOUD_HI, LOCAL_HI] });
  const p = new WebSpeechProvider({ consent: NO, env });
  const c = await p.capabilities("hi");
  assert.deepEqual(c, { stt: true, sttOnDevice: true, tts: true, ttsVoiceForLang: true, audioLeavesDevice: false });
  assert.deepEqual(availCalls[0], { langs: ["hi-IN"], processLocally: true });
  assert.equal(p.sttLeavesDevice, false);
});

test("capabilities: no consent + pack only downloadable → no STT, a note for setup", async () => {
  const { env } = fakeEnv({ available: "downloadable", voices: [LOCAL_HI] });
  const c = await new WebSpeechProvider({ consent: NO, env }).capabilities("hi");
  assert.equal(c.stt, false);
  assert.equal(c.sttOnDevice, false);
  assert.match(c.note!, /can be installed/);
});

test("capabilities: browser without available() → unknown on-device; STT only with consent", async () => {
  const { env } = fakeEnv({ available: null, voices: [LOCAL_HI] });
  const no = await new WebSpeechProvider({ consent: NO, env }).capabilities("hi");
  assert.equal(no.stt, false);
  assert.equal(no.sttOnDevice, "unknown");
  const yes = await new WebSpeechProvider({ consent: YES, env }).capabilities("hi");
  assert.equal(yes.stt, true);
  assert.equal(yes.audioLeavesDevice, true);
});

test("capabilities: no recognition (e.g. Firefox), no voices for the language", async () => {
  const { env } = fakeEnv({ noRec: true, voices: [LOCAL_EN] });
  const c = await new WebSpeechProvider({ consent: NO, env }).capabilities("hi");
  assert.equal(c.stt, false);
  assert.equal(c.tts, true);
  assert.equal(c.ttsVoiceForLang, false);
  assert.match(c.note!, /no speech recognition/);
  assert.match(c.note!, /no hi-IN voice/);
});

test("capabilities: only cloud voices and no consent → no speech output", async () => {
  const { env } = fakeEnv({ voices: [CLOUD_HI] });
  const c = await new WebSpeechProvider({ consent: NO, env }).capabilities("hi");
  assert.equal(c.tts, false);
});

test("voices that load late are waited for", async () => {
  const { env } = fakeEnv({ voices: [LOCAL_HI], lateVoices: true });
  const v = await new WebSpeechProvider({ consent: NO, env }).voices(500);
  assert.deepEqual(v, [LOCAL_HI]);
});

test("stt without consent sets processLocally and yields final transcripts only", async () => {
  const { env, made } = fakeEnv({ available: "available" });
  const p = new WebSpeechProvider({ consent: NO, env });
  const it = p.stt("hi")[Symbol.asyncIterator]();
  const first = it.next();
  await new Promise(r => setImmediate(r));
  const rec = made[0]!;
  assert.equal(rec.processLocally, true);
  assert.equal(rec.lang, "hi-IN");
  assert.equal(rec.interimResults, false);
  assert.equal(rec.started, true);
  rec.say("नम", false);
  rec.say(" नमस्ते ");
  assert.deepEqual(await first, { value: "नमस्ते", done: false });
  rec.end();
  assert.deepEqual(await it.next(), { value: undefined, done: true });
});

test("stt without consent and no on-device pack refuses (UI falls back to tap)", async () => {
  const { env, made } = fakeEnv({ available: "unavailable" });
  await assert.rejects(collect(new WebSpeechProvider({ consent: NO, env }).stt("hi")), SpeechUnavailableError);
  assert.equal(made.length, 0, "no recognizer was started, so no audio was captured");
});

test("stt with consent uses the default (cloud) engine", async () => {
  const { env, made } = fakeEnv({ available: "unavailable" });
  const it = new WebSpeechProvider({ consent: YES, env }).stt("en");
  const p = collect(it);
  await new Promise(r => setImmediate(r));
  assert.equal(made[0]!.processLocally, undefined);
  made[0]!.say("hello");
  made[0]!.end();
  assert.deepEqual(await p, ["hello"]);
});

test("stt: 'no-speech' ends quietly; other errors throw", async () => {
  const a = fakeEnv();
  const quiet = collect(new WebSpeechProvider({ consent: NO, env: a.env }).stt("hi"));
  await new Promise(r => setImmediate(r));
  a.made[0]!.onerror!({ error: "no-speech" });
  a.made[0]!.end();
  assert.deepEqual(await quiet, []);

  const b = fakeEnv();
  const loud = collect(new WebSpeechProvider({ consent: NO, env: b.env }).stt("hi"));
  await new Promise(r => setImmediate(r));
  b.made[0]!.onerror!({ error: "not-allowed" });
  await assert.rejects(loud, /not-allowed/);
});

test("stt: maxMs stops listening", async () => {
  const { env, made } = fakeEnv();
  const out = collect(new WebSpeechProvider({ consent: NO, env }).stt("hi", { maxMs: 10 }));
  await new Promise(r => setImmediate(r));
  assert.deepEqual(await out, []);
  assert.equal((made[0] as unknown as { stopped: boolean }).stopped, true);
});

test("tts uses an on-device voice, the given rate and locale", async () => {
  const { env, spoken } = fakeEnv({ voices: [CLOUD_HI, LOCAL_HI] });
  await new WebSpeechProvider({ consent: NO, env }).tts("नमस्ते", "hi", 0.85);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0]!.voice, LOCAL_HI);
  assert.equal(spoken[0]!.rate, 0.85);
  assert.equal(spoken[0]!.lang, "hi-IN");
});

test("tts refuses a cloud-only voice without consent, uses it with consent", async () => {
  const { env } = fakeEnv({ voices: [CLOUD_HI] });
  await assert.rejects(new WebSpeechProvider({ consent: NO, env }).tts("x", "hi", 1), /no on-device hi-IN voice/);
  const b = fakeEnv({ voices: [CLOUD_HI] });
  await new WebSpeechProvider({ consent: YES, env: b.env }).tts("x", "hi", 1);
  assert.equal(b.spoken[0]!.voice, CLOUD_HI);
});

test("tts falls back to a same-language voice with another region (en_IN for en-GB)", async () => {
  const { env, spoken } = fakeEnv({ voices: [LOCAL_EN] });
  await new WebSpeechProvider({ consent: NO, env }).tts("hello", "en-GB", 1);
  assert.equal(spoken[0]!.voice, LOCAL_EN);
});

test("no speech synthesis → tts throws SpeechUnavailableError", async () => {
  const { env } = fakeEnv({ noSynth: true });
  await assert.rejects(new WebSpeechProvider({ consent: YES, env }).tts("x", "hi", 1), SpeechUnavailableError);
});

// ---------- tap-only ----------

test("tap-only: a tapped choice is 'heard' once; untapped submit is ignored", async () => {
  const tap = new TapOnlyProvider();
  assert.equal(tap.submit("haan"), false);
  const heard = collect(tap.stt());
  await new Promise(r => setImmediate(r));
  assert.equal(tap.submit("हाँ"), true);
  assert.deepEqual(await heard, ["हाँ"]);
  const c = await tap.capabilities();
  assert.equal(c.stt, false);
  assert.equal(c.tts, false);
});

test("tap-only: cancel ends listening without text; tts is delegated", async () => {
  const said: string[] = [];
  const tap = new TapOnlyProvider({ tts: async t => { said.push(t); }, cancel() {}, ttsLeavesDevice: false });
  const heard = collect(tap.stt());
  await new Promise(r => setImmediate(r));
  tap.cancel();
  assert.deepEqual(await heard, []);
  await tap.tts("नमस्ते", "hi", 0.85);
  assert.deepEqual(said, ["नमस्ते"]);
  assert.equal((await tap.capabilities()).tts, true);
});

test("tap choices include a Help button whose text trips the safety screen", async () => {
  const { screenText } = await import("../companion/safety.ts");
  const help = TAP_CHOICES.find(c => c.id === "help")!;
  assert.equal(screenText(help.text.hi).level, "emergency");
  assert.equal(screenText(help.text.en).level, "emergency");
  for (const c of TAP_CHOICES.filter(c => c.id !== "help")) {
    assert.equal(screenText(c.text.hi).level, "none", c.id);
    assert.equal(screenText(c.text.en).level, "none", c.id);
  }
});

// ---------- paid stubs ----------

test("Sarvam and ElevenLabs stubs cannot be built without audio consent", () => {
  assert.throws(() => new SarvamProvider({ consent: NO }), ConsentError);
  assert.throws(() => new ElevenLabsProvider({ consent: null }), ConsentError);
});

test("stubs with consent report nothing available, throw NotEnabled, and never touch the network", async () => {
  const orig = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; throw new Error("no"); }) as typeof fetch;
  try {
    for (const p of [new SarvamProvider({ consent: YES }), new ElevenLabsProvider({ consent: YES })]) {
      const c = await p.capabilities();
      assert.equal(c.stt, false);
      assert.equal(c.tts, false);
      assert.match(c.note!, /free-only/);
      await assert.rejects(p.tts(), NotEnabledError);
      await assert.rejects(collect(p.stt()), NotEnabledError);
      assert.equal(p.ttsLeavesDevice, true);
    }
    assert.equal(new SarvamProvider({ consent: YES }).sttLeavesDevice, true);
    assert.equal(new ElevenLabsProvider({ consent: YES }).sttLeavesDevice, false);
  } finally { globalThis.fetch = orig; }
  assert.equal(called, false);
});
