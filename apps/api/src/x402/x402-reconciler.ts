import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service.js";
import { X402Service } from "./x402.service.js";

const INTERVAL_MS = 30_000;
const STALE_MS = 2 * 60_000;

@Injectable()
export class X402Reconciler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(X402Reconciler.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly prisma: PrismaService, private readonly x402: X402Service) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<string[]> {
    const intents = await this.prisma.financialIntent.findMany({
      where: { type: "X402_PAYMENT", status: "PROCESSING", lockedAt: { lt: new Date(Date.now() - STALE_MS) } },
      select: { id: true },
    });
    const reconciled: string[] = [];
    for (const intent of intents) {
      try {
        const result = await this.x402.reconcileUnknown(intent.id);
        if (result !== "SKIPPED") reconciled.push(intent.id);
      } catch (error) {
        this.logger.warn(`Could not reconcile ${intent.id}: ${(error as Error).message}`);
      }
    }
    return reconciled;
  }
}
