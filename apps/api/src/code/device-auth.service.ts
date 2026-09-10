import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { newId, PaymodError, ERROR_CODES } from "@paymod/shared";
import { PrismaService } from "../common/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { generateCredential, hashCredential, isCredentialMatch, CODE_CREDENTIAL_PREFIX } from "../common/credentials.js";

const DEVICE_CODE_PREFIX_LENGTH = 16;
// Crockford Base32, same alphabet as @paymod/shared's ULIDs: no I, L, O or U,
// so a user code survives being read aloud or transcribed from a screenshot.
const USER_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const EXPIRES_IN_SECONDS = 10 * 60;
const POLL_INTERVAL_SECONDS = 5;

export type DevicePollResult =
  | { status: "pending" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "approved"; credential: string };

/**
 * RFC 8628-style device authorization. `deviceCode` is a bearer secret held
 * by the extension; `userCode` is what a human types into the dashboard to
 * approve or deny the request under `SessionGuard`.
 *
 * The raw credential secret is never persisted: `poll()` mints it and flips
 * the row to CONSUMED in the same call, so a replayed poll can't re-read
 * it. `CodeCredential` stays a separate authority from `WalletCredential`
 * so this flow can never authenticate a financial endpoint.
 */
@Injectable()
export class DeviceAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async start() {
    const deviceCode = generateDeviceCode();
    const userCode = generateUserCode();
    const expiresAt = new Date(Date.now() + EXPIRES_IN_SECONDS * 1000);

    await this.prisma.deviceAuthRequest.create({
      data: {
        id: newId("deviceAuthRequest"),
        deviceCodeHash: deviceCode.hash,
        deviceCodePrefix: deviceCode.prefix,
        userCode,
        expiresAt,
      },
    });

    return {
      deviceCode: deviceCode.secret,
      userCode,
      verificationUri: `${getWebOrigin()}/dashboard/code/activate`,
      expiresIn: EXPIRES_IN_SECONDS,
      interval: POLL_INTERVAL_SECONDS,
    };
  }

  async poll(deviceCode: string): Promise<DevicePollResult> {
    const row = await this.prisma.deviceAuthRequest.findUnique({
      where: { deviceCodePrefix: deviceCode.slice(0, DEVICE_CODE_PREFIX_LENGTH) },
    });
    if (!row || !isCredentialMatch(deviceCode, row.deviceCodeHash)) {
      throw new PaymodError(ERROR_CODES.INVALID_CREDENTIAL, "Unknown device code", { httpStatus: 401 });
    }

    if (row.expiresAt < new Date()) {
      if (row.status === "PENDING" || row.status === "APPROVED") {
        await this.prisma.deviceAuthRequest.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
      }
      return { status: "expired" };
    }

    if (row.status === "PENDING") return { status: "pending" };
    if (row.status === "DENIED") return { status: "denied" };
    if (row.status === "CONSUMED" || row.status === "EXPIRED") return { status: "expired" };

    // APPROVED: claim it exactly once before minting, so two concurrent polls
    // can't both mint a credential for the same request.
    const claimed = await this.prisma.deviceAuthRequest.updateMany({
      where: { id: row.id, status: "APPROVED" },
      data: { status: "CONSUMED" },
    });
    if (claimed.count === 0) return { status: "expired" };

    const credential = generateCredential(CODE_CREDENTIAL_PREFIX);
    await this.prisma.codeCredential.create({
      data: { id: newId("codeCredential"), accountId: row.accountId!, walletId: row.walletId!, prefix: credential.prefix, hash: credential.hash },
    });
    return { status: "approved", credential: credential.secret };
  }

  async approve(accountId: string, userCode: string): Promise<void> {
    const row = await this.requirePendingByUserCode(userCode);
    const wallet = await this.ensureCodingAgentWallet(accountId);

    await this.prisma.deviceAuthRequest.update({
      where: { id: row.id },
      data: { status: "APPROVED", accountId, walletId: wallet.id },
    });
    await this.audit.record({
      accountId,
      actorType: "USER",
      action: "DEVICE_AUTH_APPROVED",
      targetType: "deviceAuthRequest",
      targetId: row.id,
      payload: { walletId: wallet.id },
    });
  }

  async deny(accountId: string, userCode: string): Promise<void> {
    const row = await this.requirePendingByUserCode(userCode);
    await this.prisma.deviceAuthRequest.update({ where: { id: row.id }, data: { status: "DENIED" } });
    await this.audit.record({
      accountId,
      actorType: "USER",
      action: "DEVICE_AUTH_DENIED",
      targetType: "deviceAuthRequest",
      targetId: row.id,
    });
  }

  private async requirePendingByUserCode(userCode: string) {
    const row = await this.prisma.deviceAuthRequest.findUnique({ where: { userCode } });
    if (!row || row.expiresAt < new Date() || row.status !== "PENDING") {
      throw new PaymodError(ERROR_CODES.VALIDATION_FAILED, "This code is invalid, expired or already used", {
        httpStatus: 409,
      });
    }
    return row;
  }

  private async ensureCodingAgentWallet(accountId: string) {
    const existing = await this.prisma.agentWallet.findFirst({ where: { accountId, source: "PAYMOD_CODE" } });
    if (existing) return existing;
    return this.prisma.agentWallet.create({
      data: { id: newId("wallet"), accountId, name: "Paymod Code", status: "CREATING", source: "PAYMOD_CODE" },
    });
  }
}

function getWebOrigin(): string {
  return process.env.WEB_ORIGIN ?? "http://localhost:3000";
}

function generateDeviceCode(): { secret: string; prefix: string; hash: string } {
  const secret = `pmdev_${randomBytes(24).toString("hex")}`;
  return { secret, prefix: secret.slice(0, DEVICE_CODE_PREFIX_LENGTH), hash: hashCredential(secret) };
}

function generateUserCode(): string {
  const bytes = randomBytes(8);
  let raw = "";
  for (let i = 0; i < 8; i++) raw += USER_CODE_ALPHABET[bytes[i]! % 32];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
