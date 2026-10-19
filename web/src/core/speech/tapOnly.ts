// TapOnlyProvider: the fallback when voice input is unavailable or not allowed.
// The elder taps big picture buttons; each tap is fed in as if it were heard,
// so the companion pipeline (and its safety screen) treats it the same way.
// Speech output is delegated (usually to WebSpeechProvider.tts) when present.

import type { SpeechCapabilities, SpeechProvider } from "./speech.ts";

export interface TapChoice {
  id: "yes" | "no" | "help" | "song";
  label: { hi: string; en: string };
  /** Text passed to the pipeline. "help" trips the safety screen on purpose. */
  text: { hi: string; en: string };
}

export const TAP_CHOICES: readonly TapChoice[] = [
  { id: "yes", label: { hi: "हाँ", en: "Yes" }, text: { hi: "हाँ", en: "yes" } },
  { id: "no", label: { hi: "नहीं", en: "No" }, text: { hi: "नहीं", en: "no" } },
  { id: "song", label: { hi: "गाना", en: "A song" }, text: { hi: "गाना सुनाओ", en: "sing a song" } },
  { id: "help", label: { hi: "मदद", en: "Help" }, text: { hi: "मदद", en: "help" } },
];

type Tts = (text: string, lang: string, rate: number) => Promise<void>;

export class TapOnlyProvider implements SpeechProvider {
  readonly id = "tap";
  readonly sttLeavesDevice = false;
  readonly ttsLeavesDevice: boolean;
  private readonly speak: Tts | null;
  private readonly stopSpeaking: () => void;
  private waiting: ((text: string | null) => void) | null = null;

  /** `output` is another provider whose speech output is reused (consent already applied to it). */
  constructor(output?: Pick<SpeechProvider, "tts" | "cancel" | "ttsLeavesDevice"> | null) {
    this.speak = output ? (t, l, r) => output.tts(t, l, r) : null;
    this.stopSpeaking = output ? () => output.cancel() : () => {};
    this.ttsLeavesDevice = output?.ttsLeavesDevice ?? false;
  }

  /** Called by the UI when a button is tapped. Returns false if nobody is listening. */
  submit(text: string): boolean {
    if (!this.waiting) return false;
    const w = this.waiting;
    this.waiting = null;
    w(text);
    return true;
  }

  async capabilities(): Promise<SpeechCapabilities> {
    return {
      stt: false,
      sttOnDevice: true,
      tts: !!this.speak,
      ttsVoiceForLang: !!this.speak,
      audioLeavesDevice: false,
      note: "tap to answer",
    };
  }

  /** One "listening" session: ends after one tap, or when cancelled. */
  async *stt(): AsyncGenerator<string> {
    this.waiting?.(null);
    const text = await new Promise<string | null>(r => { this.waiting = r; });
    if (text) yield text;
  }

  async tts(text: string, lang: string, rate: number): Promise<void> {
    if (this.speak) await this.speak(text, lang, rate);
  }

  cancel(): void {
    const w = this.waiting;
    this.waiting = null;
    w?.(null);
    this.stopSpeaking();
  }
}
