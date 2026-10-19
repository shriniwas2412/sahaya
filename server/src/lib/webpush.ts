// Web Push without a library: RFC 8291 (aes128gcm payload encryption) and
// RFC 8292 (VAPID). WebCrypto only, so it runs on Workers and in node tests.
// VAPID keys come from env vars only.

import { b64url, unb64url, utf8, concat } from "./b64.ts";

export interface PushSubscriptionJson { endpoint: string; keys: { p256dh: string; auth: string } }

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as BufferSource));
}

/** P-256 private key from a raw scalar plus its uncompressed public point. */
async function importEcPrivate(d: Uint8Array, pub: Uint8Array, alg: "ECDH" | "ECDSA"): Promise<CryptoKey> {
  const jwk = { kty: "EC", crv: "P-256", d: b64url(d), x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true };
  return crypto.subtle.importKey("jwk", jwk, alg === "ECDH" ? { name: "ECDH", namedCurve: "P-256" } : { name: "ECDSA", namedCurve: "P-256" }, false,
    alg === "ECDH" ? ["deriveBits"] : ["sign"]);
}

export interface EncryptOptions {
  /** Test hooks: fixed salt and application-server key pair (RFC 8291 Appendix A). */
  salt?: Uint8Array;
  asPrivate?: Uint8Array;
  asPublic?: Uint8Array;
  recordSize?: number;
}

/** Encrypt one push message body (single record, aes128gcm). */
export async function encryptPayload(plaintext: Uint8Array, uaPublic: Uint8Array, authSecret: Uint8Array, o: EncryptOptions = {}): Promise<Uint8Array> {
  let asPub: Uint8Array, asKey: CryptoKey;
  if (o.asPrivate && o.asPublic) {
    asPub = o.asPublic;
    asKey = await importEcPrivate(o.asPrivate, o.asPublic, "ECDH");
  } else {
    const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    asPub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    asKey = kp.privateKey;
  }
  const uaKey = await crypto.subtle.importKey("raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKey, 256));

  const prkKey = await hmac(authSecret, shared);
  const ikm = await hmac(prkKey, concat(utf8("WebPush: info\0"), uaPublic, asPub, new Uint8Array([1])));
  const salt = o.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(utf8("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(utf8("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const key = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, concat(plaintext, new Uint8Array([2])) as BufferSource));

  const rs = o.recordSize ?? 4096;
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = asPub.length;
  return concat(header, asPub, ct);
}

/** VAPID Authorization header value for a push endpoint. */
export async function vapidAuth(endpoint: string, subject: string, publicKey: string, privateKey: string, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const head = b64url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64url(utf8(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await importEcPrivate(unb64url(privateKey), unb64url(publicKey), "ECDSA");
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(`${head}.${body}`) as BufferSource);
  return `vapid t=${head}.${body}.${b64url(sig)}, k=${publicKey}`;
}

export interface PushMessage { title: string; body: string; tag?: string; urgent?: boolean; url?: string }

export interface VapidConfig { subject: string; publicKey: string; privateKey: string }

export type Fetch = (url: string, init: RequestInit) => Promise<{ status: number }>;

/** Send one message. Returns the push service status (201 ok; 404/410 = subscription gone). */
export async function sendPush(sub: PushSubscriptionJson, msg: PushMessage, vapid: VapidConfig, f: Fetch = fetch): Promise<number> {
  const body = await encryptPayload(utf8(JSON.stringify(msg)), unb64url(sub.keys.p256dh), unb64url(sub.keys.auth));
  const res = await f(sub.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidAuth(sub.endpoint, vapid.subject, vapid.publicKey, vapid.privateKey),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "3600",
      urgency: msg.urgent ? "high" : "normal",
    },
    body: body as BodyInit,
  });
  return res.status;
}
