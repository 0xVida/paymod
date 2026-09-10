import "reflect-metadata";
import cookieParser from "cookie-parser";
import { json, urlencoded } from "express";
import type { NextFunction, Request, Response } from "express";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { PaymodErrorFilter } from "./common/paymod-error.filter.js";

// Express's stock body-parser default (100kb) is far too small for a
// Paymod Code conversation forwarded through the inference proxy - a
// single turn's history routinely reaches hundreds of KB. `bodyParser:
// false` disables Nest's own 100kb-limited parser so this larger one is
// the only one that runs.
const REQUEST_BODY_SIZE_LIMIT = "10mb";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: false, bodyParser: false });
  app.use(json({ limit: REQUEST_BODY_SIZE_LIMIT }));
  app.use(urlencoded({ extended: true, limit: REQUEST_BODY_SIZE_LIMIT }));
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.use(cookieParser());
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: true });
  app.useGlobalFilters(new PaymodErrorFilter(app.get(HttpAdapterHost)));
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`Paymod API listening on :${port}`);
}

bootstrap();
