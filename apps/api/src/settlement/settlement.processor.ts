import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Worker, type Job } from "bullmq";
import { SETTLEMENT_QUEUE_NAME, type SettlementJobData } from "./settlement.queue.js";
import { SettlementService } from "./settlement.service.js";

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return { host: url.hostname, port: Number(url.port || 6379) };
}

@Injectable()
export class SettlementProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettlementProcessor.name);
  private worker: Worker<SettlementJobData> | undefined;

  constructor(private readonly settlement: SettlementService) {}

  onModuleInit() {
    this.worker = new Worker<SettlementJobData>(
      SETTLEMENT_QUEUE_NAME,
      async (job: Job<SettlementJobData>) => {
        await this.settlement.processIntent(job.data.intentId);
      },
      { connection: redisConnection(), concurrency: 4 },
    );
    this.worker.on("failed", (job, err) => {
      this.logger.error(`Job for intent ${job?.data.intentId} failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
