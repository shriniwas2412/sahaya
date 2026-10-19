import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPhone, isValidPhone, waNumber, waLink, telLink, smsLink } from "./contacts.ts";

test("cleanPhone keeps digits and a leading plus", () => {
  assert.equal(cleanPhone(" +91 98xx"), "+9198");
  assert.equal(cleanPhone("090000-00000"), "09000000000");
  assert.equal(cleanPhone("abc"), "");
});

test("isValidPhone allows short codes and up to 15 digits", () => {
  assert.ok(isValidPhone("112"));
  assert.ok(isValidPhone("14567"));
  assert.ok(!isValidPhone("12"));
  assert.ok(!isValidPhone("1234567890123456"));
});

test("waNumber adds 91 only to a 10-digit Indian mobile, never guesses otherwise", () => {
  assert.equal(waNumber("9000000001"), "919000000001");
  assert.equal(waNumber("09000000001"), null); // trunk 0: ambiguous, not guessed
  assert.equal(waNumber("919000000001"), "919000000001");
  assert.equal(waNumber("+44 7000 000001"), "447000000001");
  assert.equal(waNumber("0755 0000000"), null); // a landline: no WhatsApp guess
  assert.equal(waNumber("112"), null);
});

test("links are built for tel:, sms: and wa.me with encoded text", () => {
  assert.equal(telLink("90000 00001"), "tel:9000000001");
  assert.equal(smsLink("9000000001", "Madad chahiye"), "sms:9000000001?body=Madad%20chahiye");
  assert.equal(waLink("9000000001", "Test Elder 1 ko madad chahiye"), "https://wa.me/919000000001?text=Test%20Elder%201%20ko%20madad%20chahiye");
  assert.equal(waLink("112", "x"), null);
});
