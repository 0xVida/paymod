import { ERROR_CODES, PaymodError, type ErrorCode } from "@paymod/shared";

/** the API's error envelope, per spec: `{ error: { code, message, requestId?, details? } }`. */
type ErrorEnvelope = {
  error: { code: string; message: string; requestId?: string; details?: Record<string, unknown> };
};

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const err = (value as { error?: unknown }).error;
  return typeof err === "object" && err !== null && "code" in err && "message" in err;
}

/** reuses @paymod/shared's PaymodError so a caller's `catch` handles server and client errors identically. */
export async function throwForFailedResponse(response: Response): Promise<never> {
  const body: unknown = await response.json().catch(() => undefined);
  if (isErrorEnvelope(body)) {
    // the wire code is a plain string; trusted here as ErrorCode because the
    // API is this SDK's only server and always emits values from that union.
    throw new PaymodError(body.error.code as ErrorCode, body.error.message, {
      httpStatus: response.status,
      ...(body.error.requestId !== undefined && { requestId: body.error.requestId }),
      ...(body.error.details !== undefined && { details: body.error.details }),
    });
  }
  throw new PaymodError(ERROR_CODES.INTERNAL_ERROR, `Request failed with status ${response.status}`, {
    httpStatus: response.status,
  });
}
