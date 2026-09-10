import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { atomicAmountSchema } from "@paymod/shared";
import { WalletCredentialGuard } from "../common/wallet-credential.guard.js";
import { BootstrapOrAccountGuard } from "../common/bootstrap-or-account.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../common/prisma.service.js";
import { IntentsService } from "./intents.service.js";

const transferSchema = z.object({
  amount: atomicAmountSchema,
  destination: z.string().min(1),
  purpose: z.string().optional(),
});

const testTransferSchema = z.object({
  accountId: z.string().min(1),
  amount: atomicAmountSchema,
  destination: z.string().min(1),
});

@Controller("v1")
export class IntentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intents: IntentsService,
  ) {}

  @Post("transfers")
  @UseGuards(WalletCredentialGuard)
  @UsePipes(new ZodValidationPipe(transferSchema))
  async createTransfer(
    @Req() req: Request,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: z.infer<typeof transferSchema>,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key header is required for financial operations");
    }
    const { account, wallet } = req.paymod!;
    return this.intents.createTransfer(account, wallet, idempotencyKey, body);
  }

  @Get("intents/:id")
  @UseGuards(WalletCredentialGuard)
  async getIntent(@Req() req: Request, @Param("id") id: string) {
    return this.intents.getIntent(req.paymod!.account.id, id);
  }

  @Get("budget")
  @UseGuards(WalletCredentialGuard)
  async getBudget(@Req() req: Request) {
    const { account, wallet } = req.paymod!;
    return { windows: await this.intents.getBudget(account, wallet) };
  }

  /**
   * sends a real transfer through `IntentsService.createTransfer`, the same
   * path an agent's `pm_live_...` credential drives, so a dashboard user can
   * verify a wallet actually works without writing code or wiring up an
   * agent. Auth is session-based (`BootstrapOrAccountGuard`), not a wallet
   * credential: the dashboard has no credential to present since raw secrets
   * are shown once and never stored in reversible form.
   */
  @Post("wallets/:id/test-transfer")
  @UseGuards(BootstrapOrAccountGuard)
  async testTransfer(
    @Param("id") walletId: string,
    @Body(new ZodValidationPipe(testTransferSchema)) body: z.infer<typeof testTransferSchema>,
  ) {
    const wallet = await this.requireOwnedWallet(walletId, body.accountId);
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: body.accountId } });
    return this.intents.createTransfer(account, wallet, randomUUID(), {
      amount: body.amount,
      destination: body.destination,
      purpose: "Test payment (dashboard)",
    });
  }

  @Get("wallets/:id/test-transfer/:intentId")
  @UseGuards(BootstrapOrAccountGuard)
  async getTestTransfer(
    @Param("id") walletId: string,
    @Param("intentId") intentId: string,
    @Query("accountId") accountId: string,
  ) {
    await this.requireOwnedWallet(walletId, accountId);
    const intent = await this.intents.getIntent(accountId, intentId);
    if (intent.walletId !== walletId) throw new NotFoundException(`Intent ${intentId} not found`);
    return intent;
  }

  private async requireOwnedWallet(walletId: string, accountId: string) {
    const wallet = await this.prisma.agentWallet.findUnique({ where: { id: walletId } });
    if (!wallet || wallet.accountId !== accountId) {
      throw new NotFoundException(`Wallet ${walletId} not found on this account`);
    }
    return wallet;
  }
}
