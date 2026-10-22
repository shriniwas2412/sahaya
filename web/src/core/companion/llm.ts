// LLM providers. The default is ScriptedProvider: free and offline.
// Groq / OpenRouter run only with the user's own key; Ollama runs on a desktop
// or LAN; a server proxy can hold an NGO's key. All remote providers speak the
// OpenAI-compatible chat API, time out after 8 s, and throw LLMError so the
// pipeline can fall back to the scripted companion.
//
// The model is always configuration: no model name is hard-coded here or in prompts.

import type { ScriptedCompanion } from "./scripted.ts";
import type { TopicId } from "./types.ts";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompleteOptions {
  maxTokens: number;
  /** Local "HH:MM", passed through to the scripted provider. */
  clock?: string | null;
}

export interface LLMProvider {
  readonly id: string;
  /** True when text leaves the device. */
  readonly remote: boolean;
  complete(system: string, messages: readonly ChatMessage[], opts: CompleteOptions): Promise<string>;
}

export class LLMError extends Error {
  readonly kind: "timeout" | "http" | "network" | "empty" | "config";
  constructor(kind: LLMError["kind"], message: string) {
    super(message);
    this.name = "LLMError";
    this.kind = kind;
  }
}

export const LLM_TIMEOUT_MS = 8000;

// ---------- consent for remote models ----------

/**
 * A remote model (Groq, OpenRouter, the server proxy, Ollama on another machine)
 * runs only with an explicit opt-in on the elder's consent record. Without it
 * the pipeline uses the scripted companion. The flag is separate from
 * scope_audio_cloud because this sends text about health to a third party.
 */
export interface ModelConsent {
  scope_llm_cloud?: boolean | 0 | 1 | null;
}

export function remoteModelAllowed(consent: ModelConsent | null | undefined): boolean {
  return consent?.scope_llm_cloud === true || consent?.scope_llm_cloud === 1;
}

/** Exchanges (user + reply) sent to a remote model. */
export const REMOTE_HISTORY_EXCHANGES = 4;

/** What leaves the phone when a remote model is on. Keep in sync with buildSystemPrompt({ minimal: true }). */
export const REMOTE_MODEL_DISCLOSURE = {
  en: "With an online model on, each reply sends: the elder's first name, language, a plain style guide for their stage, their likes and topics to avoid, the time of day, and the last 4 exchanges. Not sent: full name, age, stage number, family notes, contacts, medicines. Words of distress are never sent; the phone handles them.",
  hi: "ऑनलाइन मॉडल चालू होने पर हर जवाब के लिए यह भेजा जाता है: बुज़ुर्ग का पहला नाम, भाषा, उनकी अवस्था के हिसाब से बात करने का सरल तरीका, उनकी पसंद और जिन बातों से बचना है, दिन का समय, और पिछली 4 बातचीत। नहीं भेजा जाता: पूरा नाम, उम्र, अवस्था का नंबर, परिवार के नोट्स, संपर्क, दवाइयाँ। परेशानी वाले शब्द कभी नहीं भेजे जाते; उन्हें फ़ोन ही संभालता है।",
} as const;

export type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

export interface OpenAICompatibleConfig {
  id: string;
  url: string;
  model: string;
  apiKey?: string | null;
  requiresKey: boolean;
  timeoutMs?: number;
  fetch?: FetchLike;
  temperature?: number;
  /** Turns of history sent (user + assistant pairs). */
  maxTurns?: number;
  /** Defaults to true. False only for a model on this same computer. */
  remote?: boolean;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly remote: boolean;
  private readonly cfg: OpenAICompatibleConfig;

  constructor(cfg: OpenAICompatibleConfig) {
    if (!cfg.model?.trim()) throw new LLMError("config", `${cfg.id}: model is required`);
    if (cfg.requiresKey && !cfg.apiKey?.trim()) throw new LLMError("config", `${cfg.id}: missing API key`);
    this.id = cfg.id;
    this.remote = cfg.remote ?? true;
    this.cfg = cfg;
  }

  /** The request without sending it (also used by tests). */
  buildRequest(system: string, messages: readonly ChatMessage[], opts: CompleteOptions): { url: string; init: RequestInit } {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.apiKey) headers.Authorization = `Bearer ${this.cfg.apiKey}`;
    const turns = (this.cfg.maxTurns ?? 8) * 2;
    return {
      url: this.cfg.url,
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.cfg.model,
          temperature: this.cfg.temperature ?? 0.6,
          max_tokens: opts.maxTokens,
          messages: [{ role: "system", content: system }, ...messages.slice(-turns)],
        }),
      },
    };
  }

  async complete(system: string, messages: readonly ChatMessage[], opts: CompleteOptions): Promise<string> {
    const { url, init } = this.buildRequest(system, messages, opts);
    const doFetch: FetchLike = this.cfg.fetch ?? ((u, i) => fetch(u, i));
    const ctrl = new AbortController();
    const timeoutMs = this.cfg.timeoutMs ?? LLM_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new LLMError("timeout", `${this.id}: no reply in ${timeoutMs} ms`));
      }, timeoutMs);
    });
    try {
      const res = await Promise.race([
        doFetch(url, { ...init, signal: ctrl.signal }).catch((e: unknown) => {
          if (e instanceof LLMError) throw e;
          throw new LLMError("network", `${this.id}: ${e instanceof Error ? e.message : String(e)}`);
        }),
        timeout,
      ]);
      if (!res.ok) throw new LLMError("http", `${this.id}: HTTP ${res.status}`);
      const json = (await Promise.race([res.json(), timeout])) as { choices?: { message?: { content?: unknown } }[] };
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw new LLMError("empty", `${this.id}: empty reply`);
      return text.trim();
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface KeyedConfig {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetch?: FetchLike;
}

export class GroqProvider extends OpenAICompatibleProvider {
  constructor(c: KeyedConfig) {
    super({ ...c, id: "groq", url: "https://api.groq.com/openai/v1/chat/completions", requiresKey: true });
  }
}

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(c: KeyedConfig) {
    super({ ...c, id: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions", requiresKey: true });
  }
}

export class OllamaProvider extends OpenAICompatibleProvider {
  constructor(c: { model: string; baseUrl?: string; timeoutMs?: number; fetch?: FetchLike }) {
    const base = (c.baseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
    super({ ...c, id: "ollama", url: `${base}/v1/chat/completions`, requiresKey: false, remote: !isLoopback(base) });
  }
}

function isLoopback(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

/** Server proxy (an NGO-held key lives on the server, never on the device). */
export class ProxyProvider extends OpenAICompatibleProvider {
  constructor(c: { url: string; model: string; timeoutMs?: number; fetch?: FetchLike }) {
    super({ ...c, id: "proxy", requiresKey: false });
  }
}

/** Offline default. Ignores the system prompt; replies from the scripted banks. */
export class ScriptedProvider implements LLMProvider {
  readonly id = "scripted";
  readonly remote = false;
  /** Topic of the last reply, so the session can record it. */
  lastTopic: TopicId | null = null;
  private readonly companion: ScriptedCompanion;

  constructor(companion: ScriptedCompanion) {
    this.companion = companion;
  }

  async complete(_system: string, messages: readonly ChatMessage[], opts: CompleteOptions): Promise<string> {
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    const turn = messages.filter(m => m.role === "assistant").length;
    const r = this.companion.reply({ text: lastUser?.content ?? "", turn, clock: opts.clock });
    this.lastTopic = r.topic;
    return r.text;
  }
}
