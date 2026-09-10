/**
 * stable machine-readable error codes.
 *
 * These are a public API surface: they reach agents through MCP tool results
 * and the SDK and an agent branches on them. Renaming one is a breaking
 * change. Add new codes freely; never repurpose an existing one.
 */
export const ERROR_CODES = {
  // authentication / authorization
  INVALID_CREDENTIAL: "INVALID_CREDENTIAL",
  CREDENTIAL_REVOKED: "CREDENTIAL_REVOKED",
  FORBIDDEN: "FORBIDDEN",

  // account / wallet lifecycle
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",
  WALLET_PAUSED: "WALLET_PAUSED",
  WALLET_ARCHIVED: "WALLET_ARCHIVED",
  WALLET_NOT_READY: "WALLET_NOT_READY",
  NO_SPENDING_POLICY: "NO_SPENDING_POLICY",

  // policy denials: mirrors the precedence ladder in @paymod/policy-engine
  DAILY_LIMIT_EXCEEDED: "DAILY_LIMIT_EXCEEDED",
  MONTHLY_LIMIT_EXCEEDED: "MONTHLY_LIMIT_EXCEEDED",
  PER_TRANSACTION_LIMIT_EXCEEDED: "PER_TRANSACTION_LIMIT_EXCEEDED",
  ASSET_NOT_ALLOWED: "ASSET_NOT_ALLOWED",
  ASSET_BLOCKED: "ASSET_BLOCKED",
  NETWORK_NOT_ALLOWED: "NETWORK_NOT_ALLOWED",
  NETWORK_BLOCKED: "NETWORK_BLOCKED",
  DESTINATION_NOT_ALLOWED: "DESTINATION_NOT_ALLOWED",
  DESTINATION_BLOCKED: "DESTINATION_BLOCKED",
  ACTION_NOT_ALLOWED: "ACTION_NOT_ALLOWED",
  ACTION_BLOCKED: "ACTION_BLOCKED",

  // approvals
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  APPROVAL_EXPIRED: "APPROVAL_EXPIRED",
  APPROVAL_ALREADY_RESOLVED: "APPROVAL_ALREADY_RESOLVED",

  // wallet contract / settlement
  WALLET_UNVERIFIED: "WALLET_UNVERIFIED",
  INSUFFICIENT_TREASURY_BALANCE: "INSUFFICIENT_TREASURY_BALANCE",
  INVALID_DESTINATION: "INVALID_DESTINATION",
  UNSUPPORTED_PAYMENT_RAIL: "UNSUPPORTED_PAYMENT_RAIL",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  SETTLEMENT_UNKNOWN: "SETTLEMENT_UNKNOWN",

  // budget accounting
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
  RESERVATION_EXPIRED: "RESERVATION_EXPIRED",

  // Paymod Code balance / inference metering
  INSUFFICIENT_CODE_BALANCE: "INSUFFICIENT_CODE_BALANCE",
  MODEL_NOT_AVAILABLE: "MODEL_NOT_AVAILABLE",

  // x402
  X402_INVALID_REQUIREMENTS: "X402_INVALID_REQUIREMENTS",
  X402_UNSUPPORTED_NETWORK: "X402_UNSUPPORTED_NETWORK",
  X402_UNSUPPORTED_ASSET: "X402_UNSUPPORTED_ASSET",
  X402_AUTOPAY_EXCEEDED: "X402_AUTOPAY_EXCEEDED",
  SSRF_BLOCKED: "SSRF_BLOCKED",

  // request handling
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export type PaymodErrorOptions = {
  /** HTTP status for the API layer. Policy denials are 200 with a DENIED body. */
  httpStatus?: number;
  requestId?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
};

export class PaymodError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly requestId: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, options: PaymodErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "PaymodError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? 400;
    this.requestId = options.requestId;
    this.details = options.details;
  }

  /** matches the spec's error envelope exactly. */
  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.requestId !== undefined && { requestId: this.requestId }),
        ...(this.details !== undefined && { details: this.details }),
      },
    };
  }
}

export function isPaymodError(value: unknown): value is PaymodError {
  return value instanceof PaymodError;
}
