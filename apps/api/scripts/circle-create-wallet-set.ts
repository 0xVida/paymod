/**
 * creates a Circle wallet set - a required grouping every Developer-Controlled
 * Wallet belongs to. One-time setup; Paymod uses a single wallet set today
 * (CIRCLE_WALLET_SET_ID), not one per customer.
 *
 * Requires CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET and CIRCLE_ENTITY_PUBLIC_KEY_FILE
 * already set in apps/api/.env (run circle-register-entity-secret.ts and
 * circle-fetch-public-key.ts first if you haven't).
 *
 *   npx tsx apps/api/scripts/circle-create-wallet-set.ts "some-name"
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { encryptEntitySecret } from "@paymod/circle";

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecretHex = process.env.CIRCLE_ENTITY_SECRET;
const publicKeyFile = process.env.CIRCLE_ENTITY_PUBLIC_KEY_FILE;
if (!apiKey || !entitySecretHex || !publicKeyFile) {
  throw new Error("CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET and CIRCLE_ENTITY_PUBLIC_KEY_FILE must all be set in apps/api/.env first.");
}

const publicKeyPem = readFileSync(new URL(`../${publicKeyFile.replace(/^\.\//, "")}`, import.meta.url), "utf8");
const name = process.argv[2] ?? "paymod-mvp";

const response = await fetch("https://api.circle.com/v1/w3s/developer/walletSets", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    idempotencyKey: randomUUID(),
    entitySecretCiphertext: encryptEntitySecret(entitySecretHex, publicKeyPem),
    name,
  }),
});
const body = (await response.json()) as { data?: { walletSet: { id: string } }; message?: string };
if (!response.ok || !body.data) {
  throw new Error(`Circle returned ${response.status}: ${JSON.stringify(body)}`);
}

console.log(`Wallet set created: ${body.data.walletSet.id}`);
console.log("Set CIRCLE_WALLET_SET_ID to this value in apps/api/.env.");
