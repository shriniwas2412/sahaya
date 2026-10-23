// Which local database this tab uses. Demo data lives in its own IndexedDB
// database, so trying the demo never touches a caregiver's real rows, and
// "clear demo" simply deletes that database.

export const REAL_DB = "sahaya";
export const DEMO_DB = "sahaya-demo";
const KEY = "sahaya:mode";

export type Mode = "demo" | "real";

export interface ModeStore { get(): string | null; set(v: string): void }

const storage: ModeStore = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v) => { try { localStorage.setItem(KEY, v); } catch { /* private mode: falls back to the default */ } },
};

/** Demo when chosen; in the hosted demo build, demo unless the visitor cleared it. */
export function currentMode(demoBuild: boolean, store: ModeStore = storage): Mode {
  const v = store.get();
  if (v === "demo" || v === "real") return v;
  return demoBuild ? "demo" : "real";
}

export const dbFor = (m: Mode) => (m === "demo" ? DEMO_DB : REAL_DB);

export function enterDemo(store: ModeStore = storage) { store.set("demo"); location.reload(); }

/** Delete the demo database and go back to the real one. */
export async function leaveDemo(store: ModeStore = storage): Promise<void> {
  store.set("real");
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DEMO_DB);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  location.reload();
}
