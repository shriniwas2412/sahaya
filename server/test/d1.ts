// A D1-shaped wrapper over node:sqlite, so tests run the real migration SQL.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { D1Database, D1PreparedStatement } from "../src/env.ts";

export function testDb(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON"); // D1 enforces foreign keys
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  const stmt = (sql: string, args: unknown[] = []): D1PreparedStatement => ({
    bind: (...v) => stmt(sql, v),
    async first<T>() { return (db.prepare(sql).get(...(args as never[])) as T) ?? null; },
    async all<T>() { return { results: db.prepare(sql).all(...(args as never[])) as T[], success: true }; },
    async run() { db.prepare(sql).run(...(args as never[])); return { results: [], success: true }; },
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(list) { return Promise.all(list.map((s) => s.run())); },
  };
}
