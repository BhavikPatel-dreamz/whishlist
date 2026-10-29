# Restock notification queue (SQS + ECS)

Terraform for the production capacity plan: SQS Standard + DLQ, ECS Fargate workers (2–10), IAM, CloudWatch logs, SQS-depth autoscaling.

## Prerequisites

- AWS account, VPC, private subnets
- ECR image built from repo root `Dockerfile.worker`
- Secrets Manager secret whose value is the Postgres `DATABASE_URL`
- Mailgun / app secrets also available to the task (extend `container_definitions.secrets` as needed)

## Apply

```bash
cd infra/restock-queue
terraform init
terraform apply \
  -var="vpc_id=vpc-..." \
  -var='private_subnet_ids=["subnet-a","subnet-b"]' \
  -var="worker_image=123.dkr.ecr.us-east-1.amazonaws.com/wishlist-restock-worker:latest" \
  -var="database_url_secret_arn=arn:aws:secretsmanager:..."
```

Copy `sqs_queue_url` into the Vercel app env as `AWS_SQS_QUEUE_URL`, set `AWS_REGION`, and grant the Vercel runtime IAM (or access keys) `sqs:SendMessage` on that queue.

Set `RESTOCK_QUEUE_ENABLED=true` (or enable `Shop.restockQueueEnabled` per store) so webhooks enqueue instead of sending inline.

## Verify

1. Trigger a restock on a flagged shop → `NotificationJob` + `OutboxMessage` rows appear.
2. `/api/cron/publish-outbox` (or worker) publishes to SQS.
3. ECS workers drain; `/api/cron/restock-queue-metrics` shows queue depth / oldest age.
4. Run `npm run loadtest:restock-queue -- --jobs 1000` on staging DB (no real Mailgun blast).
