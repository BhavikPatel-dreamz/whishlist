/**
 * Long-running restock notification worker.
 *
 * Usage: `npm run worker:restock`
 *
 * Free path (no AWS): polls PostgreSQL `NotificationJob` with fair-share.
 * Paid path: also drains Amazon SQS when `AWS_SQS_QUEUE_URL` is set.
 */

import { publishOutboxBatch } from "../lib/notifications/outbox.server";
import {
  getNotificationQueue,
  isExternalQueueConfigured,
} from "../lib/notifications/sqs.server";
import {
  peekFairShareJobIds,
  processNotificationJob,
} from "../lib/notifications/process-job.server";
import { configureSendRate } from "../lib/notifications/rate-limit-send.server";
import {
  rollupToday,
  rollupYesterday,
} from "../jobs/daily-stat-rollup.server";

const useSqs = isExternalQueueConfigured();
const CONCURRENCY = Number(
  process.env.RESTOCK_WORKER_CONCURRENCY || (useSqs ? 10 : 5),
);
const POLL_WAIT_SEC = Number(process.env.RESTOCK_WORKER_POLL_WAIT || 10);
const OUTBOX_EVERY_MS = 5_000;
/** Analytics rollup for "today" — replaces Vercel hourly cron on Hobby. */
const ROLLUP_TODAY_EVERY_MS = Number(
  process.env.ROLLUP_TODAY_EVERY_MS || 60 * 60 * 1000,
);
const DEFAULT_RATE = Number(
  process.env.RESTOCK_SEND_RATE || (useSqs ? 20 : 5),
);
/** Run side jobs (rollups) on this worker. Set WORKER_SIDE_JOBS=0 to disable. */
const sideJobsEnabled = process.env.WORKER_SIDE_JOBS !== "0";

let shuttingDown = false;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function handleJobId(jobId: string): Promise<"done" | "retry"> {
  const result = await processNotificationJob(jobId);
  if (
    result.status === "sent" ||
    result.status === "held" ||
    result.status === "dead" ||
    result.status === "skipped"
  ) {
    return "done";
  }
  const wait =
    "retryAfterMs" in result ? Math.min(result.retryAfterMs, 30_000) : 1000;
  await sleep(wait);
  return "retry";
}

async function drainSqs(): Promise<number> {
  if (!useSqs) return 0;
  const queue = await getNotificationQueue();
  const messages = await queue.receive(CONCURRENCY, POLL_WAIT_SEC);
  if (!messages.length) return 0;

  let handled = 0;
  await Promise.all(
    messages.map(async (msg) => {
      try {
        const outcome = await handleJobId(msg.body.jobId);
        if (outcome === "done") {
          await queue.delete(msg.receiptHandle);
          handled += 1;
        }
      } catch (error) {
        console.error(`[worker] job ${msg.body.jobId} crashed`, error);
      }
    }),
  );
  return handled;
}

/** Primary drain on the free path: claim due jobs from Postgres. */
async function drainFairShare(): Promise<number> {
  const jobIds = await peekFairShareJobIds(Math.min(CONCURRENCY, 10));
  if (!jobIds.length) return 0;
  let handled = 0;
  await Promise.all(
    jobIds.map(async (jobId) => {
      try {
        const result = await processNotificationJob(jobId);
        if (
          result.status === "sent" ||
          result.status === "held" ||
          result.status === "dead" ||
          result.status === "skipped"
        ) {
          handled += 1;
        } else if (
          result.status === "rate_limited" ||
          result.status === "retry"
        ) {
          const wait =
            "retryAfterMs" in result
              ? Math.min(result.retryAfterMs, 5_000)
              : 500;
          await sleep(wait);
        }
      } catch (error) {
        console.error(`[worker] fair-share job ${jobId} crashed`, error);
      }
    }),
  );
  return handled;
}

async function main(): Promise<void> {
  console.log(
    `[worker] restock worker starting mode=${useSqs ? "sqs" : "postgres"} concurrency=${CONCURRENCY} rate=${DEFAULT_RATE}/s`,
  );

  try {
    await configureSendRate({ refillPerSec: DEFAULT_RATE, maxTokens: DEFAULT_RATE });
  } catch (error) {
    console.warn("[worker] could not configure send rate", error);
  }

  let lastOutbox = 0;
  let lastRollupToday = 0;
  let lastYesterdayKey = "";

  while (!shuttingDown) {
    try {
      const now = Date.now();
      if (now - lastOutbox > OUTBOX_EVERY_MS) {
        const pub = await publishOutboxBatch(100);
        if (pub.published || pub.failed) {
          console.log(
            `[worker] outbox mode=${pub.mode} published=${pub.published} failed=${pub.failed}`,
          );
        }
        lastOutbox = now;
      }

      // Hobby Vercel has no hourly crons — Fly worker owns analytics rollups.
      if (sideJobsEnabled) {
        if (now - lastRollupToday > ROLLUP_TODAY_EVERY_MS) {
          try {
            const result = await rollupToday();
            console.log(
              `[worker] rollupToday shops=${result.shops} rows=${result.rowsUpserted} errors=${result.errors.length}`,
            );
          } catch (error) {
            console.error("[worker] rollupToday failed", error);
          }
          lastRollupToday = now;
        }

        const utcDay = new Date().toISOString().slice(0, 10);
        const utcHour = new Date().getUTCHours();
        // Once after 00:15 UTC each day
        if (utcHour === 0 && lastYesterdayKey !== utcDay) {
          const minute = new Date().getUTCMinutes();
          if (minute >= 15) {
            try {
              const result = await rollupYesterday();
              console.log(
                `[worker] rollupYesterday shops=${result.shops} rows=${result.rowsUpserted} errors=${result.errors.length}`,
              );
              lastYesterdayKey = utcDay;
            } catch (error) {
              console.error("[worker] rollupYesterday failed", error);
            }
          }
        }
      }

      if (useSqs) {
        const fromSqs = await drainSqs();
        if (fromSqs === 0) {
          const fromDb = await drainFairShare();
          if (fromDb === 0) await sleep(500);
        }
      } else {
        const fromDb = await drainFairShare();
        if (fromDb === 0) await sleep(1000);
      }
    } catch (error) {
      console.error("[worker] loop error", error);
      await sleep(2000);
    }
  }

  console.log("[worker] shutdown complete");
}

process.on("SIGINT", () => {
  shuttingDown = true;
});
process.on("SIGTERM", () => {
  shuttingDown = true;
});

main().catch((error) => {
  console.error("[worker] fatal", error);
  process.exit(1);
});
