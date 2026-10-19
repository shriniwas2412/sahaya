// Push local changes and pull everything new from the server in one round trip.
// Works only when signed in; otherwise the app stays local-only.
//
// "pushed" is the newest local stamp already sent; "cursor" is the server's own
// change stamp, so rows written on the server by a device with a slow clock are
// still pulled.

import type { Change, Repo } from "./repo.ts";

export interface SyncResponse { rows: Change[]; cursor: string; more?: boolean }
export type Post = (body: { since: string; rows: Change[] }) => Promise<SyncResponse>;

export interface SyncResult { pushed: number; pulled: number; cursor: string }

export async function syncOnce(repo: Repo, post: Post): Promise<SyncResult> {
  const pushedUpTo = (await repo.backend.getMeta<string>("sync_pushed")) ?? "";
  const since = (await repo.backend.getMeta<string>("sync_cursor")) ?? "";
  const rows = await repo.changedSince(pushedUpTo);
  let res = await post({ since, rows });
  const top = rows.reduce((m, c) => ((c.row.hlc as string) > m ? (c.row.hlc as string) : m), pushedUpTo);
  await repo.backend.setMeta("sync_pushed", top);
  let pulled = await repo.applyRemote(res.rows);
  // The server pages large pulls; keep pulling (no more pushes) until it is done.
  for (let page = 0; res.more && page < 50; page++) {
    await repo.backend.setMeta("sync_cursor", res.cursor);
    res = await post({ since: res.cursor, rows: [] });
    pulled += await repo.applyRemote(res.rows);
  }
  await repo.backend.setMeta("sync_cursor", res.cursor);
  return { pushed: rows.length, pulled, cursor: res.cursor };
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
