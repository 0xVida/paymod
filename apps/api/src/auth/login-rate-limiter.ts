import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

type Bucket = { count: number; windowStart: number };

/**
 * fixed window keyed by email, not IP: the account is the resource under
 * attack and an IP is trivial to rotate. In-memory and per-process, so a
 * multi-instance deployment would need a shared store instead.
 */
@Injectable()
export class LoginRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  checkAndRecord(email: string): void {
    const key = email.toLowerCase();
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return;
    }

    if (bucket.count >= MAX_ATTEMPTS) {
      throw new HttpException("Too many login attempts. Try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }
    bucket.count += 1;
  }

  reset(email: string): void {
    this.buckets.delete(email.toLowerCase());
  }
}
