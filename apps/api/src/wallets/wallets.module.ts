import { Module } from "@nestjs/common";
import { WalletsController } from "./wallets.controller.js";
import { CommonModule } from "../common/common.module.js";
import { circleWalletRailProvider } from "../settlement/circle-rail.provider.js";

@Module({
  imports: [CommonModule],
  controllers: [WalletsController],
  providers: [circleWalletRailProvider],
})
export class WalletsModule {}
