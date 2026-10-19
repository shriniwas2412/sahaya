// Bindings and secrets. Secrets come only from the environment
// (`wrangler secret put` in production, `.dev.vars` locally; neither is committed).

export interface D1Result<T = Record<string, unknown>> { results: T[]; success: boolean; meta?: unknown }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(stmts: D1PreparedStatement[]): Promise<D1Result[]>;
}

export interface Env {
  DB: D1Database;
  /** HMAC key for session tokens (32+ random bytes). */
  JWT_SECRET: string;
  /** VAPID public key, base64url uncompressed P-256 point (65 bytes). */
  VAPID_PUBLIC_KEY?: string;
  /** VAPID private key, base64url 32-byte scalar. */
  VAPID_PRIVATE_KEY?: string;
  /** mailto: or https: contact for push services. */
  VAPID_SUBJECT?: string;
  /** Web app origin, for CORS and the Origin check on writes. */
  APP_ORIGIN?: string;
  /** Local timezone offset in minutes for medicine times. Default 330 (IST). */
  TZ_OFFSET_MIN?: string;
  /** "1" to drop the Secure flag on the cookie for http://localhost. */
  INSECURE_COOKIE?: string;
}
