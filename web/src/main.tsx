import { render } from "preact";
import "./ui/styles.css";
import { Repo, memoryBackend } from "./data/repo.ts";
import { idbBackend } from "./data/idb.ts";
import { ulid } from "./core/ids.ts";
import { App } from "./ui/App.tsx";
import { DEMO_BUILD, loadDemo } from "./data/demo.ts";
import { currentMode, dbFor } from "./data/demoMode.ts";
import type { Lang } from "./ui/i18n.ts";

async function boot() {
  const mode = currentMode(DEMO_BUILD);
  let backend;
  try {
    backend = await idbBackend(dbFor(mode));
  } catch {
    backend = memoryBackend(); // private mode without IndexedDB: works, but nothing persists
  }
  const repo = await Repo.open(backend, ulid);
  // The demo database is filled on first open; its dates are relative to that day.
  if (mode === "demo" && !(await repo.list("elder")).length) await loadDemo(repo);
  const lang = ((await backend.getMeta<Lang>("ui_lang")) ?? "hi") as Lang;
  document.documentElement.lang = lang;
  render(<App repo={repo} initialLang={lang} />, document.getElementById("app")!);
  if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
}

boot();
