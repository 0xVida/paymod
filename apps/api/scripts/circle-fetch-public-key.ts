/**
 * Fetches Circle's RSA public key (used by packages/circle/src/entity-secret.ts
 * to encrypt the entity secret). Not secret - Circle publishes it for anyone
 * with an API key - but stored as a file since a PEM doesn't fit an .env
 * line. Run once; rotating the entity secret doesn't change this key.
 *
 *   npx tsx apps/api/scripts/circle-fetch-public-key.ts
 */
import { writeFileSync } from "node:fs";

const OUT_PATH = new URL("../circle-entity-public-key.pem", import.meta.url).pathname;

const apiKey = process.env.CIRCLE_API_KEY;
if (!apiKey) {
  throw new Error("CIRCLE_API_KEY is required. Set it in apps/api/.env first.");
}

const response = await fetch("https://api.circle.com/v1/w3s/config/entity/publicKey", {
  headers: { Authorization: `Bearer ${apiKey}` },
});
if (!response.ok) {
  throw new Error(`Circle returned ${response.status}: ${await response.text()}`);
}
const body = (await response.json()) as { data: { publicKey: string } };

writeFileSync(OUT_PATH, body.data.publicKey);
console.log(`Circle's public key saved to: ${OUT_PATH}`);
console.log("Set CIRCLE_ENTITY_PUBLIC_KEY_FILE=./circle-entity-public-key.pem in apps/api/.env if it isn't already.");
