// Make text easier to listen to before it reaches any TTS engine:
//  - strip emoji and symbols a voice would read out ("*", "#", "→");
//  - write Hindi numbers, clock times and dates as words, so the voice does not
//    read "8:30" as "eight colon thirty" or switch to English digits;
//  - split into short phrases with pauses: short at commas, longer at sentence
//    ends, and 2.5 s after a question (the companion prompt asks for 2–3 s).

export interface Phrase { text: string; pauseMs: number }

export const PAUSE = { comma: 250, sentence: 550, question: 2500 } as const;

const HI_NUM = (
  "शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस " +
  "इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस " +
  "इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ " +
  "इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी अस्सी " +
  "इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानवे बानवे तिरानवे चौरानवे पचानवे छियानवे सत्तानवे अट्ठानवे निन्यानवे सौ"
).split(" ");

const HI_MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];

/** Hindi words for 0–9999; larger numbers stay as digits. */
export function hindiNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return String(n);
  if (n <= 100) return HI_NUM[n];
  const parts: string[] = [];
  const th = Math.floor(n / 1000), h = Math.floor((n % 1000) / 100), rest = n % 100;
  if (th) parts.push(`${HI_NUM[th]} हज़ार`);
  if (h) parts.push(`${HI_NUM[h]} सौ`);
  if (rest) parts.push(HI_NUM[rest]);
  return parts.join(" ");
}

/** "08:30" -> "सुबह साढ़े आठ बजे"; "20:00" -> "रात आठ बजे". */
export function hindiTime(h: number, m: number): string {
  const part = h < 4 ? "रात" : h < 12 ? "सुबह" : h < 16 ? "दोपहर" : h < 19 ? "शाम" : "रात";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (m === 0) return `${part} ${HI_NUM[h12]} बजे`;
  if (m === 30) return h12 === 1 ? `${part} डेढ़ बजे` : h12 === 2 ? `${part} ढाई बजे` : `${part} साढ़े ${HI_NUM[h12]} बजे`;
  if (m === 15) return `${part} सवा ${HI_NUM[h12]} बजे`;
  if (m === 45) { const nx = h12 === 12 ? 1 : h12 + 1; return `${part} पौने ${HI_NUM[nx]} बजे`; }
  return `${part} ${HI_NUM[h12]} बजकर ${HI_NUM[m]} मिनट`;
}

// Pictographs, dingbats, arrows, markdown and other marks a voice reads aloud.
const SYMBOLS = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2022}*#_~`|<>[\]{}^=+\\]/gu;

export function normalizeForSpeech(text: string, lang: string): string {
  let s = text.replace(SYMBOLS, " ");
  if (lang.startsWith("hi")) {
    s = s
      .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (all, d, mo, y) => {
        const mi = Number(mo) - 1;
        return mi >= 0 && mi < 12 ? `${hindiNumber(Number(d))} ${HI_MONTHS[mi]} ${hindiNumber(Number(y))}` : all;
      })
      .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (all, y, mo, d) => {
        const mi = Number(mo) - 1;
        return mi >= 0 && mi < 12 ? `${hindiNumber(Number(d))} ${HI_MONTHS[mi]} ${hindiNumber(Number(y))}` : all;
      })
      .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_, h, m) => hindiTime(Number(h), Number(m)))
      .replace(/₹\s?(\d+)/g, (_, n) => `${hindiNumber(Number(n))} रुपये`)
      .replace(/\b\d+\b/g, (n) => hindiNumber(Number(n)));
  }
  return s.replace(/\s+/g, " ").trim();
}

/** Split into phrases with pauses. Never returns empty phrases. */
export function phrases(text: string, lang: string): Phrase[] {
  const s = normalizeForSpeech(text, lang);
  const out: Phrase[] = [];
  const re = /[^,;:،…।.!?？]+[,;:،…।.!?？]*/gu;
  for (const m of s.matchAll(re)) {
    const raw = m[0].trim();
    const body = raw.replace(/[,;:،…।.!?？]+$/u, "").trim();
    if (!body) continue;
    const end = raw.slice(body.length);
    const pauseMs = /[?？]/.test(end) ? PAUSE.question : /[।.!]/.test(end) ? PAUSE.sentence : /[,;:،…]/.test(end) ? PAUSE.comma : PAUSE.sentence;
    out.push({ text: body + (end.includes("?") || end.includes("？") ? "?" : ""), pauseMs });
  }
  if (out.length) out[out.length - 1].pauseMs = /[?？]$/.test(out[out.length - 1].text) ? PAUSE.question : 0;
  return out;
}

/** Calm speaking rate: 0.9 for early stages, 0.85 from stage 4 (or when not assessed). */
export function calmRate(stage: number | null | undefined): number {
  return stage != null && stage <= 3 ? 0.9 : 0.85;
}
