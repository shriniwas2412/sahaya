import { useEffect, useState } from "preact/hooks";
import { useApp, type SessionRow } from "./App.tsx";
import { LangToggle } from "./bits.tsx";
import { Activities } from "./Activities.tsx";
import { Account } from "./Account.tsx";
import { GDS } from "../core/gds.ts";
import { LANGUAGES, uiLang } from "../core/profile.ts";
import { step, missedDoseMessage, localClock, DEFAULT_ESCALATE_MIN, type DoseEvent } from "../core/doses.ts";
import { localDay, IST_OFFSET_MIN } from "../core/doseTick.ts";
import { waLink } from "../core/contacts.ts";
import { ulid } from "../core/ids.ts";
import { dialAction } from "../data/demo.ts";
import { ConsentCard } from "./DataRights.tsx";
import { describeAction } from "./safetyText.ts";
import { WeekCard } from "./WeekCard.tsx";
import { DemoGuide } from "./Demo.tsx";
import { groupIncidents } from "../core/summary.ts";
import { greetingName } from "./elderText.ts";
import { Icon } from "./icons.tsx";

const FACES = ["😣", "🙁", "😐", "🙂", "😄"];

const TABS = ["today", "profile", "activities", "account"] as const;
type Tab = (typeof TABS)[number];

export function Home({ tab: initial }: { tab?: string }) {
  const { t, go } = useApp();
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(initial ?? "") ? (initial as Tab) : "today");
  const labels: Record<Tab, string> = { today: t.tabToday, profile: t.tabProfile, activities: t.tabActivities, account: t.tabAccount };
  return (
    <>
      <header class="topbar">
        <div class="inner">
          <span class="brand">{t.appName}</span>
          <button class="ghost" aria-label={t.aboutLink} onClick={() => go({ name: "about" })}><Icon name="info" size={24} /></button>
          <LangToggle />
        </div>
        <div class="tabs" role="tablist">
          {TABS.map((k) => (
            <button role="tab" id={`tab-${k}`} aria-controls={`panel-${k}`} aria-selected={tab === k} onClick={() => setTab(k)}>{labels[k]}</button>
          ))}
        </div>
      </header>
      <main class="page stack" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "today" && <Today />}
        {tab === "profile" && <Profile />}
        {tab === "activities" && <Activities />}
        {tab === "account" && <Account />}
      </main>
    </>
  );
}

function Today() {
  const { repo, t, lang, data, go } = useApp();
  const elder = data.elder!;
  const today = localDay(Date.now(), IST_OFFSET_MIN);
  const doses = data.doses.filter((d) => d.id.includes(`:${today}T`)).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const first = [...elder.family_contacts].sort((a, b) => a.order - b.order)[0];

  async function startElder() {
    const s: SessionRow = {
      id: ulid(), elder_id: elder.id, mode: "companion", started_at: new Date().toISOString(), ended_at: null,
      stage_at_session: elder.gds_stage, language: elder.language, topics: [], feedback_mood: null, feedback_keep: [], feedback_avoid: [], feedback_notes: null,
    };
    await repo.save("session", s);
    await repo.backend.setMeta("elder_mode_session", s.id);
    document.documentElement.requestFullscreen?.().catch(() => {});
    (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.("portrait").catch(() => {});
    go({ name: "elder", sessionId: s.id });
  }

  async function act(d: DoseEvent, kind: "take" | "skip") {
    const m = data.meds.find((x) => x.id === d.medicine_id);
    const next = step(d, kind === "take" ? { type: "take", by: "caregiver" } : { type: "skip", by: "caregiver" }, Date.now(), m?.escalate_after_min ?? DEFAULT_ESCALATE_MIN);
    if (next !== d) await repo.save("dose_event", next);
  }

  const clock = (iso: string) => { const { h, m } = localClock(iso, IST_OFFSET_MIN); return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };
  const incidents = groupIncidents(data.safety).slice(0, 5);
  const sessions = [...data.sessions].sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? "")).filter((s) => s.mode === "companion").slice(0, 5);
  const [convs, setConvs] = useState<Record<string, { who: "elder" | "sahaya"; text: string }[]>>({});
  useEffect(() => { repo.backend.getMeta<typeof convs>("demo_conversations").then((c) => setConvs(c ?? {})); }, [repo]);
  const lastMood = sessions.find((s) => s.feedback_mood)?.feedback_mood ?? null;
  // Hindi uses the 24-hour clock, so a Hindi month never sits next to an English "am".
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: lang !== "hi" });

  return (
    <>
      <section class="card hero-card stack">
        <div class="row">
          <div class="grow">
            {data.elders.length > 1 && (
              <label class="resident-pick small">{t.residentLabel}{" "}
                <select value={elder.id} onChange={async (ev) => { await repo.backend.setMeta("active_elder", ev.currentTarget.value); repo.changed(); }}>
                  {data.elders.map((x) => <option value={x.id}>{x.display_name}{x.gds_stage ? ` · GDS ${x.gds_stage}` : ""}</option>)}
                </select>
              </label>
            )}
            <h1>{elder.display_name}</h1>
            <p class="muted">{elder.gds_stage ? `GDS ${elder.gds_stage} · ${GDS[elder.gds_stage].title[lang]}` : t.notAssessed}</p>
          </div>
          {lastMood && <span class="mood" title={t.lastMood} aria-label={`${t.lastMood}: ${t.moods[lastMood - 1]}`}>{FACES[lastMood - 1]}</span>}
        </div>
        <button class="primary block big" onClick={startElder}>{t.startElder}</button>
        {!elder.ngo_helpline && !data.demo && <p class="hint-warn" role="note">{t.helplineMissing}</p>}
      </section>

      <DemoGuide />

      <section class="card">
        <h2>{t.todayDoses}</h2>
        {!doses.length && <p class="muted">{t.noDosesToday}</p>}
        <ul class="list">
          {doses.map((d) => {
            const m = data.meds.find((x) => x.id === d.medicine_id);
            const open = !["taken", "skipped"].includes(d.status);
            const late = d.status === "missed" || d.status === "escalated";
            const msg = m ? missedDoseMessage(elder.display_name, m.name, d.scheduled_at, IST_OFFSET_MIN, uiLang(elder.language)) : "";
            const waHref = late && first ? waLink(first.phone, msg) : null;
            const wa = waHref ? dialAction(waHref, data.demo) : null;
            return (
              <li class="stack">
                <div class="row">
                  <strong class="grow">{clock(d.scheduled_at)} · {m?.name}{m?.dose ? ` · ${m.dose}` : ""}</strong>
                  <span class={`badge ${d.status}`}>{t.status[d.status]}</span>
                </div>
                {open && (
                  <div class="row">
                    <button onClick={() => act(d, "take")}>✓ {t.markTaken}</button>
                    <button class="ghost" onClick={() => act(d, "skip")}>{t.markSkipped}</button>
                    {wa?.kind === "open" && <a class="btn" href={wa.href} target="_blank" rel="noopener">{t.alertFamily}</a>}
                    {wa?.kind === "preview" && <span class="small muted">{t.demoNoDial} <code>{wa.label}</code></span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section class="card">
        <h2>{t.safetyTitle}</h2>
        {!incidents.length && <p class="muted">{t.noSafety}</p>}
        <ul class="list">
          {incidents.map((g) => {
            const urgent = g.some((e) => e.trigger !== "missed_dose");
            const resolved = g.some((e) => e.resolved_at || e.action === "connected" || e.action === "declined");
            const said = g.find((e) => e.trigger === "keyword" && e.matched)?.matched;
            return (
              <li class={`incident${urgent ? " urgent" : ""}`}>
                <strong>{when(g[0].at)}</strong>{said ? ` · “${said}”` : ""}
                <span class="block-line">{t.safetyTrigger[g[0].trigger] ?? g[0].trigger} · {g.map((e) => describeAction(t, e.action)).join(" → ")}</span>
                {resolved && <span class="badge taken">{t.resolved}</span>}
              </li>
            );
          })}
        </ul>
      </section>

      <WeekCard />

      <section class="card">
        <h2>{t.lastSessions}</h2>
        <ul class="list">
          {!sessions.length && <li class="muted">{t.noSessions}</li>}
          {sessions.map((s) => (
            <li class="stack">
              <div class="row">
                <span class="grow">{when(s.started_at ?? "")}</span>
                <span>{s.feedback_mood ? `${FACES[s.feedback_mood - 1]} ${t.moods[s.feedback_mood - 1]}` : "—"}</span>
              </div>
              {convs[s.id] && (
                <details class="conv">
                  <summary>{t.sampleConv}</summary>
                  <ol class="conv-lines" lang={uiLang(elder.language)}>
                    {convs[s.id].map((l) => <li class={l.who}><span class="small muted">{l.who === "elder" ? t.you : t.sahayaWho}:</span> {l.text}</li>)}
                  </ol>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>
      <p class="small muted">{t.notMedical}</p>
    </>
  );
}

function Profile() {
  const { repo, t, lang, data, go } = useApp();
  const e = data.elder!;
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => { repo.backend.getMeta<string>(`photo:${e.id}`).then((p) => setPhoto(p ?? null)); }, [repo, e.id]);
  const langLabel = LANGUAGES.find((l) => l.code === e.language && (l.dialect ?? null) === (e.dialect ?? null))?.label ?? e.language;

  async function pick(file: File | undefined) {
    if (!file) return;
    const url = await shrink(file);
    await repo.backend.setMeta(`photo:${e.id}`, url);
    setPhoto(url);
  }

  const rows: [string, string][] = [
    [t.name, e.display_name],
    [t.s2Title, e.gds_stage ? `${e.gds_stage} · ${GDS[e.gds_stage].title[lang]}` : t.notAssessed],
    [t.s3Title, langLabel ?? "—"],
    [t.persona, e.persona_name],
    [t.prefs, e.preferences.join(", ") || "—"],
    [t.triggers, e.triggers.join(", ") || "—"],
    [t.sundown, e.sundown_start && e.sundown_end ? `${e.sundown_start}–${e.sundown_end}` : "—"],
    [t.s5Title, e.family_contacts.map((c) => `${c.order}. ${c.name}`).join(", ") || "—"],
    [t.helpline, e.ngo_helpline ?? "—"],
    [t.s6Title, data.meds.map((m) => `${m.name} (${m.times.join(", ")})`).join("; ") || "—"],
  ];
  return (
    <>
      <section class="card">
        <dl>
          {rows.map(([k, v]) => <><dt class="muted small">{k}</dt><dd style="margin:0 0 12px">{v}</dd></>)}
        </dl>
        <button class="primary" onClick={() => go({ name: "setup", edit: true })}>{t.edit}</button>
      </section>
      <section class="card stack">
        <h2>{lang === "hi" ? "परिवार की फ़ोटो (सिर्फ़ इसी फ़ोन पर)" : "Family photo (stays on this phone)"}</h2>
        {photo && <img src={photo} alt="" style="width:120px;height:120px;border-radius:50%;object-fit:cover" />}
        <label class="btn" style="width:fit-content">
          {lang === "hi" ? "फ़ोटो चुनें" : "Choose photo"}
          <input type="file" accept="image/*" class="sr-only" onChange={(ev) => pick(ev.currentTarget.files?.[0])} />
        </label>
      </section>
      {data.demo && !e.ngo_helpline && <p class="card soft small" role="note">{t.demoHelplineNote}</p>}
      <ConsentCard />
    </>
  );
}

/** Resize a photo to 320 px so it fits in local storage. */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = 320 / Math.max(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * Math.min(1, s));
      c.height = Math.round(img.height * Math.min(1, s));
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
