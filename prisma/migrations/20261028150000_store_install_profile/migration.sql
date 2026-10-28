-- Store install profile + related tables (separate from operational Shop).

CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyShopId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "contactEmail" TEXT,
    "description" TEXT,
    "url" TEXT,
    "primaryDomain" TEXT,
    "currency" TEXT,
    "timezone" TEXT,
    "timezoneOffset" TEXT,
    "weightUnit" TEXT,
    "unitSystem" TEXT,
    "planName" TEXT,
    "isDevStore" BOOLEAN NOT NULL DEFAULT false,
    "isShopifyPlus" BOOLEAN NOT NULL DEFAULT false,
    "address" JSONB,
    "billingAddress" JSONB,
    "presentmentCurrencies" JSONB,
    "currencyFormats" JSONB,
    "taxesIncluded" BOOLEAN,
    "taxShipping" BOOLEAN,
    "checkoutApiSupported" BOOLEAN,
    "setupRequired" BOOLEAN,
    "shipsToCountries" JSONB,
    "features" JSONB,
    "resourceLimits" JSONB,
    "paymentSettings" JSONB,
    "shopLocales" JSONB,
    "themes" JSONB,
    "publications" JSONB,
    "accessScopes" JSONB,
    "activeSubscriptions" JSONB,
    "uninstallUrl" TEXT,
    "shopCreatedAt" TIMESTAMP(3),
    "scopes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "installCount" INTEGER NOT NULL DEFAULT 1,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Store_shopDomain_key" ON "Store"("shopDomain");

CREATE TABLE "StoreInstaller" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "shopifyUserId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "locale" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "collaborator" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreInstaller_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreInstaller_storeId_key" ON "StoreInstaller"("storeId");

ALTER TABLE "StoreInstaller" ADD CONSTRAINT "StoreInstaller_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StoreLocation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "shopifyLocationId" TEXT NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "address" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreLocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreLocation_storeId_shopifyLocationId_key" ON "StoreLocation"("storeId", "shopifyLocationId");
CREATE INDEX "StoreLocation_storeId_idx" ON "StoreLocation"("storeId");

ALTER TABLE "StoreLocation" ADD CONSTRAINT "StoreLocation_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StoreMarket" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "shopifyMarketId" TEXT NOT NULL,
    "name" TEXT,
    "handle" TEXT,
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreMarket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreMarket_storeId_shopifyMarketId_key" ON "StoreMarket"("storeId", "shopifyMarketId");
CREATE INDEX "StoreMarket_storeId_idx" ON "StoreMarket"("storeId");

ALTER TABLE "StoreMarket" ADD CONSTRAINT "StoreMarket_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StoreStats" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productsCount" INTEGER NOT NULL DEFAULT 0,
    "collectionsCount" INTEGER NOT NULL DEFAULT 0,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "customersCount" INTEGER NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreStats_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StoreStats_storeId_capturedAt_idx" ON "StoreStats"("storeId", "capturedAt");

ALTER TABLE "StoreStats" ADD CONSTRAINT "StoreStats_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StoreInstallEvent" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scopes" TEXT,
    "appVersion" TEXT,
    "utmSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreInstallEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StoreInstallEvent_storeId_createdAt_idx" ON "StoreInstallEvent"("storeId", "createdAt");
CREATE INDEX "StoreInstallEvent_type_idx" ON "StoreInstallEvent"("type");

ALTER TABLE "StoreInstallEvent" ADD CONSTRAINT "StoreInstallEvent_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
