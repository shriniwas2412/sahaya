// F5: About this project and its limits, in plain words, with links.
import { useApp } from "./App.tsx";
import { LangToggle } from "./bits.tsx";

export function About() {
  const { t, go, data } = useApp();
  return (
    <div class="page stack about">
      <div class="row"><span class="brand">{t.appName}</span><LangToggle /></div>
      <button class="ghost" style="width:fit-content" onClick={() => go(data.elder ? { name: "home" } : { name: "welcome" })}>← {t.back}</button>
      <h1>{t.aboutTitle}</h1>
      {t.aboutSections.map(([h, body]) => (
        <section class="card stack">
          <h2>{h}</h2>
          {body.map((p) => <p>{p}</p>)}
        </section>
      ))}
      <section class="card stack">
        <h2>{t.aboutLinksTitle}</h2>
        <ul>
          <li><a href="https://github.com/shriniwas2412/sahaya" target="_blank" rel="noopener">{t.aboutRepo}</a></li>
          <li>Reisberg B. et al. The Global Deterioration Scale. Am J Psychiatry 1982;139:1136–1139.</li>
          <li><a href="https://developer.mozilla.org/docs/Web/API/Web_Speech_API" target="_blank" rel="noopener">Web Speech API (MDN)</a></li>
          <li><a href="https://ladakh.gov.in/elderline-14567-the-national-helpline-for-senior-citizens-launched-in-ladakh/" target="_blank" rel="noopener">Elderline 14567</a> · <a href="https://112.gov.in/" target="_blank" rel="noopener">112</a></li>
        </ul>
      </section>
    </div>
  );
}
