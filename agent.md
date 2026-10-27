# Agent working notes

## Audit status

Stock-alert notification audit is **complete**. Product decisions in section 12 of `docs/stock-alert-notification-audit.md` are **approved**. No application code has been implemented yet.

Full write-up: `docs/stock-alert-notification-audit.md`.

## Findings (short)

- Stack: Shopify Remix app, Polaris admin, theme extension, Prisma/PostgreSQL.
- Stock alerts are real: `StockAlert`, app proxy `app/routes/api.stock-alert.tsx`, webhooks `inventory_levels/update` and `products/update`, dispatch in `app/lib/notifications/dispatch.server.ts`.
- Email providers in code: Resend (default), Brevo, SendGrid, and Klaviyo (event only). **Mailgun is not implemented.**
- Shop-level API key is encrypted (`app/lib/crypto.server.ts`). Env fallbacks: `DEFAULT_EMAIL_PROVIDER`, `DEFAULT_EMAIL_API_KEY`, `DEFAULT_SENDER_EMAIL`.
- No Shopify billing, no plan tables, no usage ledger, no SMTP, no test-email endpoint, no delivery-attempt history, no queue. Sends run inside the webhook (batch 500) plus optional `POST /api/cron/retry-alerts` when `CRON_SECRET` is set. No scheduler is defined in the repo.
- Idempotency is webhook-id plus `claimPendingAlerts` (`FOR UPDATE SKIP LOCKED`), not a restock-event id. Provider message ids are not stored.
- `alertsPerVariantCap` is saved in settings but not passed into `createStockAlert`.
- Tests do not exercise sending, webhooks, or the database claim. Stock-alert tests only check status constants.
- Wishlist is separate (`WishlistItem`) and must stay unchanged.

## Approved decisions

- Managed sender: Mailgun (server env credentials).
- Merchant providers in v1: Resend, Brevo, SendGrid, SMTP. Scale only. Klaviyo is event-only and does not count as a delivery or against quota.
- Starter: Mailgun only, and send-log UI limited to the latest 25 rows. Counts (today, period, remaining) are still shown.
- Merchant-owned sends count toward quota. Per-plan flag defaults on.
- Successful alert stays `SENT` until the shopper subscribes again.
- Cancel follows Shopify recurring billing: paid access until the current period ends, then Starter.
- Test emails do not consume quota and are rate-limited. Bounces do not refund quota.
- Store all usage timestamps and period keys in UTC. Convert to the store timezone only for display, and show the UTC reset in store-local time.

## Completed

- Step 1: `Plan` and `BillingSubscription` in `prisma/schema.prisma`, later renamed to Starter/Growth/Scale. Resolver `app/lib/billing/plan.server.ts` (`getShopPlan`). No Shopify Billing API calls yet.

## Completed (billing UI)

- Manage Subscription on Configurations opens Shopify’s hosted plan page (`pricing_plans`) with `target="_top"`. Monthly and annual comparison and charge confirmation happen on that Shopify page. App handle defaults to `wishlist-stock` (`SHOPIFY_APP_HANDLE` overrides it).
- `/app/settings/pricing` redirects to the same page.

Partner Dashboard must have Shopify App Pricing turned on and plans published, or that page has nothing to confirm.

## Completed (subscription sync)

- Each admin load calls the Partner API `activeSubscription` when `SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_ACCESS_TOKEN`, and `SHOPIFY_APP_GID` are set. The result is stored on `BillingSubscription`. Handles containing scale/growth/starter (or legacy gold/pro/free) map to those plans. Cancel-at-period-end stays paid until the cycle end. A confirmed empty subscription expires the local row so the shop is Starter. Results are cached for 5 minutes unless the URL has `plan_handle`.
- Configurations shows “Current plan”.

Plan handles in the Partner Dashboard should include the words starter, growth, or scale (legacy free/pro/gold still map). Welcome link should be `/app/settings` so the merchant returns into the app.

## Later

Partner API credentials are not set yet. Until they are, confirmed Shopify plans stay Starter in the app:

- `SHOPIFY_PARTNER_ORG_ID` — the number in the Partner Dashboard URL
- `SHOPIFY_PARTNER_API_ACCESS_TOKEN` — a Partner API token with Manage apps
- `SHOPIFY_APP_GID` — `gid://shopify/App/{app id}`

Plan handles should include starter, growth, or scale. Welcome link: `/app/settings`.

## Completed (usage ledger)

- `UsageCounter` and `UsageLedger` migration `prisma/migrations/20261022153000_usage_ledger`.
- Email sends reserve quota before the provider call, consume it only when the provider accepts, and release it on failure. The same alert generation cannot consume twice. A new signup increments `notifyGeneration`.
- Allowances (UTC day): Starter 30, Growth 250, Scale 1000 on the managed sender. Over quota puts the alert back to pending with “Notification limit reached” and does not call the provider.
- Starter and Growth cannot save their own email provider (managed sender only). Scale (`allowMerchantProvider`) can save Resend, Brevo, SendGrid, Mailgun, or Klaviyo; Scale merchant/custom sends are unlimited and do not count toward the 1000/day cap.

## Next pending task

Provider delivery service: Mailgun for managed sending, and Resend, Brevo, SendGrid, and SMTP for Scale. Encrypt credentials. Validate the From address. Add a rate-limited test email that does not use quota.
