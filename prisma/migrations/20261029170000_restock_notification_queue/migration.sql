-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "restockQueueEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RestockEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT,
    "inventoryItemId" TEXT,
    "cycleKey" TEXT NOT NULL,
    "available" INTEGER,
    "sellableOnlineQuantity" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestockEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "restockEventId" TEXT NOT NULL,
    "stockAlertId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "fairShareKey" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'notification_job',
    "payload" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "notificationJobId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendRateLimit" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "tokens" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "maxTokens" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "refillPerSec" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SendRateLimit_pkey" PRIMARY KEY ("id")
);

INSERT INTO "SendRateLimit" ("id", "tokens", "maxTokens", "refillPerSec", "updatedAt")
VALUES ('global', 20, 20, 20, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- CreateIndex
CREATE UNIQUE INDEX "RestockEvent_shopId_variantId_cycleKey_key" ON "RestockEvent"("shopId", "variantId", "cycleKey");

CREATE INDEX "RestockEvent_shopId_variantId_status_idx" ON "RestockEvent"("shopId", "variantId", "status");

CREATE INDEX "RestockEvent_shopId_createdAt_idx" ON "RestockEvent"("shopId", "createdAt");

CREATE UNIQUE INDEX "NotificationJob_shopId_restockEventId_stockAlertId_key" ON "NotificationJob"("shopId", "restockEventId", "stockAlertId");

CREATE INDEX "NotificationJob_status_nextRetryAt_idx" ON "NotificationJob"("status", "nextRetryAt");

CREATE INDEX "NotificationJob_shopId_status_idx" ON "NotificationJob"("shopId", "status");

CREATE INDEX "NotificationJob_status_fairShareKey_idx" ON "NotificationJob"("status", "fairShareKey");

CREATE INDEX "NotificationJob_stockAlertId_idx" ON "NotificationJob"("stockAlertId");

CREATE INDEX "NotificationJob_restockEventId_idx" ON "NotificationJob"("restockEventId");

CREATE INDEX "OutboxMessage_publishedAt_createdAt_idx" ON "OutboxMessage"("publishedAt", "createdAt");

CREATE INDEX "OutboxMessage_shopId_publishedAt_idx" ON "OutboxMessage"("shopId", "publishedAt");

CREATE INDEX "EmailDeliveryAttempt_notificationJobId_createdAt_idx" ON "EmailDeliveryAttempt"("notificationJobId", "createdAt");

CREATE INDEX "EmailDeliveryAttempt_providerMessageId_idx" ON "EmailDeliveryAttempt"("providerMessageId");

-- AddForeignKey
ALTER TABLE "RestockEvent" ADD CONSTRAINT "RestockEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationJob" ADD CONSTRAINT "NotificationJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationJob" ADD CONSTRAINT "NotificationJob_restockEventId_fkey" FOREIGN KEY ("restockEventId") REFERENCES "RestockEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailDeliveryAttempt" ADD CONSTRAINT "EmailDeliveryAttempt_notificationJobId_fkey" FOREIGN KEY ("notificationJobId") REFERENCES "NotificationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;