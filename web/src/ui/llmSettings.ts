// Optional model for the companion. Default is none: the offline scripted companion.
// A key is entered by the user and stays on this device (IndexedDB meta), never in code.

import { GroqProvider, OpenRouterProvider, OllamaProvider, type LLMProvider } from "../core/companion/index.ts";

export interface LlmSettings {
  provider: "none" | "groq" | "openrouter" | "ollama";
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export function llmFromSettings(s: LlmSettings | null | undefined): LLMProvider | undefined {
  if (!s || s.provider === "none" || !s.model.trim()) return undefined;
  if (s.provider === "ollama") return new OllamaProvider({ model: s.model, baseUrl: s.baseUrl || undefined });
  if (!s.apiKey) return undefined;
  return s.provider === "groq" ? new GroqProvider({ apiKey: s.apiKey, model: s.model }) : new OpenRouterProvider({ apiKey: s.apiKey, model: s.model });
}
