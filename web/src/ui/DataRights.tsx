// "Your data": export everything, or delete everything, and the consent
// switches for the current profile.

import { useEffect, useState } from "preact/hooks";
import { useApp } from "./App.tsx";
import { exportLocal, downloadJson } from "../data/export.ts";
import { latestConsent, withScope, isDeleteWord, type ConsentRow, type Scope } from "../data/consent.ts";
import { exportAccount, deleteAccount, me } from "./api.ts";

export function DataRights() {
  const { repo, t, data, go } = useApp();
  const [word, setWord] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function doExport() {
    setBusy(true);
    const out = await exportLocal(repo);
    if (!data.demo) {
      const signedIn = await me().then(() => true, () => false);
      if (signedIn) out.server = await exportAccount().catch(() => ({ error: "server export failed" }));
    }
    downloadJson(`sahaya-export-${out.exported_at.slice(0, 10)}.json`, out);
    setBusy(false);
    setMsg(t.exportDone);
  }

  async function doDelete() {
    if (!isDeleteWord(word)) { setMsg(t.deleteNeedWord); return; }
    setBusy(true);
    if (!data.demo) {
      const signedIn = await me().then(() => true, () => false);
      if (signedIn) {
        try { await deleteAccount(); } catch { setBusy(false); setMsg(t.deleteServerFail); return; }
      }
    }
    await repo.wipeAll();
    setBusy(false);
    go({ name: "welcome" });
  }

  return (
    <section class="card stack" aria-labelledby="dr-h">
      <h2 id="dr-h">{t.dataTitle}</h2>
      <p class="muted">{t.dataHint}</p>
      <button disabled={busy} onClick={doExport}>{t.exportAll}</button>
      <div class="danger-zone stack">
        <h3>{t.deleteAll}</h3>
        <p class="small">{t.deleteAllHint}</p>
        <div class="field">
          <label for="del-word">{t.deleteTypeWord}</label>
          <input id="del-word" value={word} autocomplete="off" onInput={(e) => setWord(e.currentTarget.value)} aria-describedby="del-msg" />
        </div>
        <button class="danger" disabled={busy || !isDeleteWord(word)} onClick={doDelete}>{t.deleteAll}</button>
      </div>
      <p id="del-msg" role="status">{msg}</p>
    </section>
  );
}

/** Consent switches for the current profile. Each change appends a new consent row. */
export function ConsentCard() {
  const { repo, t, data } = useApp();
  const elder = data.elder!;
  const [rows, setRows] = useState<ConsentRow[] | null>(null);
  useEffect(() => { repo.list<ConsentRow>("consent").then(setRows); }, [repo, data.consentVersion]);
  if (rows === null) return null;
  const cur = latestConsent(rows, elder.id);
  if (!cur) return null;
  async function toggle(scope: Scope, on: boolean) {
    const next = withScope(cur!, scope, on, new Date().toISOString());
    await repo.save("consent", next);
  }
  const items: [Scope, string, string][] = [
    ["scope_sync", t.consentSyncShort, t.consentSyncHelp],
    ["scope_audio_cloud", t.consentAudioShort, t.consentAudioHelp],
    ["scope_llm_cloud", t.consentLlmShort, t.consentLlmHelp],
  ];
  return (
    <section class="card stack" aria-labelledby="cs-h">
      <h2 id="cs-h">{t.consentTitle}</h2>
      <p class="small muted">{t.consentRecorded(new Date(cur.recorded_at).toLocaleDateString())}</p>
      {items.map(([scope, label, help]) => (
        <label class="check">
          <input type="checkbox" checked={cur[scope] === 1} disabled={data.demo && scope === "scope_sync"} onChange={(e) => toggle(scope, e.currentTarget.checked)} />
          <span><strong>{label}</strong><span class="hint">{help}</span></span>
        </label>
      ))}
    </section>
  );
}
