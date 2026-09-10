import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";
import { ERROR_CODES } from "@paymod/shared";

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: "Request body failed validation.",
          details: { issues: result.error.issues },
        },
      });
    }
    return result.data;
  }
}
