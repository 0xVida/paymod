import { forwardRef, Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module.js";
import { SettlementModule } from "../settlement/settlement.module.js";
import { X402Module } from "../x402/x402.module.js";
import { ApprovalService } from "./approval.service.js";
import { ApprovalsController } from "./approvals.controller.js";
import { TelegramService } from "./telegram.service.js";

@Module({
  imports: [CommonModule, SettlementModule, forwardRef(() => X402Module)],
  controllers: [ApprovalsController],
  providers: [ApprovalService, TelegramService],
  exports: [ApprovalService, TelegramService],
})
export class ApprovalsModule {}
