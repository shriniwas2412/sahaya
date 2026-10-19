// IndexedDB backend (browser only). One object store per table, plus "meta" for
// device-local settings (device id, clock, PIN hash, sync cursor). Meta never syncs.

import { openDB, type IDBPDatabase } from "idb";
import { TABLES, type Backend } from "./repo.ts";

export async function idbBackend(name = "sahaya"): Promise<Backend> {
  const db: IDBPDatabase = await openDB(name, 1, {
    upgrade(d) {
      for (const t of TABLES) d.createObjectStore(t, { keyPath: "id" });
      d.createObjectStore("meta");
    },
  });
  return {
    get: (t, id) => db.get(t, id),
    put: async (t, row) => { await db.put(t, row); },
    all: (t) => db.getAll(t),
    getMeta: (k) => db.get("meta", k),
    setMeta: async (k, v) => { await db.put("meta", v, k); },
  };
}
