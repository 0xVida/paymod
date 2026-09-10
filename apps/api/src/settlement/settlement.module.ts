import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module.js";
import { SettlementQueue } from "./settlement.queue.js";
import { SettlementService } from "./settlement.service.js";
import { SettlementProcessor } from "./settlement.processor.js";
import { SettlementSweeper } from "./settlement.sweeper.js";
import { circlePaymentRailProvider } from "./circle-rail.provider.js";

@Module({
  imports: [CommonModule],
  providers: [SettlementQueue, SettlementService, SettlementProcessor, SettlementSweeper, circlePaymentRailProvider],
  exports: [SettlementQueue],
})
export class SettlementModule {}
