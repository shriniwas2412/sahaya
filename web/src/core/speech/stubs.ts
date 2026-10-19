// Paid cloud speech providers: interface stubs only (this build is free-only).
// They make no network calls. They exist so the
// seam is ready: a later version would call a server proxy that holds the key.
// Both send audio/text off the device, so they cannot even be constructed
// without audio consent.

import type { AudioConsent, SpeechCapabilities, SpeechProvider } from "./speech.ts";
import { ConsentError, audioCloudAllowed } from "./speech.ts";

export class NotEnabledError extends Error {
  constructor(provider: string) {
    super(`${provider} is not enabled in this free-only build`);
    this.name = "NotEnabledError";
  }
}

abstract class CloudStub implements SpeechProvider {
  abstract readonly id: string;
  abstract readonly sttLeavesDevice: boolean;
  readonly ttsLeavesDevice = true;

  constructor(opts: { consent: AudioConsent | null | undefined }, name: string) {
    if (!audioCloudAllowed(opts.consent)) throw new ConsentError(name);
  }

  async capabilities(): Promise<SpeechCapabilities> {
    return { stt: false, sttOnDevice: false, tts: false, ttsVoiceForLang: false, audioLeavesDevice: true, note: "not enabled (free-only build)" };
  }

  async *stt(): AsyncGenerator<string> {
    throw new NotEnabledError(this.id);
  }

  async tts(): Promise<void> {
    throw new NotEnabledError(this.id);
  }

  cancel(): void {}
}

/** Sarvam AI (Indic STT + TTS). Stub. */
export class SarvamProvider extends CloudStub {
  readonly id = "sarvam";
  readonly sttLeavesDevice = true;
  constructor(opts: { consent: AudioConsent | null | undefined }) { super(opts, "sarvam"); }
}

/** ElevenLabs (TTS only). Stub. */
export class ElevenLabsProvider extends CloudStub {
  readonly id = "elevenlabs";
  readonly sttLeavesDevice = false;
  constructor(opts: { consent: AudioConsent | null | undefined }) { super(opts, "elevenlabs"); }
}
