// Cloudflare Worker entry: HTTP API + the 5-minute cron.
import { createApp } from "./app.ts";
import { runCron } from "./cron.ts";
import type { Env } from "./env.ts";

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(runCron(env));
  },
};
