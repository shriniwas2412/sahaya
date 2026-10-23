import { test } from "node:test";
import assert from "node:assert/strict";
import { currentMode, dbFor, DEMO_DB, REAL_DB } from "./demoMode.ts";

const mem = (v: string | null) => ({ v, get() { return this.v; }, set(x: string) { this.v = x; } });

test("demo data gets its own database; the hosted demo opens in demo unless cleared", () => {
  assert.equal(currentMode(false, mem(null)), "real");
  assert.equal(currentMode(true, mem(null)), "demo");
  assert.equal(currentMode(true, mem("real")), "real");
  assert.equal(currentMode(false, mem("demo")), "demo");
  assert.equal(dbFor("demo"), DEMO_DB);
  assert.equal(dbFor("real"), REAL_DB);
  assert.notEqual(DEMO_DB, REAL_DB);
});
