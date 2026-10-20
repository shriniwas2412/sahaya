import type { Dict } from "./i18n.ts";

/** Human words for a logged safety event, instead of internal codes. */
export function describeSafety(t: Dict, trigger: string, action: string | null): string {
  const a = action ?? "";
  const call = /^call_(family|helpline)_(\d+)$/.exec(a);
  const what = call ? (call[1] === "helpline" ? t.calledHelpline : t.calledN(call[2])) : t.safetyAction[a] ?? a;
  return `${t.safetyTrigger[trigger] ?? trigger} · ${what}`;
}
