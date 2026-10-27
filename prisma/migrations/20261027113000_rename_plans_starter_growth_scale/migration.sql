-- Rename Free/Pro/Gold → Starter/Growth/Scale (codes + display names).

INSERT INTO "Plan" (
    "code",
    "name",
    "monthlyPriceCents",
    "allowance",
    "allowanceWindow",
    "allowMerchantProvider",
    "merchantSendsCountTowardQuota",
    "active",
    "createdAt",
    "updatedAt"
)
SELECT
    CASE "code"
        WHEN 'free' THEN 'starter'
        WHEN 'pro' THEN 'growth'
        WHEN 'gold' THEN 'scale'
    END,
    CASE "code"
        WHEN 'free' THEN 'Starter'
        WHEN 'pro' THEN 'Growth'
        WHEN 'gold' THEN 'Scale'
    END,
    "monthlyPriceCents",
    "allowance",
    "allowanceWindow",
    "allowMerchantProvider",
    "merchantSendsCountTowardQuota",
    "active",
    "createdAt",
    CURRENT_TIMESTAMP
FROM "Plan"
WHERE "code" IN ('free', 'pro', 'gold')
ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "monthlyPriceCents" = EXCLUDED."monthlyPriceCents",
    "allowance" = EXCLUDED."allowance",
    "allowanceWindow" = EXCLUDED."allowanceWindow",
    "allowMerchantProvider" = EXCLUDED."allowMerchantProvider",
    "merchantSendsCountTowardQuota" = EXCLUDED."merchantSendsCountTowardQuota",
    "active" = EXCLUDED."active",
    "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "BillingSubscription"
SET "planCode" = 'starter'
WHERE "planCode" = 'free';

UPDATE "BillingSubscription"
SET "planCode" = 'growth'
WHERE "planCode" = 'pro';

UPDATE "BillingSubscription"
SET "planCode" = 'scale'
WHERE "planCode" = 'gold';

DELETE FROM "Plan" WHERE "code" IN ('free', 'pro', 'gold');
