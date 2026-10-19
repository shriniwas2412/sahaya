import { test } from "node:test";
import assert from "node:assert/strict";
import { ulid } from "./ids.ts";

test("ulid is 26 Crockford base32 chars and encodes the time prefix", () => {
  const id = ulid(1469918176385, new Uint8Array(10));
  assert.equal(id, "01ARYZ6S410000000000000000"); // time part from the ULID spec example
  assert.match(ulid(), /^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test("ulids sort by creation time", () => {
  assert.ok(ulid(1000) < ulid(2000));
});
