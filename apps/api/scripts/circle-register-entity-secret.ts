/**
 * Generates a new Circle entity secret and registers it with Circle. Run
 * this once for initial setup, or again any time you want to rotate the
 * entity secret - see circle.md for the full walkthrough.
 *
 * Requires CIRCLE_API_KEY in apps/api/.env. Refuses to run if
 * CIRCLE_ENTITY_SECRET is already set there, since overwriting a live
 * secret without rotating it on Circle's side first would desync the two.
 *
 *   npx tsx apps/api/scripts/circle-register-entity-secret.ts
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";

const ENV_PATH = new URL("../.env", import.meta.url).pathname;
const RECOVERY_DIR = new URL("../circle-recovery", import.meta.url).pathname;

const apiKey = process.env.CIRCLE_API_KEY;
if (!apiKey) {
  throw new Error("CIRCLE_API_KEY is required. Set it in apps/api/.env first.");
}

const existingEnv = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
if (/^CIRCLE_ENTITY_SECRET=.+/m.test(existingEnv)) {
  throw new Error(
    "CIRCLE_ENTITY_SECRET already exists in apps/api/.env. Refusing to overwrite it - " +
      "see circle.md's rotation section, which requires calling Circle's rotate endpoint " +
      "with the OLD secret before generating a new one, not just replacing the value here.",
  );
}

const entitySecret = randomBytes(32).toString("hex");
mkdirSync(RECOVERY_DIR, { recursive: true });

await registerEntitySecretCiphertext({
  apiKey,
  entitySecret,
  recoveryFileDownloadPath: RECOVERY_DIR,
});

appendFileSync(ENV_PATH, `\nCIRCLE_ENTITY_SECRET=${entitySecret}\n`);

console.log("Entity secret registered and appended to apps/api/.env as CIRCLE_ENTITY_SECRET.");
console.log(`Recovery file saved under: ${RECOVERY_DIR}`);
console.log("Move that recovery file to a password manager or secrets vault - it is the only way to recover this secret if it is lost, and Circle cannot do it for you.");
