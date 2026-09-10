import { Module } from "@nestjs/common";
import { PoliciesController } from "./policies.controller.js";
import { CommonModule } from "../common/common.module.js";

@Module({
  imports: [CommonModule],
  controllers: [PoliciesController],
})
export class PoliciesModule {}
