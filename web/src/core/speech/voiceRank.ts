// Pick the most natural-sounding browser voice for a language.
//
// Browsers expose very different voice lists: Edge has Microsoft "Online (Natural)"
// neural voices, Chrome has "Google हिन्दी", Safari/macOS have Apple voices (some
// marked "Enhanced"/"Premium"), Android has its system voices, and Linux often only
// eSpeak. Names are the only signal, so this is a heuristic ranking, not a measure.

import type { VoiceLike } from "./webSpeech.ts";

export interface RankedVoice { voice: VoiceLike; score: number; why: string[] }

const norm = (l: string) => l.replace("_", "-").toLowerCase();

export function scoreVoice(v: VoiceLike, locale: string): RankedVoice | null {
  const want = norm(locale), base = want.split("-")[0];
  const lang = norm(v.lang);
  const why: string[] = [];
  let score = 0;
  if (lang === want) { score += 30; why.push("exact language"); }
  else if (lang.split("-")[0] === base) { score += 15; why.push("same language"); }
  else return null;
  const n = v.name.toLowerCase();
  if (/natural|neural/.test(n)) { score += 50; why.push("neural"); }
  else if (/^google|google /.test(n)) { score += 40; why.push("Google"); }
  else if (/premium|enhanced|siri/.test(n)) { score += 35; why.push("enhanced"); }
  else if (/microsoft/.test(n)) { score += 15; why.push("Microsoft"); }
  if (/espeak|robot|compact|novelty/.test(n)) { score -= 40; why.push("synthetic-sounding engine"); }
  if (v.localService) { score += 3; why.push("works offline"); }
  return { voice: v, score, why };
}

/** Voices for this locale, best first. Ties keep the browser's order. */
export function rankVoices(voices: readonly VoiceLike[], locale: string): RankedVoice[] {
  return voices.map((v, i) => ({ r: scoreVoice(v, locale), i }))
    .filter((x): x is { r: RankedVoice; i: number } => !!x.r)
    .sort((a, b) => b.r.score - a.r.score || a.i - b.i)
    .map((x) => x.r);
}

/** The caregiver's chosen voice if still present, else the best ranked one. */
export function chooseVoice(voices: readonly VoiceLike[], locale: string, preferred?: string | null): VoiceLike | null {
  const ranked = rankVoices(voices, locale);
  return ranked.find((r) => r.voice.name === preferred)?.voice ?? ranked[0]?.voice ?? null;
}
