-- Merge Store install profile into operational Shop.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Profile columns on Shop
ALTER TABLE "Shop"
  ADD COLUMN IF NOT EXISTS "shopifyShopId" TEXT,
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "contactEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "url" TEXT,
  ADD COLUMN IF NOT EXISTS "primaryDomain" TEXT,
  ADD COLUMN IF NOT EXISTS "currency" TEXT,
  ADD COLUMN IF NOT EXISTS "timezone" TEXT,
  ADD COLUMN IF NOT EXISTS "timezoneOffset" TEXT,
  ADD COLUMN IF NOT EXISTS "weightUnit" TEXT,
  ADD COLUMN IF NOT EXISTS "unitSystem" TEXT,
  ADD COLUMN IF NOT EXISTS "planName" TEXT,
  ADD COLUMN IF NOT EXISTS "isDevStore" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isShopifyPlus" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "address" JSONB,
  ADD COLUMN IF NOT EXISTS "billingAddress" JSONB,
  ADD COLUMN IF NOT EXISTS "presentmentCurrencies" JSONB,
  ADD COLUMN IF NOT EXISTS "currencyFormats" JSONB,
  ADD COLUMN IF NOT EXISTS "taxesIncluded" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "taxShipping" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "checkoutApiSupported" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "setupRequired" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "shipsToCountries" JSONB,
  ADD COLUMN IF NOT EXISTS "features" JSONB,
  ADD COLUMN IF NOT EXISTS "resourceLimits" JSONB,
  ADD COLUMN IF NOT EXISTS "paymentSettings" JSONB,
  ADD COLUMN IF NOT EXISTS "shopLocales" JSONB,
  ADD COLUMN IF NOT EXISTS "themes" JSONB,
  ADD COLUMN IF NOT EXISTS "publications" JSONB,
  ADD COLUMN IF NOT EXISTS "accessScopes" JSONB,
  ADD COLUMN IF NOT EXISTS "activeSubscriptions" JSONB,
  ADD COLUMN IF NOT EXISTS "uninstallUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "shopCreatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "scopes" TEXT,
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "installCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "uninstalledAt" TIMESTAMP(3);

-- 2) Ensure a Shop row exists for every Store domain
INSERT INTO "Shop" ("id", "shop", "installedAt", "createdAt", "updatedAt", "isDevStore", "isShopifyPlus", "isActive", "installCount")
SELECT gen_random_uuid()::text, s."shopDomain", COALESCE(s."installedAt", CURRENT_TIMESTAMP), COALESCE(s."createdAt", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP, s."isDevStore", s."isShopifyPlus", s."isActive", s."installCount"
FROM "Store" s
WHERE NOT EXISTS (SELECT 1 FROM "Shop" h WHERE h."shop" = s."shopDomain");

-- 3) Backfill profile fields from Store onto Shop
UPDATE "Shop" h
SET
  "shopifyShopId" = COALESCE(h."shopifyShopId", s."shopifyShopId"),
  "name" = COALESCE(h."name", s."name"),
  "email" = COALESCE(h."email", s."email"),
  "contactEmail" = COALESCE(h."contactEmail", s."contactEmail"),
  "description" = COALESCE(h."description", s."description"),
  "url" = COALESCE(h."url", s."url"),
  "primaryDomain" = COALESCE(h."primaryDomain", s."primaryDomain"),
  "currency" = COALESCE(h."currency", s."currency"),
  "timezone" = COALESCE(h."timezone", s."timezone"),
  "timezoneOffset" = COALESCE(h."timezoneOffset", s."timezoneOffset"),
  "weightUnit" = COALESCE(h."weightUnit", s."weightUnit"),
  "unitSystem" = COALESCE(h."unitSystem", s."unitSystem"),
  "planName" = COALESCE(h."planName", s."planName"),
  "isDevStore" = COALESCE(s."isDevStore", h."isDevStore"),
  "isShopifyPlus" = COALESCE(s."isShopifyPlus", h."isShopifyPlus"),
  "address" = COALESCE(h."address", s."address"),
  "billingAddress" = COALESCE(h."billingAddress", s."billingAddress"),
  "presentmentCurrencies" = COALESCE(h."presentmentCurrencies", s."presentmentCurrencies"),
  "currencyFormats" = COALESCE(h."currencyFormats", s."currencyFormats"),
  "taxesIncluded" = COALESCE(h."taxesIncluded", s."taxesIncluded"),
  "taxShipping" = COALESCE(h."taxShipping", s."taxShipping"),
  "checkoutApiSupported" = COALESCE(h."checkoutApiSupported", s."checkoutApiSupported"),
  "setupRequired" = COALESCE(h."setupRequired", s."setupRequired"),
  "shipsToCountries" = COALESCE(h."shipsToCountries", s."shipsToCountries"),
  "features" = COALESCE(h."features", s."features"),
  "resourceLimits" = COALESCE(h."resourceLimits", s."resourceLimits"),
  "paymentSettings" = COALESCE(h."paymentSettings", s."paymentSettings"),
  "shopLocales" = COALESCE(h."shopLocales", s."shopLocales"),
  "themes" = COALESCE(h."themes", s."themes"),
  "publications" = COALESCE(h."publications", s."publications"),
  "accessScopes" = COALESCE(h."accessScopes", s."accessScopes"),
  "activeSubscriptions" = COALESCE(h."activeSubscriptions", s."activeSubscriptions"),
  "uninstallUrl" = COALESCE(h."uninstallUrl", s."uninstallUrl"),
  "shopCreatedAt" = COALESCE(h."shopCreatedAt", s."shopCreatedAt"),
  "scopes" = COALESCE(h."scopes", s."scopes"),
  "isActive" = COALESCE(s."isActive", h."isActive"),
  "installCount" = GREATEST(h."installCount", s."installCount"),
  "uninstalledAt" = COALESCE(h."uninstalledAt", s."uninstalledAt"),
  "installedAt" = COALESCE(s."installedAt", h."installedAt"),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Store" s
WHERE h."shop" = s."shopDomain";

-- 4) Retarget child tables: add shopId, backfill, drop storeId

ALTER TABLE "StoreInstaller" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "StoreInstaller" si
SET "shopId" = h."id"
FROM "Store" s
JOIN "Shop" h ON h."shop" = s."shopDomain"
WHERE si."storeId" = s."id";
DELETE FROM "StoreInstaller" WHERE "shopId" IS NULL;
ALTER TABLE "StoreInstaller" DROP CONSTRAINT IF EXISTS "StoreInstaller_storeId_fkey";
DROP INDEX IF EXISTS "StoreInstaller_storeId_key";
ALTER TABLE "StoreInstaller" DROP COLUMN IF EXISTS "storeId";
ALTER TABLE "StoreInstaller" ALTER COLUMN "shopId" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "StoreInstaller_shopId_key" ON "StoreInstaller"("shopId");
ALTER TABLE "StoreInstaller" ADD CONSTRAINT "StoreInstaller_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StoreLocation" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "StoreLocation" sl
SET "shopId" = h."id"
FROM "Store" s
JOIN "Shop" h ON h."shop" = s."shopDomain"
WHERE sl."storeId" = s."id";
DELETE FROM "StoreLocation" WHERE "shopId" IS NULL;
ALTER TABLE "StoreLocation" DROP CONSTRAINT IF EXISTS "StoreLocation_storeId_fkey";
DROP INDEX IF EXISTS "StoreLocation_storeId_shopifyLocationId_key";
DROP INDEX IF EXISTS "StoreLocation_storeId_idx";
ALTER TABLE "StoreLocation" DROP COLUMN IF EXISTS "storeId";
ALTER TABLE "StoreLocation" ALTER COLUMN "shopId" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "StoreLocation_shopId_shopifyLocationId_key" ON "StoreLocation"("shopId", "shopifyLocationId");
CREATE INDEX IF NOT EXISTS "StoreLocation_shopId_idx" ON "StoreLocation"("shopId");
ALTER TABLE "StoreLocation" ADD CONSTRAINT "StoreLocation_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StoreMarket" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "StoreMarket" sm
SET "shopId" = h."id"
FROM "Store" s
JOIN "Shop" h ON h."shop" = s."shopDomain"
WHERE sm."storeId" = s."id";
DELETE FROM "StoreMarket" WHERE "shopId" IS NULL;
ALTER TABLE "StoreMarket" DROP CONSTRAINT IF EXISTS "StoreMarket_storeId_fkey";
DROP INDEX IF EXISTS "StoreMarket_storeId_shopifyMarketId_key";
DROP INDEX IF EXISTS "StoreMarket_storeId_idx";
ALTER TABLE "StoreMarket" DROP COLUMN IF EXISTS "storeId";
ALTER TABLE "StoreMarket" ALTER COLUMN "shopId" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "StoreMarket_shopId_shopifyMarketId_key" ON "StoreMarket"("shopId", "shopifyMarketId");
CREATE INDEX IF NOT EXISTS "StoreMarket_shopId_idx" ON "StoreMarket"("shopId");
ALTER TABLE "StoreMarket" ADD CONSTRAINT "StoreMarket_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StoreStats" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "StoreStats" ss
SET "shopId" = h."id"
FROM "Store" s
JOIN "Shop" h ON h."shop" = s."shopDomain"
WHERE ss."storeId" = s."id";
DELETE FROM "StoreStats" WHERE "shopId" IS NULL;
ALTER TABLE "StoreStats" DROP CONSTRAINT IF EXISTS "StoreStats_storeId_fkey";
DROP INDEX IF EXISTS "StoreStats_storeId_capturedAt_idx";
ALTER TABLE "StoreStats" DROP COLUMN IF EXISTS "storeId";
ALTER TABLE "StoreStats" ALTER COLUMN "shopId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "StoreStats_shopId_capturedAt_idx" ON "StoreStats"("shopId", "capturedAt");
ALTER TABLE "StoreStats" ADD CONSTRAINT "StoreStats_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StoreInstallEvent" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "StoreInstallEvent" se
SET "shopId" = h."id"
FROM "Store" s
JOIN "Shop" h ON h."shop" = s."shopDomain"
WHERE se."storeId" = s."id";
DELETE FROM "StoreInstallEvent" WHERE "shopId" IS NULL;
ALTER TABLE "StoreInstallEvent" DROP CONSTRAINT IF EXISTS "StoreInstallEvent_storeId_fkey";
DROP INDEX IF EXISTS "StoreInstallEvent_storeId_createdAt_idx";
ALTER TABLE "StoreInstallEvent" DROP COLUMN IF EXISTS "storeId";
ALTER TABLE "StoreInstallEvent" ALTER COLUMN "shopId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "StoreInstallEvent_shopId_createdAt_idx" ON "StoreInstallEvent"("shopId", "createdAt");
ALTER TABLE "StoreInstallEvent" ADD CONSTRAINT "StoreInstallEvent_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5) Drop Store
DROP TABLE IF EXISTS "Store";
