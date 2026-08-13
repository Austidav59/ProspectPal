import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: "ok"; database: "up" }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", database: "up" };
    } catch {
      throw new ServiceUnavailableException("The database is unavailable");
    }
  }
}
