import { z } from "zod";
import type { Response } from "undici";
import { ERROR_CODES, PaymodError } from "@paymod/shared";

/**
 * x402 spec v2 (github.com/coinbase/x402/specs/x402-specification-v2.md),
 * its HTTP transport (github.com/coinbase/x402/specs/transports-v2/http.md)
 * and the Stellar `exact` scheme addendum
 * (github.com/x402-foundation/x402/specs/schemes/exact/scheme_exact_stellar.md)
 * were fetched and verified directly, not guessed - field names, the
 * CAIP-2 network id format and the Stellar payload shape below all match.
 *
 * The v2 HTTP transport carries every protocol object in a base64-encoded
 * JSON header, not a response body: `PAYMENT-REQUIRED` (402 response,
 * this module), `PAYMENT-SIGNATURE` (client retry, see
 * payment-payload.ts) and `PAYMENT-RESPONSE` (settlement confirmation).
 * Response/request bodies are the underlying resource, not protocol data.
 */

const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";

export const paymentRequirementsSchema = z.object({
  scheme: z.string().min(1),
  /** CAIP-2 `namespace:reference`. Stellar's own values are literally "stellar:testnet" / "stellar:pubnet". */
  network: z.string().min(1),
  amount: z.string().regex(/^\d+$/, "amount must be a non-negative integer string"),
  /** the SEP-41 token's contract address (C...), never a symbol. Classic Stellar assets are out of scope. */
  asset: z.string().min(1),
  payTo: z.string().min(1),
  maxTimeoutSeconds: z.number().int().positive(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export type PaymentRequirements = z.infer<typeof paymentRequirementsSchema>;

export const paymentRequiredResponseSchema = z.object({
  x402Version: z.number().int(),
  error: z.string().optional(),
  resource: z
    .object({
      url: z.string(),
      description: z.string().optional(),
      mimeType: z.string().optional(),
    })
    .optional(),
  accepts: z.array(paymentRequirementsSchema).min(1),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export type PaymentRequiredResponse = z.infer<typeof paymentRequiredResponseSchema>;

/**
 * reads and decodes the `PAYMENT-REQUIRED` header: the v2 transport carries
 * the payment requirements there, not in the response body.
 * Throws PaymodError(X402_INVALID_REQUIREMENTS) on a 402 with no such
 * header, malformed base64/JSON or a shape that fails the schema.
 */
export function parsePaymentRequiredResponse(response: Response): PaymentRequiredResponse {
  if (response.status !== 402) {
    throw new PaymodError(
      ERROR_CODES.X402_INVALID_REQUIREMENTS,
      `Expected HTTP 402, received ${response.status}`,
    );
  }
  const header = response.headers.get(PAYMENT_REQUIRED_HEADER);
  if (!header) {
    throw new PaymodError(ERROR_CODES.X402_INVALID_REQUIREMENTS, `402 response is missing the ${PAYMENT_REQUIRED_HEADER} header`);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    throw new PaymodError(ERROR_CODES.X402_INVALID_REQUIREMENTS, `${PAYMENT_REQUIRED_HEADER} header is not valid base64-encoded JSON`);
  }

  const result = paymentRequiredResponseSchema.safeParse(decoded);
  if (!result.success) {
    throw new PaymodError(ERROR_CODES.X402_INVALID_REQUIREMENTS, `${PAYMENT_REQUIRED_HEADER} header did not match the x402 v2 schema`, {
      details: { issues: result.error.issues },
    });
  }
  return result.data;
}

/**
 * Selects the single `accepts[]` entry Paymod can pay: the Stellar
 * `exact` scheme on the configured network, in the configured SEP-41
 * token, compared by contract address, never by a display symbol a
 * merchant could spoof. Throws a distinct PaymodError for each way a
 * requirement set can be unpayable, so the caller's policy layer gets a
 * real reason rather than a generic "no match".
 */
export function selectStellarExactRequirement(
  response: PaymentRequiredResponse,
  config: { networkId: string; tokenContractId: string },
): PaymentRequirements {
  const exact = response.accepts.filter((r) => r.scheme === "exact");
  if (exact.length === 0) {
    throw new PaymodError(ERROR_CODES.X402_INVALID_REQUIREMENTS, "No 'exact' scheme offered in accepts[]");
  }
  const onNetwork = exact.filter((r) => r.network === config.networkId);
  if (onNetwork.length === 0) {
    throw new PaymodError(
      ERROR_CODES.X402_UNSUPPORTED_NETWORK,
      `Merchant does not accept payment on ${config.networkId}`,
      { details: { offered: exact.map((r) => r.network) } },
    );
  }
  const requirement = onNetwork.find((r) => r.asset === config.tokenContractId);
  if (!requirement) {
    throw new PaymodError(
      ERROR_CODES.X402_UNSUPPORTED_ASSET,
      `Merchant does not accept treasury's configured asset (${config.tokenContractId})`,
      { details: { offered: onNetwork.map((r) => r.asset) } },
    );
  }
  return requirement;
}

/**
 * EVM twin of `selectStellarExactRequirement`: same filter shape (scheme,
 * network, asset by contract address, never a display symbol), plus one
 * check Stellar never needed: `extra.assetTransferMethod`. Per
 * x402-foundation/x402's `scheme_exact_evm.md`, `exact` on EVM has three
 * transfer methods (`eip3009`, `permit2`, `erc7710`); Paymod only
 * implements `eip3009` (USDC's native `transferWithAuthorization`, the
 * spec's own recommended default when absent). `extra.name`/
 * `extra.version` are required by that same spec section to build the
 * EIP-712 domain, validated as present strings here rather than left for
 * a signing-time crash.
 */
export function selectEvmExactRequirement(
  response: PaymentRequiredResponse,
  config: { networkId: string; tokenAddress: string },
): PaymentRequirements & { extra: { name: string; version: string } } {
  const exact = response.accepts.filter((r) => r.scheme === "exact");
  if (exact.length === 0) {
    throw new PaymodError(ERROR_CODES.X402_INVALID_REQUIREMENTS, "No 'exact' scheme offered in accepts[]");
  }
  const onNetwork = exact.filter((r) => r.network === config.networkId);
  if (onNetwork.length === 0) {
    throw new PaymodError(
      ERROR_CODES.X402_UNSUPPORTED_NETWORK,
      `Merchant does not accept payment on ${config.networkId}`,
      { details: { offered: exact.map((r) => r.network) } },
    );
  }
  const tokenLower = config.tokenAddress.toLowerCase();
  const requirement = onNetwork.find((r) => r.asset.toLowerCase() === tokenLower);
  if (!requirement) {
    throw new PaymodError(
      ERROR_CODES.X402_UNSUPPORTED_ASSET,
      `Merchant does not accept wallet's configured asset (${config.tokenAddress})`,
      { details: { offered: onNetwork.map((r) => r.asset) } },
    );
  }

  const method = requirement.extra?.["assetTransferMethod"];
  if (method !== undefined && method !== "eip3009") {
    throw new PaymodError(
      ERROR_CODES.X402_INVALID_REQUIREMENTS,
      `Merchant requires the '${String(method)}' transfer method; Paymod only supports 'eip3009'`,
    );
  }
  const name = requirement.extra?.["name"];
  const version = requirement.extra?.["version"];
  if (typeof name !== "string" || typeof version !== "string") {
    throw new PaymodError(
      ERROR_CODES.X402_INVALID_REQUIREMENTS,
      "Merchant's requirement is missing extra.name/extra.version, required to build the EIP-712 domain for eip3009",
    );
  }
  return { ...requirement, extra: { ...requirement.extra, name, version } };
}
