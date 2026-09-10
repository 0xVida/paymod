import { Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { SessionGuard } from "../common/session.guard.js";
import { CodeCredentialGuard } from "../common/code-credential.guard.js";
import { DepositService, usdcAtomicToUsd } from "./deposit.service.js";

/**
 * the credit side of a Paymod Code balance (PAYMOD_CODE_PLAN.md section 2).
 * `deposit-address` and `deposit-address/check` are dashboard-only
 * (`SessionGuard` - a signed-in human viewing/funding their own account),
 * never called from the extension. `wallet/balance` is the opposite: it's
 * what the extension calls (`CodeCredentialGuard`), a read-only ledger
 * lookup - not a relaxation of that guard's "coding sessions never
 * authenticate a financial endpoint" boundary.
 */
@Controller("v1/code")
export class DepositController {
  constructor(private readonly deposits: DepositService) {}

  @Get("deposit-address")
  @UseGuards(SessionGuard)
  async getDepositAddress(@Req() req: Request) {
    const accountId = req.paymodUser!.account.id;
    const { address } = await this.deposits.getOrCreateDepositAddress(accountId);
    const balanceUsdcAtomic = await this.deposits.getBalanceUsdcAtomic(accountId);
    return { address, balanceUsd: usdcAtomicToUsd(balanceUsdcAtomic) };
  }

  @Post("deposit-address/check")
  @UseGuards(SessionGuard)
  async checkDeposit(@Req() req: Request) {
    const result = await this.deposits.checkDeposit(req.paymodUser!.account.id);
    return {
      creditedUsd: usdcAtomicToUsd(result.creditedUsdcAtomic),
      newDepositCount: result.newDepositCount,
      balanceUsd: usdcAtomicToUsd(result.balanceUsdcAtomic),
    };
  }

  @Get("wallet/balance")
  @UseGuards(CodeCredentialGuard)
  async getBalance(@Req() req: Request) {
    const balanceUsdcAtomic = await this.deposits.getBalanceUsdcAtomic(req.paymod!.account.id);
    return { balanceUsd: usdcAtomicToUsd(balanceUsdcAtomic) };
  }
}
