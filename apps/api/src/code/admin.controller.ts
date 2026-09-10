import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards, UsePipes } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { AdminGuard, requireRecentAuth } from "../common/admin.guard.js";
import { PrismaService } from "../common/prisma.service.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ProviderKeysService } from "./provider-keys.service.js";
import { ModelPricingService } from "./model-pricing.service.js";

const providerSchema = z.enum(["OPENAI", "ANTHROPIC"]);

const createProviderKeySchema = z.object({ provider: providerSchema, label: z.string().min(1), key: z.string().min(1) });

const createPricingSchema = z.object({
  provider: providerSchema,
  model: z.string().min(1),
  inputTokenPriceAtomic: z.string().regex(/^\d+$/),
  cachedInputTokenPriceAtomic: z.string().regex(/^\d+$/).optional(),
  outputTokenPriceAtomic: z.string().regex(/^\d+$/),
  markupBasisPoints: z.number().int().min(0),
});

/**
 * `AdminGuard`-only surface (PAYMOD_CODE_PLAN.md's debit-side design): no
 * new Role/Staff system, one env-var allowlist. Provider key writes
 * additionally require `requireRecentAuth` - a stolen old browser session
 * must not be able to silently add or revoke a production provider key.
 * Pricing writes don't: a wrong price is a business mistake, correctable
 * by creating a new version, not a credential a stolen session could steal
 * or misuse for its own benefit.
 */
@Controller("v1/admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerKeys: ProviderKeysService,
    private readonly pricing: ModelPricingService,
  ) {}

  @Get("provider-keys")
  listProviderKeys() {
    return this.providerKeys.list();
  }

  @Post("provider-keys")
  @UsePipes(new ZodValidationPipe(createProviderKeySchema))
  async createProviderKey(@Req() req: Request, @Body() body: z.infer<typeof createProviderKeySchema>) {
    await requireRecentAuth(this.prisma, req);
    return this.providerKeys.create(body.provider, body.label, body.key);
  }

  @Delete("provider-keys/:id")
  async revokeProviderKey(@Req() req: Request, @Param("id") id: string) {
    await requireRecentAuth(this.prisma, req);
    await this.providerKeys.revoke(id);
    return { status: "revoked" };
  }

  @Get("model-pricing")
  listPricing() {
    return this.pricing.list();
  }

  @Post("model-pricing")
  @UsePipes(new ZodValidationPipe(createPricingSchema))
  createPricingVersion(@Body() body: z.infer<typeof createPricingSchema>) {
    return this.pricing.createVersion(body);
  }

  @Delete("model-pricing/:id")
  async deactivatePricing(@Param("id") id: string) {
    await this.pricing.deactivate(id);
    return { status: "deactivated" };
  }
}
