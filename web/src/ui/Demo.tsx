// First-run welcome (set up, or try the demo) and the demo banner.
import { useEffect, useState } from "preact/hooks";
import { useApp } from "./App.tsx";
import { LangToggle } from "./bits.tsx";
import { loadDemo, clearDemo, DEMO_PIN } from "../data/demo.ts";

export function Welcome() {
  const { repo, t, go } = useApp();
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
        <button class="block" onClick={async () => { await loadDemo(repo); go({ name: "home" }); }}>{t.tryDemo}</button>
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
  useEffect(() => { repo.backend.getMeta<boolean>("demo_guide_hidden").then((h) => setHidden(h === true)); }, [repo]);
  if (hidden !== false || !data.demo) return null;
  return (
    <section class="card guide stack" aria-labelledby="guide-h">
      <h2 id="guide-h">{t.guideTitle}</h2>
      <ol class="guide-steps">
        {t.guideSteps.map((x) => <li>{x}</li>)}
      </ol>
      <button class="ghost" style="width:fit-content" onClick={() => { setHidden(true); repo.backend.setMeta("demo_guide_hidden", true); }}>{t.guideHide}</button>
    </section>
  );
}

export function DemoBanner() {
  const { repo, t, go } = useApp();
  const [asking, setAsking] = useState(false);
  async function clear() {
    await clearDemo(repo);
    go({ name: "welcome" });
  }
  return (
    <div class="demo-banner" role="note">
      <span><strong>{t.demoBanner}</strong> · Demo · {t.demoPin(DEMO_PIN)}</span>
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
