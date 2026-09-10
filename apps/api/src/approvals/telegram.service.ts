import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { forwardRef, Inject, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { getCredentialPrefix, hashCredential, isCredentialMatch } from "../common/credentials.js";
import { PrismaService } from "../common/prisma.service.js";
import { newId } from "@paymod/shared";
import { ApprovalService } from "./approval.service.js";
import { X402Service } from "../x402/x402.service.js";

const LINK_TTL_MS = 10 * 60 * 1000;

type TelegramUser = { id: number; username?: string; first_name?: string };
type TelegramMessage = { chat: { id: number }; text?: string; from?: TelegramUser };
type TelegramCallback = { id: string; from: TelegramUser; data?: string; message?: TelegramMessage };
type TelegramUpdate = { message?: TelegramMessage; callback_query?: TelegramCallback };

function asUpdate(value: unknown): TelegramUpdate {
  return value && typeof value === "object" ? (value as TelegramUpdate) : {};
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalService,
    @Inject(forwardRef(() => X402Service)) private readonly x402: X402Service,
  ) {}

  async createLink(accountId: string) {
    const username = this.requireEnv("PAYMOD_TELEGRAM_BOT_USERNAME");
    const secret = `pmtg_${randomBytes(24).toString("hex")}`;
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await this.prisma.telegramLinkRequest.create({
      data: {
        id: newId("telegramLink"),
        accountId,
        tokenPrefix: getCredentialPrefix(secret),
        tokenHash: hashCredential(secret),
        expiresAt,
      },
    });
    return { url: `https://t.me/${username}?start=${secret}`, expiresAt };
  }

  async getConnection(accountId: string) {
    return this.prisma.telegramConnection.findUnique({
      where: { accountId },
      select: { username: true, firstName: true, connectedAt: true },
    });
  }

  async disconnect(accountId: string): Promise<void> {
    await this.prisma.telegramConnection.deleteMany({ where: { accountId } });
  }

  async notifyApproval(intentId: string): Promise<void> {
    try {
      const approval = await this.prisma.approvalRequest.findUnique({
        where: { intentId },
        include: { intent: { include: { wallet: true } }, account: { include: { telegramConnection: true } } },
      });
      const connection = approval?.account.telegramConnection;
      if (!approval || approval.status !== "PENDING" || !connection) return;
      const amount = formatAmount(approval.intent.atomicAmount.toFixed(0));
      const text = [
        "Paymod approval required",
        `Wallet: ${approval.intent.wallet.name}`,
        `Amount: ${amount} ${approval.intent.assetCode}`,
        `Destination: ${approval.intent.destination}`,
        approval.intent.purpose ? `Purpose: ${approval.intent.purpose}` : undefined,
      ].filter(Boolean).join("\n");
      const result = await this.call<{ result: { message_id: number } }>("sendMessage", {
        chat_id: connection.chatId,
        text,
        reply_markup: {
          inline_keyboard: [[
            { text: "Approve", callback_data: this.callbackData(approval.id, "approve") },
            { text: "Deny", callback_data: this.callbackData(approval.id, "deny") },
          ]],
        },
      });
      await this.prisma.approvalRequest.updateMany({
        where: { id: approval.id, status: "PENDING" },
        data: { telegramChatId: connection.chatId, telegramMessageId: String(result.result.message_id) },
      });
    } catch (error) {
      this.logger.error(`Could not deliver Telegram approval for ${intentId}: ${(error as Error).message}`);
    }
  }

  async handleWebhook(secret: string | undefined, body: unknown): Promise<void> {
    const expected = this.requireEnv("PAYMOD_TELEGRAM_WEBHOOK_SECRET");
    if (!secret || !secureEqual(secret, expected)) throw new UnauthorizedException("Invalid Telegram webhook secret");
    const update = asUpdate(body);
    if (update.message?.text?.startsWith("/start ") && update.message.from) {
      await this.consumeLink(update.message.text.slice(7).trim(), update.message.chat.id, update.message.from);
      return;
    }
    if (update.callback_query) await this.handleCallback(update.callback_query);
  }

  private async consumeLink(token: string, chatId: number, user: TelegramUser): Promise<void> {
    const link = await this.prisma.telegramLinkRequest.findUnique({ where: { tokenPrefix: getCredentialPrefix(token) } });
    if (!link || link.consumedAt || link.expiresAt <= new Date() || !isCredentialMatch(token, link.tokenHash)) {
      await this.sendMessage(chatId, "This Paymod connection link is invalid or has expired.");
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.telegramLinkRequest.updateMany({
        where: { id: link.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) return;
      await tx.telegramConnection.upsert({
        where: { accountId: link.accountId },
        create: { id: newId("telegramConnection"), accountId: link.accountId, telegramUserId: String(user.id), chatId: String(chatId), username: user.username, firstName: user.first_name },
        update: { telegramUserId: String(user.id), chatId: String(chatId), username: user.username, firstName: user.first_name },
      });
    });
    await this.sendMessage(chatId, "Paymod approvals are connected. I will ask here when a payment needs your approval.");
  }

  private async handleCallback(callback: TelegramCallback): Promise<void> {
    const parsed = this.parseCallback(callback.data);
    if (!parsed || !callback.message) return this.answerCallback(callback.id, "Invalid approval action.", true);
    const approval = await this.prisma.approvalRequest.findUnique({ where: { id: parsed.id }, include: { intent: { include: { wallet: true } } } });
    const connection = approval && await this.prisma.telegramConnection.findUnique({ where: { accountId: approval.accountId } });
    if (!approval || !connection || connection.telegramUserId !== String(callback.from.id) || connection.chatId !== String(callback.message.chat.id)) {
      return this.answerCallback(callback.id, "This approval is not assigned to you.", true);
    }
    try {
      if (parsed.action === "approve") {
        const resolved = await this.approvals.approve(parsed.id, approval.accountId, String(callback.from.id));
        if (resolved.type === "X402_PAYMENT") await this.x402.resume(resolved.intentId);
      } else await this.approvals.deny(parsed.id, approval.accountId, String(callback.from.id));
      await this.clearApprovalActions(callback.message.chat.id, approval.telegramMessageId);
      await this.sendMessage(
        callback.message.chat.id,
        parsed.action === "approve"
          ? `${approval.intent.wallet.name}: ${formatAmount(approval.intent.atomicAmount.toFixed(0))} ${approval.intent.assetCode} approved. Settlement has started.`
          : `${approval.intent.wallet.name}: ${formatAmount(approval.intent.atomicAmount.toFixed(0))} ${approval.intent.assetCode} denied. No funds moved.`,
      );
      await this.answerCallback(callback.id, parsed.action === "approve" ? "Payment approved." : "Payment denied.");
    } catch (error) {
      await this.answerCallback(callback.id, (error as Error).message, true);
    }
  }

  private callbackData(id: string, action: "approve" | "deny"): string {
    return `${action}:${id}:${this.sign(`${action}:${id}`)}`;
  }

  private parseCallback(data: string | undefined): { id: string; action: "approve" | "deny" } | undefined {
    const [action, id, signature, ...extra] = data?.split(":") ?? [];
    if (extra.length || (action !== "approve" && action !== "deny") || !id || !signature || !secureEqual(signature, this.sign(`${action}:${id}`))) return undefined;
    return { id, action };
  }

  private sign(value: string): string {
    return createHmac("sha256", this.requireEnv("PAYMOD_TELEGRAM_CALLBACK_SECRET")).update(value).digest("base64url").slice(0, 16);
  }

  private async answerCallback(id: string, text: string, showAlert = false): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: id, text, show_alert: showAlert });
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    await this.call("sendMessage", { chat_id: String(chatId), text });
  }

  private async clearApprovalActions(chatId: number, messageId: string | null): Promise<void> {
    if (!messageId) return;
    await this.call("editMessageReplyMarkup", { chat_id: String(chatId), message_id: Number(messageId), reply_markup: { inline_keyboard: [] } });
  }

  private async call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    const token = this.requireEnv("PAYMOD_TELEGRAM_BOT_TOKEN");
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Telegram ${method} failed (${response.status})`);
    return response.json() as Promise<T>;
  }

  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new ServiceUnavailableException(`${name} is not configured`);
    return value;
  }
}

function formatAmount(atomicAmount: string): string {
  const padded = atomicAmount.padStart(8, "0");
  const whole = padded.slice(0, -7);
  const fraction = padded.slice(-7).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
