import type { ComponentChildren } from "preact";
import { cloneElement, isValidElement } from "preact";
import { useState } from "preact/hooks";
import { useApp } from "./App.tsx";

let seq = 0;

/** Label + hint wired to the control with id / aria-describedby. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ComponentChildren }) {
  const [id] = useState(() => `f${++seq}`);
  const control = isValidElement(children)
    ? cloneElement(children, { id, "aria-describedby": hint ? `${id}h` : undefined } as Record<string, unknown>)
    : children;
  return (
    <div class="field">
      <label for={id}>{label}</label>
      {control}
      {hint && <span class="hint" id={`${id}h`}>{hint}</span>}
    </div>
  );
}

export function LangToggle() {
  const { lang, setLang, t } = useApp();
  const other = lang === "hi" ? "en" : "hi";
  return <button type="button" class="ghost" lang={other} onClick={() => setLang(other)}>{t.langToggle}</button>;
}
