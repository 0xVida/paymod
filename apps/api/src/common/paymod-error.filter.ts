import { ArgumentsHost, Catch } from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import type { Response } from "express";
import { isPaymodError } from "@paymod/shared";

/**
 * `PaymodError` is a plain `Error`, not a NestJS `HttpException`, so
 * without this filter every policy denial or idempotency conflict would
 * surface as an opaque 500 instead of its real status and reason. Extends
 * `BaseExceptionFilter` and delegates anything that isn't a `PaymodError`
 * to `super.catch`, so other `HttpException` subclasses keep their
 * existing handling.
 */
@Catch()
export class PaymodErrorFilter extends BaseExceptionFilter {
  constructor(httpAdapterHost: HttpAdapterHost) {
    super(httpAdapterHost.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost) {
    if (!isPaymodError(exception)) {
      super.catch(exception, host);
      return;
    }
    const res = host.switchToHttp().getResponse<Response>();
    res.status(exception.httpStatus).json(exception.toJSON());
  }
}
