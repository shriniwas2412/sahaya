// Locked elder mode. One calm screen: name, optional family photo, a big talk button,
// a big Help button, "say again" and volume. Medicine reminders appear here when due.
// Exit only by holding the top-right corner for 3 s, then the caregiver PIN.
// A browser page cannot fully lock an Android phone; this holds what the browser allows.

import { useEffect, useRef, useState } from "preact/hooks";
import { useApp, type SessionRow } from "./App.tsx";
import { CompanionPipeline, type TurnResult, type CallTarget, type LLMProvider } from "../core/companion/index.ts";
import { WebSpeechProvider, speechLocale, type SpeechProvider } from "../core/speech/index.ts";
import { toProfile, uiLang } from "../core/profile.ts";
import { currentReminder, step, doseTimeLabel, DEFAULT_ESCALATE_MIN } from "../core/doses.ts";
import { verifyPin, afterAttempt, isLocked, LONG_PRESS_MS, type Tries } from "../core/pin.ts";
import { ulid } from "../core/ids.ts";
import { speak, stopSpeaking } from "./voice.ts";
import { notifyCaregiver } from "./api.ts";
import { llmFromSettings, type LlmSettings } from "./llmSettings.ts";
import { dialAction } from "../data/demo.ts";
import { STRINGS } from "./i18n.ts";

const COPY = {
  hi: {
    hello: (n: string) => `नमस्ते, ${n}`, talk: "बात करें", listening: "सुन रहा हूँ…", again: "फिर से सुनाएँ",
    louder: "आवाज़ तेज़", softer: "आवाज़ धीमी", help: "मदद", yes: "हाँ, बुलाओ", no: "नहीं",
    call: (w: string) => `${w} को फ़ोन`, wa: "व्हाट्सऐप", connected: "बात हो गई", unanswered: "फ़ोन नहीं उठा",
    medTime: "दवाई का समय", taken: "ले ली", later: "थोड़ी देर में", close: "ठीक है",
    tapYes: "हाँ", tapNo: "नहीं", tapSong: "गाना", tapStory: "कहानी", helpline: "हेल्पलाइन",
    noContacts: "पास में किसी को आवाज़ दीजिए, या 112 पर फ़ोन कीजिए।", pin: "पिन डालें", wrong: "गलत पिन",
    holdHint: "देखभाल करने वाले: ऊपर दाएँ कोना 3 सेकंड दबाएँ",
  },
  en: {
    hello: (n: string) => `Hello, ${n}`, talk: "Talk", listening: "Listening…", again: "Say again",
    louder: "Louder", softer: "Softer", help: "Help", yes: "Yes, call", no: "No",
    call: (w: string) => `Call ${w}`, wa: "WhatsApp", connected: "We talked", unanswered: "No answer",
    medTime: "Medicine time", taken: "Taken", later: "In a little while", close: "OK",
    tapYes: "Yes", tapNo: "No", tapSong: "A song", tapStory: "A story", helpline: "Helpline",
    noContacts: "Please call out to someone nearby, or phone 112.", pin: "Enter PIN", wrong: "Wrong PIN",
    holdHint: "Caregiver: hold the top-right corner for 3 s",
  },
};

// Text fed to the pipeline for each big button when listening is not available.
const TAP_TEXT = { hi: { yes: "हाँ", no: "नहीं", song: "गाना सुनाओ", story: "कहानी सुनाओ" }, en: { yes: "yes", no: "no", song: "sing a song", story: "tell a story" } };

interface Consent { scope_audio_cloud: 0 | 1; subject_id: string; recorded_at: string; withdrawn_at?: string | null }
type Target = { target: CallTarget; tel?: string; wa?: string };

export function Elder({ sessionId }: { sessionId: string }) {
  const { repo, data } = useApp();
  const elder = data.elder!;
  const [ready, setReady] = useState<{ distress: string[]; photo: string | null; speech: SpeechProvider; stt: boolean; llm: LLMProvider | undefined } | null>(null);
  useEffect(() => {
    (async () => {
      const distress = (await repo.backend.getMeta<string[]>(`distress:${elder.id}`)) ?? [];
      const photo = (await repo.backend.getMeta<string>(`photo:${elder.id}`)) ?? null;
      const consent = (await repo.list<Consent>("consent"))
        .filter((c) => c.subject_id === elder.id && !c.withdrawn_at)
        .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
      const speech = new WebSpeechProvider({ consent: consent ?? null });
      const caps = await speech.capabilities(speechLocale(elder.language)).catch(() => ({ stt: false }));
      const llm = llmFromSettings(await repo.backend.getMeta<LlmSettings>("llm"));
      setReady({ distress, photo, speech, stt: caps.stt, llm });
    })();
  }, [repo, elder.id]);
  if (!ready) return <main class="elder" aria-busy="true" />;
  return <ElderScreen sessionId={sessionId} {...ready} />;
}

function ElderScreen({ sessionId, distress, photo, speech, stt, llm }: {
  sessionId: string; distress: string[]; photo: string | null; speech: SpeechProvider; stt: boolean; llm: LLMProvider | undefined;
}) {
  const { repo, data, go } = useApp();
  const elder = data.elder!;
  const lang = uiLang(elder.language);
  const c = COPY[lang];
  const locale = speechLocale(elder.language);
  // Built once per elder-mode session, so data reloads (dose ticks) keep the conversation state.
  const [{ profile, pipe }] = useState(() => {
    const profile = toProfile(elder, { customDistressWords: distress });
    const feedback = data.sessions.filter((s) => s.feedback_mood || s.feedback_keep?.length || s.feedback_avoid?.length)
      .sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""))
      .map((s) => ({ mood: s.feedback_mood as 1 | 2 | 3 | 4 | 5 | null, keep: s.feedback_keep ?? [], avoid: s.feedback_avoid ?? [], notes: s.feedback_notes }));
    return { profile, pipe: new CompanionPipeline({ profile, feedback, llm }) };
  });
  const [said, setSaid] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [volume, setVolume] = useState(1);
  const [em, setEm] = useState<{ phase: string; targets: Target[]; text: string } | null>(null);
  const rate = useRef(0.85);

  const say = (text: string) => { if (!text) return Promise.resolve(); setSaid(text); return speak(text, locale, rate.current, volume); };

  async function logSafety(ev: { trigger: string; matched: string; action: string; at: string; resolvedBy?: string }) {
    await repo.save("safety_event", {
      id: ulid(), elder_id: elder.id, session_id: sessionId, at: ev.at, trigger: ev.trigger, matched: ev.matched || null,
      action: ev.action, resolved_at: ev.resolvedBy ? ev.at : null, resolved_by: ev.resolvedBy ?? null,
    });
  }

  /** Apply one pipeline result: log, notify, show call buttons, speak. */
  async function handle(r: TurnResult | null) {
    if (!r) return;
    rate.current = r.rate;
    const targets: Target[] = [];
    for (const a of r.actions) {
      if (a.type === "log") await logSafety(a.event);
      else if (a.type === "notify_caregiver" && !data.demo) notifyCaregiver(elder.id, a.text).catch(() => {}); // demo: no server
      else if (a.type === "call") targets.push({ target: a.target, tel: a.url });
      else if (a.type === "whatsapp") {
        const t = targets.find((x) => x.target.phone === a.target.phone);
        if (t) t.wa = a.url; else targets.push({ target: a.target, wa: a.url });
      }
    }
    const phase = pipe.emergencyPhase;
    const text = r.say.join(" ");
    if (r.source === "emergency" || phase !== "idle") {
      setEm((prev) => (phase === "idle" ? null : { phase, targets: targets.length ? targets : prev?.targets ?? [], text: text || prev?.text || "" }));
    }
    void say(text); // never block the screen on speech; some browsers never fire onend
  }

  // Hold the screen: wake lock, back-button trap. Greet once.
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
    const getLock = () => nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    getLock();
    const onVis = () => document.visibilityState === "visible" && getLock();
    document.addEventListener("visibilitychange", onVis);
    history.pushState({ elder: 1 }, "");
    const onPop = () => history.pushState({ elder: 1 }, "");
    window.addEventListener("popstate", onPop);
    const greet = setTimeout(() => handle(pipe.opener()), 600);
    // Silence checks and the 20 s no-answer rule.
    const tick = setInterval(() => handle(pipe.tick()), 1000);
    return () => {
      lock?.release().catch(() => {});
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("popstate", onPop);
      clearTimeout(greet);
      clearInterval(tick);
      stopSpeaking();
      speech.cancel();
    };
  }, []);

  async function heard(text: string) {
    if (!text || busy) return;
    setBusy(true);
    try { await handle(await pipe.turn(text)); } finally { setBusy(false); }
  }

  async function talk() {
    if (listening) { speech.cancel(); return; }
    stopSpeaking();
    setListening(true);
    let text = "";
    try {
      for await (const t of speech.stt(locale, { maxMs: 12_000 })) { text = t; break; }
    } catch { /* no speech: stay quiet, the silence check will follow */ }
    setListening(false);
    await heard(text);
  }

  // Agitation: rapid repeated taps anywhere on the screen.
  const onAnyTap = () => { if (!em) handle(pipe.tap()); };

  // Medicine reminder card.
  const reminder = currentReminder(data.doses);
  const med = reminder && data.meds.find((m) => m.id === reminder.medicine_id);
  const announced = useRef<string>("");
  useEffect(() => {
    if (reminder && med && announced.current !== reminder.id) {
      announced.current = reminder.id;
      say(`${c.medTime}. ${med.name}${med.instructions ? `, ${med.instructions}` : ""}.`);
    }
  }, [reminder?.id]);
  async function dose(kind: "take" | "snooze") {
    if (!reminder || !med) return;
    const next = step(reminder, kind === "take" ? { type: "take", by: "elder" } : { type: "snooze" }, Date.now(), med.escalate_after_min ?? DEFAULT_ESCALATE_MIN);
    if (next !== reminder) await repo.save("dose_event", next);
  }

  // Unlock: long-press corner -> PIN.
  const [pressing, setPressing] = useState(false);
  const [askPin, setAskPin] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const pressStart = () => { setPressing(true); timer.current = window.setTimeout(() => { setPressing(false); setAskPin(true); }, LONG_PRESS_MS); };
  const pressEnd = () => { setPressing(false); clearTimeout(timer.current); };

  async function unlocked() {
    if (pipe.emergencyPhase !== "idle" && pipe.emergencyPhase !== "done") await handle(pipe.resolveEmergency("caregiver"));
    const s = data.sessions.find((x) => x.id === sessionId);
    if (s) await repo.save<SessionRow>("session", { ...s, ended_at: new Date().toISOString(), topics: pipe.sessionTopics() });
    await repo.backend.setMeta("elder_mode_session", null);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    go({ name: "feedback", sessionId });
  }

  async function closeEmergency() {
    if (pipe.emergencyPhase === "exhausted") await handle(pipe.resolveEmergency("elder"));
    setEm(null);
  }

  return (
    <main class="elder" lang={lang} onPointerDown={onAnyTap}>
      <button class={`corner${pressing ? " pressing" : ""}`} aria-label={c.holdHint}
        onPointerDown={(e) => { e.stopPropagation(); pressStart(); }} onPointerUp={pressEnd} onPointerLeave={pressEnd} onPointerCancel={pressEnd}
        onContextMenu={(e) => e.preventDefault()}>
        <span class="ring" />
      </button>

      <div class="elder-body">
      {data.demo && <span class="demo-pill">{STRINGS[lang].demoBanner}</span>}
      <h1 class="hello">{c.hello(profile.displayName)}</h1>
      {photo && <img class="photo" src={photo} alt="" />}
      <p class="said" aria-live="polite">{said}</p>

      <div class="grow">
        {reminder && med && !em ? (
          <section class="dose" aria-labelledby="medh">
            <h2 id="medh" style="font-size:var(--fs-elder);margin:0">{doseTimeLabel(reminder.scheduled_at, 330, lang)}</h2>
            <p style="font-size:var(--fs-elder-xl);font-weight:700">{med.name}</p>
            {med.instructions && <p>{med.instructions}</p>}
            <button class="take" onClick={() => dose("take")}>✓ {c.taken}</button>
            {reminder.status === "due" && <button class="later" onClick={() => dose("snooze")}>{c.later}</button>}
          </section>
        ) : !stt ? (
          <div class="grid2">
            {(["yes", "no", "song", "story"] as const).map((k) => (
              <button class="soft" disabled={busy} onClick={() => heard(TAP_TEXT[lang][k])}>{c[`tap${k[0].toUpperCase()}${k.slice(1)}` as "tapYes"]}</button>
            ))}
          </div>
        ) : (
          <button class="talk" aria-pressed={listening} disabled={busy} onClick={talk}>{listening ? c.listening : `🎙 ${c.talk}`}</button>
        )}
      </div>

      {data.demo && <DemoSay label={STRINGS[lang].demoType} send={STRINGS[lang].demoSend} onSay={heard} />}
      <div class="grid2">
        <button class="soft" onClick={() => say(said)}>↻ {c.again}</button>
        <button class="soft" onClick={() => setVolume(volume < 1 ? 1 : 0.6)}>{volume < 1 ? `🔊 ${c.louder}` : `🔉 ${c.softer}`}</button>
      </div>
      </div>
      <button class="help" onClick={() => handle(pipe.help())}>🆘 {c.help}</button>

      {em && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="emh" class="elder" style="position:fixed;inset:0;z-index:20;overflow:auto">
          <p id="emh" class="hello" style="font-size:var(--fs-elder)">{em.text}</p>
          <div class="grow">
            {em.phase === "asking" && (
              <div class="grid2">
                <button class="help" style="position:static" onClick={() => heard(TAP_TEXT[lang].yes)}>{c.yes}</button>
                <button class="soft" onClick={() => heard(TAP_TEXT[lang].no)}>{c.no}</button>
              </div>
            )}
            {em.phase === "calling" && (
              <>
                {data.demo && <p class="demo-note">{STRINGS[lang].demoNoDial}</p>}
                {em.targets.map(({ target, tel, wa }) => (
                  <>
                    {tel && <CallLink href={tel} demo={data.demo} text={`📞 ${c.call(target.kind === "helpline" ? c.helpline : target.name)}`} />}
                    {wa && <CallLink href={wa} demo={data.demo} text={`💬 ${c.wa}`} />}
                  </>
                ))}
                <div class="grid2">
                  <button class="soft" onClick={() => handle(pipe.callConnected())}>✓ {c.connected}</button>
                  <button class="soft" onClick={() => handle(pipe.callUnanswered())}>{c.unanswered} →</button>
                </div>
              </>
            )}
            {em.phase === "exhausted" && <p class="said">{c.noContacts}</p>}
          </div>
          {(em.phase === "done" || em.phase === "exhausted") && <button class="soft" onClick={closeEmergency}>{c.close}</button>}
        </div>
      )}

      {askPin && <PinPad lang={lang} onCancel={() => setAskPin(false)} onOk={unlocked} />}
    </main>
  );
}

/** A call/WhatsApp button. In demo mode it shows the link instead of opening it. */
function CallLink({ href, demo, text }: { href: string; demo: boolean; text: string }) {
  const d = dialAction(href, demo);
  const style = "font-size:var(--fs-elder);min-height:80px";
  if (d.kind === "open") return <a class="btn call" href={d.href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener" style={style}>{text}</a>;
  return (
    <div class="call preview" style={style} aria-label={`${text}: ${d.label}`}>
      <span>{text}</span>
      <code>{d.label}</code>
    </div>
  );
}

/** Demo only: type a sentence and send it through the same pipeline as speech. */
function DemoSay({ label, send, onSay }: { label: string; send: string; onSay(t: string): void }) {
  const [v, setV] = useState("");
  return (
    <details class="demo-say" onPointerDown={(e) => e.stopPropagation()}>
      <summary>⌨ {label}</summary>
      <form class="demo-say" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onSay(v.trim()); setV(""); } }}>
        <label for="demo-say" class="sr-only">{label}</label>
        <div class="row">
          <input id="demo-say" class="grow" value={v} onInput={(e) => setV(e.currentTarget.value)} autocomplete="off" />
          <button class="soft" type="submit">{send}</button>
        </div>
      </form>
    </details>
  );
}

function PinPad({ lang, onOk, onCancel }: { lang: "hi" | "en"; onOk(): void; onCancel(): void }) {
  const { repo } = useApp();
  const c = COPY[lang];
  const [pin, setPin] = useState("");
  const [tries, setTries] = useState<Tries>({ fails: 0, lockedUntil: 0 });
  const [msg, setMsg] = useState("");
  async function check(p: string) {
    const stored = await repo.backend.getMeta<string>("pin_hash");
    if (isLocked(tries, Date.now())) { setMsg(c.wrong); setPin(""); return; }
    const ok = !!stored && (await verifyPin(p, stored));
    setTries(afterAttempt(tries, ok, Date.now()));
    if (ok) onOk(); else { setMsg(c.wrong); setPin(""); }
  }
  const press = (d: string) => {
    const p = (pin + d).slice(0, 6);
    setPin(p);
    setMsg("");
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="pinh" class="elder" style="position:fixed;inset:0;z-index:30;justify-content:center" onPointerDown={(e) => e.stopPropagation()}>
      <h2 id="pinh" class="hello" style="font-size:var(--fs-elder)">{c.pin}</h2>
      <div class="pindots" aria-label={`${pin.length}`}>{Array.from({ length: Math.max(4, pin.length) }, (_, i) => <span class={i < pin.length ? "on" : ""} />)}</div>
      <p class="said" role="alert" style="min-height:1.5em">{msg}</p>
      <div class="pinpad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <button class="soft" onClick={() => press(d)}>{d}</button>)}
        <button class="soft" aria-label="⌫" onClick={() => setPin(pin.slice(0, -1))}>⌫</button>
        <button class="soft" onClick={() => press("0")}>0</button>
        <button class="soft" aria-label="OK" disabled={pin.length < 4} onClick={() => check(pin)}>✓</button>
      </div>
      <button class="soft" onClick={onCancel}>✕</button>
    </div>
  );
}
