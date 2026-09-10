import { randomBytes } from "node:crypto";

/**
 * Prefixed ULIDs are the primary keys everywhere: TEXT columns, not UUID.
 *
 * One identifier, used internally and publicly, so there is no internal/public
 * mapping table to keep in sync. ULIDs sort lexicographically by creation time,
 * which makes them well-behaved as B-tree keys and the prefix makes a
 * mis-wired foreign key obvious on sight in a log line.
 */
export const ID_PREFIXES = {
  user: "usr",
  account: "acc",
  session: "ses",
  wallet: "wal",
  credential: "cred",
  codeCredential: "ccred",
  codeDepositAddress: "cdep",
  codeLedgerEntry: "cldg",
  providerApiKey: "pkey",
  modelPricing: "mpr",
  usageReservation: "ures",
  usageEvent: "uev",
  intent: "int",
  policy: "pol",
  reservation: "res",
  spendEvent: "spn",
  budgetPeriod: "bgt",
  chainTx: "tx",
  approval: "apr",
  request: "req",
  webhook: "wh",
  auditEvent: "aud",
  settlement: "stl",
  walletAsset: "wa",
  deviceAuthRequest: "dev",
  telegramLink: "tgl",
  telegramConnection: "tgc",
  oauthClient: "ocl",
  oauthCode: "ocd",
  oauthToken: "oct",
} as const;

export type IdEntity = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdEntity];

// Crockford Base32: no I, L, O or U, so IDs survive being read aloud or
// transcribed from a screenshot without ambiguity.
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_CHARS = 10; // 48 bits of millisecond timestamp
const RANDOM_CHARS = 16; // 80 bits of entropy
const ULID_LENGTH = TIME_CHARS + RANDOM_CHARS;

function encodeTime(timestamp: number): string {
  if (!Number.isInteger(timestamp) || timestamp < 0) {
    throw new RangeError("ULID timestamp must be a non-negative integer");
  }
  let remaining = timestamp;
  let out = "";
  for (let i = TIME_CHARS - 1; i >= 0; i--) {
    const mod = remaining % 32;
    out = ENCODING[mod] + out;
    remaining = (remaining - mod) / 32;
  }
  return out;
}

function encodeRandom(): string {
  // 32 divides 256 exactly, so `byte % 32` stays uniform: no modulo bias.
  const bytes = randomBytes(RANDOM_CHARS);
  let out = "";
  for (let i = 0; i < RANDOM_CHARS; i++) out += ENCODING[bytes[i]! % 32];
  return out;
}

export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

export function newId(entity: IdEntity, now?: number): string {
  return `${ID_PREFIXES[entity]}_${ulid(now)}`;
}

const ULID_PATTERN = new RegExp(`^[${ENCODING}]{${ULID_LENGTH}}$`);

export function isId(entity: IdEntity, value: unknown): value is string {
  if (typeof value !== "string") return false;
  const prefix = `${ID_PREFIXES[entity]}_`;
  return value.startsWith(prefix) && ULID_PATTERN.test(value.slice(prefix.length));
}

/**
 * throws on a well-formed ID of the wrong entity, which is the failure this
 * whole scheme exists to catch: passing a spender id where a treasury id
 * belongs is otherwise a silent, hard-to-trace bug.
 */
export function assertId(entity: IdEntity, value: unknown): string {
  if (!isId(entity, value)) {
    throw new TypeError(
      `Expected a ${entity} id (${ID_PREFIXES[entity]}_...), received ${JSON.stringify(value)}`,
    );
  }
  return value;
}

export function timestampOf(id: string): Date {
  const ulidPart = id.includes("_") ? id.slice(id.indexOf("_") + 1) : id;
  if (!ULID_PATTERN.test(ulidPart)) throw new TypeError(`Not a ULID: ${id}`);
  let ms = 0;
  for (const char of ulidPart.slice(0, TIME_CHARS)) ms = ms * 32 + ENCODING.indexOf(char);
  return new Date(ms);
}
