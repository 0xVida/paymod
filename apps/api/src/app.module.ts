import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { CommonModule } from "./common/common.module.js";
import { WalletsModule } from "./wallets/wallets.module.js";
import { PoliciesModule } from "./policies/policies.module.js";
import { IntentsModule } from "./intents/intents.module.js";
import { SettlementModule } from "./settlement/settlement.module.js";
import { X402Module } from "./x402/x402.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { ConfigModule } from "./config/config.module.js";
import { RequestIdMiddleware } from "./common/request-id.middleware.js";
import { ApiRateLimitMiddleware } from "./common/api-rate-limit.middleware.js";
import { CodeModule } from "./code/code.module.js";
import { ApprovalsModule } from "./approvals/approvals.module.js";

@Module({
  imports: [
    CommonModule,
    WalletsModule,
    PoliciesModule,
    IntentsModule,
    SettlementModule,
    X402Module,
    AuthModule,
    AuditModule,
    ConfigModule,
    CodeModule,
    ApprovalsModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, ApiRateLimitMiddleware).forRoutes("*");
  }
}
