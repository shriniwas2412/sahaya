import { render } from "preact";
import "./ui/styles.css";
import { Repo, memoryBackend } from "./data/repo.ts";
import { idbBackend } from "./data/idb.ts";
import { ulid } from "./core/ids.ts";
import { App } from "./ui/App.tsx";
import { autoLoadDemo } from "./data/demo.ts";
import type { Lang } from "./ui/i18n.ts";

async function boot() {
  let backend;
  try {
    backend = await idbBackend();
  } catch {
    backend = memoryBackend(); // private mode without IndexedDB: works, but nothing persists
  }
  const repo = await Repo.open(backend, ulid);
  await autoLoadDemo(repo); // only in the VITE_DEMO=1 build, only on an empty device
  const lang = ((await backend.getMeta<Lang>("ui_lang")) ?? "hi") as Lang;
  document.documentElement.lang = lang;
  render(<App repo={repo} initialLang={lang} />, document.getElementById("app")!);
  if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
}

boot();
