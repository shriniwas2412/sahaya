import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GroqProvider, OpenRouterProvider, OllamaProvider, ProxyProvider, ScriptedProvider, LLMError, LLM_TIMEOUT_MS,
  type FetchLike, type ChatMessage,
} from "./llm.ts";
import { ScriptedCompanion } from "./scripted.ts";

const reply = (content: unknown, ok = true, status = 200): FetchLike => async () => ({ ok, status, json: async () => ({ choices: [{ message: { content } }] }) });
const history = (n: number): ChatMessage[] => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));

test("default timeout is 8 s", () => {
  assert.equal(LLM_TIMEOUT_MS, 8000);
});

test("Groq request: OpenAI-compatible body, key only in the header, history trimmed to 8 turns", () => {
  const p = new GroqProvider({ apiKey: "test-key", model: "test-model" });
  const { url, init } = p.buildRequest("SYS", history(30), { maxTokens: 80 });
  assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal((init.headers as Record<string, string>).Authorization, "Bearer test-key");
  const body = JSON.parse(String(init.body));
  assert.equal(body.model, "test-model");
  assert.equal(body.max_tokens, 80);
  assert.deepEqual(body.messages[0], { role: "system", content: "SYS" });
  assert.equal(body.messages.length, 1 + 16);
  assert.equal(body.messages.at(-1).content, "m29");
  assert.ok(!String(init.body).includes("test-key"));
});

test("keyed providers refuse to start without a key or a model", () => {
  assert.throws(() => new GroqProvider({ apiKey: "", model: "m" }), (e: unknown) => e instanceof LLMError && e.kind === "config");
  assert.throws(() => new OpenRouterProvider({ apiKey: "k", model: " " }), /model is required/);
});

test("OpenRouter, Ollama and proxy endpoints; Ollama and proxy send no key", () => {
  assert.equal(new OpenRouterProvider({ apiKey: "k", model: "m" }).buildRequest("s", [], { maxTokens: 1 }).url, "https://openrouter.ai/api/v1/chat/completions");
  const o = new OllamaProvider({ model: "m", baseUrl: "http://192.168.1.5:11434/" }).buildRequest("s", [], { maxTokens: 1 });
  assert.equal(o.url, "http://192.168.1.5:11434/v1/chat/completions");
  assert.equal((o.init.headers as Record<string, string>).Authorization, undefined);
  assert.equal(new OllamaProvider({ model: "m" }).buildRequest("s", [], { maxTokens: 1 }).url, "http://localhost:11434/v1/chat/completions");
  assert.equal(new ProxyProvider({ url: "/api/llm", model: "m" }).buildRequest("s", [], { maxTokens: 1 }).url, "/api/llm");
});

test("complete: trims the reply", async () => {
  const p = new GroqProvider({ apiKey: "k", model: "m", fetch: reply("  Namaste!  ") });
  assert.equal(await p.complete("s", [], { maxTokens: 10 }), "Namaste!");
});

test("complete: HTTP errors, network errors and empty replies become typed LLMErrors", async () => {
  const kind = async (f: FetchLike) => {
    try { await new GroqProvider({ apiKey: "k", model: "m", fetch: f }).complete("s", [], { maxTokens: 1 }); return "none"; }
    catch (e) { return e instanceof LLMError ? e.kind : "other"; }
  };
  assert.equal(await kind(reply("x", false, 429)), "http");
  assert.equal(await kind(async () => { throw new TypeError("Failed to fetch"); }), "network");
  assert.equal(await kind(reply("   ")), "empty");
  assert.equal(await kind(reply(42)), "empty");
});

test("complete: times out and aborts the request", async () => {
  let aborted = false;
  const hang: FetchLike = (_u, init) => new Promise(() => { init.signal?.addEventListener("abort", () => { aborted = true; }); });
  const p = new GroqProvider({ apiKey: "k", model: "m", fetch: hang, timeoutMs: 20 });
  await assert.rejects(p.complete("s", [], { maxTokens: 1 }), (e: unknown) => e instanceof LLMError && e.kind === "timeout");
  assert.equal(aborted, true);
});

test("complete: a slow body read also times out", async () => {
  const slowBody: FetchLike = async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) });
  const p = new GroqProvider({ apiKey: "k", model: "m", fetch: slowBody, timeoutMs: 20 });
  await assert.rejects(p.complete("s", [], { maxTokens: 1 }), /no reply in 20 ms/);
});

test("ScriptedProvider is offline: no fetch, answers from the banks", async () => {
  const orig = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; throw new Error("no"); }) as typeof fetch;
  try {
    const p = new ScriptedProvider(new ScriptedCompanion({ displayName: "Test", gdsStage: 3, language: "en" }));
    assert.equal(p.remote, false);
    const out = await p.complete("ignored", [{ role: "user", content: "we flew kites" }], { maxTokens: 50 });
    assert.ok(out.length > 5);
  } finally { globalThis.fetch = orig; }
  assert.equal(called, false);
});

// ---------- explicit opt-in for remote models ----------
import { remoteModelAllowed, REMOTE_MODEL_DISCLOSURE } from "./llm.ts";

test("remote model opt-in accepts only an explicit scope_llm_cloud true/1", () => {
  assert.equal(remoteModelAllowed({ scope_llm_cloud: true }), true);
  assert.equal(remoteModelAllowed({ scope_llm_cloud: 1 }), true);
  for (const c of [null, undefined, {}, { scope_llm_cloud: 0 }, { scope_llm_cloud: false }]) assert.equal(remoteModelAllowed(c as never), false);
});

test("Ollama on this computer is not remote; on another machine it is", () => {
  assert.equal(new OllamaProvider({ model: "m" }).remote, false);
  assert.equal(new OllamaProvider({ model: "m", baseUrl: "http://127.0.0.1:11434" }).remote, false);
  assert.equal(new OllamaProvider({ model: "m", baseUrl: "http://192.168.1.5:11434" }).remote, true);
  assert.equal(new GroqProvider({ apiKey: "k", model: "m" }).remote, true);
  assert.equal(new ProxyProvider({ url: "/api/llm", model: "m" }).remote, true);
});

test("disclosure text names what is sent and what is not, in Hindi and English", () => {
  assert.match(REMOTE_MODEL_DISCLOSURE.en, /first name/);
  assert.match(REMOTE_MODEL_DISCLOSURE.en, /Not sent: .*stage number.*family notes/);
  assert.match(REMOTE_MODEL_DISCLOSURE.hi, /पहला नाम/);
});
