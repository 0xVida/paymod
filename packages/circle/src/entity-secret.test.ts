import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, privateDecrypt, constants } from "node:crypto";
import { encryptEntitySecret, loadEntitySecretHex } from "./entity-secret.js";

function generateTestKeyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

test("encrypted entity secret decrypts back to the original bytes", () => {
  const { publicKey, privateKey } = generateTestKeyPair();
  const entitySecretHex = "a".repeat(64);
  const ciphertext = encryptEntitySecret(entitySecretHex, publicKey);
  const decrypted = privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(ciphertext, "base64"),
  );
  assert.equal(decrypted.toString("hex"), entitySecretHex);
});

test("each encryption is freshly randomized, never identical ciphertext twice", () => {
  const { publicKey } = generateTestKeyPair();
  const entitySecretHex = "b".repeat(64);
  const first = encryptEntitySecret(entitySecretHex, publicKey);
  const second = encryptEntitySecret(entitySecretHex, publicKey);
  assert.notEqual(first, second);
});

test("loadEntitySecretHex rejects a secret that isn't 64 hex characters", async () => {
  process.env.TEST_CIRCLE_ENTITY_SECRET = "not-hex";
  await assert.rejects(() => loadEntitySecretHex("TEST_CIRCLE_ENTITY_SECRET"));
  delete process.env.TEST_CIRCLE_ENTITY_SECRET;
});

test("loadEntitySecretHex accepts a valid 32-byte hex secret", async () => {
  process.env.TEST_CIRCLE_ENTITY_SECRET = "c".repeat(64);
  const secret = await loadEntitySecretHex("TEST_CIRCLE_ENTITY_SECRET");
  assert.equal(secret, "c".repeat(64));
  delete process.env.TEST_CIRCLE_ENTITY_SECRET;
});
