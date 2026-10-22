import { useEffect, useState } from "preact/hooks";
import { useApp } from "./App.tsx";
import { me, signIn, signUp, signOut, enablePush, type Me } from "./api.ts";
import { syncOnce, httpPost } from "../data/syncClient.ts";
import { WebSpeechProvider, speechLocale, type SpeechCapabilities } from "../core/speech/index.ts";
import { modelStatus, type LlmSettings } from "./llmSettings.ts";
import { REMOTE_MODEL_DISCLOSURE } from "../core/companion/index.ts";
import { DataRights } from "./DataRights.tsx";

export function Account() {
  const { repo, t, lang, data } = useApp();
  const [user, setUser] = useState<Me | null>(null);
  const [mode, setMode] = useState<"in" | "up">("in");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [msg, setMsg] = useState("");
  const [caps, setCaps] = useState<SpeechCapabilities | null>(null);
  const [llm, setLlm] = useState<LlmSettings>({ provider: "none", model: "" });
  const [consent, setConsent] = useState<{ scope_llm_cloud?: 0 | 1 } | null>(null);

  useEffect(() => { me().then(setUser).catch(() => setUser(null)); }, []);
  useEffect(() => {
    (async () => {
      const consent = (await repo.list<{ subject_id: string; recorded_at: string; scope_audio_cloud: 0 | 1; scope_llm_cloud?: 0 | 1 }>("consent"))
        .filter((c) => c.subject_id === data.elder?.id).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
      setConsent(consent ?? null);
      setCaps(await new WebSpeechProvider({ consent: consent ?? null }).capabilities(speechLocale(data.elder?.language)).catch(() => null));
      setLlm((await repo.backend.getMeta<LlmSettings>("llm")) ?? { provider: "none", model: "" });
    })();
  }, [repo, data.elder?.id, data.consentVersion]);

  async function submit(e: Event) {
    e.preventDefault();
    setMsg("");
    try {
      setUser(mode === "in" ? await signIn(form.email, form.password) : await signUp(form.name, form.email, form.password));
      setForm({ ...form, password: "" });
    } catch (err) {
      setMsg(String((err as Error).message) === "401" ? t.badLogin : t.syncFail);
    }
  }

  async function sync() {
    try {
      const r = await syncOnce(repo, httpPost());
      setMsg(t.syncOk(r.pushed, r.pulled) + (r.kept ? ` ${t.syncKept(r.kept)}` : ""));
    } catch {
      setMsg(t.syncFail);
    }
  }

  return (
    <>
      <section class="card stack">
        <h1>{t.accTitle}</h1>
        <p class="muted">{t.accHint}</p>
        {!navigator.onLine && <p class="card warn small">{t.offline}</p>}
        {data.demo ? <p class="card warn small">{t.demoNoSync}</p> : user ? (
          <>
            <p><strong>{user.name}</strong> · {user.email}</p>
            <div class="row">
              <button class="primary" onClick={sync}>{t.syncNow}</button>
              <button onClick={async () => setMsg((await enablePush().catch(() => false)) ? t.saved : t.notifUnsupported)}>{t.notifOn}</button>
              <button class="ghost" onClick={async () => { await signOut().catch(() => {}); setUser(null); }}>{t.signOut}</button>
            </div>
          </>
        ) : (
          <form class="stack" onSubmit={submit}>
            {mode === "up" && (
              <div class="field"><label for="an">{t.name}</label><input id="an" autocomplete="name" value={form.name} onInput={(e) => setForm({ ...form, name: e.currentTarget.value })} required /></div>
            )}
            <div class="field"><label for="ae">{t.email}</label><input id="ae" type="email" autocomplete="email" value={form.email} onInput={(e) => setForm({ ...form, email: e.currentTarget.value })} required /></div>
            <div class="field"><label for="ap">{t.password}</label><input id="ap" type="password" minLength={8} autocomplete={mode === "in" ? "current-password" : "new-password"} value={form.password} onInput={(e) => setForm({ ...form, password: e.currentTarget.value })} required /></div>
            <div class="row">
              <button class="primary" type="submit">{mode === "in" ? t.signIn : t.signUp}</button>
              <button type="button" class="ghost" onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? t.signUp : t.signIn}</button>
            </div>
          </form>
        )}
        {msg && <p role="status">{msg}</p>}
      </section>
      <section class="card">
        <h2>{t.voiceTitle}</h2>
        <p>{t.voiceStt}: <strong>{caps?.stt ? t.yes : t.no}</strong> · {t.voiceTts}: <strong>{caps?.tts ? t.yes : t.no}</strong></p>
        {caps?.note && <p class="small muted">{caps.note}</p>}
        <p class="small muted">{t.voiceFallback}</p>
      </section>
      <section class="card stack">
        <h2>{lang === "hi" ? "बातचीत का मॉडल (ज़रूरी नहीं)" : "Conversation model (optional)"}</h2>
        <p class="small muted">{t.modelDefault}</p>
        <div class="card soft small" role="note"><strong>{t.modelWhatLeaves}</strong> {REMOTE_MODEL_DISCLOSURE[lang]}</div>
        <div class="field"><label for="lp">{lang === "hi" ? "प्रदाता" : "Provider"}</label>
          <select id="lp" value={llm.provider} onChange={(e) => setLlm({ ...llm, provider: e.currentTarget.value as LlmSettings["provider"] })}>
            <option value="none">{lang === "hi" ? "कोई नहीं (ऑफ़लाइन)" : "None (offline)"}</option>
            <option value="groq">Groq</option><option value="openrouter">OpenRouter</option><option value="ollama">Ollama (desktop / LAN)</option>
          </select></div>
        {llm.provider !== "none" && (
          <>
            <div class="field"><label for="lm">{lang === "hi" ? "मॉडल का नाम" : "Model name"}</label><input id="lm" value={llm.model} onInput={(e) => setLlm({ ...llm, model: e.currentTarget.value })} /></div>
            {llm.provider === "ollama"
              ? <div class="field"><label for="lu">URL</label><input id="lu" placeholder="http://localhost:11434" value={llm.baseUrl ?? ""} onInput={(e) => setLlm({ ...llm, baseUrl: e.currentTarget.value })} /></div>
              : <div class="field"><label for="lk">API key</label><input id="lk" type="password" autocomplete="off" value={llm.apiKey ?? ""} onInput={(e) => setLlm({ ...llm, apiKey: e.currentTarget.value })} /></div>}
          </>
        )}
        <p class={`small model-status ${modelStatus(llm, consent)}`} role="status">{t.modelStatus[modelStatus(llm, consent)]}</p>
        <button onClick={async () => { await repo.backend.setMeta("llm", llm); setMsg(t.saved); }}>{t.save}</button>
      </section>
      <DataRights />
    </>
  );
}
