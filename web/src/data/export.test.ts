import { test } from "node:test";
import assert from "node:assert/strict";
import { Repo, memoryBackend } from "./repo.ts";
import { exportLocal } from "./export.ts";

test("export has every data table and never the PIN hash or a model key", async () => {
  const b = memoryBackend();
  const r = await Repo.open(b, () => "dev1");
  await r.save("elder", { id: "e1", display_name: "Test Elder 1" });
  await b.setMeta("pin_hash", "pbkdf2$secret");
  await b.setMeta("llm", { provider: "groq", model: "m", apiKey: "test-key-value" });
  const out = await exportLocal(r, "2026-10-22T00:00:00.000Z");
  assert.deepEqual(Object.keys(out.tables).sort(), ["activity_score", "consent", "dose_event", "elder", "medicine", "safety_event", "session"]);
  assert.equal(out.tables.elder[0].display_name, "Test Elder 1");
  assert.equal(out.exported_at, "2026-10-22T00:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(out), /pbkdf2|test-key-value/);
});
