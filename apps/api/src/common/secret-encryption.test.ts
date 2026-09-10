import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "./secret-encryption.js";

const originalKey = process.env.CODE_DEPOSIT_KEY_ENCRYPTION_KEY;

function withMasterKey<T>(key: string | undefined, body: () => T): T {
  process.env.CODE_DEPOSIT_KEY_ENCRYPTION_KEY = key;
  try {
    return body();
  } finally {
    process.env.CODE_DEPOSIT_KEY_ENCRYPTION_KEY = originalKey;
  }
}

describe("secret-encryption", () => {
  test("round-trips a real secret", () => {
    const key = randomBytes(32).toString("base64");
    withMasterKey(key, () => {
      const secret = "this-is-a-solana-secret-key-base58-string";
      const encrypted = encryptSecret(secret);
      assert.notEqual(encrypted, secret, "the stored value must not be the plaintext");
      assert.equal(decryptSecret(encrypted), secret);
    });
  });

  test("different plaintexts produce different ciphertext (real random IV, not reused)", () => {
    const key = randomBytes(32).toString("base64");
    withMasterKey(key, () => {
      const a = encryptSecret("same-plaintext");
      const b = encryptSecret("same-plaintext");
      assert.notEqual(a, b, "encrypting the same plaintext twice must not produce identical ciphertext");
    });
  });

  test("decrypting with the wrong master key fails rather than silently returning garbage", () => {
    const encrypted = withMasterKey(randomBytes(32).toString("base64"), () => encryptSecret("secret"));
    withMasterKey(randomBytes(32).toString("base64"), () => {
      assert.throws(() => decryptSecret(encrypted));
    });
  });

  test("fails closed when the master key is missing", () => {
    withMasterKey(undefined, () => {
      assert.throws(() => encryptSecret("secret"), /CODE_DEPOSIT_KEY_ENCRYPTION_KEY/);
    });
  });

  test("fails closed when the master key is the wrong length", () => {
    withMasterKey(Buffer.from("too-short").toString("base64"), () => {
      assert.throws(() => encryptSecret("secret"), /CODE_DEPOSIT_KEY_ENCRYPTION_KEY/);
    });
  });
});
