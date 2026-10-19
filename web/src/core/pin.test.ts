import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPin, verifyPin, isValidPin, afterAttempt, isLocked, MAX_TRIES, LOCKOUT_MS } from "./pin.ts";

test("PIN must be 4 to 6 digits", () => {
  for (const ok of ["1234", "12345", "123456"]) assert.ok(isValidPin(ok), ok);
  for (const bad of ["123", "1234567", "12a4", "", " 1234"]) assert.ok(!isValidPin(bad), bad);
});

test("hash verifies the right PIN only, and is salted", async () => {
  const h = await hashPin("4321", 1000);
  assert.match(h, /^pbkdf2\$1000\$/);
  assert.ok(!h.includes("4321"));
  assert.equal(await verifyPin("4321", h), true);
  assert.equal(await verifyPin("4322", h), false);
  assert.notEqual(await hashPin("4321", 1000), h);
});

test("malformed stored hash never verifies", async () => {
  assert.equal(await verifyPin("1234", "plain1234"), false);
});

test("five wrong PINs lock for 30 s; a right PIN resets", () => {
  let t = { fails: 0, lockedUntil: 0 };
  for (let i = 0; i < MAX_TRIES - 1; i++) t = afterAttempt(t, false, 0);
  assert.equal(isLocked(t, 0), false);
  t = afterAttempt(t, false, 1000);
  assert.equal(isLocked(t, 1000 + LOCKOUT_MS - 1), true);
  assert.equal(isLocked(t, 1000 + LOCKOUT_MS), false);
  assert.deepEqual(afterAttempt({ fails: 3, lockedUntil: 0 }, true, 5), { fails: 0, lockedUntil: 0 });
});
