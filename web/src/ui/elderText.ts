// Small text helpers for the elder screen (pure, so they are tested in node).

import type { TurnTrace } from "../core/companion/index.ts";

/** "Shanti (demo)" -> "Shanti": the demo pill already labels the profile. */
export const greetingName = (name: string) => name.replace(/\s*\((demo|नमूना)\)\s*$/i, "").trim();

/** Join spoken parts with the Hindi full stop "।" in Hindi, ". " in English. */
export function sentence(parts: (string | null | undefined)[], lang: "hi" | "en"): string {
  const p = parts.map((x) => (x ?? "").trim().replace(/[।.]+$/, "")).filter(Boolean);
  if (!p.length) return "";
  return lang === "hi" ? `${p.join("। ")}।` : `${p.join(". ")}.`;
}

export type StepKey = "listen" | "safety" | "reply";
export interface StripStep { key: StepKey; on: boolean; active: boolean; note?: "ok" | "check" | "emergency" | "scripted" | "model" }

/**
 * The three-step strip under Sahaya's reply: सुन रहे हैं → सुरक्षा जांच → जवाब.
 * It lights each step the last turn passed through; while listening only the first pulses.
 */
export function strip(trace: TurnTrace | null, listening: boolean): StripStep[] {
  if (listening) return [{ key: "listen", on: true, active: true }, { key: "safety", on: false, active: false }, { key: "reply", on: false, active: false }];
  if (!trace) return [{ key: "listen", on: false, active: false }, { key: "safety", on: false, active: false }, { key: "reply", on: false, active: false }];
  const screened = trace.stages.includes("safety");
  const replied = trace.stages.some((s) => s !== "safety");
  return [
    { key: "listen", on: trace.heard.length > 0, active: false },
    { key: "safety", on: screened, active: false, note: screened ? (trace.safetyLevel === "none" ? "ok" : trace.safetyLevel) : undefined },
    { key: "reply", on: replied, active: false, note: replied ? trace.source : undefined },
  ];
}
