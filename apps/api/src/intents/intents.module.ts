import { Module } from "@nestjs/common";
import { IntentsController } from "./intents.controller.js";
import { IntentsService } from "./intents.service.js";
import { CommonModule } from "../common/common.module.js";
import { SettlementModule } from "../settlement/settlement.module.js";
import { ApprovalsModule } from "../approvals/approvals.module.js";

@Module({
  imports: [CommonModule, SettlementModule, ApprovalsModule],
  controllers: [IntentsController],
  providers: [IntentsService],
})
export class IntentsModule {}
