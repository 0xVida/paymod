import { Injectable } from "@nestjs/common";
import type { InferenceProvider } from "@paymod/database";
import { ERROR_CODES, PaymodError, newId } from "@paymod/shared";
import { PrismaService } from "../common/prisma.service.js";
import { encryptSecret, decryptSecret } from "../common/secret-encryption.js";

export type ProviderKeySummary = {
  id: string;
  provider: InferenceProvider;
  label: string;
  isActive: boolean;
  createdAt: Date;
  revokedAt: Date | null;
};

/**
 * Replaces the old env-var key lookup (`provider-keys.ts`, deleted)
 * without changing the inference proxy's shape - only where the real key
 * comes from. Encrypted at rest with the same AES-256-GCM
 * `secret-encryption.ts` utility used for `CodeDepositAddress`. Raw key
 * shown once at creation, never again, same as `WalletCredential`.
 */
@Injectable()
export class ProviderKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /** most-recently-created active key wins, for the rare case a provider has more than one (rotation in progress). Throws the same domain error the inference proxy already needs to surface as "this model isn't currently servable" - a provider with no active key isn't a 500, it's a known, expected state. */
  async resolveActiveKey(provider: InferenceProvider): Promise<string> {
    const row = await this.prisma.providerApiKey.findFirst({
      where: { provider, isActive: true, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!row) {
      throw new PaymodError(ERROR_CODES.MODEL_NOT_AVAILABLE, `No active ${provider} provider key is configured.`, { httpStatus: 503 });
    }
    return decryptSecret(row.encryptedKey);
  }

  async hasActiveKey(provider: InferenceProvider): Promise<boolean> {
    const row = await this.prisma.providerApiKey.findFirst({ where: { provider, isActive: true, revokedAt: null }, select: { id: true } });
    return row !== null;
  }

  async create(provider: InferenceProvider, label: string, rawKey: string): Promise<ProviderKeySummary> {
    const row = await this.prisma.providerApiKey.create({
      data: { id: newId("providerApiKey"), provider, label, encryptedKey: encryptSecret(rawKey), isActive: true },
    });
    return toSummary(row);
  }

  async list(): Promise<ProviderKeySummary[]> {
    const rows = await this.prisma.providerApiKey.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map(toSummary);
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.providerApiKey.update({ where: { id }, data: { isActive: false, revokedAt: new Date() } });
  }
}

function toSummary(row: { id: string; provider: InferenceProvider; label: string; isActive: boolean; createdAt: Date; revokedAt: Date | null }): ProviderKeySummary {
  return { id: row.id, provider: row.provider, label: row.label, isActive: row.isActive, createdAt: row.createdAt, revokedAt: row.revokedAt };
}
