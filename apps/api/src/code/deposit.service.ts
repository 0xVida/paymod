import { Injectable } from "@nestjs/common";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { newId } from "@paymod/shared";
import { CodeBalanceRepository } from "@paymod/database";
import { PrismaService } from "../common/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { encryptSecret, decryptSecret } from "../common/secret-encryption.js";
import { getSolanaRpcUrl, getUsdcMint } from "./solana-config.js";
import { SweepService } from "./sweep.service.js";

const USDC_ATOMIC_PER_DOLLAR = 1_000_000n;

/** the two RPC calls `checkDeposit` actually needs, narrowed from `Connection` so a fake can stand in for tests without a real devnet round trip. A real `Connection` instance satisfies this structurally, no adapter needed. */
export interface SolanaRpc {
  getSignaturesForAddress(address: PublicKey, options?: { until?: string; limit?: number }): Promise<{ signature: string }[]>;
  getParsedTransaction(signature: string, options?: { maxSupportedTransactionVersion?: number }): Promise<ParsedTransactionWithMeta | null>;
}

export function defaultSolanaRpc(): SolanaRpc {
  return new Connection(getSolanaRpcUrl(), "confirmed");
}

/** sum of qualifying USDC transfers *to* `owner`'s associated token account in one transaction, in USDC's own 6-decimal atomic unit. Ignores everything else in the transaction - outgoing transfers, unrelated token movements, a missing pre-balance (the account's first-ever USDC deposit has no `preTokenBalances` entry, treated as starting from zero). */
function usdcCreditedTo(meta: ParsedTransactionWithMeta["meta"] | undefined, owner: string, mint: string): bigint {
  const pre = meta?.preTokenBalances?.find((balance) => balance.owner === owner && balance.mint === mint);
  const post = meta?.postTokenBalances?.find((balance) => balance.owner === owner && balance.mint === mint);
  const preAmount = BigInt(pre?.uiTokenAmount.amount ?? "0");
  const postAmount = BigInt(post?.uiTokenAmount.amount ?? "0");
  const delta = postAmount - preAmount;
  return delta > 0n ? delta : 0n;
}

export type CheckDepositResult = { creditedUsdcAtomic: string; newDepositCount: number; balanceUsdcAtomic: string };

/**
 * the credit side of Paymod Code's balance (PAYMOD_CODE_PLAN.md section 2).
 * USDC on Solana only for this pass - SOL deposits aren't credited yet
 * (need a SOL/USD price at time of credit, deferred). No watcher: crediting
 * only ever runs when `checkDeposit` is called (the dashboard's "I've sent
 * it" button), never on a background timer.
 */
@Injectable()
export class DepositService {
  private readonly balances: CodeBalanceRepository;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sweep: SweepService,
  ) {
    this.balances = new CodeBalanceRepository(prisma);
  }

  async getOrCreateDepositAddress(accountId: string): Promise<{ address: string }> {
    const existing = await this.prisma.codeDepositAddress.findUnique({ where: { accountId } });
    if (existing) return { address: existing.address };

    const keypair = Keypair.generate();
    const address = keypair.publicKey.toBase58();
    const encryptedSecretKey = encryptSecret(Buffer.from(keypair.secretKey).toString("base64"));

    await this.prisma.codeDepositAddress.create({
      data: { id: newId("codeDepositAddress"), accountId, address, encryptedSecretKey },
    });
    await this.audit.record({ accountId, actorType: "USER", action: "CODE_DEPOSIT_ADDRESS_CREATED", targetType: "codeDepositAddress" });

    return { address };
  }

  /** what's actually spendable right now: confirmed balance minus anything currently held by an in-flight inference reservation (PAYMOD_CODE_PLAN.md's debit side) - never the gross balance, which could show funds already earmarked for a call in progress as free to spend again. */
  async getBalanceUsdcAtomic(accountId: string): Promise<string> {
    return this.balances.getSpendableAtomic(accountId);
  }

  /** "I've sent it": one on-demand check, not a background poll. Idempotent - safe to call any number of times, including concurrently, for the same real deposit. */
  async checkDeposit(accountId: string, rpc: SolanaRpc = defaultSolanaRpc()): Promise<CheckDepositResult> {
    const record = await this.prisma.codeDepositAddress.findUnique({ where: { accountId } });
    const { address } = record ?? (await this.getOrCreateDepositAddress(accountId));
    const depositAddress = new PublicKey(address);
    const usdcMint = getUsdcMint().toBase58();

    const signatures = await rpc.getSignaturesForAddress(depositAddress, {
      ...(record?.lastProcessedSignature && { until: record.lastProcessedSignature }),
    });
    // newest-first from the RPC - process oldest-first so the cursor only
    // ever advances forward through real history.
    const chronological = [...signatures].reverse();

    let creditedUsdcAtomic = 0n;
    let newDepositCount = 0;
    let newestSignature = record?.lastProcessedSignature;

    for (const { signature } of chronological) {
      const transaction = await rpc.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
      const delta = usdcCreditedTo(transaction?.meta, address, usdcMint);
      if (delta > 0n) {
        const credited = await this.balances.credit({ accountId, amountAtomic: delta.toString(), type: "DEPOSIT", txSignature: signature });
        if (credited) {
          creditedUsdcAtomic += delta;
          newDepositCount += 1;
        }
      }
      newestSignature = signature;
    }

    if (newestSignature !== record?.lastProcessedSignature) {
      await this.prisma.codeDepositAddress.update({ where: { accountId }, data: { lastProcessedSignature: newestSignature } });
    }
    if (newDepositCount > 0) {
      await this.audit.record({
        accountId,
        actorType: "USER",
        action: "CODE_DEPOSIT_CREDITED",
        targetType: "codeDepositAddress",
        payload: { creditedUsdcAtomic: creditedUsdcAtomic.toString(), newDepositCount },
      });
      // best-effort, not on the critical path - the ledger credit above is
      // already final and correct regardless of whether this succeeds, is
      // unconfigured, or fails outright (see SweepService's own docblock).
      await this.sweep.sweep(accountId).catch(() => undefined);
    }

    const balanceUsdcAtomic = await this.getBalanceUsdcAtomic(accountId);
    return { creditedUsdcAtomic: creditedUsdcAtomic.toString(), newDepositCount, balanceUsdcAtomic };
  }
}

export function usdcAtomicToUsd(atomic: string): number {
  return Number(BigInt(atomic)) / Number(USDC_ATOMIC_PER_DOLLAR);
}
