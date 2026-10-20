import { test } from "node:test";
import assert from "node:assert/strict";
import { demoUserSql, parseVars } from "../scripts/seed-demo.ts";
import { hashPassword } from "../src/lib/password.ts";
import { createApp } from "../src/app.ts";
import { testDb } from "./d1.ts";

test("parseVars reads KEY=VALUE lines and skips comments", () => {
  assert.deepEqual(parseVars("# c\nDEMO_EMAIL=demo@example.invalid\nDEMO_PASSWORD=\"x y z 123\"\n"), { DEMO_EMAIL: "demo@example.invalid", DEMO_PASSWORD: "x y z 123" });
});

test("seeded demo account can log in, and re-seeding resets the password", async () => {
  const DB = testDb();
  const env = { DB, JWT_SECRET: "test-secret-not-real-0123456789abcdef", INSECURE_COOKIE: "1" };
  const app = createApp();
  const login = (password: string) => app.request("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "demo@example.invalid", password }),
  }, env);
  await DB.prepare(demoUserSql("Demo@Example.invalid", "Demo Caregiver", await hashPassword("first demo pw", 1000), "2026-10-20T00:00:00Z")).run();
  assert.equal((await login("first demo pw")).status, 200);
  await DB.prepare(demoUserSql("demo@example.invalid", "Demo Caregiver", await hashPassword("second demo pw", 1000), "2026-10-20T00:00:00Z")).run();
  assert.equal((await login("first demo pw")).status, 401);
  assert.equal((await login("second demo pw")).status, 200);
});

test("quotes in values cannot break out of the SQL string", () => {
  const sql = demoUserSql("a'b@example.invalid", "O'Brien'); DROP TABLE app_user;--", "h", "t");
  assert.ok(sql.includes("'O''Brien''); DROP TABLE app_user;--'"));
});
