import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service.js";
import { BootstrapOrAccountGuard } from "../common/bootstrap-or-account.guard.js";

const DEFAULT_LIMIT = 100;

@Controller("v1")
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("audit")
  @UseGuards(BootstrapOrAccountGuard)
  async list(@Query("accountId") accountId: string) {
    const events = await this.prisma.auditEvent.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      take: DEFAULT_LIMIT,
    });
    return { events };
  }
}
