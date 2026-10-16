import db from "../db.server";
import { ProxyError } from "./proxy.server";

/**
 * Fixed-window rate limiter backed by Postgres so limits hold across app instances.
 * The unique (key, windowStart) index makes the increment atomic: concurrent requests
 * either create the row or bump the counter, never both.
 */
export async function rateLimit(options: {
  key: string;
  limit: number;
  windowSeconds: number;
  shopId?: string | null;
  message?: string;
}): Promise<void> {
  const { key, limit, windowSeconds, shopId = null } = options;
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000);

  const bucket = await db.rateLimitBucket.upsert({
    where: { key_windowStart: { key, windowStart } },
    create: { key, windowStart, count: 1, shopId },
    update: { count: { increment: 1 } },
    select: { count: true },
  });

  if (bucket.count > limit) {
    const retryAfter = Math.ceil((windowStart.getTime() + windowSeconds * 1000 - now) / 1000);
    throw new ProxyError(
      429,
      options.message || `Too many requests. Try again in ${retryAfter}s.`,
      "rate_limited",
    );
  }
}

/** Housekeeping: drop buckets older than an hour. Called opportunistically from webhooks. */
export async function pruneRateLimits(): Promise<void> {
  await db.rateLimitBucket.deleteMany({
    where: { windowStart: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
}
