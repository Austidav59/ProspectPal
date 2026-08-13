import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ServeStaticModule } from "@nestjs/serve-static";
import { LoggerModule } from "nestjs-pino";

import { AuthModule } from "./auth/auth.module";
import { BusinessesModule } from "./businesses/businesses.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
import { validateEnvironment } from "./config/environment";
import { DatabaseModule } from "./database/database.module";
import { EmailCampaignsModule } from "./email-campaigns/email-campaigns.module";
import { EmailModule } from "./email/email.module";
import { HealthController } from "./health/health.controller";
import { SettingsModule } from "./settings/settings.module";

function resolveEnvFiles(): string[] {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
    resolve(__dirname, "../../../../.env"),
  ];

  return [...new Set(candidates.filter((path) => existsSync(path)))];
}

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: resolveEnvFiles(),
      isGlobal: true,
      validate: validateEnvironment,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        redact: {
          paths: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
          censor: "[REDACTED]",
        },
      },
    }),
    ServeStaticModule.forRoot({
      rootPath: resolve(__dirname, "../../Frontend/dist"),
      exclude: ["/api/{*path}"],
    }),
    DatabaseModule,
    AuthModule,
    CampaignsModule,
    BusinessesModule,
    SettingsModule,
    EmailModule,
    EmailCampaignsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
