import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { buildSweepTransaction } from "./sweep.service.js";

function fakePublicKey(): PublicKey {
  return Keypair.generate().publicKey;
}

const blockhash = randomBytes(32).toString("hex").slice(0, 44);

describe("buildSweepTransaction", () => {
  test("sets the relayer as fee payer, not the deposit address", () => {
    const relayerAddress = fakePublicKey();
    const transaction = buildSweepTransaction({
      depositAddress: fakePublicKey(),
      relayerAddress,
      treasuryAddress: fakePublicKey(),
      usdcMint: fakePublicKey(),
      depositTokenAccount: fakePublicKey(),
      treasuryTokenAccount: fakePublicKey(),
      treasuryTokenAccountExists: true,
      amountAtomic: 5_000_000n,
      blockhash,
    });

    assert.ok(transaction.feePayer?.equals(relayerAddress));
  });

  test("the deposit address, not the relayer, is the transfer authority", () => {
    const depositAddress = fakePublicKey();
    const depositTokenAccount = fakePublicKey();
    const treasuryTokenAccount = fakePublicKey();
    const transaction = buildSweepTransaction({
      depositAddress,
      relayerAddress: fakePublicKey(),
      treasuryAddress: fakePublicKey(),
      usdcMint: fakePublicKey(),
      depositTokenAccount,
      treasuryTokenAccount,
      treasuryTokenAccountExists: true,
      amountAtomic: 5_000_000n,
      blockhash,
    });

    const transferInstruction = transaction.instructions.at(-1)!;
    assert.ok(transferInstruction.programId.equals(TOKEN_PROGRAM_ID));
    // SPL token transfer keys: [source, destination, owner/authority].
    assert.ok(transferInstruction.keys[0]!.pubkey.equals(depositTokenAccount));
    assert.ok(transferInstruction.keys[1]!.pubkey.equals(treasuryTokenAccount));
    assert.ok(transferInstruction.keys[2]!.pubkey.equals(depositAddress));
    assert.equal(transferInstruction.keys[2]!.isSigner, true);
  });

  test("creates the treasury's associated token account only when it doesn't already exist", () => {
    const withCreation = buildSweepTransaction({
      depositAddress: fakePublicKey(),
      relayerAddress: fakePublicKey(),
      treasuryAddress: fakePublicKey(),
      usdcMint: fakePublicKey(),
      depositTokenAccount: fakePublicKey(),
      treasuryTokenAccount: fakePublicKey(),
      treasuryTokenAccountExists: false,
      amountAtomic: 1_000_000n,
      blockhash,
    });
    assert.equal(withCreation.instructions.length, 2, "expected an ATA-creation instruction plus the transfer");

    const withoutCreation = buildSweepTransaction({
      depositAddress: fakePublicKey(),
      relayerAddress: fakePublicKey(),
      treasuryAddress: fakePublicKey(),
      usdcMint: fakePublicKey(),
      depositTokenAccount: fakePublicKey(),
      treasuryTokenAccount: fakePublicKey(),
      treasuryTokenAccountExists: true,
      amountAtomic: 1_000_000n,
      blockhash,
    });
    assert.equal(withoutCreation.instructions.length, 1, "an existing treasury token account needs only the transfer");
  });
});
