-- Align commercial allowances with product rules:
-- Free 30/day (managed only), Pro 250/day (managed only),
-- Gold 1000/day managed; custom provider allowed (unlimited decided at send time).

UPDATE "Plan"
SET
  "allowance" = 30,
  "allowanceWindow" = 'day',
  "allowMerchantProvider" = false,
  "merchantSendsCountTowardQuota" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'free';

UPDATE "Plan"
SET
  "allowance" = 250,
  "allowanceWindow" = 'day',
  "allowMerchantProvider" = false,
  "merchantSendsCountTowardQuota" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'pro';

UPDATE "Plan"
SET
  "allowance" = 1000,
  "allowanceWindow" = 'day',
  "allowMerchantProvider" = true,
  "merchantSendsCountTowardQuota" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'gold';
