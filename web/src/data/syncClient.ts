// Push local changes and pull everything new from the server in one round trip.
// Works only when signed in; otherwise the app stays local-only.
//
// "pushed" is the newest local stamp already sent; "cursor" is the server's own
// change stamp, so rows written on the server by a device with a slow clock are
// still pulled.

import type { Backend, Change, Repo } from "./repo.ts";

export interface SyncResponse { rows: Change[]; cursor: string; more?: boolean }
export type Post = (body: { since: string; rows: Change[] }) => Promise<SyncResponse>;

export interface SyncResult { pushed: number; pulled: number; cursor: string; kept: number }

/**
 * Elders whose newest consent (by recorded_at) is not withdrawn and allows sync.
 * Everything about any other elder stays on this phone.
 */
export async function syncableElders(b: Backend): Promise<Set<string>> {
  const newest = new Map<string, Record<string, unknown>>();
  for (const c of await b.all("consent")) {
    if (c.deleted || c.subject_type === "farmer") continue;
    const cur = newest.get(c.subject_id as string);
    if (!cur || String(c.recorded_at) > String(cur.recorded_at)) newest.set(c.subject_id as string, c);
  }
  return new Set([...newest].filter(([, c]) => c.scope_sync === 1 && !c.withdrawn_at).map(([id]) => id));
}

/** Split changes into the ones that may be sent and the ones kept on this phone. */
export async function consentFilter(b: Backend, changes: Change[]): Promise<{ send: Change[]; kept: Change[] }> {
  const ok = await syncableElders(b);
  const medElder = new Map((await b.all("medicine")).map((m) => [m.id, m.elder_id as string]));
  const sesElder = new Map((await b.all("session")).map((x) => [x.id, x.elder_id as string]));
  const elderOf = ({ table, row }: Change): string | undefined => {
    switch (table) {
      case "elder": return row.id;
      case "consent": return row.subject_id as string;
      case "medicine": case "session": case "safety_event": return row.elder_id as string;
      case "dose_event": return medElder.get(row.medicine_id as string);
      case "activity_score": return sesElder.get(row.session_id as string);
    }
  };
  const send: Change[] = [], kept: Change[] = [];
  for (const c of changes) (ok.has(elderOf(c) ?? "") ? send : kept).push(c);
  return { send, kept };
}

export async function syncOnce(repo: Repo, post: Post): Promise<SyncResult> {
  // Demo data is synthetic and local; it must never reach a server.
  if ((await repo.backend.getMeta<boolean>("demo")) === true) throw new Error("sync is off in demo mode");
  const pushedUpTo = (await repo.backend.getMeta<string>("sync_pushed")) ?? "";
  const since = (await repo.backend.getMeta<string>("sync_cursor")) ?? "";
  const { send: rows, kept } = await consentFilter(repo.backend, await repo.changedSince(pushedUpTo));
  let res = await post({ since, rows });
  // Never move the push cursor past a kept-back row, so it is sent once consent is given.
  const stamp = (c: Change) => c.row.hlc as string;
  const floor = kept.reduce((m, c) => (m === null || stamp(c) < m ? stamp(c) : m), null as string | null);
  const top = rows.reduce((m, c) => (stamp(c) > m && (floor === null || stamp(c) < floor) ? stamp(c) : m), pushedUpTo);
  await repo.backend.setMeta("sync_pushed", top);
  let pulled = await repo.applyRemote(res.rows);
  // The server pages large pulls; keep pulling (no more pushes) until it is done.
  for (let page = 0; res.more && page < 50; page++) {
    await repo.backend.setMeta("sync_cursor", res.cursor);
    res = await post({ since: res.cursor, rows: [] });
    pulled += await repo.applyRemote(res.rows);
  }
  await repo.backend.setMeta("sync_cursor", res.cursor);
  return { pushed: rows.length, pulled, cursor: res.cursor, kept: kept.length };
}

/** fetch-based Post for the real server (cookie auth). */
export const httpPost = (base = "/api"): Post => async (body) => {
  const r = await fetch(`${base}/sync`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sync failed: ${r.status}`);
  return r.json();
};
