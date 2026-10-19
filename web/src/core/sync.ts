// Offline multi-device sync.
//
// A caregiver's phone, the elder's phone and the server each hold copies of the
// same rows and may edit them offline. Each row is a last-writer-wins map (a
// state-based CRDT, Shapiro et al. 2011): every field carries the timestamp of its
// last write in `_v`, and merge keeps, per field, the value with the larger
// timestamp. Timestamps come from a hybrid logical clock (Kulkarni et al. 2014):
// wall-clock ms + counter + device id, so they are totally ordered, close to real
// time, and never go backwards even if a phone's clock is wrong. Deletes are the
// `deleted` field, so they merge like any other edit.
//
// mergeRecord is commutative, associative and idempotent (tested), so the order in
// which devices sync does not change the result.

export type Stamp = string;
export interface Versioned {
  id: string;
  _v?: Record<string, Stamp>;
  [field: string]: unknown;
}

const META = new Set(["id", "_v", "hlc"]);

export interface ClockParts { wall: number; counter: number; node: string }

/** Fixed-width string so plain string comparison orders timestamps correctly. */
export function encode({ wall, counter, node }: ClockParts): Stamp {
  return `${String(wall).padStart(15, "0")}:${String(counter).padStart(5, "0")}:${node}`;
}

export function decode(ts: Stamp): ClockParts {
  const [wall, counter, ...node] = ts.split(":");
  return { wall: Number(wall), counter: Number(counter), node: node.join(":") };
}

export interface Clock {
  node: string;
  tick(): Stamp;
  observe(ts: Stamp): void;
}

/** Hybrid logical clock for one device. `now` is injectable for tests. */
export function createClock(node: string, now: () => number = () => Date.now()): Clock {
  let last = { wall: 0, counter: 0 };
  return {
    node,
    tick() {
      const pt = now();
      if (pt > last.wall) last = { wall: pt, counter: 0 };
      else last = { wall: last.wall, counter: last.counter + 1 };
      return encode({ ...last, node });
    },
    observe(ts) {
      if (!ts) return;
      const r = decode(ts);
      const pt = now();
      const wall = Math.max(pt, last.wall, r.wall);
      let counter = 0;
      if (wall === last.wall && wall === r.wall) counter = Math.max(last.counter, r.counter) + 1;
      else if (wall === last.wall) counter = last.counter + 1;
      else if (wall === r.wall) counter = r.counter + 1;
      last = { wall, counter };
    },
  };
}

/** Stamp every field that changed between `prev` and `next` with `ts`. */
export function stamp<T extends Versioned>(prev: T | null | undefined, next: T, ts: Stamp): T {
  const v: Record<string, Stamp> = { ...(prev?._v || {}) };
  for (const k of Object.keys(next)) {
    if (META.has(k)) continue;
    if (!prev || JSON.stringify(prev[k]) !== JSON.stringify(next[k])) v[k] = ts;
  }
  return { ...next, _v: v };
}

export function tombstone<T extends Versioned>(rec: T, ts: Stamp): T {
  return { ...rec, deleted: true, _v: { ...(rec._v || {}), deleted: ts } };
}

/** Field-wise last-writer-wins merge of two versions of the same row. */
export function mergeRecord<T extends Versioned>(a: T | null | undefined, b: T | null | undefined): T {
  if (!a) return b as T;
  if (!b) return a;
  const out: Versioned = { id: a.id };
  const v: Record<string, Stamp> = {};
  // Sorted keys so the merged object is byte-identical whatever the merge order.
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !META.has(k)).sort();
  for (const k of keys) {
    const ta = a._v?.[k] ?? "";
    const tb = b._v?.[k] ?? "";
    // Equal stamps only happen for unstamped fields; break the tie on the value.
    const pick = tb > ta || (tb === ta && JSON.stringify(b[k]) > JSON.stringify(a[k])) ? b : a;
    if (k in pick) out[k] = pick[k];
    const ts = tb > ta ? tb : ta;
    if (ts) v[k] = ts;
  }
  out._v = v;
  return out as T;
}

/** Merge two row lists by id. */
export function mergeAll<T extends Versioned>(listA: T[], listB: T[]): T[] {
  const m = new Map(listA.map((r) => [r.id, r]));
  for (const r of listB) m.set(r.id, mergeRecord(m.get(r.id), r));
  return [...m.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/** Newest stamp on one row (stored as the row's `hlc`). */
export function rowStamp(r: Versioned): Stamp {
  let max = "";
  for (const ts of Object.values(r._v || {})) if (ts > max) max = ts;
  return max;
}

/** Newest stamp in a list, so a clock can observe() an incoming batch. */
export function maxStamp(list: Versioned[]): Stamp {
  let max = "";
  for (const r of list) {
    const s = rowStamp(r);
    if (s > max) max = s;
  }
  return max;
}
