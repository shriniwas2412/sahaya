// F3: the last 7 days from rows on this phone. Plain CSS bars, a WhatsApp share (text only,
// no number) and a print view. Nothing is estimated.

import { useApp } from "./App.tsx";
import { weekSummary, summaryText } from "../core/summary.ts";
import { IST_OFFSET_MIN } from "../core/doseTick.ts";
import { uiLang } from "../core/profile.ts";
import { greetingName } from "./elderText.ts";
import { Icon } from "./icons.tsx";

export function WeekCard() {
  const { t, lang, data } = useApp();
  const s = weekSummary({ doses: data.doses, sessions: data.sessions, safety: data.safety }, Date.now(), IST_OFFSET_MIN);
  const name = greetingName(data.elder!.display_name);
  const text = summaryText(s, name, uiLang(data.elder!.language) === "en" && lang === "en" ? "en" : lang);
  const max = Math.max(1, ...s.days.map((d) => d.taken + d.missed));
  const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { weekday: "short" });
  return (
    <section class="card stack week" aria-labelledby="wk-h">
      <h2 id="wk-h">{t.weekTitle}</h2>
      {s.empty ? <p class="muted">{t.weekEmpty}</p> : (
        <>
          <dl class="week-stats">
            <div><dt>{t.weekTaken}</dt><dd>{s.taken}</dd></div>
            <div><dt>{t.weekMissed}</dt><dd>{s.missed + s.escalated}</dd></div>
            <div><dt>{t.weekSessions}</dt><dd>{s.sessions} <span class="small muted">({s.minutes} {t.minShort})</span></dd></div>
            <div><dt>{t.weekMood}</dt><dd>{s.mood === null ? t.notRecorded : `${s.mood}/5`}{s.moodCount ? <span class="small muted"> ({s.moodCount})</span> : null}</dd></div>
            <div><dt>{t.weekAlerts}</dt><dd>{s.incidents}</dd></div>
          </dl>
          <div class="bars" role="img" aria-label={t.weekBarsLabel}>
            {s.days.map((d) => (
              <div class="bar-col">
                <div class="bar-stack" style={`height:${Math.round(((d.taken + d.missed) / max) * 100)}%`}>
                  {d.missed > 0 && <span class="bar missed" style={`flex:${d.missed}`} />}
                  {d.taken > 0 && <span class="bar taken" style={`flex:${d.taken}`} />}
                </div>
                <span class="bar-day">{dayLabel(d.day)}</span>
              </div>
            ))}
          </div>
          <p class="small muted legend"><span class="key taken" /> {t.weekTaken} <span class="key missed" /> {t.weekMissed}</p>
        </>
      )}
      <p class="small muted">{t.weekSource}</p>
      <div class="row no-print">
        <a class="btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener"><Icon name="share" size={22} /> {t.weekShare}</a>
        <button onClick={() => window.print()}><Icon name="print" size={22} /> {t.weekPrint}</button>
      </div>
    </section>
  );
}
