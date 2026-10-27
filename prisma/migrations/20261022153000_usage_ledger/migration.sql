ALTER TABLE "StockAlert" ADD COLUMN "notifyGeneration" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "reservedCount" INTEGER NOT NULL DEFAULT 0,
    "consumedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsageLedger" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "stockAlertId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsageCounter_shopId_periodKey_key" ON "UsageCounter"("shopId", "periodKey");
CREATE UNIQUE INDEX "UsageLedger_idempotencyKey_key" ON "UsageLedger"("idempotencyKey");
CREATE INDEX "UsageLedger_shopId_periodKey_idx" ON "UsageLedger"("shopId", "periodKey");
CREATE INDEX "UsageLedger_stockAlertId_idx" ON "UsageLedger"("stockAlertId");

ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageLedger" ADD CONSTRAINT "UsageLedger_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
