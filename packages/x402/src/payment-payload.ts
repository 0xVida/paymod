import { z } from "zod";
import type { Response } from "undici";
import { ERROR_CODES, PaymodError } from "@paymod/shared";
import type { PaymentRequirements } from "./requirements.js";

const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";
const X402_VERSION = 2;

/** the Stellar `exact` scheme's payload: a single signed transaction, base64 XDR. */
export type StellarExactPayload = { transaction: string };

/**
 * the EVM `exact` scheme's `eip3009` payload: an ERC-3009
 * `TransferWithAuthorization` signature plus the parameters to
 * reconstruct the signed message. Never a transaction: EIP-3009 transfers
 * are gasless from the payer's side and broadcast by the facilitator, not
 * Paymod. Field-for-field match of x402-foundation/x402's
 * `scheme_exact_evm.md` example payload.
 */
export type EvmExactPayload = {
  signature: string;
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
};

export type PaymentPayload = {
  x402Version: number;
  accepted: PaymentRequirements;
  payload: StellarExactPayload | EvmExactPayload;
  resource?: { url: string; description?: string; mimeType?: string };
};

/**
 * builds and base64-encodes the `PAYMENT-SIGNATURE` header value: the
 * requirement being satisfied plus the rail-specific signed payload, a
 * signed transaction (Stellar) or an EIP-3009 authorization signature
 * (EVM `eip3009`). The Stellar payload must already carry the
 * `__check_auth`-signed authorization entry: see `@paymod/stellar`'s
 * `buildX402TransferAuthorizationEntry`.
 */
export function encodePaymentSignatureHeader(
  requirement: PaymentRequirements,
  payload: StellarExactPayload | EvmExactPayload,
  resource?: PaymentPayload["resource"],
): string {
  const body: PaymentPayload = {
    x402Version: X402_VERSION,
    accepted: requirement,
    payload,
    ...(resource !== undefined && { resource }),
  };
  return Buffer.from(JSON.stringify(body)).toString("base64");
}

export function paymentSignatureHeaderName(): string {
  return PAYMENT_SIGNATURE_HEADER;
}

const settlementResponseSchema = z.object({
  success: z.boolean(),
  errorReason: z.string().optional(),
  payer: z.string().optional(),
  transaction: z.string(),
  network: z.string(),
  amount: z.string().optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export type SettlementResponse = z.infer<typeof settlementResponseSchema>;

/**
 * reads and decodes the `PAYMENT-RESPONSE` header from a merchant's success
 * (or failed-settlement) response. Throws PaymodError(PAYMENT_FAILED) if the
 * header is missing or malformed: a 200 with no settlement confirmation is
 * not trustworthy regardless of the resource body.
 */
export function parsePaymentResponse(response: Response): SettlementResponse {
  const header = response.headers.get(PAYMENT_RESPONSE_HEADER);
  if (!header) {
    throw new PaymodError(ERROR_CODES.PAYMENT_FAILED, `Response is missing the ${PAYMENT_RESPONSE_HEADER} header`);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    throw new PaymodError(ERROR_CODES.PAYMENT_FAILED, `${PAYMENT_RESPONSE_HEADER} header is not valid base64-encoded JSON`);
  }

  const result = settlementResponseSchema.safeParse(decoded);
  if (!result.success) {
    throw new PaymodError(ERROR_CODES.PAYMENT_FAILED, `${PAYMENT_RESPONSE_HEADER} header did not match the SettlementResponse schema`, {
      details: { issues: result.error.issues },
    });
  }
  return result.data;
}
