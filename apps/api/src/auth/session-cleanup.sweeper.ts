import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service.js";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * `resolveSession` already rejects an expired session on read (see its own
 * docblock), but it never deletes the row: without this, `sessions`
 * grows by one every login, forever. Same hand-rolled periodic-sweep shape
 * as `SettlementSweeper`.
 */
@Injectable()
export class SessionCleanupSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionCleanupSweeper.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.sweep().catch((err) => this.logger.error(`Session cleanup failed: ${(err as Error).message}`));
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    if (count > 0) this.logger.log(`Deleted ${count} expired session(s)`);
    return count;
  }
}
