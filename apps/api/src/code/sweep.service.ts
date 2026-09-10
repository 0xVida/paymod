import { Injectable, Logger } from "@nestjs/common";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction, createTransferInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import { PrismaService } from "../common/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { decryptSecret } from "../common/secret-encryption.js";
import { getRelayerKeypair, getSolanaRpcUrl, getTreasuryUsdcAddress, getUsdcMint } from "./solana-config.js";

export type SweepResult = { swept: boolean; amountUsdcAtomic?: string };

/**
 * Pure function so the sweep's instruction set is unit-testable without a
 * live RPC connection. Relayer signs only as fee payer; the deposit
 * address signs as transfer authority, so the relayer alone can never move
 * a deposit address's funds.
 */
export function buildSweepTransaction(params: {
  depositAddress: PublicKey;
  relayerAddress: PublicKey;
  treasuryAddress: PublicKey;
  usdcMint: PublicKey;
  depositTokenAccount: PublicKey;
  treasuryTokenAccount: PublicKey;
  treasuryTokenAccountExists: boolean;
  amountAtomic: bigint;
  blockhash: string;
}): Transaction {
  const transaction = new Transaction({ feePayer: params.relayerAddress, recentBlockhash: params.blockhash });
  if (!params.treasuryTokenAccountExists) {
    transaction.add(
      createAssociatedTokenAccountInstruction(params.relayerAddress, params.treasuryTokenAccount, params.treasuryAddress, params.usdcMint),
    );
  }
  transaction.add(createTransferInstruction(params.depositTokenAccount, params.treasuryTokenAccount, params.depositAddress, params.amountAtomic));
  return transaction;
}

/**
 * moves accumulated USDC to the Paymod treasury (PAYMOD_CODE_PLAN.md
 * section 2, step 4). Not on the critical path: `DepositService.checkDeposit`
 * already credited the ledger, so a sweep failure here doesn't touch the
 * user's balance. Silently a no-op until `SOLANA_TREASURY_ADDRESS`/
 * `SOLANA_RELAYER_SECRET_KEY` are configured - optional infrastructure, not
 * a broken feature, until Paymod funds a relayer.
 */
@Injectable()
export class SweepService {
  private readonly logger = new Logger(SweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async sweep(accountId: string, connection: Connection = new Connection(getSolanaRpcUrl(), "confirmed")): Promise<SweepResult> {
    let relayer: Keypair;
    let treasuryAddress: PublicKey;
    try {
      relayer = getRelayerKeypair();
      treasuryAddress = getTreasuryUsdcAddress();
    } catch {
      return { swept: false };
    }

    const record = await this.prisma.codeDepositAddress.findUnique({ where: { accountId } });
    if (!record) return { swept: false };

    const depositKeypair = Keypair.fromSecretKey(Buffer.from(decryptSecret(record.encryptedSecretKey), "base64"));
    const usdcMint = getUsdcMint();
    const depositTokenAccount = await getAssociatedTokenAddress(usdcMint, depositKeypair.publicKey);
    const treasuryTokenAccount = await getAssociatedTokenAddress(usdcMint, treasuryAddress);

    const depositBalance = await connection.getTokenAccountBalance(depositTokenAccount).catch(() => null);
    const amountAtomic = BigInt(depositBalance?.value.amount ?? "0");
    if (amountAtomic === 0n) return { swept: false };

    const treasuryAccountInfo = await connection.getAccountInfo(treasuryTokenAccount);
    const { blockhash } = await connection.getLatestBlockhash();

    const transaction = buildSweepTransaction({
      depositAddress: depositKeypair.publicKey,
      relayerAddress: relayer.publicKey,
      treasuryAddress,
      usdcMint,
      depositTokenAccount,
      treasuryTokenAccount,
      treasuryTokenAccountExists: treasuryAccountInfo !== null,
      amountAtomic,
      blockhash,
    });

    try {
      await sendAndConfirmTransaction(connection, transaction, [relayer, depositKeypair]);
    } catch (error) {
      this.logger.warn(`Sweep failed for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`);
      return { swept: false };
    }

    await this.audit.record({
      accountId,
      actorType: "SYSTEM",
      action: "CODE_DEPOSIT_SWEPT",
      targetType: "codeDepositAddress",
      payload: { amountUsdcAtomic: amountAtomic.toString() },
    });

    return { swept: true, amountUsdcAtomic: amountAtomic.toString() };
  }
}
