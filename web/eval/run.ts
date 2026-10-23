// Offline evaluation. Run: npm run eval (writes eval/report.json, prints Markdown).
//  1. Safety screen on a hand-written synthetic utterance set (eval/safety_set.ts).
//  2. Stage adherence of the offline (scripted) companion's replies per GDS stage.
//  3. Turn-pipeline latency in Node on this machine (a laptop, not a phone).
// Every number printed here comes from running this file; nothing is typed in by hand.

import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { screenText } from "../src/core/companion/safety.ts";
import { CompanionPipeline } from "../src/core/companion/pipeline.ts";
import { lengthRule } from "../src/core/companion/prompt.ts";
import { toProfile } from "../src/core/profile.ts";
import { generateDemo } from "../src/data/demoGen.ts";
import type { Stage } from "../src/core/companion/types.ts";
import { SAFETY_SET, type Level } from "./safety_set.ts";
import { stageMetrics, prf, type Prf } from "./metrics.ts";

const r2 = (x: number) => Math.round(x * 100) / 100;

// ---------- 1. safety ----------
export function evalSafety() {
  const rows = SAFETY_SET.map((it) => ({ ...it, pred: screenText(it.text).level as Level }));
  const per = (cls: Level): Prf => prf(rows.map((r) => [r.label === cls, r.pred === cls]));
  const alert = prf(rows.map((r) => [r.label !== "none", r.pred !== "none"]));
  const byTag: Record<string, { n: number; correct: number }> = {};
  const byLang: Record<string, { n: number; correct: number }> = {};
  for (const r of rows) {
    for (const [k, m] of [[r.tag, byTag], [r.lang, byLang]] as const) {
      m[k] ??= { n: 0, correct: 0 };
      m[k].n++;
      if (r.pred === r.label) m[k].correct++;
    }
  }
  const confusion: Record<string, Record<string, number>> = {};
  for (const r of rows) { confusion[r.label] ??= {}; confusion[r.label][r.pred] = (confusion[r.label][r.pred] ?? 0) + 1; }
  return {
    size: rows.length,
    counts: { emergency: rows.filter((r) => r.label === "emergency").length, check: rows.filter((r) => r.label === "check").length, none: rows.filter((r) => r.label === "none").length },
    exactAccuracy: r2(rows.filter((r) => r.pred === r.label).length / rows.length),
    emergency: per("emergency"), check: per("check"), anyAlert: alert, confusion,
    byTag: Object.fromEntries(Object.entries(byTag).map(([k, v]) => [k, { ...v, accuracy: r2(v.correct / v.n) }])),
    byLang: Object.fromEntries(Object.entries(byLang).map(([k, v]) => [k, { ...v, accuracy: r2(v.correct / v.n) }])),
    falseNegatives: rows.filter((r) => r.label !== "none" && r.pred === "none").map(({ text, lang, label, tag }) => ({ text, lang, label, tag })),
    underTriaged: rows.filter((r) => r.label === "emergency" && r.pred === "check").map(({ text, lang, tag }) => ({ text, lang, tag })),
    falsePositives: rows.filter((r) => r.label === "none" && r.pred !== "none").map(({ text, lang, pred, tag }) => ({ text, lang, pred, tag })),
  };
}

// ---------- 2. stage adherence ----------
const INPUTS: Record<"hi" | "en", string[]> = {
  hi: ["हाँ", "नहीं", "अच्छा", "गाना सुनाओ", "कहानी सुनाओ", "मेरी बेटी कहाँ है", "आज खाना अच्छा था", "पता नहीं", "मुझे काम पर जाना है", "हम्म", "ठीक है", "बारिश हो रही है"],
  en: ["yes", "no", "okay", "sing a song", "tell a story", "where is my daughter", "lunch was nice", "I don't know", "I need to go to work", "hmm", "fine", "it is raining"],
};

export async function evalStages() {
  const base = generateDemo(Date.parse("2026-10-20T06:00:00Z")).elder;
  const out: Record<string, ReturnType<typeof stageMetrics> & { stage: number; lang: string; maxSentencesAllowed: number }> = {};
  for (const lang of ["hi", "en"] as const) {
    const row = base.find((e) => (lang === "en" ? e.language === "en-IN" : e.language === "hi-IN" && !e.dialect))!;
    for (const stage of [1, 2, 3, 4, 5, 6, 7] as Stage[]) {
      const profile = toProfile({ ...row, gds_stage: stage });
      const turns: string[] = [];
      const pipe = new CompanionPipeline({ profile, feedback: [], clock: () => "10:30", now: () => 0 });
      turns.push(pipe.opener().say.join(" "));
      for (const text of INPUTS[lang]) turns.push((await pipe.turn(text)).say.join(" "));
      out[`${lang}-${stage}`] = { stage, lang, maxSentencesAllowed: lengthRule(stage).maxSentences, ...stageMetrics(turns, lang, lengthRule(stage).maxSentences) };
    }
  }
  return out;
}

// ---------- 3. latency ----------
export async function evalLatency(n = 400) {
  const row = generateDemo(Date.parse("2026-10-20T06:00:00Z")).elder[0];
  const pipe = new CompanionPipeline({ profile: toProfile(row), feedback: [], clock: () => "10:30", now: () => 0 });
  const texts = [...INPUTS.hi, ...SAFETY_SET.filter((s) => s.label === "none").map((s) => s.text)];
  for (let i = 0; i < 50; i++) await pipe.turn(texts[i % texts.length]); // warm-up
  const turn: number[] = [], screen: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = texts[i % texts.length];
    let a = performance.now(); screenText(t); screen.push(performance.now() - a);
    a = performance.now(); await pipe.turn(t); turn.push(performance.now() - a);
  }
  const q = (xs: number[], p: number) => { const s = [...xs].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 1000) / 1000; };
  return {
    runs: n, node: process.version, platform: `${process.platform}-${process.arch}`,
    note: "Measured in Node on a laptop with the offline scripted companion; not a phone, no network model.",
    turnMs: { median: q(turn, 0.5), p95: q(turn, 0.95) }, safetyScreenMs: { median: q(screen, 0.5), p95: q(screen, 0.95) },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const safety = evalSafety();
  const stages = await evalStages();
  const latency = await evalLatency();
  const report = { generated: "by eval/run.ts", data: "synthetic, hand-written; not field data", safety, stages, latency };
  writeFileSync(new URL("./report.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  console.log(`## Safety screen (${safety.size} synthetic utterances: ${safety.counts.emergency} emergency, ${safety.counts.check} check, ${safety.counts.none} none)\n`);
  console.log("| Class | Precision | Recall | F1 | Support |\n|---|---|---|---|---|");
  for (const [k, v] of [["emergency", safety.emergency], ["check", safety.check], ["any alert", safety.anyAlert]] as const) console.log(`| ${k} | ${pct(v.precision)} | ${pct(v.recall)} | ${pct(v.f1)} | ${v.support} |`);
  console.log(`\nFalse negatives (${safety.falseNegatives.length}):`);
  for (const f of safety.falseNegatives) console.log(`- "${f.text}" (${f.lang}, ${f.tag}, should be ${f.label})`);
  console.log(`Under-triaged emergency -> check (${safety.underTriaged.length}):`);
  for (const f of safety.underTriaged) console.log(`- "${f.text}" (${f.lang}, ${f.tag})`);
  console.log(`False positives (${safety.falsePositives.length}):`);
  for (const f of safety.falsePositives) console.log(`- "${f.text}" (${f.lang}, ${f.tag}) -> ${f.pred}`);
  console.log("\n## Stage adherence (offline companion, 13 turns per stage)\n");
  console.log("| Lang | Stage | Words/sentence | Max sentences/turn (allowed) | Questions/turn (max) | Turns within limits | Banned phrases |\n|---|---|---|---|---|---|---|");
  for (const s of Object.values(stages)) console.log(`| ${s.lang} | ${s.stage} | ${s.wordsPerSentence} | ${s.maxSentences} (${s.maxSentencesAllowed}) | ${s.questionsPerTurn} (${s.maxQuestions}) | ${pct(s.withinLimits)} | ${s.banned} |`);
  console.log(`\n## Latency (${latency.runs} turns, ${latency.platform}, Node ${latency.node})\n`);
  console.log(`Turn: median ${latency.turnMs.median} ms, p95 ${latency.turnMs.p95} ms. Safety screen: median ${latency.safetyScreenMs.median} ms, p95 ${latency.safetyScreenMs.p95} ms.`);
}
