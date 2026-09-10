import { Controller, Get } from "@nestjs/common";
import { ProviderKeysService } from "./provider-keys.service.js";
import { ModelPricingService } from "./model-pricing.service.js";

/**
 * no auth, same precedent as `GET /v1/config`: a model catalog isn't
 * account-specific. `available` requires both an active `ModelPricing` row
 * and an active `ProviderApiKey` - missing either means the inference
 * proxy would refuse the call anyway, so it's not worth advertising here.
 */
@Controller("v1/code")
export class ModelsController {
  constructor(
    private readonly pricing: ModelPricingService,
    private readonly providerKeys: ProviderKeysService,
  ) {}

  @Get("models")
  async listModels() {
    const priced = await this.pricing.listActive();
    const providers = [...new Set(priced.map((row) => row.provider))];
    const activeProviders = new Set(
      (await Promise.all(providers.map(async (provider) => ({ provider, active: await this.providerKeys.hasActiveKey(provider) }))))
        .filter((entry) => entry.active)
        .map((entry) => entry.provider),
    );

    return priced.map((row) => ({
      id: row.model,
      label: row.model,
      provider: row.provider.toLowerCase(),
      available: activeProviders.has(row.provider),
    }));
  }
}
