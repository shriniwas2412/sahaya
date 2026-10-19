import { test } from "node:test";
import assert from "node:assert/strict";
import { Repo, memoryBackend, type Change } from "./repo.ts";
import { syncOnce, type Post } from "./syncClient.ts";
import { mergeRecord, createClock, type Versioned } from "../core/sync.ts";

// A tiny stand-in for the server: merges rows and hands out its own change stamps.
function fakeServer() {
  const rows = new Map<string, { change: Change; at: string }>();
  const clock = createClock("server", () => 1);
  const post: Post = async ({ since, rows: incoming }) => {
    for (const c of incoming) {
      const k = `${c.table}/${c.row.id}`;
      const merged = mergeRecord(rows.get(k)?.change.row as Versioned | undefined, c.row);
      rows.set(k, { change: { table: c.table, row: merged }, at: clock.tick() });
    }
    const out = [...rows.values()].filter((r) => r.at > since);
    return { rows: out.map((r) => r.change), cursor: clock.tick() };
  };
  return { post };
}

let n = 0;
const ids = () => `d${++n}`;

test("caregiver phone and elder phone converge through the server", async () => {
  const server = fakeServer();
  const care = await Repo.open(memoryBackend(), ids);
  const elder = await Repo.open(memoryBackend(), ids);
  await care.save("medicine", { id: "m1", elder_id: "e1", name: "Test Tablet A", times: ["08:00"] });
  const r1 = await syncOnce(care, server.post);
  assert.equal(r1.pushed, 1);
  const r2 = await syncOnce(elder, server.post);
  assert.equal(r2.pulled, 1);
  await elder.save("dose_event", { id: "dose:m1:2026-10-20T08:00", medicine_id: "m1", status: "taken" });
  await syncOnce(elder, server.post);
  await syncOnce(care, server.post);
  assert.equal((await care.get<{ status: string }>("dose_event", "dose:m1:2026-10-20T08:00"))?.status, "taken");
});

test("a second sync with no new local writes pushes nothing", async () => {
  const server = fakeServer();
  const r = await Repo.open(memoryBackend(), ids);
  await r.save("elder", { id: "e1", display_name: "Test Elder 1" });
  await syncOnce(r, server.post);
  const again = await syncOnce(r, server.post);
  assert.equal(again.pushed, 0);
});

test("paged pulls continue until the server has no more", async () => {
  const r = await Repo.open(memoryBackend(), ids);
  const pages = [
    { rows: [{ table: "elder" as const, row: { id: "e1", display_name: "Test Elder 1", _v: { display_name: "000000000000001:00000:s" } } }], cursor: "c1", more: true },
    { rows: [{ table: "elder" as const, row: { id: "e2", display_name: "Test Elder 2", _v: { display_name: "000000000000002:00000:s" } } }], cursor: "c2", more: false },
  ];
  const seen: string[] = [];
  const res = await syncOnce(r, async (b) => { seen.push(b.since); return pages.shift()!; });
  assert.equal(res.pulled, 2);
  assert.deepEqual(seen, ["", "c1"]);
  assert.equal(await r.backend.getMeta("sync_cursor"), "c2");
});
