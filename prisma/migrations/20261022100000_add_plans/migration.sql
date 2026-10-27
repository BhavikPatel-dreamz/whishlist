-- CreateTable
CREATE TABLE "Plan" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyPriceCents" INTEGER NOT NULL,
    "allowance" INTEGER NOT NULL,
    "allowanceWindow" TEXT NOT NULL,
    "allowMerchantProvider" BOOLEAN NOT NULL DEFAULT false,
    "merchantSendsCountTowardQuota" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "shopifyGid" TEXT,
    "status" TEXT NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3),
    "test" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_shopifyGid_key" ON "BillingSubscription"("shopifyGid");

-- CreateIndex
CREATE INDEX "BillingSubscription_shopId_status_idx" ON "BillingSubscription"("shopId", "status");

-- CreateIndex
CREATE INDEX "BillingSubscription_shopId_currentPeriodEnd_idx" ON "BillingSubscription"("shopId", "currentPeriodEnd");

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_planCode_fkey" FOREIGN KEY ("planCode") REFERENCES "Plan"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the commercial catalog. Amounts are configurable rows, not application constants.
INSERT INTO "Plan" (
    "code",
    "name",
    "monthlyPriceCents",
    "allowance",
    "allowanceWindow",
    "allowMerchantProvider",
    "merchantSendsCountTowardQuota",
    "active",
    "updatedAt"
) VALUES
    ('free', 'Free', 0, 50, 'month', false, true, true, CURRENT_TIMESTAMP),
    ('pro', 'Pro', 1500, 100, 'day', true, true, true, CURRENT_TIMESTAMP),
    ('gold', 'Gold', 3000, 1000, 'day', true, true, true, CURRENT_TIMESTAMP);
