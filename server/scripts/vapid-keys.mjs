// Print a new VAPID key pair (base64url) for VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
// Run: node scripts/vapid-keys.mjs   (keep the output out of git)
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
const b64 = (u) => Buffer.from(u).toString("base64url");
console.log("VAPID_PUBLIC_KEY=" + b64(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))));
console.log("VAPID_PRIVATE_KEY=" + (await crypto.subtle.exportKey("jwk", kp.privateKey)).d);
