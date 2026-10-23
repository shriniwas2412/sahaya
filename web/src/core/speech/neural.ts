// Optional natural-sounding cloud TTS with the user's own key (TTS only; listening
// stays on WebSpeech or tap-to-answer).
//
//  - SarvamTTSProvider: Sarvam AI Bulbul, Indic voices. POST /text-to-speech with an
//    `api-subscription-key` header; the reply carries base64 audio.
//    https://docs.sarvam.ai/api-reference-docs/text-to-speech/convert
//  - AzureTTSProvider: Azure AI Speech neural voices (hi-IN-SwaraNeural, …) via SSML.
//    https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech
//
// Both send the text to be spoken to the provider, so they cannot be built without
// audio consent (scope_audio_cloud). Keys are never hard-coded: the caregiver types
// one in (kept on this phone) or the server holds it and `endpoint` points at the
// server's proxy. Network and playback are injected, so tests run without either.

import type { AudioConsent, SpeechCapabilities, SpeechProvider } from "./speech.ts";
import { ConsentError, SpeechUnavailableError, audioCloudAllowed, speechLocale } from "./speech.ts";
import { phrases } from "./prosody.ts";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Plays one audio clip and resolves when it ends. */
export type PlayFn = (audio: ArrayBuffer, mime: string, signal: AbortSignal) => Promise<void>;

export interface NeuralOptions {
  consent: AudioConsent | null | undefined;
  /** User's own key. Omit when `endpoint` is a server proxy that adds the key. */
  apiKey?: string;
  endpoint?: string;
  voice?: string;
  fetch?: FetchLike;
  play: PlayFn;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  timeoutMs?: number;
}

const defaultSleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
});

export function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

abstract class NeuralTTS implements SpeechProvider {
  abstract readonly id: string;
  readonly sttLeavesDevice = false;
  readonly ttsLeavesDevice = true;
  protected readonly o: NeuralOptions & { fetch: FetchLike; sleep: NonNullable<NeuralOptions["sleep"]> };
  private abort: AbortController | null = null;

  constructor(o: NeuralOptions, name: string) {
    if (!audioCloudAllowed(o.consent)) throw new ConsentError(name);
    if (!o.apiKey && !o.endpoint) throw new SpeechUnavailableError(`${name}: needs an API key or a server endpoint`);
    this.o = { ...o, fetch: o.fetch ?? (globalThis.fetch as unknown as FetchLike), sleep: o.sleep ?? defaultSleep };
  }

  protected abstract languages(): string[];
  protected abstract synth(text: string, locale: string, rate: number, signal: AbortSignal): Promise<{ audio: ArrayBuffer; mime: string }>;

  async capabilities(lang: string): Promise<SpeechCapabilities> {
    const ok = this.languages().includes(speechLocale(lang));
    return { stt: false, sttOnDevice: false, tts: ok, ttsVoiceForLang: ok, audioLeavesDevice: true, ...(ok ? {} : { note: `${this.id} has no ${speechLocale(lang)} voice` }) };
  }

  async *stt(): AsyncGenerator<string> {
    throw new SpeechUnavailableError(`${this.id} is used for speaking only`);
  }

  /** Speak phrase by phrase, with the same pauses as the phone voice. */
  async tts(text: string, lang: string, rate: number): Promise<void> {
    this.cancel();
    const ac = new AbortController();
    this.abort = ac;
    const locale = speechLocale(lang);
    for (const p of phrases(text, locale)) {
      if (ac.signal.aborted) return;
      const timer = setTimeout(() => ac.abort(), this.o.timeoutMs ?? 10_000);
      let clip: { audio: ArrayBuffer; mime: string };
      try { clip = await this.synth(p.text, locale, rate, ac.signal); } finally { clearTimeout(timer); }
      if (ac.signal.aborted) return;
      await this.o.play(clip.audio, clip.mime, ac.signal);
      if (p.pauseMs) await this.o.sleep(p.pauseMs, ac.signal);
    }
  }

  cancel(): void {
    this.abort?.abort();
    this.abort = null;
  }
}

const SARVAM_LANGS = ["hi-IN", "mr-IN", "gu-IN", "en-IN", "bn-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "pa-IN", "od-IN"];

export class SarvamTTSProvider extends NeuralTTS {
  readonly id = "sarvam-tts";
  constructor(o: NeuralOptions) { super(o, "sarvam"); }
  protected languages() { return SARVAM_LANGS; }
  protected async synth(text: string, locale: string, rate: number, signal: AbortSignal) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.o.apiKey) headers["api-subscription-key"] = this.o.apiKey;
    const res = await this.o.fetch(this.o.endpoint ?? "https://api.sarvam.ai/text-to-speech", {
      method: "POST", headers, signal,
      body: JSON.stringify({ text, target_language_code: locale, speaker: this.o.voice ?? "anushka", model: "bulbul:v2", pace: rate, speech_sample_rate: 22050 }),
    });
    if (!res.ok) throw new SpeechUnavailableError(`sarvam: HTTP ${res.status}`);
    const body = (await res.json()) as { audios?: string[] };
    const b64 = body.audios?.[0];
    if (!b64) throw new SpeechUnavailableError("sarvam: no audio in reply");
    return { audio: base64ToBytes(b64), mime: "audio/wav" };
  }
}

const AZURE_VOICES: Record<string, string> = { "hi-IN": "hi-IN-SwaraNeural", "mr-IN": "mr-IN-AarohiNeural", "gu-IN": "gu-IN-DhwaniNeural", "en-IN": "en-IN-NeerjaNeural" };

export class AzureTTSProvider extends NeuralTTS {
  readonly id = "azure-tts";
  private readonly region: string;
  constructor(o: NeuralOptions & { region?: string }) {
    super(o, "azure");
    this.region = (o.region ?? "centralindia").replace(/[^a-z0-9]/gi, "");
  }
  protected languages() { return Object.keys(AZURE_VOICES); }
  /** SSML for one phrase; rate below 1 becomes a negative percentage. */
  ssml(text: string, locale: string, rate: number): string {
    const voice = this.o.voice ?? AZURE_VOICES[locale] ?? AZURE_VOICES["hi-IN"];
    const pct = Math.round((rate - 1) * 100);
    return `<speak version="1.0" xml:lang="${locale}"><voice name="${xmlEscape(voice)}"><prosody rate="${pct}%">${xmlEscape(text)}</prosody></voice></speak>`;
  }
  protected async synth(text: string, locale: string, rate: number, signal: AbortSignal) {
    const headers: Record<string, string> = { "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3" };
    if (this.o.apiKey) headers["Ocp-Apim-Subscription-Key"] = this.o.apiKey;
    const res = await this.o.fetch(this.o.endpoint ?? `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST", headers, signal, body: this.ssml(text, locale, rate),
    });
    if (!res.ok) throw new SpeechUnavailableError(`azure: HTTP ${res.status}`);
    return { audio: await res.arrayBuffer(), mime: "audio/mpeg" };
  }
}

/** Browser playback through an <audio> element. */
export function browserPlay(audio: ArrayBuffer, mime: string, signal: AbortSignal, volume = 1): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([audio], { type: mime }));
    const el = new Audio(url);
    el.volume = volume;
    const done = () => { URL.revokeObjectURL(url); resolve(); };
    el.onended = done;
    el.onerror = () => { URL.revokeObjectURL(url); reject(new SpeechUnavailableError("audio playback failed")); };
    signal.addEventListener("abort", () => { el.pause(); done(); }, { once: true });
    el.play().catch((e) => { URL.revokeObjectURL(url); reject(e); });
  });
}
