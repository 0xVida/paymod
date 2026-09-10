import { HttpStatus, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

type Bucket = { count: number; resetAt: number };

const GENERAL_WINDOW_MS = 60_000;
const GENERAL_LIMIT = 120;
const AUTH_WINDOW_MS = 15 * 60_000;
const AUTH_LIMIT = 30;

@Injectable()
export class ApiRateLimitMiddleware implements NestMiddleware {
  private readonly buckets = new Map<string, Bucket>();

  use(req: Request, res: Response, next: NextFunction) {
    if (req.path === "/health" || req.path === "/v1/approvals/telegram/webhook") return next();
    const isAuthWrite = req.path.startsWith("/v1/auth/") && req.method !== "GET";
    const windowMs = isAuthWrite ? AUTH_WINDOW_MS : GENERAL_WINDOW_MS;
    const limit = isAuthWrite ? AUTH_LIMIT : GENERAL_LIMIT;
    const key = `${isAuthWrite ? "auth" : "api"}:${req.ip}`;
    const now = Date.now();
    const bucket = this.buckets.get(key);
    const current = !bucket || bucket.resetAt <= now ? { count: 0, resetAt: now + windowMs } : bucket;

    current.count += 1;
    this.buckets.set(key, current);
    res.setHeader("RateLimit-Limit", limit);
    res.setHeader("RateLimit-Remaining", Math.max(0, limit - current.count));
    res.setHeader("RateLimit-Reset", Math.ceil(current.resetAt / 1000));
    if (current.count > limit) {
      res.setHeader("Retry-After", Math.ceil((current.resetAt - now) / 1000));
      return res.status(HttpStatus.TOO_MANY_REQUESTS).json({ error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." } });
    }
    next();
  }
}
