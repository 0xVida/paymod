import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";

export const SETTLEMENT_QUEUE_NAME = "settlement";

export type SettlementJobData = { intentId: string };

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return { host: url.hostname, port: Number(url.port || 6379) };
}

/**
 * Postgres remains the source of truth for intent state; this queue is only
 * the trigger. Enqueue after the creating transaction commits, never inside
 * it: a job that fires before the row is visible would find nothing to
 * claim.
 */
@Injectable()
export class SettlementQueue implements OnModuleDestroy {
  private readonly queue = new Queue<SettlementJobData>(SETTLEMENT_QUEUE_NAME, {
    connection: redisConnection(),
  });

  async enqueue(intentId: string): Promise<void> {
    await this.queue.add("settle", { intentId }, { jobId: intentId, removeOnComplete: 1000, removeOnFail: 1000 });
  }

  /**
   * used by the sweeper to retry a stuck intent. Deliberately no fixed jobId:
   * a completed/failed job with the same intentId would make a duplicate
   * jobId a no-op. Double-processing safety comes from the claim lease and
   * the deterministic on-chain payment id, not queue-level dedup.
   */
  async enqueueRetry(intentId: string): Promise<void> {
    await this.queue.add("settle", { intentId }, { removeOnComplete: 1000, removeOnFail: 1000 });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
