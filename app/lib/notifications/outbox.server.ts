import db from "../../db.server";
import { getNotificationQueue, isExternalQueueConfigured } from "./sqs.server";

export type OutboxPayload = { jobId: string };

/**
 * Publish unpublished outbox rows.
 *
 * - With AWS SQS: push `{ jobId }` to the queue.
 * - Without AWS (free path): mark rows published immediately — the Fly/Postgres
 *   worker polls `NotificationJob` directly, so SQS is optional.
 */
export async function publishOutboxBatch(limit = 100): Promise<{
  published: number;
  failed: number;
  mode: "sqs" | "postgres";
}> {
  const rows = await db.outboxMessage.findMany({
    where: { publishedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  if (!rows.length) return { published: 0, failed: 0, mode: isExternalQueueConfigured() ? "sqs" : "postgres" };

  if (!isExternalQueueConfigured()) {
    await db.outboxMessage.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { publishedAt: new Date(), lastError: null },
    });
    return { published: rows.length, failed: 0, mode: "postgres" };
  }

  const queue = await getNotificationQueue();
  let published = 0;
  let failed = 0;

  for (const row of rows) {
    const payload = row.payload as OutboxPayload;
    if (!payload?.jobId) {
      await db.outboxMessage.update({
        where: { id: row.id },
        data: {
          attempts: { increment: 1 },
          lastError: "invalid payload: missing jobId",
          publishedAt: new Date(),
        },
      });
      failed += 1;
      continue;
    }
    try {
      await queue.send({ jobId: payload.jobId });
      await db.outboxMessage.update({
        where: { id: row.id },
        data: { publishedAt: new Date(), lastError: null },
      });
      published += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.outboxMessage.update({
        where: { id: row.id },
        data: {
          attempts: { increment: 1 },
          lastError: message.slice(0, 500),
        },
      });
      failed += 1;
      console.error(`[outbox] publish failed for ${row.id}: ${message}`);
    }
  }

  return { published, failed, mode: "sqs" };
}
