// Elder-mode PIN: 4-6 digits, stored only as a salted PBKDF2-SHA256 hash on the device.
// Uses WebCrypto, so the same code runs in the browser and in node tests.

export const PIN_ITERATIONS = 100_000;
export const MAX_TRIES = 5;
export const LOCKOUT_MS = 30_000;
export const LONG_PRESS_MS = 3_000;

export const isValidPin = (pin: string) => /^\d{4,6}$/.test(pin);

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** "pbkdf2$<iterations>$<salt b64>$<hash b64>" */
export async function hashPin(pin: string, iterations: number = PIN_ITERATIONS): Promise<string> {
  if (!isValidPin(pin)) throw new Error("PIN must be 4 to 6 digits");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(await derive(pin, salt, iterations))}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [alg, it, salt, hash] = stored.split("$");
  if (alg !== "pbkdf2" || !salt || !hash) return false;
  const got = await derive(pin, unb64(salt), Number(it));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

/** Wrong-PIN lockout: after MAX_TRIES failures, wait LOCKOUT_MS. */
export interface Tries { fails: number; lockedUntil: number }
export function afterAttempt(t: Tries, ok: boolean, now: number): Tries {
  if (ok) return { fails: 0, lockedUntil: 0 };
  const fails = t.fails + 1;
  return fails >= MAX_TRIES ? { fails: 0, lockedUntil: now + LOCKOUT_MS } : { fails, lockedUntil: t.lockedUntil };
}
export const isLocked = (t: Tries, now: number) => now < t.lockedUntil;
