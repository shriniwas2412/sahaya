import { test } from "node:test";
import assert from "node:assert/strict";
import { Repo, memoryBackend } from "./repo.ts";

let n = 0;
const ids = () => `dev${++n}`;
const fixedNow = (start: number) => { let t = start; return () => t++; };

test("open keeps one device id across restarts", async () => {
  const b = memoryBackend();
  const r1 = await Repo.open(b, ids);
  const r2 = await Repo.open(b, ids);
  assert.equal(r1.origin, r2.origin);
});

test("save stamps changed fields only and sets hlc + origin", async () => {
  const r = await Repo.open(memoryBackend(), ids, fixedNow(1000));
  const a = await r.save("elder", { id: "e1", display_name: "Test Elder 1", dialect: null });
  const b = await r.save("elder", { id: "e1", display_name: "Test Elder 1", dialect: "Malwi" });
  const va = (a as unknown as { _v: Record<string, string> })._v;
  const vb = (b as unknown as { _v: Record<string, string> })._v;
  assert.equal(vb.display_name, va.display_name);
  assert.ok(vb.dialect > va.dialect);
  assert.equal((b as unknown as { hlc: string }).hlc, vb.dialect);
  assert.equal((b as unknown as { origin: string }).origin, r.origin);
});

test("remove hides the row but keeps a tombstone that syncs", async () => {
  const r = await Repo.open(memoryBackend(), ids);
  await r.save("medicine", { id: "m1", name: "Test Tablet A" });
  await r.remove("medicine", "m1");
  assert.deepEqual(await r.list("medicine"), []);
  const ch = await r.changedSince("");
  assert.equal(ch.length, 1);
  assert.equal(ch[0].row.deleted, true);
});

test("two devices converge after exchanging changes both ways", async () => {
  const A = await Repo.open(memoryBackend(), ids, fixedNow(1000));
  const B = await Repo.open(memoryBackend(), ids, fixedNow(2000));
  await A.save("elder", { id: "e1", display_name: "Test Elder 1", notes: null });
  await B.applyRemote(await A.changedSince(""));
  await A.save("elder", { id: "e1", display_name: "Test Elder 1", notes: "Likes bhajans" });
  await B.save("elder", { id: "e1", display_name: "Test Elder One", notes: null });
  const fromA = await A.changedSince("");
  const fromB = await B.changedSince("");
  await A.applyRemote(fromB);
  await B.applyRemote(fromA);
  const ea = await A.get<Record<string, unknown>>("elder", "e1");
  const eb = await B.get<Record<string, unknown>>("elder", "e1");
  assert.equal(ea!.display_name, "Test Elder One");
  assert.equal(ea!.notes, "Likes bhajans");
  assert.deepEqual(ea, eb);
});

test("applyRemote ignores unknown tables and returns the number of rows changed", async () => {
  const r = await Repo.open(memoryBackend(), ids);
  const n1 = await r.applyRemote([
    { table: "nope" as never, row: { id: "x" } },
    { table: "elder", row: { id: "e9", display_name: "Test Elder 9", _v: { display_name: "000000000000005:00000:z" } } },
  ]);
  assert.equal(n1, 1);
  assert.equal(await r.applyRemote([{ table: "elder", row: { id: "e9", display_name: "Test Elder 9", _v: { display_name: "000000000000005:00000:z" } } }]), 0);
});

test("after seeing a remote stamp from the future, local writes sort after it", async () => {
  const r = await Repo.open(memoryBackend(), ids, () => 1000);
  const future = "000009999999999:00000:other";
  await r.applyRemote([{ table: "elder", row: { id: "e1", display_name: "x", _v: { display_name: future } } }]);
  const s = await r.save("elder", { id: "e1", display_name: "y" });
  assert.ok((s as unknown as { hlc: string }).hlc > future);
});

test("remove() clears personal fields locally, so the tombstone that syncs carries no PII", async () => {
  const r = await Repo.open(memoryBackend(), ids);
  await r.save("elder", { id: "e1", display_name: "Test Elder 1", notes: "Likes bhajans" });
  await r.remove("elder", "e1");
  const raw = await r.backend.get("elder", "e1");
  assert.equal(raw!.deleted, true);
  assert.equal(raw!.display_name, "");
  assert.equal(raw!.notes, null);
});

test("wipeAll empties every table and the device settings", async () => {
  const b = memoryBackend();
  const r = await Repo.open(b, ids);
  await r.save("elder", { id: "e1", display_name: "Test Elder 1" });
  await b.setMeta("pin_hash", "x");
  await r.wipeAll();
  assert.deepEqual(await b.all("elder"), []);
  assert.equal(await b.getMeta("pin_hash"), undefined);
});
