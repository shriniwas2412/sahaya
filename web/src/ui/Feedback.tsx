// 30-second caregiver form after an elder-mode session. Writes session.feedback_*,
// which the companion reads next time to weight topics.

import { useEffect, useState } from "preact/hooks";
import { useApp, type SessionRow } from "./App.tsx";
import { Icon } from "./icons.tsx";

const FACES = ["😣", "🙁", "😐", "🙂", "😄"];

export function Feedback({ sessionId }: { sessionId: string }) {
  const { repo, t, data, go } = useApp();
  const s = data.sessions.find((x) => x.id === sessionId);
  const [mood, setMood] = useState<number | null>(null);
  const [keep, setKeep] = useState<string[]>([]);
  const [avoid, setAvoid] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  useEffect(() => { if (!s) go({ name: "home" }); }, [s]);
  if (!s) return null;
  // This session's topics first, then the rest, so any topic can be kept or avoided.
  const topics = [...new Set([...(s.topics ?? []), ...Object.keys(t.topic)])];
  const toggle = (list: string[], set: (v: string[]) => void, v: string, other: string[], setOther: (v: string[]) => void) => {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
    if (other.includes(v)) setOther(other.filter((x) => x !== v));
  };
  async function save() {
    await repo.save<SessionRow>("session", { ...s!, feedback_mood: mood, feedback_keep: keep, feedback_avoid: avoid, feedback_notes: notes.trim() || null });
    go({ name: "home" });
  }
  return (
    <div class="page stack">
      <h1>{t.fbTitle(data.elder?.display_name ?? "")}</h1>
      <p class="muted">{t.fbHint}</p>
      <div class="faces" role="radiogroup" aria-label={t.fbTitle(data.elder?.display_name ?? "")}>
        {FACES.map((f, i) => (
          <button type="button" role="radio" aria-checked={mood === i + 1} aria-label={t.moods[i]} onClick={() => setMood(i + 1)}>{f}</button>
        ))}
      </div>
      {mood && <p class="small muted" aria-live="polite">{t.moods[mood - 1]}</p>}
      <fieldset class="card">
        <legend><strong>{t.fbKeep}</strong></legend>
        <div class="chips keep">{topics.map((k) => <button type="button" class="chip" aria-pressed={keep.includes(k)} onClick={() => toggle(keep, setKeep, k, avoid, setAvoid)}>{keep.includes(k) && <Icon name="check" size={20} />}{t.topic[k] ?? k}</button>)}</div>
      </fieldset>
      <fieldset class="card">
        <legend><strong>{t.fbAvoid}</strong></legend>
        <div class="chips avoid">{topics.map((k) => <button type="button" class="chip" aria-pressed={avoid.includes(k)} onClick={() => toggle(avoid, setAvoid, k, keep, setKeep)}>{avoid.includes(k) && <Icon name="cross" size={20} />}{t.topic[k] ?? k}</button>)}</div>
      </fieldset>
      <div class="field">
        <label for="fbn">{t.fbNotes} ({t.optional})</label>
        <textarea id="fbn" value={notes} onInput={(e) => setNotes(e.currentTarget.value)} />
      </div>
      <div class="row">
        <button type="button" onClick={() => go({ name: "home" })}>{t.fbSkip}</button>
        <button type="button" class="primary grow" onClick={save}>{t.fbSave}</button>
      </div>
    </div>
  );
}
