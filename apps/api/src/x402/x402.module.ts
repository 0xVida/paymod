import { forwardRef, Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module.js";
import { ApprovalsModule } from "../approvals/approvals.module.js";
import { X402Controller } from "./x402.controller.js";
import { X402Service } from "./x402.service.js";
import { stellarX402SignerProvider } from "./stellar-x402.provider.js";
import { circleX402SignerProvider } from "./circle-x402.provider.js";
import { X402Reconciler } from "./x402-reconciler.js";

@Module({
  imports: [CommonModule, forwardRef(() => ApprovalsModule)],
  controllers: [X402Controller],
  providers: [X402Service, X402Reconciler, stellarX402SignerProvider, circleX402SignerProvider],
  exports: [X402Service],
})
export class X402Module {}
