export type ModelDescriptor = { id: string; label: string; provider: "openai" | "anthropic"; contextWindow: number };

/**
 * deliberately static for Phase 1, no dynamic routing - a fixed list of supported model
 * ids, each pointing at a provider adapter. backend availability is a separate concern
 * resolved via `GET /v1/code/models` - the picker uses the intersection of both.
 * `contextWindow` is each provider's published figure, shown in the UI, never sent to the provider.
 */
export const MODEL_REGISTRY: ModelDescriptor[] = [
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", contextWindow: 128_000 },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "openai", contextWindow: 1_050_000 },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", provider: "openai", contextWindow: 1_050_000 },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "openai", contextWindow: 1_050_000 },
];

export function getModelDescriptor(modelId: string): ModelDescriptor | undefined {
  return MODEL_REGISTRY.find((model) => model.id === modelId);
}
