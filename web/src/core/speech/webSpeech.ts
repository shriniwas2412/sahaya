// WebSpeechProvider: free browser speech (SpeechRecognition + speechSynthesis).
//
// Privacy: Chrome's SpeechRecognition sends audio to a cloud service unless
// `processLocally` is set and an on-device language pack is available. So:
//  - without audio consent, STT runs only with processLocally = true after
//    SpeechRecognition.available() reports "available"; otherwise STT is
//    unavailable and the UI uses tap-to-answer;
//  - without audio consent, TTS uses only on-device voices (localService).
// Both APIs are reached through an injectable env so tests need no browser.

import type { AudioConsent, SpeechCapabilities, SpeechProvider, SttOptions } from "./speech.ts";
import { SpeechUnavailableError, audioCloudAllowed, speechLocale } from "./speech.ts";

// ---- minimal shapes of the browser APIs we use ----

export interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type Availability = "available" | "downloadable" | "downloading" | "unavailable";

export interface RecognitionCtor {
  new (): RecognitionLike;
  available?: (opts: { langs: string[]; processLocally: boolean }) => Promise<Availability>;
}

export interface VoiceLike {
  lang: string;
  name: string;
  localService: boolean;
  default?: boolean;
}

export interface UtteranceLike {
  lang: string;
  rate: number;
  voice: VoiceLike | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

export interface SynthLike {
  speak(u: UtteranceLike): void;
  cancel(): void;
  getVoices(): VoiceLike[];
  addEventListener?: (type: "voiceschanged", fn: () => void) => void;
  removeEventListener?: (type: "voiceschanged", fn: () => void) => void;
}

export interface WebSpeechEnv {
  SpeechRecognition?: RecognitionCtor;
  speechSynthesis?: SynthLike;
  SpeechSynthesisUtterance?: new (text: string) => UtteranceLike;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

export function browserEnv(): WebSpeechEnv {
  const g = globalThis as unknown as Record<string, unknown>;
  return {
    SpeechRecognition: (g.SpeechRecognition ?? g.webkitSpeechRecognition) as RecognitionCtor | undefined,
    speechSynthesis: g.speechSynthesis as SynthLike | undefined,
    SpeechSynthesisUtterance: g.SpeechSynthesisUtterance as WebSpeechEnv["SpeechSynthesisUtterance"],
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
}

const IGNORABLE_STT_ERRORS = new Set(["no-speech", "aborted"]);
const IGNORABLE_TTS_ERRORS = new Set(["interrupted", "canceled"]);

export class WebSpeechProvider implements SpeechProvider {
  readonly id = "webspeech";
  readonly sttLeavesDevice: boolean;
  readonly ttsLeavesDevice: boolean;
  private readonly env: WebSpeechEnv;
  private readonly cloudOk: boolean;
  private current: RecognitionLike | null = null;

  constructor(opts: { consent: AudioConsent | null | undefined; env?: WebSpeechEnv }) {
    this.env = opts.env ?? browserEnv();
    this.cloudOk = audioCloudAllowed(opts.consent);
    this.sttLeavesDevice = this.cloudOk;
    this.ttsLeavesDevice = this.cloudOk;
  }

  private async onDeviceStatus(locale: string): Promise<Availability | "unknown"> {
    const Rec = this.env.SpeechRecognition;
    if (!Rec || typeof Rec.available !== "function") return "unknown";
    try {
      return await Rec.available({ langs: [locale], processLocally: true });
    } catch {
      return "unknown";
    }
  }

  /** Voices, waiting briefly for `voiceschanged` because some browsers load them late. */
  async voices(waitMs = 1000): Promise<VoiceLike[]> {
    const synth = this.env.speechSynthesis;
    if (!synth) return [];
    const now = synth.getVoices();
    if (now.length || !synth.addEventListener) return now;
    return new Promise(resolve => {
      const done = () => {
        synth.removeEventListener?.("voiceschanged", done);
        this.env.clearTimeout(timer);
        resolve(synth.getVoices());
      };
      const timer = this.env.setTimeout(done, waitMs);
      synth.addEventListener!("voiceschanged", done);
    });
  }

  /** Best voice for a locale; on-device only unless audio consent was given. */
  pickVoice(voices: readonly VoiceLike[], locale: string): VoiceLike | null {
    const allowed = voices.filter(v => this.cloudOk || v.localService);
    const norm = (l: string) => l.replace("_", "-").toLowerCase();
    const want = norm(locale);
    const base = want.split("-")[0]!;
    return allowed.find(v => norm(v.lang) === want)
      ?? allowed.find(v => norm(v.lang).split("-")[0] === base)
      ?? null;
  }

  async capabilities(lang: string): Promise<SpeechCapabilities> {
    const locale = speechLocale(lang);
    const notes: string[] = [];
    const Rec = this.env.SpeechRecognition;
    let stt = false;
    let sttOnDevice: boolean | "unknown" = false;
    if (!Rec) {
      notes.push("this browser has no speech recognition");
    } else {
      const status = await this.onDeviceStatus(locale);
      sttOnDevice = status === "unknown" ? "unknown" : status === "available";
      stt = this.cloudOk || status === "available";
      if (!stt && (status === "downloadable" || status === "downloading")) notes.push(`on-device ${locale} speech pack can be installed`);
      else if (!stt) notes.push("voice input needs audio consent on this browser");
    }

    const synth = this.env.speechSynthesis;
    const voices = await this.voices();
    const voice = this.pickVoice(voices, locale);
    const anyAllowed = voices.some(v => this.cloudOk || v.localService);
    const tts = !!synth && !!this.env.SpeechSynthesisUtterance && (this.cloudOk ? true : anyAllowed);
    if (!synth) notes.push("this browser has no speech output");
    else if (!voice) notes.push(`no ${locale} voice installed`);

    return {
      stt,
      sttOnDevice,
      tts,
      ttsVoiceForLang: !!voice,
      audioLeavesDevice: this.cloudOk && !!Rec && sttOnDevice !== true,
      ...(notes.length ? { note: notes.join("; ") } : {}),
    };
  }

  async *stt(lang: string, opts: SttOptions = {}): AsyncGenerator<string> {
    const Rec = this.env.SpeechRecognition;
    if (!Rec) throw new SpeechUnavailableError("speech recognition is not available");
    const locale = speechLocale(lang);
    let local = false;
    if (!this.cloudOk) {
      if ((await this.onDeviceStatus(locale)) !== "available") {
        throw new SpeechUnavailableError(`on-device ${locale} recognition is not available; use tap-to-answer`);
      }
      local = true;
    }

    const rec = new Rec();
    rec.lang = locale;
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    if (local) rec.processLocally = true;

    const queue: string[] = [];
    let ended = false;
    let failure: Error | null = null;
    let wake: (() => void) | null = null;
    const notify = () => { wake?.(); wake = null; };

    rec.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const t = r[0]?.transcript?.trim();
        if (r.isFinal && t) queue.push(t);
      }
      notify();
    };
    rec.onerror = e => {
      if (!IGNORABLE_STT_ERRORS.has(e.error)) failure = new SpeechUnavailableError(`speech recognition error: ${e.error}`);
      notify();
    };
    rec.onend = () => { ended = true; notify(); };

    this.current = rec;
    const timer = opts.maxMs ? this.env.setTimeout(() => rec.stop(), opts.maxMs) : null;
    rec.start();
    try {
      while (true) {
        if (queue.length) { yield queue.shift()!; continue; }
        if (failure) throw failure;
        if (ended) return;
        await new Promise<void>(r => { wake = r; });
      }
    } finally {
      if (timer !== null) this.env.clearTimeout(timer);
      if (!ended) rec.abort();
      if (this.current === rec) this.current = null;
    }
  }

  async tts(text: string, lang: string, rate: number): Promise<void> {
    const synth = this.env.speechSynthesis;
    const Utter = this.env.SpeechSynthesisUtterance;
    if (!synth || !Utter) throw new SpeechUnavailableError("speech output is not available");
    const locale = speechLocale(lang);
    const voice = this.pickVoice(await this.voices(), locale);
    if (!voice && !this.cloudOk) throw new SpeechUnavailableError(`no on-device ${locale} voice`);
    synth.cancel();
    const u = new Utter(text);
    u.lang = locale;
    u.rate = rate;
    u.voice = voice;
    await new Promise<void>((resolve, reject) => {
      u.onend = () => resolve();
      u.onerror = e => (IGNORABLE_TTS_ERRORS.has(e.error) ? resolve() : reject(new SpeechUnavailableError(`speech output error: ${e.error}`)));
      synth.speak(u);
    });
  }

  cancel(): void {
    this.current?.abort();
    this.current = null;
    this.env.speechSynthesis?.cancel();
  }
}
