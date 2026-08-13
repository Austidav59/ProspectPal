import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import helmet from "helmet";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module";
import type { Environment } from "./config/environment";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Environment, true>);
  const apiPort = config.getOrThrow<number>("API_PORT");
  const webOrigin = config.getOrThrow<string>("WEB_ORIGIN");
  const auth0Domain = config.getOrThrow<string>("AUTH0_DOMAIN");

  app.useLogger(app.get(Logger));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          connectSrc: ["'self'", `https://${auth0Domain}`],
        },
      },
    }),
  );
  app.enableCors({
    credentials: true,
    origin: webOrigin,
  });
  app.enableShutdownHooks();
  app.setGlobalPrefix("api");

  await app.listen(apiPort, "0.0.0.0");
}

void bootstrap();
