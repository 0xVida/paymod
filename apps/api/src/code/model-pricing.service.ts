import { Injectable } from "@nestjs/common";
import type { InferenceProvider, ModelPricing } from "@paymod/database";
import { ERROR_CODES, PaymodError, newId } from "@paymod/shared";
import { PrismaService } from "../common/prisma.service.js";

export type ModelPricingRow = {
  id: string;
  provider: InferenceProvider;
  model: string;
  inputTokenPriceAtomic: string;
  cachedInputTokenPriceAtomic: string | null;
  outputTokenPriceAtomic: string;
  markupBasisPoints: number;
  version: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export type CreatePricingVersionInput = {
  provider: InferenceProvider;
  model: string;
  inputTokenPriceAtomic: string;
  cachedInputTokenPriceAtomic?: string;
  outputTokenPriceAtomic: string;
  markupBasisPoints: number;
};

function toRow(row: ModelPricing): ModelPricingRow {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    inputTokenPriceAtomic: row.inputTokenPriceAtomic.toFixed(0),
    cachedInputTokenPriceAtomic: row.cachedInputTokenPriceAtomic?.toFixed(0) ?? null,
    outputTokenPriceAtomic: row.outputTokenPriceAtomic.toFixed(0),
    markupBasisPoints: row.markupBasisPoints,
    version: row.version,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

/**
 * `apps/code-core` never determines what Paymod charges - pricing lives
 * here only, `apps/api` owns it entirely. Versioned and effective-dated:
 * `UsageReservation.pricingVersion` snapshots the active row at
 * reservation time and `commit` always prices against that exact
 * snapshot, never whatever row happens to be active once a long stream
 * finishes.
 */
@Injectable()
export class ModelPricingService {
  constructor(private readonly prisma: PrismaService) {}

  /** throws the same "not currently servable" error the inference proxy already surfaces for a missing provider key - unpriced is unavailable, never free. */
  async getActivePricing(provider: InferenceProvider, model: string): Promise<ModelPricingRow> {
    const now = new Date();
    const row = await this.prisma.modelPricing.findFirst({
      where: { provider, model, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      orderBy: { version: "desc" },
    });
    if (!row) {
      throw new PaymodError(ERROR_CODES.MODEL_NOT_AVAILABLE, `No active pricing configured for ${provider}/${model}.`, { httpStatus: 503 });
    }
    return toRow(row);
  }

  /** what `GET /v1/code/models` reads before intersecting with which providers currently have an active key. */
  async listActive(): Promise<ModelPricingRow[]> {
    const now = new Date();
    const rows = await this.prisma.modelPricing.findMany({
      where: { effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      orderBy: [{ provider: "asc" }, { model: "asc" }],
    });
    return rows.map(toRow);
  }

  async list(): Promise<ModelPricingRow[]> {
    const rows = await this.prisma.modelPricing.findMany({ orderBy: [{ provider: "asc" }, { model: "asc" }, { version: "desc" }] });
    return rows.map(toRow);
  }

  /** closes out a pricing row with no replacement version, so its model stops appearing in `GET /v1/code/models` - for retiring a model from the switch entirely, not for correcting a price (use `createVersion` for that). */
  async deactivate(id: string): Promise<void> {
    await this.prisma.modelPricing.update({ where: { id }, data: { effectiveTo: new Date() } });
  }

  /** closes out whichever row is currently open-ended for this provider+model (`effectiveTo = now`) and creates the next version in the same transaction - at most one row is ever active for a given provider+model at a time. */
  async createVersion(input: CreatePricingVersionInput): Promise<ModelPricingRow> {
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.modelPricing.findFirst({
        where: { provider: input.provider, model: input.model, effectiveTo: null },
        orderBy: { version: "desc" },
      });
      const now = new Date();
      if (previous) {
        await tx.modelPricing.update({ where: { id: previous.id }, data: { effectiveTo: now } });
      }
      const row = await tx.modelPricing.create({
        data: {
          id: newId("modelPricing"),
          provider: input.provider,
          model: input.model,
          inputTokenPriceAtomic: input.inputTokenPriceAtomic,
          cachedInputTokenPriceAtomic: input.cachedInputTokenPriceAtomic ?? null,
          outputTokenPriceAtomic: input.outputTokenPriceAtomic,
          markupBasisPoints: input.markupBasisPoints,
          version: (previous?.version ?? 0) + 1,
          effectiveFrom: now,
        },
      });
      return toRow(row);
    });
  }
}
