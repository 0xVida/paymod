import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { newId } from "@paymod/shared";

/**
 * Stamps every response with a `Paymod-Request-Id` header for
 * transport-level tracing. Distinct from the `req_` id `IntentsService`
 * mints for a financial operation, which is domain-significant
 * (propagates into FinancialIntent, audit events, webhooks) and threaded
 * through method parameters explicitly, not read back out of here.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    res.setHeader("Paymod-Request-Id", newId("request"));
    next();
  }
}
