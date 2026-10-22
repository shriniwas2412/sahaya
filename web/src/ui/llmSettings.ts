// Optional model for the companion. Default is none: the offline scripted companion.
// A key is entered by the user and stays on this device (IndexedDB meta), never in code.

import { GroqProvider, OpenRouterProvider, OllamaProvider, remoteModelAllowed, type LLMProvider, type ModelConsent } from "../core/companion/index.ts";

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

export type ModelStatus = "off" | "incomplete" | "needs_consent" | "on";

/** What the Account card says about the model: it mirrors the pipeline's own rule. */
export function modelStatus(s: LlmSettings | null | undefined, consent: ModelConsent | null | undefined): ModelStatus {
  if (!s || s.provider === "none") return "off";
  const p = llmFromSettings(s);
  if (!p) return "incomplete";
  return p.remote && !remoteModelAllowed(consent) ? "needs_consent" : "on";
}
