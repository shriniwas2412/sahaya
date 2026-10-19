// HS256 JWT for the session cookie.
import { b64url, unb64url, utf8 } from "./b64.ts";

export interface Claims { sub: string; role: string; exp: number }

const key = (secret: string) =>
  crypto.subtle.importKey("raw", utf8(secret) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function signJwt(claims: Claims, secret: string): Promise<string> {
  const head = b64url(utf8(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(utf8(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("HMAC", await key(secret), utf8(`${head}.${body}`) as BufferSource);
  return `${head}.${body}.${b64url(sig)}`;
}

export async function verifyJwt(token: string | undefined, secret: string, now = Date.now()): Promise<Claims | null> {
  const parts = (token ?? "").split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  try {
    if (JSON.parse(new TextDecoder().decode(unb64url(head))).alg !== "HS256") return null;
    const ok = await crypto.subtle.verify("HMAC", await key(secret), unb64url(sig) as BufferSource, utf8(`${head}.${body}`) as BufferSource);
    if (!ok) return null;
    const c = JSON.parse(new TextDecoder().decode(unb64url(body))) as Claims;
    return typeof c.sub === "string" && c.exp * 1000 > now ? c : null;
  } catch {
    return null;
  }
}
