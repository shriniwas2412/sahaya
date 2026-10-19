import { useEffect, useRef, useState } from "preact/hooks";
import { useApp } from "./App.tsx";
import { emptyElder, validateElder, splitList, renumber, LANGUAGES, type ElderRow, type ElderError } from "../core/profile.ts";
import { GDS, STAGES } from "../core/gds.ts";
import { HELPLINE_OPTIONS } from "../core/contacts.ts";
import { isValidTime, DEFAULT_ESCALATE_MIN, type Medicine } from "../core/doses.ts";
import { hashPin, isValidPin } from "../core/pin.ts";
import { ulid } from "../core/ids.ts";
import type { FamilyContact } from "../core/companion/types.ts";
import { Field, LangToggle } from "./bits.tsx";

const STEPS = 7;
type MedDraft = Medicine & { _new?: boolean };

const STEP_ERRORS: Record<number, ElderError[]> = {
  1: ["display_name", "age", "birth_decade", "persona_name"],
  2: ["gds_stage"],
  4: ["sundown"],
  5: ["contact_phone", "ngo_helpline"],
};

export function Setup({ edit }: { edit: boolean }) {
  const { repo, t, lang, data, go } = useApp();
  const [step, setStep] = useState(1);
  const [e, setE] = useState<ElderRow>(() => data.elder ?? emptyElder(ulid()));
  const [stageChosen, setStageChosen] = useState(!!data.elder);
  const [meds, setMeds] = useState<MedDraft[]>(() => data.meds.map((m) => ({ ...m })));
  const [removed, setRemoved] = useState<string[]>([]);
  const [prefText, setPrefText] = useState(e.preferences.join(", "));
  const [trigText, setTrigText] = useState(e.triggers.join(", "));
  const [distressText, setDistressText] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [hasPin, setHasPin] = useState(false);
  const [consent, setConsent] = useState({ agreed: edit, given_by: "guardian", method: "verbal_recorded", sync: false, audio: false });
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    repo.backend.getMeta<string>("pin_hash").then((h) => setHasPin(!!h));
    repo.backend.getMeta<string[]>(`distress:${e.id}`).then((w) => setDistressText((w ?? []).join(", ")));
  }, [repo, e.id]);
  useEffect(() => { head.current?.focus(); setShown(false); }, [step]);

  const set = <K extends keyof ElderRow>(k: K, v: ElderRow[K]) => setE((x) => ({ ...x, [k]: v }));
  const synced: ElderRow = { ...e, preferences: splitList(prefText), triggers: splitList(trigText) };
  const allErr = validateElder(synced, stageChosen);
  const stepErr = (STEP_ERRORS[step] ?? []).filter((k) => allErr.includes(k));
  const pinErr = step === 7 && !(hasPin && !pin) ? (!isValidPin(pin) ? t.pinBad : pin !== pin2 ? t.pinMismatch : null) : null;
  const medErr = step === 6 && meds.some((m) => !m.name.trim() || !m.times.length || m.times.some((x) => !isValidTime(x)));
  const consentErr = step === 7 && !consent.agreed;
  const blocked = stepErr.length > 0 || !!pinErr || medErr || consentErr;
  const showErr = (k: ElderError) => shown && stepErr.includes(k) ? <p class="err" role="alert">{t.errors[k]}</p> : null;

  async function next() {
    setShown(true);
    if (blocked) return;
    if (step < STEPS) { setStep(step + 1); return; }
    setBusy(true);
    const now = new Date().toISOString();
    await repo.save("elder", synced);
    for (const m of meds) {
      const { _new, ...row } = m;
      await repo.save("medicine", { ...row, elder_id: e.id, times: [...new Set(row.times)].sort() });
    }
    for (const id of removed) await repo.remove("medicine", id);
    await repo.backend.setMeta(`distress:${e.id}`, splitList(distressText));
    if (pin) await repo.backend.setMeta("pin_hash", await hashPin(pin));
    if (!edit) {
      await repo.save("consent", {
        id: ulid(), subject_type: "elder", subject_id: e.id, given_by: consent.given_by, method: consent.method,
        scope_store: 1, scope_sync: consent.sync ? 1 : 0, scope_audio_cloud: consent.audio ? 1 : 0, scope_contact_share: 0, scope_research_aggregate: 0,
        language: lang, recorded_at: now,
      });
    }
    setBusy(false);
    go({ name: "home" });
  }

  const contacts = e.family_contacts;
  const setContacts = (cs: FamilyContact[]) => set("family_contacts", renumber(cs));
  const helplineIsOption = HELPLINE_OPTIONS.some((h) => h.number === e.ngo_helpline);

  return (
    <div class="page stack">
      <div class="row">
        <span class="brand">{t.appName}</span>
        <LangToggle />
      </div>
      <div>
        <p class="muted" aria-live="polite">{t.stepOf(step, STEPS)}</p>
        <div class="steps" aria-hidden="true">{Array.from({ length: STEPS }, (_, i) => <span class={i < step ? "on" : ""} />)}</div>
      </div>

      {step === 1 && (
        <section class="stack">
          <h1 tabIndex={-1} ref={head}>{t.s1Title}</h1>
          {!edit && <p class="card soft small">{t.notMedical}</p>}
          <Field label={t.name} hint={t.nameHint}>
            <input value={e.display_name} onInput={(ev) => set("display_name", ev.currentTarget.value)} autocomplete="off" aria-invalid={shown && stepErr.includes("display_name")} />
          </Field>
          {showErr("display_name")}
          <div class="row">
            <div class="grow">
              <Field label={`${t.age} (${t.optional})`}>
                <input inputMode="numeric" value={e.age ?? ""} onInput={(ev) => set("age", ev.currentTarget.value ? Number(ev.currentTarget.value) : null)} />
              </Field>
            </div>
            <div class="grow">
              <Field label={`${t.birthDecade} (${t.optional})`} hint={t.birthDecadeHint}>
                <select value={e.birth_decade ?? ""} onChange={(ev) => set("birth_decade", ev.currentTarget.value ? Number(ev.currentTarget.value) : null)}>
                  <option value="">—</option>
                  {[1920, 1930, 1940, 1950, 1960, 1970, 1980].map((d) => <option value={d}>{d}s</option>)}
                </select>
              </Field>
            </div>
          </div>
          {showErr("age")}{showErr("birth_decade")}
          <Field label={`${t.facility} (${t.optional})`}>
            <input value={e.facility ?? ""} onInput={(ev) => set("facility", ev.currentTarget.value || null)} />
          </Field>
          <Field label={t.persona} hint={t.personaHint}>
            <input value={e.persona_name} onInput={(ev) => set("persona_name", ev.currentTarget.value)} />
          </Field>
          {showErr("persona_name")}
        </section>
      )}

      {step === 2 && (
        <section class="stack">
          <h1 tabIndex={-1} ref={head}>{t.s2Title}</h1>
          <p class="muted">{t.s2Hint}</p>
          <div class="choices" role="radiogroup" aria-label={t.s2Title}>
            {STAGES.map((s) => (
              <button type="button" class="choice" role="radio" aria-label={`${s}. ${GDS[s].title[lang]}: ${GDS[s][lang]}`} aria-checked={stageChosen && e.gds_stage === s}
                onClick={() => { set("gds_stage", s); setStageChosen(true); }}>
                <span class="num">{s}</span>
                <span><strong>{GDS[s].title[lang]}</strong><span class="small">{GDS[s][lang]}</span></span>
              </button>
            ))}
            <button type="button" class="choice" role="radio" aria-label={t.notAssessed} aria-checked={stageChosen && e.gds_stage === null}
              onClick={() => { set("gds_stage", null); setStageChosen(true); }}>
              <span class="num">?</span>
              <span><strong>{t.notAssessed}</strong><span class="small">{t.notAssessedHint}</span></span>
            </button>
          </div>
          {showErr("gds_stage")}
          <p class="muted small">Reisberg B. et al., Am J Psychiatry 1982;139:1136–1139.</p>
        </section>
      )}

      {step === 3 && (
        <section class="stack">
          <h1 tabIndex={-1} ref={head}>{t.s3Title}</h1>
          <p class="muted">{t.s3Hint}</p>
          <div class="choices" role="radiogroup" aria-label={t.s3Title}>
            {LANGUAGES.map((l) => (
              <button type="button" class="choice" role="radio" aria-label={l.label} aria-checked={e.language === l.code && (e.dialect ?? null) === l.dialect}
                onClick={() => setE((x) => ({ ...x, language: l.code, dialect: l.dialect }))}>
                <span lang={l.code.split("-")[0]}><strong>{l.label}</strong></span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 4 && (
        <section class="stack">
          <h1 tabIndex={-1} ref={head}>{t.s4Title}</h1>
          <Field label={`${t.prefs} (${t.optional})`} hint={t.prefsHint}><textarea value={prefText} onInput={(ev) => setPrefText(ev.currentTarget.value)} /></Field>
          <Field label={`${t.triggers} (${t.optional})`} hint={t.triggersHint}><textarea value={trigText} onInput={(ev) => setTrigText(ev.currentTarget.value)} /></Field>
          <Field label={`${t.distress} (${t.optional})`} hint={t.distressHint}><input value={distressText} onInput={(ev) => setDistressText(ev.currentTarget.value)} /></Field>
          <Field label={`${t.energy} (${t.optional})`} hint={t.energyHint}><input value={e.energy_pattern ?? ""} onInput={(ev) => set("energy_pattern", ev.currentTarget.value || null)} /></Field>
          <fieldset class="card">
            <legend><strong>{t.sundown}</strong></legend>
            <span class="hint">{t.sundownHint}</span>
            <div class="row" style="margin-top:8px">
              <div class="grow"><Field label={t.from}><input type="time" value={e.sundown_start ?? ""} onInput={(ev) => set("sundown_start", ev.currentTarget.value || null)} /></Field></div>
              <div class="grow"><Field label={t.to}><input type="time" value={e.sundown_end ?? ""} onInput={(ev) => set("sundown_end", ev.currentTarget.value || null)} /></Field></div>
            </div>
            {showErr("sundown")}
          </fieldset>
          <Field label={`${t.story} (${t.optional})`} hint={t.storyHint}><textarea value={e.notes ?? ""} onInput={(ev) => set("notes", ev.currentTarget.value || null)} /></Field>
        </section>
      )}

      {step === 5 && (
        <section class="stack">
          <h1 tabIndex={-1} ref={head}>{t.s5Title}</h1>
          <p class="muted">{t.s5Hint}</p>
          {contacts.map((c, i) => (
            <fieldset class="card stack">
              <legend><strong>{i + 1}. {c.name || t.contactName}</strong></legend>
              <div class="row">
                <div class="grow"><Field label={t.contactName}><input value={c.name} onInput={(ev) => setContacts(contacts.map((x, j) => j === i ? { ...x, name: ev.currentTarget.value } : x))} /></Field></div>
                <div class="grow"><Field label={`${t.relation} (${t.optional})`}><input value={c.relation ?? ""} onInput={(ev) => setContacts(contacts.map((x, j) => j === i ? { ...x, relation: ev.currentTarget.value || null } : x))} /></Field></div>
              </div>
              <Field label={t.phone}><input type="tel" inputMode="tel" value={c.phone} onInput={(ev) => setContacts(contacts.map((x, j) => j === i ? { ...x, phone: ev.currentTarget.value } : x))} /></Field>
              <label class="check"><input type="checkbox" checked={!!c.whatsapp} onChange={(ev) => setContacts(contacts.map((x, j) => j === i ? { ...x, whatsapp: ev.currentTarget.checked } : x))} />{t.whatsapp}</label>
              <div class="row">
                {i > 0 && <button type="button" onClick={() => { const cs = [...contacts]; [cs[i - 1], cs[i]] = [cs[i], cs[i - 1]]; setContacts(cs); }}>↑ {t.moveUp}</button>}
                <button type="button" class="ghost" onClick={() => setContacts(contacts.filter((_, j) => j !== i))}>{t.remove}</button>
              </div>
            </fieldset>
          ))}
          <button type="button" onClick={() => setContacts([...contacts, { name: "", phone: "", whatsapp: true, order: contacts.length + 1 }])}>+ {t.addContact}</button>
          {showErr("contact_phone")}
          <fieldset class="card stack">
            <legend><strong>{t.helpline}</strong></legend>
            <span class="hint">{t.helplineHint}</span>
            <div class="choices" role="radiogroup" aria-label={t.helpline}>
              <button type="button" class="choice" role="radio" aria-checked={!e.ngo_helpline} onClick={() => set("ngo_helpline", null)}>{t.noHelpline}</button>
              {HELPLINE_OPTIONS.map((h) => (
                <button type="button" class="choice" role="radio" aria-label={`${h.number}, ${h.label[lang]}`} aria-checked={e.ngo_helpline === h.number} onClick={() => set("ngo_helpline", h.number)}>
                  <span><strong>{h.number}</strong><span class="small">{h.label[lang]}</span></span>
                </button>
              ))}
            </div>
            <Field label={t.customNumber}>
              <input type="tel" inputMode="tel" value={helplineIsOption ? "" : e.ngo_helpline ?? ""} onInput={(ev) => set("ngo_helpline", ev.currentTarget.value || null)} />
            </Field>
            {showErr("ngo_helpline")}
            <p class="small muted">{t.source}: {HELPLINE_OPTIONS.map((h) => <a href={h.source} target="_blank" rel="noopener" style="margin-right:8px">{h.number}</a>)}</p>
          </fieldset>
        </section>
      )}

      {step === 6 && (
        <section class="stack">
          <h1 tabIndex={-1} ref={head}>{t.s6Title}</h1>
          <p class="card warn small">{t.s6Hint}</p>
          {!meds.length && <p class="muted">{t.noMeds}</p>}
          {meds.map((m, i) => {
            const upd = (p: Partial<MedDraft>) => setMeds(meds.map((x, j) => (j === i ? { ...x, ...p } : x)));
            return (
              <fieldset class="card stack">
                <legend><strong>{m.name || t.medName}</strong></legend>
                <Field label={t.medName}><input value={m.name} onInput={(ev) => upd({ name: ev.currentTarget.value })} /></Field>
                {shown && !m.name.trim() && <p class="err">{t.medName}</p>}
                <Field label={`${t.dose} (${t.optional})`}><input value={m.dose ?? ""} onInput={(ev) => upd({ dose: ev.currentTarget.value || null })} /></Field>
                <div>
                  <label>{t.times}</label>
                  <div class="row">
                    {m.times.map((tm, k) => (
                      <span class="row" style="gap:4px">
                        <input type="time" aria-label={`${t.times} ${k + 1}`} style="width:9em" value={tm} onInput={(ev) => upd({ times: m.times.map((x, q) => (q === k ? ev.currentTarget.value : x)) })} />
                        <button type="button" class="ghost" aria-label={`${t.remove} ${tm}`} onClick={() => upd({ times: m.times.filter((_, q) => q !== k) })}>✕</button>
                      </span>
                    ))}
                    <button type="button" onClick={() => upd({ times: [...m.times, "08:00"] })}>+ {t.addTime}</button>
                  </div>
                  {shown && !m.times.length && <p class="err">{t.times}</p>}
                </div>
                <Field label={`${t.instructions} (${t.optional})`} hint={t.instructionsHint}><input value={m.instructions ?? ""} onInput={(ev) => upd({ instructions: ev.currentTarget.value || null })} /></Field>
                <Field label={t.escalate}>
                  <input inputMode="numeric" value={m.escalate_after_min ?? DEFAULT_ESCALATE_MIN} onInput={(ev) => upd({ escalate_after_min: Math.max(5, Number(ev.currentTarget.value) || DEFAULT_ESCALATE_MIN) })} />
                </Field>
                <button type="button" class="ghost" onClick={() => { if (!m._new) setRemoved([...removed, m.id]); setMeds(meds.filter((_, j) => j !== i)); }}>{t.remove}</button>
              </fieldset>
            );
          })}
          <button type="button" onClick={() => setMeds([...meds, { id: ulid(), elder_id: e.id, name: "", dose: null, times: ["08:00"], instructions: null, escalate_after_min: DEFAULT_ESCALATE_MIN, alert_user_id: null, active: 1, _new: true }])}>+ {t.addMed}</button>
        </section>
      )}

      {step === 7 && (
        <section class="stack">
          <h1 tabIndex={-1} ref={head}>{t.s7Title}</h1>
          <p class="muted">{t.s7Hint}</p>
          {hasPin && <p class="small muted">{t.pinKeep}</p>}
          <div class="row">
            <div class="grow"><Field label={t.pin}><input type="password" inputMode="numeric" autocomplete="new-password" maxLength={6} value={pin} onInput={(ev) => setPin(ev.currentTarget.value.replace(/\D/g, ""))} /></Field></div>
            <div class="grow"><Field label={t.pin2}><input type="password" inputMode="numeric" autocomplete="new-password" maxLength={6} value={pin2} onInput={(ev) => setPin2(ev.currentTarget.value.replace(/\D/g, ""))} /></Field></div>
          </div>
          {shown && pinErr && <p class="err" role="alert">{pinErr}</p>}
          {!edit && (
            <fieldset class="card stack">
              <legend><strong>{t.consentTitle}</strong></legend>
              <label class="check"><input type="checkbox" checked={consent.agreed} onChange={(ev) => setConsent({ ...consent, agreed: ev.currentTarget.checked })} />{t.consentText}</label>
              <Field label={t.consentBy}>
                <select value={consent.given_by} onChange={(ev) => setConsent({ ...consent, given_by: ev.currentTarget.value })}>
                  <option value="self">{t.self}</option><option value="guardian">{t.guardian}</option><option value="facility">{t.facilityStaff}</option>
                </select>
              </Field>
              <Field label={t.consentMethod}>
                <select value={consent.method} onChange={(ev) => setConsent({ ...consent, method: ev.currentTarget.value })}>
                  <option value="verbal_recorded">{t.verbal}</option><option value="paper_signed">{t.paper}</option><option value="digital">{t.digital}</option>
                </select>
              </Field>
              <label class="check"><input type="checkbox" checked={consent.sync} onChange={(ev) => setConsent({ ...consent, sync: ev.currentTarget.checked })} />{t.consentSync}</label>
              <label class="check"><input type="checkbox" checked={consent.audio} onChange={(ev) => setConsent({ ...consent, audio: ev.currentTarget.checked })} />{t.consentAudio}</label>
              {shown && consentErr && <p class="err" role="alert">{t.consentNeeded}</p>}
            </fieldset>
          )}
        </section>
      )}

      <nav class="wizard-nav">
        {step > 1 ? <button type="button" onClick={() => setStep(step - 1)}>{t.back}</button>
          : edit ? <button type="button" onClick={() => go({ name: "home" })}>{t.cancel}</button> : <span />}
        <button type="button" class="primary" disabled={busy} onClick={next}>{step === STEPS ? t.finish : t.next}</button>
      </nav>
    </div>
  );
}
