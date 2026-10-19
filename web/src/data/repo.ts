// Local rows with CRDT stamps. Every write goes through here, so every row carries
// per-field versions (_v), its newest stamp (hlc) and the device it came from (origin).

import { createClock, mergeRecord, rowStamp, stamp, tombstone, maxStamp, type Clock, type Versioned } from "../core/sync.ts";

export const TABLES = ["elder", "medicine", "dose_event", "session", "activity_score", "safety_event", "consent"] as const;
export type Table = (typeof TABLES)[number];

export interface Backend {
  get(table: Table, id: string): Promise<Versioned | undefined>;
  put(table: Table, row: Versioned): Promise<void>;
  all(table: Table): Promise<Versioned[]>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
}

export interface Change { table: Table; row: Versioned }

export class Repo {
  readonly backend: Backend;
  readonly clock: Clock;
  readonly origin: string;
  private listeners = new Set<() => void>();

  constructor(backend: Backend, clock: Clock, origin: string) {
    this.backend = backend;
    this.clock = clock;
    this.origin = origin;
  }

  /** Open with a stable device id, and a clock that has seen every stored stamp. */
  static async open(backend: Backend, newId: () => string, now?: () => number): Promise<Repo> {
    let device = await backend.getMeta<string>("device_id");
    if (!device) {
      device = newId();
      await backend.setMeta("device_id", device);
    }
    const clock = createClock(device, now);
    clock.observe((await backend.getMeta<string>("hlc_last")) ?? "");
    return new Repo(backend, clock, device);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() { for (const fn of this.listeners) fn(); }

  async get<T>(table: Table, id: string): Promise<T | undefined> {
    const r = await this.backend.get(table, id);
    return r && !r.deleted ? (r as unknown as T) : undefined;
  }

  async list<T>(table: Table): Promise<T[]> {
    return (await this.backend.all(table)).filter((r) => !r.deleted) as unknown as T[];
  }

  /** Insert or update; only changed fields get a new stamp. */
  async save<T extends { id: string }>(table: Table, row: T): Promise<T> {
    const prev = await this.backend.get(table, row.id);
    const ts = this.clock.tick();
    const next = stamp(prev, { ...(prev ?? {}), ...row, origin: prev?.origin ?? this.origin } as Versioned, ts);
    next.hlc = rowStamp(next);
    await this.backend.put(table, next);
    await this.backend.setMeta("hlc_last", ts);
    this.emit();
    return next as unknown as T;
  }

  async remove(table: Table, id: string): Promise<void> {
    const prev = await this.backend.get(table, id);
    if (!prev) return;
    const ts = this.clock.tick();
    const next = tombstone(prev, ts);
    next.hlc = rowStamp(next);
    await this.backend.put(table, next);
    await this.backend.setMeta("hlc_last", ts);
    this.emit();
  }

  /** Merge rows from another device or the server. */
  async applyRemote(changes: Change[]): Promise<number> {
    let n = 0;
    for (const { table, row } of changes) {
      if (!TABLES.includes(table) || typeof row?.id !== "string") continue;
      const prev = await this.backend.get(table, row.id);
      const merged = mergeRecord(prev, row);
      merged.hlc = rowStamp(merged);
      if (JSON.stringify(prev) !== JSON.stringify(merged)) {
        await this.backend.put(table, merged);
        n++;
      }
    }
    const top = maxStamp(changes.map((c) => c.row));
    if (top) {
      this.clock.observe(top);
      await this.backend.setMeta("hlc_last", this.clock.tick());
    }
    if (n) this.emit();
    return n;
  }

  /** Rows whose newest stamp is after `since` (deleted rows included, so deletes sync). */
  async changedSince(since: string): Promise<Change[]> {
    const out: Change[] = [];
    for (const table of TABLES) {
      for (const row of await this.backend.all(table)) if ((row.hlc as string) > since) out.push({ table, row });
    }
    return out;
  }
}

/** In-memory backend for tests and for a first run before IndexedDB opens. */
export function memoryBackend(): Backend {
  const t = new Map<string, Map<string, Versioned>>();
  const meta = new Map<string, unknown>();
  const tbl = (name: string) => t.get(name) ?? t.set(name, new Map()).get(name)!;
  const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
  return {
    async get(table, id) { return clone(tbl(table).get(id)); },
    async put(table, row) { tbl(table).set(row.id, clone(row)); },
    async all(table) { return [...tbl(table).values()].map(clone); },
    async getMeta(key) { return clone(meta.get(key)) as never; },
    async setMeta(key, value) { meta.set(key, clone(value)); },
  };
}
