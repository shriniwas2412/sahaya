// Caregiver voice settings: the ranked phone voices for the elder's language with a
// preview, and an optional natural cloud voice with the caregiver's own key.
import { useEffect, useState } from "preact/hooks";
import { useApp } from "./App.tsx";
import { configureVoice, speak, voicesFor, DEFAULT_VOICE, type VoiceSettings } from "./voice.ts";
import { calmRate, speechLocale } from "../core/speech/index.ts";
import { uiLang } from "../core/profile.ts";

const SAMPLE: Record<string, string> = {
  hi: "नमस्ते, मैं सहाया हूँ। आज सुबह आठ बजे की दवा ले ली? चलिए, कोई पुराना गाना याद करते हैं।",
  en: "Hello, I am Sahaya. Shall we remember an old song together?",
  mr: "नमस्कार, मी सहाया. आपण एखादं जुनं गाणं आठवूया का?",
};

export function VoicePicker({ consent }: { consent: { scope_audio_cloud: 0 | 1 } | null }) {
  const { repo, t, data } = useApp();
  const locale = speechLocale(data.elder?.language);
  const [s, setS] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [list, setList] = useState(voicesFor(locale));
  const [msg, setMsg] = useState("");
  useEffect(() => { repo.backend.getMeta<VoiceSettings>("voice").then((v) => setS(v ?? DEFAULT_VOICE)); }, [repo]);
  useEffect(() => {
    const load = () => setList(voicesFor(locale));
    load();
    if (typeof speechSynthesis === "undefined") return;
    speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => speechSynthesis.removeEventListener?.("voiceschanged", load);
  }, [locale]);

  async function save(next: VoiceSettings) {
    setS(next);
    await repo.backend.setMeta("voice", next);
    configureVoice(next, consent);
    setMsg(t.voiceSaved);
  }
  async function preview() {
    configureVoice(s, consent);
    const sample = SAMPLE[locale.startsWith("mr") ? "mr" : uiLang(data.elder?.language)] ?? SAMPLE.hi;
    try { await speak(sample, locale, calmRate(data.elder?.gds_stage)); } catch { setMsg(t.voiceTestFail); }
  }
  const cloudOk = !!consent?.scope_audio_cloud;
  return (
    <section class="card stack" aria-labelledby="vp-h">
      <h2 id="vp-h">{t.voicePickTitle}</h2>
      <div class="field">
        <label for="vp-voice">{t.voicePick} ({locale})</label>
        <select id="vp-voice" value={s.voiceName ?? ""} onChange={(e) => save({ ...s, voiceName: e.currentTarget.value || null })}>
          <option value="">{t.voiceAuto}{list[0] ? `: ${list[0].voice.name}` : ""}</option>
          {list.map((r) => <option value={r.voice.name}>{r.voice.name}</option>)}
        </select>
        <p class="small muted">{list.length ? t.voiceRanked : t.voiceNone}</p>
      </div>
      <div class="field">
        <label for="vp-prov">{t.voiceNeural}</label>
        <select id="vp-prov" value={s.provider} onChange={(e) => save({ ...s, provider: e.currentTarget.value as VoiceSettings["provider"] })}>
          <option value="phone">{t.voiceProviderNone}</option>
          <option value="sarvam" disabled={!cloudOk}>Sarvam AI (Bulbul)</option>
          <option value="azure" disabled={!cloudOk}>Azure AI Speech (neural)</option>
        </select>
      </div>
      {s.provider !== "phone" && (
        <>
          <div class="field">
            <label for="vp-key">{t.voiceKey}</label>
            <input id="vp-key" type="password" autocomplete="off" value={s.apiKey ?? ""} onChange={(e) => save({ ...s, apiKey: e.currentTarget.value.trim() })} />
          </div>
          {s.provider === "azure" && (
            <div class="field">
              <label for="vp-region">Region</label>
              <input id="vp-region" value={s.region ?? "centralindia"} onChange={(e) => save({ ...s, region: e.currentTarget.value.trim() })} />
            </div>
          )}
          <p class="small muted">{t.voiceKeyNote}</p>
        </>
      )}
      <button onClick={preview}>{t.voicePreview}</button>
      {msg && <p class="small" role="status">{msg}</p>}
    </section>
  );
}
