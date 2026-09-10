import type { ModelPricingRow } from "./model-pricing.service.js";

const TOKENS_PER_PRICE_UNIT = 1_000_000n;

/**
 * rounds up rather than truncating: truncation would let Paymod
 * systematically undercharge by a fraction of an atomic unit per call,
 * immaterial once but real money at volume. Keeps the same conservative
 * direction as the reservation estimate.
 */
function costForTokensCeil(tokens: number, pricePerMillionAtomic: bigint): bigint {
  const numerator = BigInt(tokens) * pricePerMillionAtomic;
  return (numerator + TOKENS_PER_PRICE_UNIT - 1n) / TOKENS_PER_PRICE_UNIT;
}

function applyMarkupCeil(baseAtomic: bigint, markupBasisPoints: number): bigint {
  const numerator = baseAtomic * BigInt(markupBasisPoints);
  return (numerator + 9999n) / 10000n;
}

/**
 * not a tokenizer, only needs to bound the reservation from above; the
 * real charge is always computed later from the provider's reported usage.
 * Dividing by 3 rather than the ~4 chars/token typical of English text
 * keeps the bias toward over-reserving, never over-paying.
 */
function estimateInputTokens(body: unknown): number {
  const json = JSON.stringify(body ?? "");
  return Math.ceil(json.length / 3);
}

/** A conservative maximum charge for the reservation - real input tokens are unknown until the provider responds, so this pads a character-based estimate; real output tokens are unknown until the stream ends, so this assumes the full server-enforced ceiling is used. */
export function estimateMaxChargeAtomic(pricing: ModelPricingRow, effectiveMaxOutput: number, requestBody: unknown): string {
  const inputTokens = estimateInputTokens(requestBody);
  const inputCost = costForTokensCeil(inputTokens, BigInt(pricing.inputTokenPriceAtomic));
  const outputCost = costForTokensCeil(effectiveMaxOutput, BigInt(pricing.outputTokenPriceAtomic));
  const base = inputCost + outputCost;
  return (base + applyMarkupCeil(base, pricing.markupBasisPoints)).toString();
}

export type ActualUsage = { inputTokens: number; cachedInputTokens?: number; outputTokens: number };
export type ActualCharge = { providerCostAtomic: string; markupAtomic: string; chargedAtomic: string };

/** the exact charge for a completed call, computed from the provider's own reported token counts against the pricing version snapshotted at reservation time - never today's pricing, whatever it now is. */
export function computeActualChargeAtomic(pricing: ModelPricingRow, usage: ActualUsage): ActualCharge {
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  const billableInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens);
  const cachedPricePerMillion = pricing.cachedInputTokenPriceAtomic !== null ? BigInt(pricing.cachedInputTokenPriceAtomic) : BigInt(pricing.inputTokenPriceAtomic);

  const inputCost = costForTokensCeil(billableInputTokens, BigInt(pricing.inputTokenPriceAtomic));
  const cachedCost = costForTokensCeil(cachedInputTokens, cachedPricePerMillion);
  const outputCost = costForTokensCeil(usage.outputTokens, BigInt(pricing.outputTokenPriceAtomic));

  const providerCost = inputCost + cachedCost + outputCost;
  const markup = applyMarkupCeil(providerCost, pricing.markupBasisPoints);
  return { providerCostAtomic: providerCost.toString(), markupAtomic: markup.toString(), chargedAtomic: (providerCost + markup).toString() };
}
