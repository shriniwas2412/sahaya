// Create (or reset) the local demo caregiver account from .dev.vars.
//   DEMO_EMAIL=...  DEMO_PASSWORD=...   (in server/.dev.vars, which is gitignored)
// Run:  node scripts/seed-demo.ts
//       npx wrangler d1 execute sahaya --local --file=.wrangler/seed-demo.sql
// Local development only. Never use the demo password anywhere real.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { hashPassword } from "../src/lib/password.ts";

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** One SQL statement that inserts or resets the demo caregiver. */
export function demoUserSql(email: string, name: string, passwordHash: string, now: string): string {
  return `INSERT INTO app_user (id, hlc, deleted, role, name, email, password_hash, created_at) VALUES ` +
    `('demo-caregiver', ${q(now)}, 0, 'caregiver', ${q(name)}, ${q(email.toLowerCase())}, ${q(passwordHash)}, ${q(now)}) ` +
    `ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, password_hash = excluded.password_hash, deleted = 0;`;
}

export function parseVars(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

async function main() {
  if (!existsSync(".dev.vars")) throw new Error("Create server/.dev.vars first (copy .dev.vars.example).");
  const v = parseVars(readFileSync(".dev.vars", "utf8"));
  const email = v.DEMO_EMAIL, password = v.DEMO_PASSWORD;
  if (!email || !password || password.length < 8) throw new Error("Set DEMO_EMAIL and DEMO_PASSWORD (8+ characters) in .dev.vars.");
  if (password === "change-me-demo-only") console.warn("Note: still the example demo password. Fine on your laptop only.");
  mkdirSync(".wrangler", { recursive: true });
  writeFileSync(".wrangler/seed-demo.sql", demoUserSql(email, "Demo Caregiver", await hashPassword(password), new Date().toISOString()) + "\n");
  console.log("Wrote .wrangler/seed-demo.sql (gitignored). Apply it with:");
  console.log("  npx wrangler d1 execute sahaya --local --file=.wrangler/seed-demo.sql");
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
