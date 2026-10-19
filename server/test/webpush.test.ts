import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptPayload, vapidAuth, sendPush } from "../src/lib/webpush.ts";
import { b64url, unb64url, utf8 } from "../src/lib/b64.ts";

// RFC 8291 Appendix A worked example.
const A = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

test("aes128gcm encryption matches the RFC 8291 Appendix A example byte for byte", async () => {
  const out = await encryptPayload(unb64url(A.plaintext), unb64url(A.uaPublic), unb64url(A.auth), {
    salt: unb64url(A.salt), asPrivate: unb64url(A.asPrivate), asPublic: unb64url(A.asPublic),
  });
  assert.equal(b64url(out), A.body);
});

async function vapidKeys() {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { kp, publicKey: b64url(pub), privateKey: jwk.d! };
}

test("VAPID header is a valid ES256 JWT for the endpoint origin", async () => {
  const k = await vapidKeys();
  const h = await vapidAuth("https://push.example.test/send/abc", "mailto:test@example.test", k.publicKey, k.privateKey, 1_000_000);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
  assert.ok(m);
  const claims = JSON.parse(new TextDecoder().decode(unb64url(m[2])));
  assert.equal(claims.aud, "https://push.example.test");
  assert.equal(claims.exp, 1000 + 12 * 3600);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k.kp.publicKey, unb64url(m[3]) as BufferSource, utf8(`${m[1]}.${m[2]}`) as BufferSource);
  assert.ok(ok);
  assert.equal(m[4], k.publicKey);
});

test("sendPush posts an encrypted body with the right headers", async () => {
  const k = await vapidKeys();
  let seen: { url: string; init: RequestInit } | null = null;
  const status = await sendPush(
    { endpoint: "https://push.example.test/x", keys: { p256dh: A.uaPublic, auth: A.auth } },
    { title: "Sahaya", body: "Test Elder 1", urgent: true },
    { subject: "mailto:test@example.test", publicKey: k.publicKey, privateKey: k.privateKey },
    async (url, init) => { seen = { url, init }; return { status: 201 }; },
  );
  assert.equal(status, 201);
  const h = seen!.init.headers as Record<string, string>;
  assert.equal(h["content-encoding"], "aes128gcm");
  assert.equal(h.urgency, "high");
  assert.ok((seen!.init.body as Uint8Array).length > 86);
});
