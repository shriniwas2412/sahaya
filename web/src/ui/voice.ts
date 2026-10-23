// Speech output for the app: short phrases with pauses, the most natural voice on
// this phone (or the caregiver's pick), the volume setting, and optionally a cloud
// voice with the caregiver's own key. Listening and capability checks come from
// core/speech (WebSpeechProvider).

import { chooseVoice, phrases, rankVoices, SarvamTTSProvider, AzureTTSProvider, browserPlay, type SpeechProvider, type VoiceLike } from "../core/speech/index.ts";

export type VoiceProvider = "phone" | "sarvam" | "azure";
export interface VoiceSettings { provider: VoiceProvider; voiceName?: string | null; apiKey?: string; region?: string }
export const DEFAULT_VOICE: VoiceSettings = { provider: "phone" };

let settings: VoiceSettings = DEFAULT_VOICE;
let cloud: SpeechProvider | null = null;
let volumeNow = 1;
let run = 0;

/** Apply settings; a cloud voice is only built with audio consent and a key. */
export function configureVoice(s: VoiceSettings | null | undefined, consent: { scope_audio_cloud: 0 | 1 | boolean } | null) {
  settings = s ?? DEFAULT_VOICE;
  cloud = null;
  if (settings.provider !== "phone" && settings.apiKey) {
    const play = (a: ArrayBuffer, mime: string, sig: AbortSignal) => browserPlay(a, mime, sig, volumeNow);
    try {
      cloud = settings.provider === "sarvam"
        ? new SarvamTTSProvider({ consent, apiKey: settings.apiKey, play })
        : new AzureTTSProvider({ consent, apiKey: settings.apiKey, region: settings.region, play });
    } catch { cloud = null; } // no consent: stay on the phone voice
  }
}

export const usingCloudVoice = () => cloud !== null;

export function voicesFor(locale: string): { voice: VoiceLike; score: number }[] {
  if (typeof speechSynthesis === "undefined") return [];
  return rankVoices(speechSynthesis.getVoices(), locale);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function speakPhrase(text: string, locale: string, rate: number, voice: SpeechSynthesisVoice | null): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = locale;
    u.rate = rate;
    u.volume = volumeNow;
    if (voice) u.voice = voice;
    // Resolve on end, on error, or after a generous estimate: some browsers never fire onend.
    const t = setTimeout(resolve, 1500 + text.length * 110 / rate);
    u.onend = u.onerror = () => { clearTimeout(t); resolve(); };
    speechSynthesis.speak(u);
  });
}

export async function speak(text: string, locale: string, rate = 0.85, volume = 1): Promise<void> {
  if (!text) return;
  volumeNow = volume;
  const mine = ++run;
  stopSpeaking(false);
  if (cloud) {
    try { await cloud.tts(text, locale, rate); return; } catch { /* network or key problem: fall back to the phone voice */ }
    if (mine !== run) return;
  }
  if (typeof speechSynthesis === "undefined") return;
  const voice = chooseVoice(speechSynthesis.getVoices(), locale, settings.voiceName) as SpeechSynthesisVoice | null;
  for (const p of phrases(text, locale)) {
    if (mine !== run) return;
    await speakPhrase(p.text, locale, rate, voice);
    if (p.pauseMs && mine !== run) return;
    if (p.pauseMs) await wait(p.pauseMs);
  }
}

export function stopSpeaking(bump = true) {
  if (bump) run++;
  cloud?.cancel();
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
