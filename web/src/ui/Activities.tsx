// Caregiver-led memory activity (from the earlier Sahaya app): orientation, five words,
// animal naming, the five words again. Stored as a memory_activity session plus
// activity_score rows. Flags compare the person with their own first sessions only.

import { useEffect, useRef, useState } from "preact/hooks";
import { useApp, type ActivityRow, type SessionRow } from "./App.tsx";
import { orientationItems, listForSession, FLUENCY_SECONDS } from "../core/tasks.ts";
import { scoreSession, flags, DOMAINS, type Domain, type ScoredSession, type Scores } from "../core/scoring.ts";
import { ulid } from "../core/ids.ts";

const SHOWN: Domain[] = ["orientation", "immediate", "fluency", "delayed"];

export function activityHistory(sessions: SessionRow[], scores: ActivityRow[]): ScoredSession[] {
  return sessions
    .filter((s) => s.mode === "memory_activity" && s.started_at)
    .map((s) => {
      const sc: Scores = {};
      for (const a of scores) if (a.session_id === s.id && (a.task as Domain) in DOMAINS) sc[a.task as Domain] = a.score;
      return { date: s.started_at!.slice(0, 10), scores: sc };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function Activities() {
  const { t, data } = useApp();
  const [running, setRunning] = useState(false);
  const history = activityHistory(data.sessions, data.activities);
  const fl = flags(history);
  if (running) return <Run index={history.length} onDone={() => setRunning(false)} />;
  return (
    <>
      <section class="card stack">
        <h1>{t.actTitle}</h1>
        <p class="muted">{t.actHint}</p>
        <p class="card warn small">{t.actNotDiag}</p>
        <button class="primary" onClick={() => setRunning(true)}>{t.actStart}</button>
      </section>
      {fl.map((f) => <p class="card warn" role="status">{f.kind === "acute" ? t.flagAcute : t.flagDecline} ({t.domain[f.domain] ?? f.domain})</p>)}
      <section class="card">
        <h2>{t.history}</h2>
        {!history.length && <p class="muted">{t.noActivity}</p>}
        {!!history.length && (
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse">
              <thead><tr><th scope="col" style="text-align:left">📅</th>{SHOWN.map((d) => <th scope="col" style="text-align:right">{t.domain[d]}</th>)}</tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr style="border-top:1px solid var(--line)"><td>{h.date}</td>{SHOWN.map((d) => <td style="text-align:right">{h.scores[d] ?? "—"}{DOMAINS[d].max ? `/${DOMAINS[d].max}` : ""}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Run({ index, onDone }: { index: number; onDone(): void }) {
  const { repo, t, lang, data } = useApp();
  const elder = data.elder!;
  const words = listForSession(index)[lang];
  const items = orientationItems(new Date(), elder.facility ?? "", lang);
  const [stage, setStage] = useState(0);
  const [orient, setOrient] = useState<(boolean | null)[]>(items.map(() => null));
  const [imm, setImm] = useState<boolean[]>(words.map(() => false));
  const [del, setDel] = useState<boolean[]>(words.map(() => false));
  const [count, setCount] = useState(0);
  const [left, setLeft] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearInterval(timer.current), []);

  function startTimer() {
    setLeft(FLUENCY_SECONDS);
    timer.current = window.setInterval(() => setLeft((s) => { if (s !== null && s <= 1) { clearInterval(timer.current); return 0; } return (s ?? 1) - 1; }), 1000);
  }

  async function finish() {
    const sc = scoreSession({
      orientation: orient.map(Boolean), immediate: imm, delayed: del, fluency: left === 0 || count ? count : null,
    });
    const s: SessionRow = {
      id: ulid(), elder_id: elder.id, mode: "memory_activity", started_at: new Date().toISOString(), ended_at: new Date().toISOString(),
      stage_at_session: elder.gds_stage, language: elder.language, topics: [], feedback_mood: null, feedback_keep: [], feedback_avoid: [], feedback_notes: null,
    };
    await repo.save("session", s);
    for (const d of SHOWN) if (sc[d] != null) await repo.save<ActivityRow>("activity_score", { id: ulid(), session_id: s.id, task: d, score: sc[d]!, max_score: DOMAINS[d].max });
    onDone();
  }

  const Checks = ({ v, set }: { v: boolean[]; set(x: boolean[]): void }) => (
    <div class="chips">{words.map((w, i) => <button type="button" class="chip" aria-pressed={v[i]} onClick={() => set(v.map((x, j) => (j === i ? !x : x)))}>{w}</button>)}</div>
  );

  return (
    <section class="card stack">
      {stage === 0 && (
        <>
          <h2>1. {t.domain.orientation}</h2>
          <ol class="list">
            {items.map((it, i) => (
              <li class="stack">
                <strong>{it.q[lang]}</strong>
                <span class="small muted">{t.answer}: {it.answer}</span>
                <div class="row">
                  <button aria-pressed={orient[i] === true} class={orient[i] === true ? "primary" : ""} onClick={() => setOrient(orient.map((x, j) => (j === i ? true : x)))}>{t.correct}</button>
                  <button aria-pressed={orient[i] === false} class={orient[i] === false ? "danger" : ""} onClick={() => setOrient(orient.map((x, j) => (j === i ? false : x)))}>{t.wrong}</button>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {stage === 1 && (
        <>
          <h2>2. {t.learnTitle}</h2>
          <p class="muted">{t.learnHint}</p>
          <p style="font-size:var(--fs-xl);font-weight:700">{words.join(" · ")}</p>
          <p><strong>{t.immediateQ}</strong></p>
          <Checks v={imm} set={setImm} />
        </>
      )}
      {stage === 2 && (
        <>
          <h2>3. {t.fluencyTitle}</h2>
          <p class="muted">{t.fluencyHint}</p>
          {left === null ? <button class="primary" onClick={startTimer}>{t.startTimer}</button> : <p aria-live="polite" style="font-size:var(--fs-xl)">{left === 0 ? t.timeUp : `${left} s`}</p>}
          <div class="row">
            <button class="primary" style="min-height:72px;min-width:120px;font-size:var(--fs-xl)" disabled={left === null || left === 0} onClick={() => setCount(count + 1)}>+1</button>
            <strong style="font-size:var(--fs-xl)" aria-live="polite">{count}</strong>
            <button class="ghost" disabled={!count} onClick={() => setCount(count - 1)}>−1</button>
          </div>
        </>
      )}
      {stage === 3 && (
        <>
          <h2>4. {t.delayedTitle}</h2>
          <p class="muted">{t.delayedHint}</p>
          <Checks v={del} set={setDel} />
        </>
      )}
      <div class="row">
        <button onClick={() => (stage ? setStage(stage - 1) : onDone())}>{stage ? t.back : t.cancel}</button>
        {stage < 3 ? <button class="primary grow" onClick={() => setStage(stage + 1)}>{t.next}</button> : <button class="primary grow" onClick={finish}>{t.save}</button>}
      </div>
    </section>
  );
}
