-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "accessToken" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "emailProvider" TEXT NOT NULL DEFAULT 'resend',
    "apiKey" TEXT,
    "senderEmail" TEXT,
    "senderName" TEXT,
    "emailSubject" TEXT NOT NULL DEFAULT '{{ product_title }} is back in stock!',
    "emailHeading" TEXT NOT NULL DEFAULT 'Good news — it''s back!',
    "emailBody" TEXT NOT NULL DEFAULT 'The item you were waiting for is available again. Tap below before it sells out.',
    "buttonLabel" TEXT NOT NULL DEFAULT 'Buy it now',
    "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twilioAccountSid" TEXT,
    "twilioAuthToken" TEXT,
    "twilioFromNumber" TEXT,
    "wishlistRequiresLogin" BOOLEAN NOT NULL DEFAULT false,
    "doubleOptIn" BOOLEAN NOT NULL DEFAULT false,
    "alertsPerVariantCap" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WishlistItem" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerId" TEXT,
    "guestToken" TEXT,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "handle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAlert" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerId" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productTitle" TEXT,
    "variantTitle" TEXT,
    "locale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shop_key" ON "Shop"("shop");

-- CreateIndex
CREATE INDEX "WishlistItem_shopId_customerId_idx" ON "WishlistItem"("shopId", "customerId");

-- CreateIndex
CREATE INDEX "WishlistItem_shopId_guestToken_idx" ON "WishlistItem"("shopId", "guestToken");

-- CreateIndex
CREATE INDEX "WishlistItem_shopId_productId_idx" ON "WishlistItem"("shopId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "WishlistItem_shopId_customerId_productId_variantId_key" ON "WishlistItem"("shopId", "customerId", "productId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "WishlistItem_shopId_guestToken_productId_variantId_key" ON "WishlistItem"("shopId", "guestToken", "productId", "variantId");

-- CreateIndex
CREATE INDEX "StockAlert_shopId_variantId_status_idx" ON "StockAlert"("shopId", "variantId", "status");

-- CreateIndex
CREATE INDEX "StockAlert_shopId_status_createdAt_idx" ON "StockAlert"("shopId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockAlert_shopId_variantId_email_key" ON "StockAlert"("shopId", "variantId", "email");

-- CreateIndex
CREATE INDEX "WebhookEvent_processedAt_idx" ON "WebhookEvent"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_shopId_webhookId_key" ON "WebhookEvent"("shopId", "webhookId");

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitBucket_key_windowStart_key" ON "RateLimitBucket"("key", "windowStart");

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateLimitBucket" ADD CONSTRAINT "RateLimitBucket_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
