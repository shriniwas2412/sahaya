// Locked elder mode. One calm screen that never scrolls: the person's name, what they said
// and Sahaya's reply, one main action (talk, picture answers or today's medicine), "say
// again" and volume, and Help as a fixed footer. A small strip shows each turn passing
// through listening → the safety check → the reply, and whether the reply was scripted.
// Exit only by holding the top-right corner for 3 s (mouse, touch or keyboard), then the PIN.
// A browser page cannot fully lock an Android phone; this holds what the browser allows.

import { useEffect, useRef, useState } from "preact/hooks";
import { useApp, type SessionRow } from "./App.tsx";
import { CompanionPipeline, NO_ANSWER_MS, type TurnResult, type TurnTrace, type CallTarget, type LLMProvider } from "../core/companion/index.ts";
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
import { Icon, type IconName } from "./icons.tsx";
import { greetingName, sentence, strip } from "./elderText.ts";

const COPY = {
  hi: {
    hello: (n: string) => `नमस्ते, ${n}`, talk: "बात करें", listening: "सुन रहे हैं…", again: "फिर से सुनाएँ",
    louder: "आवाज़ तेज़", softer: "आवाज़ धीमी", help: "मदद", yes: "हाँ, किसी को बुलाओ", no: "नहीं, ठीक हूँ",
    call: (w: string) => `${w} को फ़ोन`, wa: "संदेश भेजें", connected: "बात हो गई", unanswered: "फ़ोन नहीं उठा",
    autoNext: "अगर बात नहीं हुई, तो थोड़ी देर में अगला नंबर अपने-आप लगेगा।",
    taken: "ले ली", later: "थोड़ी देर में", close: "ठीक है",
    tapYes: "हाँ", tapNo: "नहीं", tapSong: "गाना", tapStory: "कहानी", helpline: "हेल्पलाइन",
    noContacts: "पास में किसी को आवाज़ दीजिए, या 112 पर फ़ोन कीजिए।", pin: "पिन डालें", wrong: "गलत पिन",
    locked: (s: number) => `बहुत बार गलत। ${s} सेकंड रुकें।`,
    del: "मिटाएँ", ok: "ठीक", closePad: "बंद करें", dots: (n: number, of: number) => `${of} में से ${n} अंक`,
    holdHint: "देखभाल करने वाले: ऊपर दाएँ गोला 3 सेकंड दबाएँ",
    exitHint: "बाहर: गोला 3 सेकंड · पिन 1234",
    youSaid: "आपने कहा:", steps: { listen: "सुन रहे हैं", safety: "सुरक्षा जांच", reply: "जवाब" },
    notes: { ok: "ठीक", check: "ध्यान", emergency: "मदद", scripted: "ऑफ़लाइन", model: "मॉडल" },
  },
  en: {
    hello: (n: string) => `Hello, ${n}`, talk: "Talk", listening: "Listening…", again: "Say again",
    louder: "Louder", softer: "Softer", help: "Help", yes: "Yes, call someone", no: "No, I'm fine",
    call: (w: string) => `Call ${w}`, wa: "Send a message", connected: "We talked", unanswered: "No answer",
    autoNext: "If no one answered, the next number is called automatically in a moment.",
    taken: "Taken", later: "In a little while", close: "OK",
    tapYes: "Yes", tapNo: "No", tapSong: "A song", tapStory: "A story", helpline: "Helpline",
    noContacts: "Please call out to someone nearby, or phone 112.", pin: "Enter PIN", wrong: "Wrong PIN",
    locked: (s: number) => `Too many tries. Wait ${s} s.`,
    del: "Delete", ok: "OK", closePad: "Close", dots: (n: number, of: number) => `${n} of ${of} digits`,
    holdHint: "Caregiver: hold the top-right circle for 3 seconds",
    exitHint: "Exit: hold circle 3 s · PIN 1234",
    youSaid: "You said:", steps: { listen: "Listening", safety: "Safety check", reply: "Reply" },
    notes: { ok: "fine", check: "check", emergency: "help", scripted: "offline", model: "model" },
  },
};

// Text fed to the pipeline for each big button when listening is not available.
const TAP_TEXT = { hi: { yes: "हाँ", no: "नहीं", song: "गाना सुनाओ", story: "कहानी सुनाओ" }, en: { yes: "yes", no: "no", song: "sing a song", story: "tell a story" } };
const TAP_ICON: Record<keyof typeof TAP_TEXT.hi, IconName> = { yes: "check", no: "cross", song: "music", story: "book" };

interface Consent { scope_audio_cloud: 0 | 1; scope_llm_cloud?: 0 | 1; subject_id: string; recorded_at: string; withdrawn_at?: string | null }
type Target = { target: CallTarget; tel?: string; wa?: string };

export function Elder({ sessionId }: { sessionId: string }) {
  const { repo, data } = useApp();
  const elder = data.elder!;
  const [ready, setReady] = useState<{ distress: string[]; photo: string | null; speech: SpeechProvider; stt: boolean; llm: LLMProvider | undefined; consent: Consent | null } | null>(null);
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
      setReady({ distress, photo, speech, stt: caps.stt, llm, consent: consent ?? null });
    })();
  }, [repo, elder.id]);
  if (!ready) return <main class="elder" aria-busy="true" />;
  return <ElderScreen sessionId={sessionId} {...ready} />;
}

function ElderScreen({ sessionId, distress, photo, speech, stt, llm, consent }: {
  sessionId: string; distress: string[]; photo: string | null; speech: SpeechProvider; stt: boolean; llm: LLMProvider | undefined; consent: Consent | null;
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
    // A remote model runs only if this consent allows it (scope_llm_cloud); otherwise offline.
    return { profile, pipe: new CompanionPipeline({ profile, feedback, llm, consent }) };
  });
  const [said, setSaid] = useState("");
  const [trace, setTrace] = useState<TurnTrace | null>(null);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [volume, setVolume] = useState(1);
  const [em, setEm] = useState<{ phase: string; targets: Target[]; text: string } | null>(null);
  const rate = useRef(0.85);
  // Timers read the latest volume through a ref.
  const vol = useRef(1);
  vol.current = volume;

  const say = (text: string) => { if (!text) return Promise.resolve(); setSaid(text); return speak(text, locale, rate.current, vol.current); };

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
    if (r.trace) setTrace(r.trace);
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

  // During a call, the elder does not have to report the result: after the phone app hands
  // back (or 20 s without an answer), the next contact is tried automatically.
  const calling = em?.phase === "calling";
  const callTarget = em?.targets?.[0]?.target.phone;
  useEffect(() => {
    if (!calling) return;
    let t = window.setTimeout(() => handle(pipe.callUnanswered()), NO_ANSWER_MS);
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(t);
      t = window.setTimeout(() => handle(pipe.callUnanswered()), NO_ANSWER_MS);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", onVis); };
  }, [calling, callTarget]);

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
      say(sentence([doseTimeLabel(reminder.scheduled_at, 330, lang), med.name, med.instructions], lang));
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
  // The wrong-PIN lockout lives here, so closing the pad does not reset it.
  const [tries, setTries] = useState<Tries>({ fails: 0, lockedUntil: 0 });

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

  const steps = strip(trace, listening);
  const showDose = !!(reminder && med && !em);
  return (
    <main class={`elder${data.demo ? " demo" : ""}`} lang={lang} onPointerDown={onAnyTap}>
      <div class="elder-top">
        {data.demo && (
          <p class="exit-hint"><span class="demo-pill">{STRINGS[lang].demoBanner}</span> {c.exitHint}</p>
        )}
        <button class={`corner${pressing ? " pressing" : ""}`} aria-label={c.holdHint}
          onPointerDown={(e) => { e.stopPropagation(); pressStart(); }} onPointerUp={pressEnd} onPointerLeave={pressEnd} onPointerCancel={pressEnd}
          onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); pressStart(); } }}
          onKeyUp={(e) => { if (e.key === "Enter" || e.key === " ") pressEnd(); }}
          onContextMenu={(e) => e.preventDefault()}>
          <span class="ring" />
        </button>
      </div>

      <div class="elder-body">
        <h1 class="hello">{c.hello(greetingName(profile.displayName))}</h1>
        {photo && !showDose && <img class="photo" src={photo} alt="" />}

        {showDose ? (
          <section class="dose" aria-labelledby="medh">
            <h2 id="medh" class="dose-title">{doseTimeLabel(reminder!.scheduled_at, 330, lang)}</h2>
            <p class="dose-name">{med!.name}</p>
            {med!.instructions && <p>{med!.instructions}</p>}
            <button class="take" onClick={() => dose("take")}><Icon name="check" /> {c.taken}</button>
            {reminder!.status === "due" && <button class="later" onClick={() => dose("snooze")}>{c.later}</button>}
          </section>
        ) : (
          <>
            <div class="turn" aria-live="polite">
              {trace?.heard && <p class="heard"><span>{c.youSaid}</span> {trace.heard}</p>}
              <p class="said">{said}</p>
            </div>
            {(trace?.heard || listening) && (
              <ol class="strip" aria-label={`${c.steps.listen} → ${c.steps.safety} → ${c.steps.reply}`}>
                {steps.map((st) => (
                  <li class={`${st.on ? "on" : ""}${st.active ? " active" : ""}${st.note ? ` n-${st.note}` : ""}`}>
                    {c.steps[st.key]}{st.note && <span class="note"> · {c.notes[st.note]}</span>}
                  </li>
                ))}
              </ol>
            )}
            <div class="main-action">
              {!stt ? (
                <div class="answers">
                  {(["yes", "no", "song", "story"] as const).map((k) => (
                    <button class="answer" disabled={busy} onClick={() => heard(TAP_TEXT[lang][k])}>
                      <Icon name={TAP_ICON[k]} size={34} />
                      <span>{c[`tap${k[0].toUpperCase()}${k.slice(1)}` as "tapYes"]}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <button class="talk" aria-pressed={listening} disabled={busy} onClick={talk}>
                  <Icon name="mic" size={40} /> {listening ? c.listening : c.talk}
                </button>
              )}
            </div>
            {data.demo && <DemoSay label={STRINGS[lang].demoType} send={STRINGS[lang].demoSend} onSay={heard} />}
          </>
        )}
      </div>

      <div class="elder-controls">
        <button class="soft" onClick={() => say(said)}><Icon name="replay" /> {c.again}</button>
        <button class="soft" onClick={() => setVolume(volume < 1 ? 1 : 0.6)}>
          <Icon name={volume < 1 ? "speakerUp" : "speakerDown"} /> {volume < 1 ? c.louder : c.softer}
        </button>
      </div>
      <button class="help" onClick={() => handle(pipe.help())}><Icon name="hand" size={34} /> {c.help}</button>

      {em && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="emh" class="overlay">
          <div class="overlay-group">
            {photo && em.phase === "asking" && <img class="photo" src={photo} alt="" />}
            <p id="emh" class="em-text" tabIndex={-1} ref={(el) => el?.focus()}>{em.text}</p>
            {em.phase === "asking" && (
              <div class="stack-btns">
                <button class="help big-yes" onClick={() => heard(TAP_TEXT[lang].yes)}><Icon name="phone" size={34} /> {c.yes}</button>
                <button class="soft" onClick={() => heard(TAP_TEXT[lang].no)}>{c.no}</button>
              </div>
            )}
            {em.phase === "calling" && (
              <div class="stack-btns">
                {data.demo && <p class="demo-note">{STRINGS[lang].demoNoDial}</p>}
                {em.targets.map(({ target, tel, wa }) => {
                  const who = target.kind === "helpline" ? c.helpline : target.name;
                  return (
                    <>
                      {tel && <CallLink href={tel} demo={data.demo} icon="phone" text={c.call(who)} />}
                      {wa && <CallLink href={wa} demo={data.demo} icon="chat" text={c.wa} />}
                    </>
                  );
                })}
                <div class="grid2">
                  <button class="soft" onClick={() => handle(pipe.callConnected())}><Icon name="check" /> {c.connected}</button>
                  <button class="soft" onClick={() => handle(pipe.callUnanswered())}>{c.unanswered}</button>
                </div>
                <p class="auto-next">{c.autoNext}</p>
              </div>
            )}
            {em.phase === "exhausted" && <p class="said">{c.noContacts}</p>}
            {(em.phase === "done" || em.phase === "exhausted") && <button class="soft" onClick={closeEmergency}>{c.close}</button>}
          </div>
        </div>
      )}

      {askPin && <PinPad lang={lang} tries={tries} setTries={setTries} onCancel={() => setAskPin(false)} onOk={unlocked} />}
    </main>
  );
}

/** A call/WhatsApp button. In demo mode it shows the (masked) link instead of opening it. */
function CallLink({ href, demo, text, icon }: { href: string; demo: boolean; text: string; icon: IconName }) {
  const d = dialAction(href, demo);
  if (d.kind === "open") {
    return <a class="btn call" href={d.href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener"><Icon name={icon} /> {text}</a>;
  }
  return (
    <div class="call preview" role="group" aria-label={`${text}: ${d.label}`}>
      <span><Icon name={icon} /> {text}</span>
      <code>{d.label}</code>
    </div>
  );
}

/** Demo only: type a sentence and send it through the same pipeline as speech. */
function DemoSay({ label, send, onSay }: { label: string; send: string; onSay(t: string): void }) {
  const [v, setV] = useState("");
  return (
    <details class="demo-say" onPointerDown={(e) => e.stopPropagation()}>
      <summary><Icon name="keyboard" /> {label}</summary>
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

function PinPad({ lang, tries, setTries, onOk, onCancel }: {
  lang: "hi" | "en"; tries: Tries; setTries(t: Tries): void; onOk(): void; onCancel(): void;
}) {
  const { repo } = useApp();
  const c = COPY[lang];
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState("");
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  async function check(p: string) {
    const now = Date.now();
    if (isLocked(tries, now)) { setMsg(c.locked(Math.ceil((tries.lockedUntil - now) / 1000))); setPin(""); return; }
    const stored = await repo.backend.getMeta<string>("pin_hash");
    const ok = !!stored && (await verifyPin(p, stored));
    const next = afterAttempt(tries, ok, now);
    setTries(next);
    if (ok) onOk();
    else { setMsg(isLocked(next, now) ? c.locked(Math.ceil((next.lockedUntil - now) / 1000)) : c.wrong); setPin(""); }
  }
  const press = (d: string) => { setPin((pin + d).slice(0, 6)); setMsg(""); };
  const shown = Math.max(4, pin.length);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="pinh" class="overlay" onPointerDown={(e) => e.stopPropagation()}>
      <div class="overlay-group">
        <h2 id="pinh" class="em-text">{c.pin}</h2>
        <div class="pindots" role="img" aria-label={c.dots(pin.length, shown)}>{Array.from({ length: shown }, (_, i) => <span class={i < pin.length ? "on" : ""} />)}</div>
        <p class="said pin-msg" role="alert">{msg}</p>
        <div class="pinpad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d, i) => <button class="soft" ref={i === 0 ? first : undefined} onClick={() => press(d)}>{d}</button>)}
          <button class="soft" aria-label={c.del} onClick={() => setPin(pin.slice(0, -1))}><Icon name="backspace" /></button>
          <button class="soft" onClick={() => press("0")}>0</button>
          <button class="soft" aria-label={c.ok} disabled={pin.length < 4} onClick={() => check(pin)}><Icon name="check" /></button>
        </div>
        <button class="soft" aria-label={c.closePad} onClick={onCancel}><Icon name="close" /> {c.closePad}</button>
      </div>
    </div>
  );
}
