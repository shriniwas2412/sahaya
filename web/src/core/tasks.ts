// Task content and generators. Our own word lists and items: not taken from
// MMSE, MoCA or any licensed instrument.

// Three lists of everyday, concrete words (fruit, furniture, nature, object, animal),
// rotated across sessions so the same senior does not learn one list.
export const WORD_LISTS = [
  { id: "A", hi: ["आम", "कुर्सी", "नदी", "घड़ी", "गाय"], en: ["mango", "chair", "river", "watch", "cow"] },
  { id: "B", hi: ["केला", "पलंग", "पहाड़", "चश्मा", "तोता"], en: ["banana", "bed", "mountain", "spectacles", "parrot"] },
  { id: "C", hi: ["अमरूद", "दरवाज़ा", "तालाब", "छाता", "बकरी"], en: ["guava", "door", "pond", "umbrella", "goat"] },
];

export function listForSession(sessionIndex: number) {
  return WORD_LISTS[((sessionIndex % WORD_LISTS.length) + WORD_LISTS.length) % WORD_LISTS.length];
}

type L = "en" | "hi";
const DAYS: Record<L, string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  hi: ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"],
};
const MONTHS: Record<L, string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  hi: ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"],
};

/** Orientation questions with the answer the caregiver checks against. */
export function orientationItems(date: Date, place: string, lang: L) {
  return [
    { id: "day", q: { en: "What day of the week is it today?", hi: "आज कौन सा दिन है?" }, answer: DAYS[lang][date.getDay()] },
    { id: "date", q: { en: "What is today's date?", hi: "आज कौन सी तारीख है?" }, answer: `${date.getDate()} (±1 ok)` },
    { id: "month", q: { en: "Which month is it?", hi: "कौन सा महीना चल रहा है?" }, answer: MONTHS[lang][date.getMonth()] },
    { id: "year", q: { en: "Which year is it?", hi: "कौन सा साल है?" }, answer: String(date.getFullYear()) },
    { id: "place", q: { en: "Where are we right now?", hi: "हम अभी कहां हैं?" }, answer: place || "—" },
  ];
}

/** Small seeded PRNG (mulberry32) so a session can be replayed in tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Digits 1-9, no digit repeated back to back. */
export function digitSequence(length: number, rand: () => number): number[] {
  const out: number[] = [];
  while (out.length < length) {
    const d = 1 + Math.floor(rand() * 9);
    if (d !== out[out.length - 1]) out.push(d);
  }
  return out;
}

export type SpanKind = "forward" | "backward";
export interface SpanState { kind: SpanKind; length: number; trial: number; failsAtLength: number; best: number; done: boolean }
export const SPAN: Record<SpanKind, { from: number; to: number }> = {
  forward: { from: 3, to: 7 },
  backward: { from: 2, to: 5 },
};

/**
 * Digit-span staircase: two trials per length; pass the length if either is right;
 * stop when both trials at a length fail. State is a plain object for easy testing.
 */
export function spanStart(kind: SpanKind): SpanState {
  return { kind, length: SPAN[kind].from, trial: 0, failsAtLength: 0, best: 0, done: false };
}
export function spanNext(state: SpanState, correct: boolean): SpanState {
  const s = { ...state };
  if (correct) {
    s.best = s.length;
    s.length += 1; s.trial = 0; s.failsAtLength = 0;
  } else {
    s.failsAtLength += 1; s.trial += 1;
    if (s.failsAtLength >= 2) { s.done = true; return s; }
  }
  if (s.length > SPAN[s.kind].to) s.done = true;
  return s;
}
export function expectedAnswer(digits: number[], kind: SpanKind): number[] {
  return kind === "backward" ? [...digits].reverse() : digits;
}

// Symbol match: the senior taps the picture that matches the one on top.
export const SYMBOLS = ["🌸", "🍎", "🐄", "☀️", "🏠", "🐟", "⭐", "🌙", "🚲", "🔔", "🥭", "🪔"];
export const SYMBOL_TRIALS = 16;

export function symbolTrial(rand: () => number): { target: string; options: string[] } {
  const pool = [...SYMBOLS];
  const options: string[] = [];
  for (let i = 0; i < 4; i++) options.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return { target: options[Math.floor(rand() * 4)], options };
}

export const FLUENCY_SECONDS = 60;
