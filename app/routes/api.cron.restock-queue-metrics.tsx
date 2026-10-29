import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import db from "../db.server";
import { timingSafeEqual } from "../lib/crypto.server";

/**
 * Operator metrics for the restock notification queue.
 * Protect with CRON_SECRET. Wire to CloudWatch / Datadog / log scrape as needed.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return json({ ok: false, error: "cron_disabled" }, { status: 503 });
  }
  const provided = (request.headers.get("authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!provided || !timingSafeEqual(provided, secret)) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const [
    queued,
    sending,
    held,
    failed,
    dead,
    sentToday,
    oldestQueued,
    outboxPending,
    rateLimit,
  ] = await Promise.all([
    db.notificationJob.count({ where: { status: "queued" } }),
    db.notificationJob.count({ where: { status: "sending" } }),
    db.notificationJob.count({ where: { status: "held" } }),
    db.notificationJob.count({ where: { status: "failed" } }),
    db.notificationJob.count({ where: { status: "dead" } }),
    db.notificationJob.count({
      where: {
        status: "sent",
        updatedAt: { gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) },
      },
    }),
    db.notificationJob.findFirst({
      where: {
        status: "queued",
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, shopId: true },
    }),
    db.outboxMessage.count({ where: { publishedAt: null } }),
    db.sendRateLimit.findUnique({ where: { id: "global" } }),
  ]);

  const perShop = await db.notificationJob.groupBy({
    by: ["shopId", "status"],
    where: { status: { in: ["queued", "sending", "held"] } },
    _count: { _all: true },
  });

  const oldestAgeMs = oldestQueued
    ? Date.now() - oldestQueued.createdAt.getTime()
    : 0;

  const alerts = {
    oldestQueuedOver5m: oldestAgeMs > 5 * 60 * 1000,
    deadNonzero: dead > 0,
    outboxBacklog: outboxPending > 100,
  };

  return json({
    ok: true,
    queue: { queued, sending, held, failed, dead, sentToday },
    oldestQueuedAgeMs: oldestAgeMs,
    outboxPending,
    rateLimit,
    perShop,
    alerts,
  });
};
