import { test } from "node:test";
import assert from "node:assert/strict";
import { modelStatus } from "./llmSettings.ts";

test("a remote model is reported as needing consent until scope_llm_cloud is on", () => {
  const groq = { provider: "groq" as const, model: "test-model", apiKey: "test-key" };
  assert.equal(modelStatus(null, null), "off");
  assert.equal(modelStatus({ provider: "none", model: "" }, null), "off");
  assert.equal(modelStatus({ provider: "groq", model: "test-model" }, null), "incomplete");
  assert.equal(modelStatus(groq, { scope_llm_cloud: 0 }), "needs_consent");
  assert.equal(modelStatus(groq, { scope_llm_cloud: 1 }), "on");
});

test("Ollama on this computer needs no cloud consent; on another machine it does", () => {
  assert.equal(modelStatus({ provider: "ollama", model: "m", baseUrl: "http://localhost:11434" }, null), "on");
  assert.equal(modelStatus({ provider: "ollama", model: "m", baseUrl: "http://192.168.1.20:11434" }, null), "needs_consent");
});
