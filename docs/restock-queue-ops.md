# Restock queue — ops cheat sheet

## Free path (recommended if you have no AWS)

No SQS / ECS. Same `NotificationJob` tables; worker polls Postgres.

| Piece | Free choice |
|---|---|
| App + webhooks | Existing **Vercel** |
| Durable queue | **PostgreSQL** `NotificationJob` |
| Worker | **Fly.io** free allowance (`fly.toml` + `Dockerfile.worker`) |
| Send rate | **5 emails/s** (`RESTOCK_SEND_RATE=5`) |
| Email | Existing **Mailgun** |

### Deploy Fly worker

```bash
fly apps create wishlist-restock-worker   # once
fly secrets set DATABASE_URL="..." \
  DEFAULT_EMAIL_API_KEY="..." \
  DEFAULT_SENDER_EMAIL="..." \
  SHOPIFY_API_KEY="..." \
  SHOPIFY_API_SECRET="..." \
  APP_ENCRYPTION_KEY="..." \
  # plus any other secrets your app needs for Mailgun / sessions
fly deploy --config fly.toml --dockerfile Dockerfile.worker
```

Do **not** set `AWS_SQS_QUEUE_URL`. Outbox rows are marked published without SQS; the worker drains jobs from the DB.

On Vercel set `RESTOCK_QUEUE_ENABLED=true` (or enable `Shop.restockQueueEnabled` per store).

Expect ~5.5 hours for a 100k burst at 5/s — fine for correctness, not the paid 20/s target.

## Paid path (optional later)

| Lever | Effect |
|---|---|
| `AWS_SQS_QUEUE_URL` + `AWS_REGION` | Real SQS |
| Terraform | [`infra/restock-queue/`](../infra/restock-queue/) |
| Rate | `RESTOCK_SEND_RATE=20`, concurrency 10 |

## Enable flags

| Lever | Effect |
|---|---|
| `RESTOCK_QUEUE_ENABLED=true` | All shops enqueue (no inline Mailgun in webhooks) |
| `Shop.restockQueueEnabled` | Per-shop opt-in |
| `RESTOCK_WORKER_CONCURRENCY` | In-flight sends (default 5 free / 10 SQS) |
| `RESTOCK_SEND_RATE` | Global emails/sec (default 5 free / 20 SQS) |

## Vercel Hobby = no frequent crons

Vercel Hobby only allows **once-daily** Cron Jobs. This app’s `vercel.json` has **`crons: []`** so deploys succeed on free Vercel.

The **Fly worker** runs instead:

| Job | When |
|---|---|
| Outbox / job drain | Continuous |
| `rollupToday` | Every hour (`ROLLUP_TODAY_EVERY_MS`) |
| `rollupYesterday` | After 00:15 UTC daily |
| Disable side jobs | `WORKER_SIDE_JOBS=0` |

HTTP cron routes (`/api/cron/...`) still work if you call them manually or from a free external scheduler (e.g. cron-job.org) with `Authorization: Bearer $CRON_SECRET`.

## Processes

| Process | Command / route |
|---|---|
| Worker | `npm run worker:restock` or Fly deploy |
| Metrics (manual) | `GET /api/cron/restock-queue-metrics` |
| Load seed | `npm run loadtest:restock-queue -- --jobs 1000` |

## Alerts (metrics JSON `alerts`)

- `oldestQueuedOver5m` — backlog aging  
- `deadNonzero` — exhausted jobs  
- `outboxBacklog` — publish lag (mainly relevant with SQS)
