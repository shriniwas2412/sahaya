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

const TABS = ["today", "profile", "activities", "account"] as const;
type Tab = (typeof TABS)[number];

export function Home({ tab: initial }: { tab?: string }) {
  const { t } = useApp();
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(initial ?? "") ? (initial as Tab) : "today");
  const labels: Record<Tab, string> = { today: t.tabToday, profile: t.tabProfile, activities: t.tabActivities, account: t.tabAccount };
  return (
    <>
      <header class="topbar">
        <div class="inner"><span class="brand">{t.appName}</span><LangToggle /></div>
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
  const recent = [...data.safety].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  const sessions = [...data.sessions].sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? "")).slice(0, 5);

  return (
    <>
      <section class="card stack">
        <h1>{elder.display_name}</h1>
        <p class="muted">{elder.gds_stage ? `GDS ${elder.gds_stage} · ${GDS[elder.gds_stage].title[lang]}` : t.notAssessed}</p>
        <button class="primary block" style="min-height:64px;font-size:var(--fs-lg)" onClick={startElder}>{t.startElder}</button>
      </section>

      <section class="card">
        <h2>{t.todayDoses}</h2>
        {!doses.length && <p class="muted">{t.noDosesToday}</p>}
        <ul class="list">
          {doses.map((d) => {
            const m = data.meds.find((x) => x.id === d.medicine_id);
            const open = !["taken", "skipped"].includes(d.status);
            const late = d.status === "missed" || d.status === "escalated";
            const msg = m ? missedDoseMessage(elder.display_name, m.name, d.scheduled_at, IST_OFFSET_MIN, uiLang(elder.language)) : "";
            const wa = late && first ? waLink(first.phone, msg) : null;
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
                    {wa && <a class="btn" href={wa} target="_blank" rel="noopener">{t.alertFamily}</a>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section class="card">
        <h2>{t.safetyTitle}</h2>
        {!recent.length && <p class="muted">{t.noSafety}</p>}
        <ul class="list">
          {recent.map((s) => <li><strong>{new Date(s.at).toLocaleString(lang === "hi" ? "hi-IN" : "en-IN")}</strong> · {s.trigger} · {s.action}{s.matched ? ` · “${s.matched}”` : ""}</li>)}
        </ul>
      </section>

      <section class="card">
        <h2>{t.lastSessions}</h2>
        <ul class="list">
          {sessions.filter((s) => s.mode === "companion").map((s) => (
            <li>{new Date(s.started_at ?? "").toLocaleString(lang === "hi" ? "hi-IN" : "en-IN")} · {s.feedback_mood ? t.moods[s.feedback_mood - 1] : "—"}</li>
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
