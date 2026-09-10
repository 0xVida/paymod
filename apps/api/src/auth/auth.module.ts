import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { LoginRateLimiter } from "./login-rate-limiter.js";
import { SessionCleanupSweeper } from "./session-cleanup.sweeper.js";
import { OAuthController, OAuthMetadataController } from "./oauth.controller.js";
import { OAuthService } from "./oauth.service.js";

@Module({
  imports: [CommonModule],
  controllers: [AuthController, OAuthController, OAuthMetadataController],
  providers: [AuthService, LoginRateLimiter, SessionCleanupSweeper, OAuthService],
})
export class AuthModule {}
