import { BadRequestException, Body, Controller, Get, NotFoundException, Put, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { newId, parseAtomicAmount } from "@paymod/shared";
import { POLICY_TYPES } from "@paymod/policy-engine";
import { readTreasuryState } from "@paymod/stellar";
import { Server } from "@stellar/stellar-sdk/rpc";
import { BootstrapOrAccountGuard } from "../common/bootstrap-or-account.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../common/prisma.service.js";
import { getStellarRpcUrl } from "../settlement/stellar-config.js";
import { AuditService } from "../audit/audit.service.js";
import { actorFromRequest } from "../common/audit-actor.js";

const upsertPolicySchema = z.object({
  id: z.string().min(1).optional(),
  accountId: z.string().min(1),
  /** `null` = account-wide: a restriction/ceiling only, per ADR 0010's migration plan. See @paymod/policy-engine's `checkSpendingAuthority`. */
  walletId: z.string().min(1).nullable().default(null),
  type: z.enum(POLICY_TYPES),
  config: z.unknown(),
  priority: z.number().int().default(0),
  enabled: z.boolean().default(true),
});

/**
 * Enforces ADR 0007's on-chain headroom invariant: PER_TRANSACTION_LIMIT can
 * never exceed max_per_payment and DAILY_LIMIT x 3 can never exceed
 * max_per_period. Stops an operator from configuring a policy the chain
 * would silently reject at settlement, possibly after a human already
 * approved it.
 *
 * The contract's `set_limits` (owner-only) means these caps aren't strictly
 * immutable, but Paymod's API can't call it on the customer's behalf (ADR
 * 0001) and no product surface exposes it yet. Until one does, this check
 * validates against current on-chain state as the only reachable fix.
 *
 * Only checked for wallet-scoped policies: an account-wide rule has no
 * single wallet contract to validate against.
 *
 * Dormant for Circle-rail wallets (`!wallet?.contractId` is always true for
 * them) - intentional, not a gap. Circle has no equivalent on-chain cap
 * concept, so enforcement is entirely off-chain for that rail. Stays in
 * place for Stellar's future re-expansion.
 */
async function assertWithinOnChainHeadroom(
  prisma: PrismaService,
  walletId: string | null,
  type: string,
  config: unknown,
): Promise<void> {
  if (walletId === null) return;
  if (type !== "PER_TRANSACTION_LIMIT" && type !== "DAILY_LIMIT") return;

  const wallet = await prisma.agentWallet.findUnique({ where: { id: walletId } });
  if (!wallet?.contractId) return; // No deployed contract yet; nothing to validate against.

  const limitAtomic = (config as { limitAtomic?: string }).limitAtomic;
  if (!limitAtomic) throw new BadRequestException("config.limitAtomic is required");

  const server = new Server(getStellarRpcUrl());
  const state = await readTreasuryState(server, wallet.contractId);
  const limit = parseAtomicAmount(limitAtomic);

  if (type === "PER_TRANSACTION_LIMIT") {
    const maxPerPayment = parseAtomicAmount(state.maxPerPaymentAtomic);
    if (limit > maxPerPayment) {
      throw new BadRequestException(
        `PER_TRANSACTION_LIMIT (${limitAtomic}) exceeds this wallet's current on-chain max_per_payment (${state.maxPerPaymentAtomic}). Update the wallet's on-chain limits first.`,
      );
    }
  } else {
    const headroom = limit * 3n;
    const maxPerPeriod = parseAtomicAmount(state.maxPerPeriodAtomic);
    if (headroom > maxPerPeriod) {
      throw new BadRequestException(
        `DAILY_LIMIT x 3 (${headroom}) exceeds this wallet's current on-chain max_per_period (${state.maxPerPeriodAtomic}). Update the wallet's on-chain limits first.`,
      );
    }
  }
}

@Controller("v1")
export class PoliciesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get("policies")
  @UseGuards(BootstrapOrAccountGuard)
  async list(@Query("accountId") accountId: string) {
    const policies = await this.prisma.policy.findMany({ where: { accountId }, orderBy: { createdAt: "desc" } });
    return { policies };
  }

  @Put("policies")
  @UseGuards(BootstrapOrAccountGuard)
  @UsePipes(new ZodValidationPipe(upsertPolicySchema))
  async upsert(@Req() req: Request, @Body() body: z.infer<typeof upsertPolicySchema>) {
    await assertWithinOnChainHeadroom(this.prisma, body.walletId, body.type, body.config);
    const policy = body.id ? await this.updatePolicy(body.id, body) : await this.createPolicy(body);
    await this.audit.record({
      accountId: body.accountId,
      ...actorFromRequest(req),
      action: body.id ? "POLICY_UPDATED" : "POLICY_CREATED",
      targetType: "policy",
      targetId: policy.id,
      payload: { type: body.type, walletId: body.walletId, config: body.config, enabled: body.enabled },
    });
    return policy;
  }

  private async updatePolicy(id: string, body: z.infer<typeof upsertPolicySchema>) {
    const existing = await this.prisma.policy.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Policy ${id} not found`);
    return this.prisma.policy.update({
      where: { id },
      data: {
        walletId: body.walletId,
        type: body.type,
        config: body.config as object,
        priority: body.priority,
        enabled: body.enabled,
      },
    });
  }

  private async createPolicy(body: z.infer<typeof upsertPolicySchema>) {
    return this.prisma.policy.create({
      data: {
        id: newId("policy"),
        accountId: body.accountId,
        walletId: body.walletId,
        type: body.type,
        config: body.config as object,
        priority: body.priority,
        enabled: body.enabled,
      },
    });
  }
}
