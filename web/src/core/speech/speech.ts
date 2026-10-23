// SpeechProvider contract and the audio-consent rule.
//
// Audio may leave the device only when the consent record has
// scope_audio_cloud = true. Every provider declares whether its STT/TTS sends
// audio to a server, and withAudioConsent() makes those calls fail closed
// without consent. Providers that are cloud-only also check in their constructor.

export type StageLike = 1 | 2 | 3 | 4 | 5 | 6 | 7 | null | undefined;

export interface SpeechCapabilities {
  /** Speech-to-text usable right now for this language (respecting consent). */
  stt: boolean;
  /** STT runs on the device: true / false / "unknown" when the browser cannot say. */
  sttOnDevice: boolean | "unknown";
  /** Text-to-speech usable. */
  tts: boolean;
  /** A voice for this language exists (else the default voice is used). */
  ttsVoiceForLang: boolean;
  /** Whether using this provider sends audio off the device. */
  audioLeavesDevice: boolean;
  /** Short reason when stt or tts is false, for the setup screen. */
  note?: string;
}

export interface SttOptions {
  /** Stop listening after this long without a result (ms). */
  maxMs?: number;
}

export interface SpeechProvider {
  readonly id: string;
  /** True if stt() sends audio off the device. */
  readonly sttLeavesDevice: boolean;
  /** True if tts() sends text/audio to a server for synthesis. */
  readonly ttsLeavesDevice: boolean;
  capabilities(lang: string): Promise<SpeechCapabilities>;
  /** One listening session; yields final transcripts, then ends. */
  stt(lang: string, opts?: SttOptions): AsyncIterable<string>;
  /** Speak and resolve when finished. */
  tts(text: string, lang: string, rate: number): Promise<void>;
  /** Stop speaking and listening now. */
  cancel(): void;
}

/** The consent fields speech needs (from the consent table). */
export interface AudioConsent {
  scope_audio_cloud: boolean | 0 | 1;
}

export class ConsentError extends Error {
  constructor(provider: string) {
    super(`${provider}: audio cannot leave the device without consent (scope_audio_cloud)`);
    this.name = "ConsentError";
  }
}

export class SpeechUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeechUnavailableError";
  }
}

export function audioCloudAllowed(consent: AudioConsent | null | undefined): boolean {
  return consent?.scope_audio_cloud === true || consent?.scope_audio_cloud === 1;
}

/** Calm speech: 0.9 for stages 1–3, slower (0.85) for 4–7 and when not assessed. */
export function speechRate(stage: StageLike): number {
  return stage != null && stage <= 3 ? 0.9 : 0.85;
}

/** Voice locale for a profile language/dialect. Hindi dialects use hi-IN voices. */
export function speechLocale(language: string | null | undefined): string {
  const l = String(language ?? "").trim();
  if (/^[a-z]{2}-[A-Z]{2}$/.test(l)) return l;
  const s = l.toLowerCase();
  if (s.startsWith("mr") || s.startsWith("marathi")) return "mr-IN";
  if (s.startsWith("gu")) return "gu-IN";
  if (s.startsWith("en")) return "en-IN";
  return "hi-IN";
}

/**
 * Wrap any provider so cloud audio is refused without consent. Calls that
 * stay on the device pass through untouched.
 */
export function withAudioConsent(provider: SpeechProvider, consent: AudioConsent | null | undefined): SpeechProvider {
  const ok = audioCloudAllowed(consent);
  return {
    id: provider.id,
    sttLeavesDevice: provider.sttLeavesDevice,
    ttsLeavesDevice: provider.ttsLeavesDevice,
    async capabilities(lang) {
      const c = await provider.capabilities(lang);
      if (ok) return c;
      return {
        ...c,
        stt: c.stt && !provider.sttLeavesDevice,
        tts: c.tts && !provider.ttsLeavesDevice,
        audioLeavesDevice: false,
        note: provider.sttLeavesDevice || provider.ttsLeavesDevice ? "needs audio consent" : c.note,
      };
    },
    stt(lang, opts) {
      if (provider.sttLeavesDevice && !ok) {
        return { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new ConsentError(provider.id)) }) };
      }
      return provider.stt(lang, opts);
    },
    async tts(text, lang, rate) {
      if (provider.ttsLeavesDevice && !ok) throw new ConsentError(provider.id);
      return provider.tts(text, lang, rate);
    },
    cancel: () => provider.cancel(),
  };
}
