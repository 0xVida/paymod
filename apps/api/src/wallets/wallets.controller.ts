import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { newId, PaymodError, ERROR_CODES } from "@paymod/shared";
import type { AgentWallet } from "@paymod/database";
import type { CircleWalletRail } from "@paymod/circle";
import { WalletCredentialGuard } from "../common/wallet-credential.guard.js";
import { BootstrapOrAccountGuard } from "../common/bootstrap-or-account.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../common/prisma.service.js";
import { generateCredential } from "../common/credentials.js";
import { caip2ForCircleBlockchain, getCircleUsdcTokenId } from "../settlement/circle-config.js";
import { CIRCLE_WALLET_RAIL } from "../settlement/circle-rail.provider.js";
import { AuditService } from "../audit/audit.service.js";
import { actorFromRequest } from "../common/audit-actor.js";

const WALLET_SCOPED_AUTHORITY_TYPES = ["DAILY_LIMIT", "MONTHLY_LIMIT", "PER_TRANSACTION_LIMIT"] as const;

const createWalletSchema = z.object({
  accountId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});

const walletActionSchema = z.object({ accountId: z.string().min(1) });
const updateWalletSchema = z.object({
  accountId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
});

// a bodyless request with no Content-Type doesn't reach this pipe as
// `undefined` - Express's json() parser leaves `req.body` as `""` when the
// Content-Type doesn't match, and zod's object check rejects "" before
// `.optional()` ever runs. coercing anything non-object to `{}` up front
// covers every shape the body arrives in.
const createCredentialSchema = z.preprocess(
  (value) => (value && typeof value === "object" ? value : {}),
  z.object({ accountId: z.string().min(1).optional() }),
);

/**
 * `AgentWallet` is a policy and approval boundary in front of a wallet
 * Circle's Developer-Controlled Wallets API actually holds and signs for.
 * `POST /v1/wallets` creates the row as `CREATING` and provisions the real
 * Circle wallet in the same request, moving it to `ACTIVE` once confirmed.
 * Circle's idempotency key derives deterministically from the wallet id,
 * so if the process dies after Circle creates the wallet but before
 * `externalWalletId` persists, the row stays `CREATING` and the next
 * access safely retries into the same Circle wallet - see
 * `ensureProvisioned`.
 */
@Controller("v1")
export class WalletsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CIRCLE_WALLET_RAIL) private readonly circleWalletRail: CircleWalletRail,
  ) {}

  @Get("wallets")
  @UseGuards(BootstrapOrAccountGuard)
  async list(@Query("accountId") accountId: string) {
    return this.prisma.agentWallet.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
    });
  }

  @Get("wallets/:id")
  @UseGuards(BootstrapOrAccountGuard)
  async get(@Param("id") walletId: string, @Query("accountId") accountId: string) {
    const wallet = await this.requireOwnedWallet(walletId, accountId);
    return this.ensureProvisioned(wallet);
  }

  @Post("wallets")
  @UseGuards(BootstrapOrAccountGuard)
  async create(
    @Req() req: Request,
    @Body(new ZodValidationPipe(createWalletSchema)) body: z.infer<typeof createWalletSchema>,
  ) {
    const wallet = await this.prisma.agentWallet.create({
      data: {
        id: newId("wallet"),
        accountId: body.accountId,
        name: body.name,
        status: "CREATING",
        rail: "CIRCLE",
        ...(body.description !== undefined && { description: body.description }),
      },
    });
    await this.audit.record({
      accountId: body.accountId,
      ...actorFromRequest(req),
      action: "WALLET_CREATED",
      targetType: "wallet",
      targetId: wallet.id,
      payload: { name: wallet.name },
    });
    return this.ensureProvisioned(wallet, actorFromRequest(req));
  }

  @Patch("wallets/:id")
  @UseGuards(BootstrapOrAccountGuard)
  async update(
    @Req() req: Request,
    @Param("id") walletId: string,
    @Body(new ZodValidationPipe(updateWalletSchema)) body: z.infer<typeof updateWalletSchema>,
  ) {
    const wallet = await this.requireOwnedWallet(walletId, body.accountId);
    const updated = await this.prisma.agentWallet.update({
      where: { id: wallet.id },
      data: {
        name: body.name,
        ...(body.description !== undefined && { description: body.description || null }),
      },
    });
    await this.audit.record({
      accountId: body.accountId,
      ...actorFromRequest(req),
      action: "WALLET_UPDATED",
      targetType: "wallet",
      targetId: wallet.id,
      payload: { name: updated.name },
    });
    return updated;
  }

  @Post("wallets/:id/archive")
  @UseGuards(BootstrapOrAccountGuard)
  async archive(
    @Req() req: Request,
    @Param("id") walletId: string,
    @Body(new ZodValidationPipe(walletActionSchema)) body: z.infer<typeof walletActionSchema>,
  ) {
    const wallet = await this.requireOwnedWallet(walletId, body.accountId);
    if (!wallet.contractId && !wallet.externalWalletId) {
      throw new BadRequestException("Only a provisioned wallet can be closed");
    }

    await this.prisma.$transaction([
      this.prisma.agentWallet.update({ where: { id: wallet.id }, data: { status: "ARCHIVED" } }),
      this.prisma.walletCredential.updateMany({
        where: { walletId: wallet.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.oAuthToken.updateMany({
        where: { walletId: wallet.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      accountId: body.accountId,
      ...actorFromRequest(req),
      action: "WALLET_ARCHIVED",
      targetType: "wallet",
      targetId: wallet.id,
      payload: { name: wallet.name },
    });
    return { ok: true };
  }

  @Delete("wallets/:id")
  @UseGuards(BootstrapOrAccountGuard)
  async discard(
    @Req() req: Request,
    @Param("id") walletId: string,
    @Query("accountId") accountId: string,
  ) {
    const wallet = await this.requireOwnedWallet(walletId, accountId);
    if (wallet.contractId || wallet.externalWalletId || wallet.status === "ACTIVE") {
      throw new BadRequestException("A provisioned wallet cannot be deleted. Close it instead.");
    }

    await this.prisma.agentWallet.delete({ where: { id: wallet.id } });
    await this.audit.record({
      accountId,
      ...actorFromRequest(req),
      action: "WALLET_DISCARDED",
      targetType: "wallet",
      targetId: wallet.id,
      payload: { name: wallet.name, status: wallet.status },
    });
    return { ok: true };
  }

  /**
   * no-op if the wallet isn't `CREATING` - never re-provisions an
   * already-active or archived wallet. if it is `CREATING`, this doubles as
   * the crash-recovery path - `createWallet` is idempotent per wallet id, so
   * retrying after an interrupted first attempt recovers the same Circle
   * wallet instead of creating a duplicate.
   */
  private async ensureProvisioned(wallet: AgentWallet, actor?: ReturnType<typeof actorFromRequest>) {
    if (wallet.status !== "CREATING") return wallet;

    const circleWallet = await this.circleWalletRail.createWallet(wallet.id);
    const activated = await this.prisma.agentWallet.update({
      where: { id: wallet.id },
      data: {
        status: "ACTIVE",
        networkId: caip2ForCircleBlockchain(circleWallet.blockchain),
        externalWalletId: circleWallet.id,
        // Circle's Developer-Controlled Wallets have no separate customer
        // owner key the way a Soroban contract does - the wallet's own
        // on-chain address is the only address there is, so it goes here
        // rather than leaving this column unused.
        ownerAddress: circleWallet.address,
        assets: {
          create: { id: newId("walletAsset"), assetCode: "USDC", decimals: 6, contractAddress: getCircleUsdcTokenId() },
        },
      },
      include: { assets: true },
    });
    await this.audit.record({
      accountId: wallet.accountId,
      ...(actor ?? { actorType: "SYSTEM" as const }),
      action: "WALLET_ACTIVATED",
      targetType: "wallet",
      targetId: wallet.id,
      payload: { externalWalletId: circleWallet.id, blockchain: circleWallet.blockchain },
    });
    return activated;
  }

  /** the credential holder's own wallet balance - no wallet id needed, derived from the credential */
  @Get("wallet/balance")
  @UseGuards(WalletCredentialGuard)
  async myBalance(@Req() req: Request) {
    return this.readBalance(req.paymod!.wallet);
  }

  @Get("wallets/:id/balance")
  @UseGuards(BootstrapOrAccountGuard)
  async balance(@Param("id") walletId: string, @Query("accountId") accountId: string) {
    const wallet = await this.requireOwnedWallet(walletId, accountId);
    return this.readBalance(wallet);
  }

  /**
   * Circle wallets have no equivalent to Soroban's immutable on-chain spend
   * caps, so enforcement rests entirely on Paymod's off-chain engine here.
   * kept as a route rather than removed so a future rail with real
   * on-chain limits can populate it again.
   */
  @Get("wallets/:id/limits")
  @UseGuards(BootstrapOrAccountGuard)
  async limits(@Param("id") walletId: string, @Query("accountId") accountId: string) {
    await this.requireOwnedWallet(walletId, accountId);
    throw new NotFoundException("This wallet's rail has no on-chain spend limits - policy is enforced off-chain");
  }

  private async readBalance(wallet: { id: string; externalWalletId: string | null }) {
    if (!wallet.externalWalletId) {
      throw new PaymodError(ERROR_CODES.WALLET_UNVERIFIED, "This wallet has not finished provisioning yet");
    }
    const state = await this.circleWalletRail.readWalletState(wallet.externalWalletId);
    return { assetCode: state.assetCode, available: state.balanceAtomic };
  }

  /**
   * `accountId` is optional in the body - required in practice for a session
   * caller (`BootstrapOrAccountGuard` 403s without it) but not for a
   * bootstrap-token caller, which is already fully authenticated with no
   * account to scope to. when present, the handler still verifies `:id`
   * actually belongs to that account.
   */
  @Post("wallets/:id/credentials")
  @UseGuards(BootstrapOrAccountGuard)
  async createCredential(
    @Req() req: Request,
    @Param("id") walletId: string,
    @Body(new ZodValidationPipe(createCredentialSchema))
    body: z.infer<typeof createCredentialSchema>,
  ) {
    const wallet = await this.prisma.agentWallet.findUnique({ where: { id: walletId } });
    if (!wallet) {
      throw new NotFoundException(`Wallet ${walletId} not found`);
    }
    if (body.accountId !== undefined && wallet.accountId !== body.accountId) {
      throw new NotFoundException(`Wallet ${walletId} not found on this account`);
    }

    const { secret, prefix, hash } = generateCredential();
    const credential = await this.prisma.walletCredential.create({
      data: { id: newId("credential"), walletId, prefix, hash },
    });
    await this.audit.record({
      accountId: wallet.accountId,
      ...actorFromRequest(req),
      action: "CREDENTIAL_CREATED",
      targetType: "wallet",
      targetId: walletId,
      // the raw secret is returned exactly once and never stored or logged again. only its prefix identifies it here.
      payload: { credentialId: credential.id, prefix },
    });
    // the raw secret is returned exactly once and never stored or logged again
    return { id: credential.id, prefix, secret };
  }

  @Get("wallets/:id/credentials")
  @UseGuards(BootstrapOrAccountGuard)
  async listCredentials(@Param("id") walletId: string, @Query("accountId") accountId: string) {
    await this.requireOwnedWallet(walletId, accountId);
    return this.prisma.walletCredential.findMany({
      where: { walletId },
      select: { id: true, prefix: true, createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  @Delete("wallets/:walletId/credentials/:credentialId")
  @UseGuards(BootstrapOrAccountGuard)
  async revokeCredential(
    @Req() req: Request,
    @Param("walletId") walletId: string,
    @Param("credentialId") credentialId: string,
    @Query("accountId") accountId: string,
  ) {
    await this.requireOwnedWallet(walletId, accountId);
    const credential = await this.prisma.walletCredential.findFirst({ where: { id: credentialId, walletId } });
    if (!credential) throw new NotFoundException("Credential not found");
    if (!credential.revokedAt) await this.prisma.walletCredential.update({ where: { id: credential.id }, data: { revokedAt: new Date() } });
    await this.audit.record({ accountId, ...actorFromRequest(req), action: "CREDENTIAL_REVOKED", targetType: "wallet", targetId: walletId, payload: { credentialId, prefix: credential.prefix } });
    return { ok: true };
  }

  @Get("wallets/:id/setup-status")
  @UseGuards(BootstrapOrAccountGuard)
  async setupStatus(@Param("id") walletId: string, @Query("accountId") accountId: string) {
    const wallet = await this.requireOwnedWallet(walletId, accountId);

    const [authorityPolicy, credential, completedIntent] = await Promise.all([
      this.prisma.policy.findFirst({
        where: { walletId, enabled: true, type: { in: [...WALLET_SCOPED_AUTHORITY_TYPES] } },
      }),
      this.prisma.walletCredential.findFirst({ where: { walletId, revokedAt: null } }),
      this.prisma.financialIntent.findFirst({ where: { walletId, status: "COMPLETED" } }),
    ]);

    let funded = false;
    if (wallet.status === "ACTIVE" && wallet.externalWalletId) {
      funded = await this.readBalance(wallet)
        .then((balance) => BigInt(balance.available) > 0n)
        .catch(() => false);
    }

    return {
      deployed: wallet.status === "ACTIVE",
      funded,
      hasAuthority: !!authorityPolicy,
      hasCredential: !!credential,
      hasCompletedPayment: !!completedIntent,
    };
  }

  private async requireOwnedWallet(walletId: string, accountId: string) {
    const wallet = await this.prisma.agentWallet.findUnique({ where: { id: walletId } });
    if (!wallet || wallet.accountId !== accountId) {
      throw new NotFoundException(`Wallet ${walletId} not found on this account`);
    }
    return wallet;
  }
}
