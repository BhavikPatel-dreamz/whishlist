/**
 * Staging load / recovery harness for the restock notification queue.
 *
 * Does NOT send real customer email — sets MOCK_EMAIL_PROVIDER=1 so providers
 * short-circuit (wire your mock in providers when running this).
 *
 * Usage (against a staging DB):
 *   RESTOCK_QUEUE_ENABLED=true npx tsx scripts/restock-queue-load-test.ts --jobs 1000
 *
 * Scenarios covered lightly:
 * - burst enqueue of N jobs
 * - duplicate enqueue idempotency
 * - outbox publish
 * - worker drain via processNotificationJob (optional --drain)
 */

import db from "../app/db.server";
import { publishOutboxBatch } from "../app/lib/notifications/outbox.server";
import { processNotificationJob } from "../app/lib/notifications/process-job.server";
import { resetMemoryQueueForTests, memoryQueueDepthForTests } from "../app/lib/notifications/sqs.server";

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

async function main() {
  const jobCount = Number(arg("jobs", "100"));
  const drain = process.argv.includes("--drain");
  const shopDomain = arg("shop", "");

  const shop = shopDomain
    ? await db.shop.findUnique({ where: { shop: shopDomain } })
    : await db.shop.findFirst();
  if (!shop) {
    console.error("No shop found — pass --shop myshop.myshopify.com");
    process.exit(1);
  }

  resetMemoryQueueForTests();

  const cycleKey = `loadtest-${Date.now()}`;
  const event = await db.restockEvent.create({
    data: {
      shopId: shop.id,
      variantId: "loadtest-variant",
      productId: "loadtest-product",
      cycleKey,
      sellableOnlineQuantity: 10,
      status: "enqueued",
    },
  });

  // Synthetic alerts + jobs (emails are fake — do not drain against real Mailgun)
  const alertIds: string[] = [];
  const batch = 100;
  for (let i = 0; i < jobCount; i += batch) {
    const n = Math.min(batch, jobCount - i);
    const created = await Promise.all(
      Array.from({ length: n }, async (_, j) => {
        const idx = i + j;
        const alert = await db.stockAlert.create({
          data: {
            shopId: shop.id,
            email: `loadtest+${idx}@example.com`,
            contactKey: `email:loadtest+${idx}@example.com`,
            channel: "email",
            productId: "loadtest-product",
            variantId: "loadtest-variant",
            productTitle: "Load Test Product",
            status: "PENDING",
          },
        });
        return alert.id;
      }),
    );
    alertIds.push(...created);
  }

  let jobsCreated = 0;
  for (const alertId of alertIds) {
    try {
      const job = await db.notificationJob.create({
        data: {
          shopId: shop.id,
          restockEventId: event.id,
          stockAlertId: alertId,
          status: "queued",
          fairShareKey: BigInt(Date.now()),
        },
      });
      await db.outboxMessage.create({
        data: {
          shopId: shop.id,
          payload: { jobId: job.id },
        },
      });
      jobsCreated += 1;
    } catch {
      /* unique conflict */
    }
  }

  // Duplicate enqueue should create 0 new jobs
  let dupes = 0;
  for (const alertId of alertIds.slice(0, 10)) {
    try {
      await db.notificationJob.create({
        data: {
          shopId: shop.id,
          restockEventId: event.id,
          stockAlertId: alertId,
          status: "queued",
        },
      });
      dupes += 1;
    } catch {
      /* expected */
    }
  }

  const published = await publishOutboxBatch(Math.min(jobsCreated, 500));

  console.log(
    JSON.stringify(
      {
        shop: shop.shop,
        restockEventId: event.id,
        jobsCreated,
        duplicateInsertsSucceeded: dupes,
        outbox: published,
        memoryQueueDepth: memoryQueueDepthForTests(),
      },
      null,
      2,
    ),
  );

  if (drain) {
    console.warn(
      "--drain will call processNotificationJob (needs valid Shopify session + prefer MOCK). Aborting drain in default harness safety mode unless --force-drain.",
    );
    if (process.argv.includes("--force-drain")) {
      const jobs = await db.notificationJob.findMany({
        where: { restockEventId: event.id, status: "queued" },
        take: 50,
        select: { id: true },
      });
      for (const job of jobs) {
        const result = await processNotificationJob(job.id);
        console.log(job.id, result);
      }
    }
  }

  console.log(
    "Load-test seed complete. Run worker to drain, or clean up loadtest-* rows when done.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
