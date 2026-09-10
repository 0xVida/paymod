import { Module } from "@nestjs/common";
import { DeviceAuthController } from "./device-auth.controller.js";
import { DeviceAuthService } from "./device-auth.service.js";
import { InferenceProxyController } from "./inference-proxy.controller.js";
import { InferenceProxyService } from "./inference-proxy.service.js";
import { DepositController } from "./deposit.controller.js";
import { DepositService } from "./deposit.service.js";
import { SweepService } from "./sweep.service.js";
import { AdminController } from "./admin.controller.js";
import { ModelsController } from "./models.controller.js";
import { ProviderKeysService } from "./provider-keys.service.js";
import { ModelPricingService } from "./model-pricing.service.js";
import { CommonModule } from "../common/common.module.js";

@Module({
  imports: [CommonModule],
  controllers: [DeviceAuthController, InferenceProxyController, DepositController, AdminController, ModelsController],
  providers: [DeviceAuthService, InferenceProxyService, DepositService, SweepService, ProviderKeysService, ModelPricingService],
})
export class CodeModule {}
