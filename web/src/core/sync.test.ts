import { test } from "node:test";
import assert from "node:assert/strict";
import { createClock, encode, decode, stamp, tombstone, mergeRecord, mergeAll, maxStamp, rowStamp, type Versioned } from "./sync.ts";

test("clock never goes backwards even if the wall clock does", () => {
  let now = 1000;
  const c = createClock("a", () => now);
  const t1 = c.tick();
  now = 500;
  const t2 = c.tick();
  const t3 = c.tick();
  assert.ok(t1 < t2 && t2 < t3);
  assert.deepEqual(decode(t3), { wall: 1000, counter: 2, node: "a" });
});

test("observing a remote timestamp from the future moves the clock past it", () => {
  const c = createClock("a", () => 1000);
  const remote = encode({ wall: 5000, counter: 3, node: "b" });
  c.observe(remote);
  assert.ok(c.tick() > remote);
});

test("encoded timestamps sort like numbers", () => {
  assert.ok(encode({ wall: 99, counter: 0, node: "z" }) < encode({ wall: 100, counter: 0, node: "a" }));
  assert.ok(encode({ wall: 100, counter: 9, node: "z" }) < encode({ wall: 100, counter: 10, node: "a" }));
});

// Caregiver phone and elder phone edit the same elder profile offline.
const base = stamp(null, { id: "e1", display_name: "Test Elder 1", dialect: "", notes: "" } as Versioned, "t1:a");
const phoneA = stamp(base, { ...base, dialect: "Bundeli" }, "t2:a");
const phoneB = stamp(base, { ...base, notes: "Likes bhajans" }, "t3:b");

test("concurrent edits to different fields are both kept", () => {
  const m = mergeRecord(phoneA, phoneB);
  assert.equal(m.dialect, "Bundeli");
  assert.equal(m.notes, "Likes bhajans");
});

test("same field edited on both: the later write wins, in either merge order", () => {
  const x = stamp(base, { ...base, display_name: "Test Elder A" }, "t5:a");
  const y = stamp(base, { ...base, display_name: "Test Elder B" }, "t6:b");
  assert.equal(mergeRecord(x, y).display_name, "Test Elder B");
  assert.equal(mergeRecord(y, x).display_name, "Test Elder B");
});

test("a delete syncs, and a later edit can bring the row back", () => {
  const del = tombstone(phoneA, "t7:a");
  assert.equal(mergeAll([phoneB], [del])[0].deleted, true);
  const revived = stamp(del, { ...del, deleted: false }, "t8:b");
  assert.equal(mergeRecord(del, revived).deleted, false);
});

const strip = (l: unknown) => JSON.stringify(l);
const lists: Versioned[][] = [
  [phoneA],
  [phoneB, stamp(null, { id: "e2", display_name: "Test Elder 2" } as Versioned, "t4:b")],
  [tombstone(base, "t9:c")],
];

test("merge is commutative, associative and idempotent", () => {
  const [a, b, c] = lists;
  assert.equal(strip(mergeAll(a, b)), strip(mergeAll(b, a)));
  assert.equal(strip(mergeAll(mergeAll(a, b), c)), strip(mergeAll(a, mergeAll(b, c))));
  assert.equal(strip(mergeAll(mergeAll(a, b), b)), strip(mergeAll(a, b)));
});

test("randomised: every merge order of 5 devices gives the same result", () => {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const fields = ["display_name", "dialect", "notes", "triggers"];
  const devices = Array.from({ length: 5 }, (_, p) =>
    Array.from({ length: 3 }, (_, i) => {
      const rec: Versioned = { id: "e" + i };
      for (const f of fields) if (rand() < 0.6) rec[f] = `${f}-${p}`;
      return stamp(null, rec, `${String(Math.floor(rand() * 50)).padStart(3, "0")}:${p}`);
    }),
  );
  const ref = strip(devices.reduce(mergeAll, [] as Versioned[]));
  for (let k = 0; k < 30; k++) {
    const order = [...devices].sort(() => rand() - 0.5);
    assert.equal(strip(order.reduce(mergeAll, [] as Versioned[])), ref);
  }
});

test("maxStamp and rowStamp find the newest timestamp", () => {
  assert.equal(maxStamp([phoneA, phoneB]), "t3:b");
  assert.equal(rowStamp(phoneA), "t2:a");
});

test("stamp ignores id, _v and hlc", () => {
  const r = stamp(null, { id: "x", hlc: "old", a: 1 } as Versioned, "t1:a");
  assert.deepEqual(Object.keys(r._v!), ["a"]);
});
