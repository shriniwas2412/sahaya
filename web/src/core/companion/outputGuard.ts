// OutputGuard: the last step before speech, for model AND scripted text.
//  1. strip markdown, lists, links, emoji and stage directions (it is spoken);
//  2. block medicine/dose/diagnosis talk → fixed safe line;
//  3. block caregiver avoid-phrases → caller substitutes a scripted redirect;
//  4. cap length by stage, and keep at most one question.

import type { Lang, Stage } from "./types.ts";
import { lengthRule } from "./prompt.ts";
import { matchPhrases } from "./triggers.ts";

export type GuardReason = "medical" | "trigger" | "empty" | "trimmed" | "stripped" | "persona";

export interface GuardResult {
  /** Text to speak, or null when the caller must use a scripted line instead. */
  text: string | null;
  reasons: GuardReason[];
}

export interface GuardOptions {
  stage: Stage | null;
  lang: Lang;
  avoid?: readonly string[];
}

const MEDICAL_LINE: Record<"hi" | "en", string> = {
  hi: "दवा की बात आपके घरवाले या डॉक्टर ही बताएँगे। चलिए, कुछ और बात करते हैं।",
  en: "Your family or doctor will help with medicines. Let's talk about something nice.",
};

const MEDICAL: RegExp[] = [
  // amounts with units
  /\d+(?:\.\d+)?\s*(?:mg|mcg|ml|iu|units?|tablets?|pills?|capsules?|drops?|गोली|गोलियाँ|गोलियां|टैबलेट|कैप्सूल)(?![\p{L}])/iu,
  // dose words
  /(?<![\p{L}])(?:dose|doses|dosage|overdose|prescri\w*|खुराक|डोज़|डोज)(?![\p{L}])/iu,
  // common drug names and classes
  /(?<![\p{L}])(?:paracetamol|crocin|dolo|calpol|aspirin|ibuprofen|combiflam|diclofenac|insulin|metformin|glimepiride|donepezil|memantine|rivastigmine|galantamine|amlodipine|telmisartan|losartan|atorvastatin|pantoprazole|omeprazole|alprazolam|antibiotics?|painkillers?|sleeping pills?|पैरासिटामोल|पेनकिलर|नींद की गोली|इंसुलिन)(?![\p{L}])/iu,
  // instructions to take / change medicine
  /(?<![\p{L}])(?:take|have|swallow|stop|skip|double|increase|reduce|change)\s+(?:your|a|an|the|one|two|three|another|extra|more|less|some)?\s*(?:extra\s+)?(?:medicines?|medications?|tablets?|pills?|capsules?|doses?)(?![\p{L}])/iu,
  /(?:दवा|दवाई|दवाइयाँ|गोली)\s*(?:लें|लीजिए|ले लीजिए|लो|ले लो|खाइए|खा लीजिए|खाओ|बंद|छोड़)/u,
  /(?<![\p{L}])(?:dawai|dawaai|dava|dawa|goli)\s+(?:le|lo|lijiye|le lo|le lijiye|kha|khao|khaiye|kha lo|band|chhod)(?![\p{L}])/iu,
  // diagnosis
  /(?<![\p{L}])you\s+(?:may\s+|might\s+|probably\s+|could\s+)?have\s+(?:dementia|alzheimer\w*|diabetes|cancer|a stroke|an infection|depression)/iu,
  /(?<![\p{L}])diagnos\w*/iu,
  /आपको\s+(?:डिमेंशिया|अल्ज़ाइमर|अल्जाइमर|शुगर|डायबिटीज़|डायबिटीज|कैंसर)\s+(?:है|हो सकता)/u,
];

const PERSONA_BREAK = /(?<![\p{L}])(?:as an ai|i am an ai|im an ai|i'm an ai|language model|chatbot|मैं एक एआई)(?![\p{L}])/iu;

export function isMedicalAdvice(text: string): boolean {
  return MEDICAL.some(re => re.test(text));
}

/** Make text speakable: no markdown, lists, links, emoji or stage directions. */
export function toSpeakable(text: string): string {
  let t = String(text ?? "");
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/`([^`]*)`/g, "$1");
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/https?:\/\/\S+/g, " ");
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1");
  t = t.replace(/\*[^*\n]+\*/g, " ");          // *smiles warmly*
  t = t.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");   // (softly) [pause]
  t = t.replace(/^\s{0,3}#{1,6}\s*/gm, "");
  // list items become sentences
  t = t.split(/\r?\n/).map(line => {
    const item = line.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, "").trim();
    if (!item) return "";
    return /[.!?।]$/.test(item) ? item : item !== line.trim() ? `${item}.` : item;
  }).filter(Boolean).join(" ");
  t = t.replace(/\p{Extended_Pictographic}|‍|️/gu, "");
  t = t.replace(/[*_#>|~]/g, " ");
  return t.replace(/\s+([,.!?।])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

function sentences(text: string): string[] {
  return text.match(/[^.!?।]+[.!?।]+["'”’)]*|[^.!?।]+$/g)?.map(s => s.trim()).filter(Boolean) ?? [];
}

/** Cap to the stage's sentence and character limits, keeping at most one question. */
export function capLength(text: string, stage: Stage | null, lang: Lang): string {
  const rule = lengthRule(stage);
  const kept: string[] = [];
  for (const s of sentences(text)) {
    if (kept.length >= rule.maxSentences) break;
    kept.push(s);
    if (s.endsWith("?")) break;
  }
  let out = kept.join(" ");
  if (out.length > rule.maxChars) {
    const cut = out.slice(0, rule.maxChars);
    const space = cut.lastIndexOf(" ");
    out = (space > rule.maxChars / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, "");
    if (!/[.!?।]$/.test(out)) out += lang === "en" || lang === "gu" ? "." : "।";
  }
  return out;
}

export function guardOutput(text: string, opts: GuardOptions): GuardResult {
  const reasons: GuardReason[] = [];
  const speakable = toSpeakable(text);
  if (speakable !== String(text ?? "").trim()) reasons.push("stripped");
  if (!speakable) return { text: null, reasons: [...reasons, "empty"] };

  if (isMedicalAdvice(speakable)) {
    const line = MEDICAL_LINE[opts.lang === "en" ? "en" : "hi"];
    return { text: capLength(line, opts.stage, opts.lang), reasons: [...reasons, "medical"] };
  }
  if (opts.avoid?.length && matchPhrases(speakable, opts.avoid).length) {
    return { text: null, reasons: [...reasons, "trigger"] };
  }

  let body = speakable;
  if (PERSONA_BREAK.test(body)) {
    body = sentences(body).filter(s => !PERSONA_BREAK.test(s)).join(" ");
    reasons.push("persona");
    if (!body) return { text: null, reasons: [...reasons, "empty"] };
  }
  const capped = capLength(body, opts.stage, opts.lang);
  if (capped !== body) reasons.push("trimmed");
  return { text: capped, reasons };
}
