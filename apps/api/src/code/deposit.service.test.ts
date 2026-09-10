import test, { before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { PublicKey } from "@solana/web3.js";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { newId } from "@paymod/shared";
import { PrismaService } from "../common/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { DepositService, type SolanaRpc } from "./deposit.service.js";
import { SweepService } from "./sweep.service.js";
import { getUsdcMint } from "./solana-config.js";

/**
 * real Postgres, fake Solana RPC - mirrors `device-auth.service.test.ts`'s
 * style. No real devnet round trip: `SolanaRpc` is narrowed to exactly the
 * two calls `checkDeposit` makes, so a fake implementing just those is a
 * real substitute, not a partial mock hiding behavior.
 *
 *   docker compose up -d
 *   npm --workspace @paymod/api run test
 */

process.env.CODE_DEPOSIT_KEY_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const prisma = new PrismaService();
const audit = new AuditService(prisma);
// A real SweepService, not a fake: SOLANA_RELAYER_SECRET_KEY/
// SOLANA_TREASURY_ADDRESS are deliberately unset in this test env, so it
// safely no-ops via its own "not configured yet" fallback - exactly the
// behavior it's designed to have until Paymod funds a relayer for real.
const service = new DepositService(prisma, audit, new SweepService(prisma, audit));
const usdcMint = getUsdcMint().toBase58();

let accountId: string;

before(async () => {
  await prisma.$connect();
});

async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "code_ledger_entries", "code_deposit_addresses", "code_credentials",
      "device_auth_requests", "sessions", "users",
      "chain_tx_attempts", "settlements", "spend_reservations", "budget_periods",
      "financial_intents", "wallet_assets", "wallet_credentials",
      "policies", "agent_wallets", "audit_events", "idempotency_records", "accounts"
    RESTART IDENTITY CASCADE
  `);
}

beforeEach(async () => {
  await resetDatabase();
  const userId = newId("user");
  accountId = newId("account");
  await prisma.user.create({ data: { id: userId, email: `${userId}@test.paymod.dev`, passwordHash: "x", name: "Test" } });
  await prisma.account.create({ data: { id: accountId, userId, name: "Test" } });
});

after(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

/** A `ParsedTransactionWithMeta` carrying only what `usdcCreditedTo` reads - pre/post USDC balances for one owner. */
function fakeUsdcTransaction(owner: string, preAtomic: string | undefined, postAtomic: string): ParsedTransactionWithMeta {
  const tokenBalance = (amount: string) => ({ accountIndex: 0, mint: usdcMint, owner, uiTokenAmount: { amount, decimals: 6, uiAmount: null, uiAmountString: amount } });
  return {
    meta: {
      preTokenBalances: preAtomic === undefined ? [] : [tokenBalance(preAtomic)],
      postTokenBalances: [tokenBalance(postAtomic)],
    },
  } as unknown as ParsedTransactionWithMeta;
}

function fakeRpc(transactions: Record<string, ParsedTransactionWithMeta>): SolanaRpc {
  const signatures = Object.keys(transactions);
  return {
    getSignaturesForAddress: async (_address: PublicKey, options) => {
      const untilIndex = options?.until ? signatures.indexOf(options.until) : -1;
      // real RPC returns newest-first; only signatures after `until` (exclusive).
      return signatures.slice(untilIndex + 1).reverse().map((signature) => ({ signature }));
    },
    getParsedTransaction: async (signature: string) => transactions[signature] ?? null,
  };
}

describe("DepositService", () => {
  test("getOrCreateDepositAddress generates and stores a real, encrypted keypair", async () => {
    const first = await service.getOrCreateDepositAddress(accountId);
    assert.ok(first.address.length > 30, "expected a real base58 Solana address");

    const second = await service.getOrCreateDepositAddress(accountId);
    assert.equal(second.address, first.address, "a second call must return the same address, not generate a new one");

    const row = await prisma.codeDepositAddress.findUniqueOrThrow({ where: { accountId } });
    assert.notEqual(row.encryptedSecretKey, "", "the secret key must be stored encrypted");
    assert.doesNotMatch(row.encryptedSecretKey, /^[1-9A-HJ-NP-Za-km-z]{80,}$/, "the stored value must not look like a raw base58 secret key");
  });

  test("a new USDC transfer credits the ledger and advances the cursor", async () => {
    const { address } = await service.getOrCreateDepositAddress(accountId);
    const rpc = fakeRpc({ sig1: fakeUsdcTransaction(address, undefined, "5000000") }); // 5,000,000 atomic = $5

    const result = await service.checkDeposit(accountId, rpc);

    assert.equal(result.creditedUsdcAtomic, "5000000");
    assert.equal(result.newDepositCount, 1);
    assert.equal(result.balanceUsdcAtomic, "5000000");

    const row = await prisma.codeDepositAddress.findUniqueOrThrow({ where: { accountId } });
    assert.equal(row.lastProcessedSignature, "sig1");
  });

  test("calling checkDeposit again with nothing new is a no-op, not a double credit", async () => {
    const { address } = await service.getOrCreateDepositAddress(accountId);
    const rpc = fakeRpc({ sig1: fakeUsdcTransaction(address, undefined, "5000000") });

    await service.checkDeposit(accountId, rpc);
    const second = await service.checkDeposit(accountId, rpc);

    assert.equal(second.creditedUsdcAtomic, "0");
    assert.equal(second.newDepositCount, 0);
    assert.equal(second.balanceUsdcAtomic, "5000000", "the balance from the first deposit must still be there, not doubled or lost");
  });

  test("two separate deposits both credit and the cursor lands on the newest", async () => {
    const { address } = await service.getOrCreateDepositAddress(accountId);
    const rpc = fakeRpc({
      sig1: fakeUsdcTransaction(address, undefined, "1000000"),
      sig2: fakeUsdcTransaction(address, "1000000", "3500000"),
    });

    const result = await service.checkDeposit(accountId, rpc);

    assert.equal(result.newDepositCount, 2);
    assert.equal(result.balanceUsdcAtomic, "3500000");
    const row = await prisma.codeDepositAddress.findUniqueOrThrow({ where: { accountId } });
    assert.equal(row.lastProcessedSignature, "sig2");
  });

  test("a transaction with no incoming USDC transfer credits nothing", async () => {
    const { address } = await service.getOrCreateDepositAddress(accountId);
    const rpc = fakeRpc({ sig1: fakeUsdcTransaction(address, "1000000", "1000000") }); // no change

    const result = await service.checkDeposit(accountId, rpc);

    assert.equal(result.creditedUsdcAtomic, "0");
    assert.equal(result.newDepositCount, 0);
  });
});
