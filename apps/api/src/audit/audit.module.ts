import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module.js";
import { AuditController } from "./audit.controller.js";

@Module({
  imports: [CommonModule],
  controllers: [AuditController],
})
export class AuditModule {}
