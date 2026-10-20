import { createContext } from "preact";
import { useContext, useEffect, useState, useCallback, useRef } from "preact/hooks";
import type { Repo } from "../data/repo.ts";
import type { ElderRow } from "../core/profile.ts";
import type { DoseEvent, Medicine } from "../core/doses.ts";
import { planTick } from "../core/doseTick.ts";
import { STRINGS, type Dict, type Lang } from "./i18n.ts";
import { Setup } from "./Setup.tsx";
import { Home } from "./Home.tsx";
import { Elder } from "./Elder.tsx";
import { Feedback } from "./Feedback.tsx";
import { Welcome, DemoBanner } from "./Demo.tsx";

export interface SessionRow {
  id: string; elder_id: string; mode: "companion" | "memory_activity" | "paper";
  started_at: string | null; ended_at: string | null; stage_at_session: number | null; language: string | null;
  topics: string[]; feedback_mood: number | null; feedback_keep: string[]; feedback_avoid: string[]; feedback_notes: string | null;
}
export interface SafetyRow {
  id: string; elder_id: string; session_id: string | null; at: string;
  trigger: "keyword" | "silence" | "agitation" | "manual" | "missed_dose"; matched: string | null; action: string | null;
  resolved_at: string | null; resolved_by: string | null;
}
export interface ActivityRow { id: string; session_id: string; task: string; score: number | null; max_score: number | null }

export interface Data {
  elder: ElderRow | null;
  meds: Medicine[];
  doses: DoseEvent[];
  sessions: SessionRow[];
  safety: SafetyRow[];
  activities: ActivityRow[];
  /** Demo data is loaded: show the banner, never dial, never sync. */
  demo: boolean;
}

export type Route = { name: "welcome" } | { name: "setup"; edit: boolean } | { name: "home"; tab?: string } | { name: "elder"; sessionId: string } | { name: "feedback"; sessionId: string };

interface Ctx {
  repo: Repo;
  lang: Lang;
  t: Dict;
  setLang(l: Lang): void;
  data: Data;
  go(r: Route): void;
}
const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

async function load(repo: Repo): Promise<Data> {
  const elders = (await repo.list<ElderRow>("elder")).sort((a, b) => a.id.localeCompare(b.id));
  const elder = elders[0] ?? null;
  const meds = elder ? (await repo.list<Medicine>("medicine")).filter((m) => m.elder_id === elder.id) : [];
  const medIds = new Set(meds.map((m) => m.id));
  const doses = (await repo.list<DoseEvent>("dose_event")).filter((d) => medIds.has(d.medicine_id));
  const sessions = elder ? (await repo.list<SessionRow>("session")).filter((s) => s.elder_id === elder.id) : [];
  const sIds = new Set(sessions.map((s) => s.id));
  const safety = elder ? (await repo.list<SafetyRow>("safety_event")).filter((s) => s.elder_id === elder.id) : [];
  const activities = (await repo.list<ActivityRow>("activity_score")).filter((a) => sIds.has(a.session_id));
  const demo = (await repo.backend.getMeta<boolean>("demo")) === true;
  return { elder, meds, doses, sessions, safety, activities, demo };
}

export function App({ repo, initialLang }: { repo: Repo; initialLang: Lang }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [data, setData] = useState<Data | null>(null);
  const [route, setRoute] = useState<Route>({ name: "home" });

  // Loads can overlap (several saves in a row); only the newest one may set state.
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const n = ++latest.current;
    const d = await load(repo);
    if (n === latest.current) setData(d);
  }, [repo]);
  useEffect(() => {
    reload();
    return repo.onChange(reload);
  }, [repo, reload]);

  // Resume elder mode after a reload: the lock survives a refresh.
  useEffect(() => {
    repo.backend.getMeta<string>("elder_mode_session").then((sid) => { if (sid) setRoute({ name: "elder", sessionId: sid }); });
  }, [repo]);

  // Dose reminders: create and advance today's dose rows every 30 s while the app is open.
  useEffect(() => {
    if (!data) return;
    const tick = async () => {
      for (const ev of planTick(data.meds, data.doses, Date.now())) await repo.save("dose_event", ev);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [repo, data]);

  const setLang = (l: Lang) => {
    setLangState(l);
    document.documentElement.lang = l;
    repo.backend.setMeta("ui_lang", l);
  };

  if (!data) return <div class="page" aria-busy="true" />;
  const ctx: Ctx = { repo, lang, t: STRINGS[lang], setLang, data, go: setRoute };
  const r: Route = !data.elder && route.name !== "setup" ? { name: "welcome" } : route;
  return (
    <AppCtx.Provider value={ctx}>
      {data.demo && r.name !== "elder" && <DemoBanner />}
      {r.name === "welcome" && <Welcome />}
      {r.name === "setup" && <Setup edit={r.edit} />}
      {r.name === "home" && <Home tab={r.tab} />}
      {r.name === "elder" && <Elder sessionId={r.sessionId} />}
      {r.name === "feedback" && <Feedback sessionId={r.sessionId} />}
    </AppCtx.Provider>
  );
}
