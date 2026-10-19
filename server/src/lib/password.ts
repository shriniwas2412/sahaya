// Password hashing with PBKDF2-SHA256 (WebCrypto). Workers caps PBKDF2 at 100,000 iterations.
import { b64url, unb64url, utf8 } from "./b64.ts";

export const ITERATIONS = 100_000;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", utf8(password) as BufferSource, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256));
}

export async function hashPassword(password: string, iterations = ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2_sha256$${iterations}$${b64url(salt)}$${b64url(await derive(password, salt, iterations))}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const [alg, it, salt, hash] = (stored ?? "").split("$");
  if (alg !== "pbkdf2_sha256" || !salt || !hash) return false;
  const got = await derive(password, unb64url(salt), Number(it));
  const want = unb64url(hash);
  if (got.length !== want.length) return false;
  let d = 0;
  for (let i = 0; i < got.length; i++) d |= got[i] ^ want[i];
  return d === 0;
}

export const validPassword = (p: unknown): p is string => typeof p === "string" && p.length >= 8 && p.length <= 200;
