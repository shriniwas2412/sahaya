// "Export all": every data table on this phone as JSON. Device settings (PIN hash,
// model key, photo) are not data rows and are left out on purpose.

import { TABLES, type Repo, type Table } from "./repo.ts";

export interface LocalExport {
  app: "sahaya";
  exported_at: string;
  tables: Record<Table, Record<string, unknown>[]>;
  server?: unknown;
}

export async function exportLocal(repo: Repo, now: string = new Date().toISOString()): Promise<LocalExport> {
  const tables = {} as LocalExport["tables"];
  for (const t of TABLES) {
    tables[t] = (await repo.backend.all(t)).map(({ _v, ...row }) => row as Record<string, unknown>);
  }
  return { app: "sahaya", exported_at: now, tables };
}

/** Offer a JSON file to the user (browser only). */
export function downloadJson(name: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
