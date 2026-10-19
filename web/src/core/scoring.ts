// Session scores, baselines and "talk to the doctor" flags.
// These rules are for noticing change in one person over time. They are not
// diagnostic cut-offs and are not validated against any clinical instrument.

export type Domain = "orientation" | "immediate" | "delayed" | "forward" | "backward" | "fluency" | "symbol";
export type Scores = Partial<Record<Domain, number | null>> & { symbolMedianMs?: number | null };
export interface ScoredSession { date: string; scores: Scores }
export interface RawSession {
  orientation?: boolean[]; immediate?: boolean[]; delayed?: boolean[];
  forward?: number | null; backward?: number | null; fluency?: number | null;
  symbol?: { correct: boolean; ms: number }[];
}
export type Flag = { kind: "acute"; domain: Domain; value: number } | { kind: "decline"; domain: Domain; baseline: number; value: number };

export const DOMAINS: Record<Domain, { en: string; hi: string; max: number | null }> = {
  orientation: { en: "Orientation", hi: "समय-स्थान की जानकारी", max: 5 },
  immediate: { en: "Word recall (immediate)", hi: "शब्द याद (तुरंत)", max: 5 },
  delayed: { en: "Word recall (after 5 min)", hi: "शब्द याद (5 मिनट बाद)", max: 5 },
  forward: { en: "Digit span forward", hi: "अंक क्रम (सीधा)", max: 7 },
  backward: { en: "Digit span backward", hi: "अंक क्रम (उल्टा)", max: 5 },
  fluency: { en: "Animals named in 60 s", hi: "60 सेकंड में जानवरों के नाम", max: null },
  symbol: { en: "Symbol match (of 16)", hi: "चित्र मिलान (16 में से)", max: 16 },
};

export function median(xs: (number | null | undefined)[]): number | null {
  const v = (xs.filter((x) => Number.isFinite(x)) as number[]).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Turn raw task results into the stored score object. Missing tasks stay null. */
export function scoreSession(raw: RawSession): Scores {
  const count = (arr?: boolean[]) => Array.isArray(arr) ? arr.filter(Boolean).length : null;
  const sym = raw.symbol;
  return {
    orientation: count(raw.orientation),
    immediate: count(raw.immediate),
    delayed: count(raw.delayed),
    forward: raw.forward ?? null,
    backward: raw.backward ?? null,
    fluency: Number.isFinite(raw.fluency) ? raw.fluency : null,
    symbol: sym ? sym.filter((t) => t.correct).length : null,
    symbolMedianMs: sym ? median(sym.filter(t => t.correct).map(t => t.ms)) : null,
  };
}

/** Baseline per domain = mean of that domain over the first two sessions that have it. */
export function baseline(sessions: ScoredSession[]): Record<Domain, number | null> {
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const out = {} as Record<Domain, number | null>;
  for (const d of Object.keys(DOMAINS) as Domain[]) {
    const vals = sorted.map((s) => s.scores[d]).filter((x): x is number => Number.isFinite(x)).slice(0, 2);
    out[d] = vals.length === 2 ? (vals[0] + vals[1]) / 2 : null;
  }
  return out;
}

// How far below baseline counts as a real drop, per domain.
const DROP: Partial<Record<Domain, (b: number) => number>> = {
  orientation: b => b - 2,
  delayed: b => b - 2,
  fluency: b => Math.floor(b * 0.7),
  symbol: b => b - 4,
};

/**
 * Flags for the latest session.
 * - "acute": orientation 3 or less today. Sudden confusion can be delirium
 *   (infection, dehydration, a new medicine) and needs a same-day check.
 * - "decline": a domain at or below its drop line in the last TWO sessions,
 *   so one bad day does not raise a flag.
 */
export function flags(sessions: ScoredSession[]): Flag[] {
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.at(-1);
  if (!last) return [];
  const out: Flag[] = [];
  const o = last.scores.orientation;
  if (typeof o === "number" && o <= 3) {
    out.push({ kind: "acute", domain: "orientation", value: o });
  }
  if (sorted.length >= 4) {
    const base = baseline(sorted);
    const [prev, cur] = sorted.slice(-2);
    for (const [d, line] of Object.entries(DROP) as [Domain, (b: number) => number][]) {
      const bd = base[d];
      if (bd == null) continue;
      const limit = line(bd);
      const a = prev.scores[d], b = cur.scores[d];
      if (typeof a === "number" && typeof b === "number" && a <= limit && b <= limit) {
        out.push({ kind: "decline", domain: d, baseline: bd, value: b });
      }
    }
  }
  return out;
}

/** Which word list a resident's next session should use. */
export function nextListIndex(sessions: unknown[]): number {
  return sessions.length;
}
