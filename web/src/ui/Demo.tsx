// First-run welcome (set up, or try the demo) and the demo banner.
import { useEffect, useState } from "preact/hooks";
import { useApp } from "./App.tsx";
import { LangToggle } from "./bits.tsx";
import { DEMO_PIN } from "../data/demo.ts";
import { enterDemo, leaveDemo } from "../data/demoMode.ts";

export function Welcome() {
  const { t, go } = useApp();
  return (
    <div class="page stack welcome">
      <div class="row">
        <span class="brand">{t.appName}</span>
        <LangToggle />
      </div>
      <section class="hero stack">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width="72" height="72" />
        <h1>{t.welcomeTitle}</h1>
        <p class="lead">{t.welcomeBody}</p>
        <button class="primary block big" onClick={() => go({ name: "setup", edit: false })}>{t.start}</button>
      </section>
      <section class="card soft stack">
        <button class="block" onClick={() => enterDemo()}>{t.tryDemo}</button>
        <p class="small muted">{t.tryDemoHint}</p>
      </section>
      <p class="small muted">{t.notMedical}</p>
      <button class="ghost" style="width:fit-content" onClick={() => go({ name: "about" })}>{t.aboutLink}</button>
    </div>
  );
}

/** F2: three steps that show the safety screen within a minute. Dismissible, demo only. */
export function DemoGuide() {
  const { repo, t, data } = useApp();
  const [hidden, setHidden] = useState<boolean | null>(null);
  const [tour, setTour] = useState(false);
  useEffect(() => { repo.backend.getMeta<boolean>("demo_guide_hidden").then((h) => setHidden(h === true)); }, [repo]);
  if (hidden !== false || !data.demo) return null;
  return (
    <section class="card guide stack" aria-labelledby="guide-h">
      <h2 id="guide-h">{t.guideTitle}</h2>
      <ol class="guide-steps">
        {t.guideSteps.map((x) => <li>{x}</li>)}
      </ol>
      <div class="row">
        <button class="primary" onClick={() => setTour(true)}>{t.tourStart}</button>
        <button class="ghost" style="width:fit-content" onClick={() => { setHidden(true); repo.backend.setMeta("demo_guide_hidden", true); }}>{t.guideHide}</button>
      </div>
      {tour && <Tour onClose={() => setTour(false)} />}
    </section>
  );
}

export function DemoBanner() {
  const { t } = useApp();
  const [asking, setAsking] = useState(false);
  const clear = () => leaveDemo();
  return (
    <div class="demo-banner" role="note">
      <span><strong>Demo / नमूना</strong> · {t.demoBanner} · {t.demoPin(DEMO_PIN)}</span>
      {asking ? (
        <span class="row" style="gap:4px" role="group" aria-label={t.demoClearConfirm}>
          <span>{t.demoClearConfirm}</span>
          <button class="ghost" onClick={clear}>{t.demoClearYes}</button>
          <button class="ghost" onClick={() => setAsking(false)}>{t.cancel}</button>
        </span>
      ) : (
        <button class="ghost" onClick={() => setAsking(true)}>{t.demoClear}</button>
      )}
    </div>
  );
}

/** Which resident each tour step shows (the incident step switches to Ramkali). */
const TOUR_ELDER = ["demo-elder", "demo-elder", "demo-elder", "demo-e2", "demo-e3", "demo-elder"];
export const TOUR_STEP_MS = 12_000;

/** About 70 s guided tour: six short cards, auto-advancing, pausable, keyboard friendly. */
export function Tour({ onClose }: { onClose(): void }) {
  const { repo, t } = useApp();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = t.tourSteps.length;
  useEffect(() => {
    repo.backend.setMeta("active_elder", TOUR_ELDER[i] ?? "demo-elder").then(() => repo.changed());
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (paused || i >= n - 1) return;
    const id = setTimeout(() => setI(i + 1), TOUR_STEP_MS);
    return () => clearTimeout(id);
  }, [i, paused]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);
  const [title, body] = t.tourSteps[i];
  return (
    <div class="tour" role="dialog" aria-modal="false" aria-labelledby="tour-h" onPointerEnter={() => setPaused(true)}>
      <p class="small muted">Demo / नमूना · {t.tourOf(i + 1, n)}</p>
      <h2 id="tour-h" tabIndex={-1} ref={(el) => el?.focus({ preventScroll: true })}>{title}</h2>
      <p>{body}</p>
      <div class="tour-bar" aria-hidden="true"><span style={{ width: `${((i + 1) / n) * 100}%` }} /></div>
      <div class="row">
        <button class="ghost" disabled={i === 0} onClick={() => { setPaused(true); setI(i - 1); }}>{t.tourBack}</button>
        {i < n - 1
          ? <button class="primary" onClick={() => { setPaused(true); setI(i + 1); }}>{t.tourNext}</button>
          : <button class="primary" onClick={onClose}>{t.tourDone}</button>}
      </div>
    </div>
  );
}
