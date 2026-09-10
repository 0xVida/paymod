import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";
import { IdempotencyService } from "./idempotency.service.js";
import { WalletCredentialGuard } from "./wallet-credential.guard.js";
import { SessionGuard } from "./session.guard.js";
import { BootstrapOrAccountGuard } from "./bootstrap-or-account.guard.js";
import { CodeCredentialGuard } from "./code-credential.guard.js";
import { AdminGuard } from "./admin.guard.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiRateLimitMiddleware } from "./api-rate-limit.middleware.js";

const GUARDS = [WalletCredentialGuard, SessionGuard, BootstrapOrAccountGuard, CodeCredentialGuard, AdminGuard];

@Global()
@Module({
  providers: [PrismaService, IdempotencyService, AuditService, ApiRateLimitMiddleware, ...GUARDS],
  exports: [PrismaService, IdempotencyService, AuditService, ApiRateLimitMiddleware, ...GUARDS],
})
export class CommonModule {}
