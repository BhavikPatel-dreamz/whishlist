# Stock alert notification — audit and development plan

Status: **audit only**. No application behavior was changed. Implementation must wait for product-owner approval of the decisions in section 12.

Evidence is from the repository as inspected. Anything not present in code, schema, tests, or `shopify.app.toml` is recorded as a gap. Mailgun is **not** in this repository.

## 1. Existing application architecture

| Layer | What exists |
|---|---|
| Runtime | Node.js (`package.json` engines `>=20.19 <22 \|\| >=22.12`) |
| App framework | Shopify Remix template (`@remix-run/*` 2.16, `@shopify/shopify-app-remix` 4.1) |
| Admin UI | Polaris + App Bridge (`app/routes/app.tsx`, `app.settings.tsx`, `app.alerts.tsx`, `app._index.tsx`, `app.customise.tsx`) |
| Storefront | Theme app extension `extensions/theme` (`back-in-stock.js`, `wishlist-button.js`, `wishlist-page.js`) |
| Data | Prisma 6 + PostgreSQL (`prisma/schema.prisma`). Migrations: `20260818113413_init`, `20260902090000_add_ui_config` |
| Auth | Offline/online sessions in `Session`; shop row in `Shop` (`app/shopify.server.ts`, `app/lib/shop.server.ts`) |
| Public API | App proxy prefix `apps`, subpath `wishlist-stock` (`shopify.app.toml`) |
| Tests | Vitest. Five test files; stock-alert tests only assert status constants |
| Billing | **Missing.** No `billing` config, no `appSubscription` GraphQL, no plan tables |
| Job queue | **Missing.** Sends run inside the webhook request and a cron sweep |

Conventions to keep: Remix route modules, Prisma models in `app/models/*.server.ts`, notification logic in `app/lib/notifications/`, secrets via `encryptSecret` / `decryptSecret` (`app/lib/crypto.server.ts`), admin routes gated by `authenticate.admin`, storefront routes by `authenticateProxyRequest`, webhooks by `authenticate.webhook`.

## 2. End-to-end stock alert flow

### 2.1 Customer subscribes

| Step | Status | Evidence |
|---|---|---|
| Storefront form | Implemented, not verified in this audit | `extensions/theme/assets/back-in-stock.js` POSTs to `${proxyBase}/stock-alert` |
| App proxy route | Implemented, not verified | `app/routes/api.stock-alert.tsx` `action` |
| HMAC / proxy auth | Implemented, unit-tested for proxy helpers | `app/lib/proxy-auth.server.ts`, `app/lib/__tests__/proxy.server.test.ts` |
| Rate limit | Implemented, not verified under load | `rateLimit` keys `alert-write` (5/min) and `alert-write-hour` (20/hour) per shop+IP; table `RateLimitBucket` |
| Honeypot | Implemented | Body field `website` short-circuits |
| Out-of-stock check | Implemented | GraphQL via `getVariantsByIds`; rejects if `availableForSale && sellableOnlineQuantity > 0` (HTTP 409 `already_available`) |
| Persist | Implemented | `createStockAlert` in `app/models/stock-alert.server.ts` |
| Per-variant cap | Partially implemented | `Shop.alertsPerVariantCap` is saved in settings, but `api.stock-alert.tsx` never passes `perVariantCap` into `createStockAlert`, so the cap is not enforced |
| Double opt-in email | Implemented, not verified | If `Shop.doubleOptIn` and status is `PENDING`, confirmation is sent through `sendEmail`. Confirm link: `app/routes/r.confirm.$id.tsx` → `confirmStockAlert` (`PENDING` → `CONFIRMED`) |

Association stored on `StockAlert`: `shopId` (FK to `Shop`, which has unique `shop` domain), `productId`, `variantId`, `email`, optional `customerId` (logged-in Shopify customer from the proxy), optional `phone`, titles, locale. Unique constraint `one_alert_per_email_variant` on `(shopId, variantId, email)`.

### 2.2 Inventory detection and trigger

| Trigger | Status | Evidence |
|---|---|---|
| `inventory_levels/update` | Implemented, subscribed | `shopify.app.toml` → `/webhooks/inventory`; handler `app/routes/webhooks.inventory.tsx` |
| `products/update` | Implemented, subscribed | `/webhooks/products/update`; handler `app/routes/webhooks.products.update.tsx` (continue-selling, draft→active) |
| Webhook HMAC | Implemented by library, not covered by an app test | `authenticate.webhook` in `app/shopify.server.ts` |
| Duplicate webhook id | Implemented | `claimWebhook` + `WebhookEvent` unique `(shopId, webhookId)` in `app/lib/webhook-events.server.ts` |
| Cron retry | Implemented, opt-in | `POST /api/cron/retry-alerts` (`app/routes/api.cron.retry-alerts.tsx`). Disabled with 503 unless `CRON_SECRET` is set. **No scheduler is defined in the repo** |
| Restock-event id | Missing | Idempotency is webhook-id plus row claim, not a restock event |

Inventory handler ignores the event when `available <= 0`. It then loads the variant by inventory item (`getVariantByInventoryItem`) and only dispatches if GraphQL says `availableForSale` and `sellableOnlineQuantity > 0` and product status is `ACTIVE` (`dispatchRestockAlerts`).

### 2.3 Eligible subscribers

`claimPendingAlerts` (`app/models/stock-alert.server.ts`):

- One SQL `UPDATE … RETURNING` with `FOR UPDATE SKIP LOCKED`.
- Claims `PENDING` and `CONFIRMED`, or only `CONFIRMED` when `shop.doubleOptIn` is true.
- Also reclaims `SENDING` rows older than `STALE_SENDING_MS` (10 minutes).
- Increments `attempts`, sets status `SENDING`.
- Batch size **500**. Rows beyond 500 stay `PENDING` until another webhook or the cron.

Cancelled, sent, and (until a human retry) failed rows are not claimed.

### 2.4 Email content

`app/lib/notifications/template.server.ts` (`backInStockHtml`, `backInStockText`, `render`). Merchant copy lives on `Shop`: `emailSubject`, `emailHeading`, `emailBody`, `buttonLabel`. Placeholders include product title, variant title, shop name, price, product URL. Click tracking: `/r/alert/:id` (`app/routes/r.alert.$id.tsx`) sets `convertedAt` then redirects. Unsubscribe: `/alerts/unsubscribe` (`app/routes/alerts.unsubscribe.tsx`) → `cancelStockAlert`.

Template rendering has unit tests (`app/lib/__tests__/template.server.test.ts`). HTML output is not snapshot-tested against a live provider.

### 2.5 Delivery, retries, duplicates, rate limits

| Concern | Status | Behavior |
|---|---|---|
| Provider call | Implemented | `sendEmail` in `app/lib/notifications/providers.server.ts` |
| Success | Implemented | `markAlertSent` sets `SENT`, `notifiedAt`, clears `lastError`. **Provider message id is discarded** |
| Failure | Implemented | `markAlertFailed`. If `attempts >= 3` (value after claim increment), status `FAILED`; otherwise back to `PENDING` |
| Automatic retry | Partial | Next inventory webhook or cron can reclaim `PENDING`. No backoff schedule, no dead-letter table |
| Manual retry | Implemented in UI path | Admin alerts page can call `retryStuckAlerts` with `includeFailed` (`reactivateFailedAlerts` resets attempts). File: `app/routes/app.alerts.tsx` |
| Duplicate emails for one restock | Implemented for the happy path | Second webhook cannot claim a row already `SENDING` or `SENT`. **Not covered by an integration test** |
| Same subscriber, later restock | By design today | After `SENT`, the unique row is not emailed again until the shopper subscribes again (`createStockAlert` reopens `SENT`/`CANCELLED`/`FAILED` to `PENDING`) |
| Provider rate limits | Missing | Concurrency constant `SEND_CONCURRENCY = 10` only. No Mailgun/Resend/SendGrid quota handling |
| Public signup rate limit | Implemented | `RateLimitBucket` |
| Large lists | Risk | Up to 500 emails are sent **inside the webhook HTTP request**. No queue |

### 2.6 Merchant admin

| Screen | Path | What it shows |
|---|---|---|
| Home stats | `app/routes/app._index.tsx` | `stockAlertStats`, `topRequestedVariants` (pending only) |
| Alerts list / retry / export | `app/routes/app.alerts.tsx`, `app.alerts.export.tsx` | Filter, CSV (max 50,000 rows) |
| Settings | `app/routes/app.settings.tsx` | Provider, API key (masked), sender, template, SMS, double opt-in, wishlist login, cap field |
| Customise | `app/routes/app.customise.tsx` | `UIConfig` extension toggle and product card JSON |

There is no usage meter, plan card, delivery-attempt log, or test-email action.

### 2.7 Wishlist (do not change)

Separate tables `WishlistItem` and `WishlistMetric`. Routes: `app/routes/api.wishlist.tsx`, `api.wishlist-event.tsx`. Models: `app/models/wishlist.server.ts`. Storefront: `wishlist-button.js`, `wishlist-page.js`. Tests: `app/models/__tests__/wishlist.server.test.ts`. Shared pieces only: `Shop`, proxy auth, rate limit, UI config, encryption. Stock-alert work must not alter wishlist writes or those tests’ expectations.

## 3. Current email integration (not Mailgun)

`Shop.emailProvider` default is `"resend"`. Schema comment lists `resend | sendgrid | klaviyo`. Code also implements **Brevo** (`https://api.brevo.com/v3/smtp/email`). Settings UI options: Resend, Brevo, SendGrid, Klaviyo.

`resolveSettings` (`app/lib/shop.server.ts`):

- If the shop has no `apiKey`, use `DEFAULT_EMAIL_API_KEY`, `DEFAULT_EMAIL_PROVIDER`, and `DEFAULT_SENDER_EMAIL`.
- If the shop has an `apiKey`, use the shop provider and decrypt that key.
- Sender email falls back to `DEFAULT_SENDER_EMAIL` when the shop field is empty.

Klaviyo does not send HTML. It posts a “Back in Stock” event and expects a Klaviyo flow to deliver. That is not a transactional send.

Twilio SMS is optional (`sendSms`) and does not change email status if SMS fails.

**Mailgun:** no references, no env vars, no client. Treating the current stack as “Mailgun for testing” would be incorrect. Platform-managed mode should be implemented as an explicit provider (Mailgun can be the first managed provider **after** approval), not assumed to exist.

Credentials at rest: AES-256-GCM (`enc.v1.` prefix) when `APP_ENCRYPTION_KEY` or `SHOPIFY_API_SECRET` is set. Plaintext rows written before encryption still decrypt as raw strings (`decryptSecret`). The admin loader returns a masked key, not the raw key. Logs on failure include `result.error` from the provider body (truncated). That can leak provider error text; it must not include the API key (current `sendEmail` does not log the key). SendGrid/Klaviyo error strings include up to 200 characters of the provider body.

No sender-domain verification, no test-connection endpoint, no bounce/complaint webhooks, no suppression list.

## 4. Webhooks and inventory

Configured in `shopify.app.toml` (API version `2026-10`):

- `app/scopes_update` → `app/routes/webhooks.app.scopes_update.tsx`
- `products/update`
- `inventory_levels/update`
- `app/uninstalled` → `app/routes/webhooks.app.uninstalled.tsx`

Also present in code but **not** in `shopify.app.toml` subscriptions: `webhooks.orders.paid.tsx`, `webhooks.orders.updated.tsx`, `webhooks.app.installed.tsx`, `webhooks.compliance.tsx`. Whether those are registered in the Partner Dashboard is **not visible in the repo**. Compliance handler deletes stock alerts for GDPR topics (`app/routes/webhooks.compliance.tsx`).

Processing failures return HTTP 500 and delete the `WebhookEvent` row so Shopify can retry. A success path that already emailed some of a 500-row batch and then throws would retry the webhook; already `SENT` rows are not reclaimed, in-flight `SENDING` rows are reclaimed only after 10 minutes. Partial batch failure is therefore eventually consistent, not transactional.

## 5. Database and billing

### Tables that exist

- `Session` — Shopify sessions (includes `accessToken`).
- `Shop` — tenant, notification settings, encrypted `apiKey`, Twilio fields, template copy, `doubleOptIn`, `alertsPerVariantCap`.
- `StockAlert` — one subscription row per shop + variant + email. Status doubles as the delivery job.
- `WebhookEvent` — webhook id dedupe.
- `RateLimitBucket` — public endpoint windows.
- `UIConfig` — theme extension toggle.
- `WishlistItem`, `WishlistMetric`.

### Tables that do not exist

Notification jobs, restock events, delivery attempts, plans, Shopify billing state, usage counters, provider credential records separate from `Shop.apiKey`, bounce/suppression, test-email audit.

### Billing

**Missing.** No Shopify app subscription code. Plans in the brief cannot be enforced until billing (or an explicit internal plan flag for development) exists.

### Environment variables referenced in code

`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL`, `SHOP_CUSTOM_DOMAIN`, `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `DEFAULT_EMAIL_PROVIDER`, `DEFAULT_EMAIL_API_KEY`, `DEFAULT_SENDER_EMAIL`, `CRON_SECRET`, `NODE_ENV`, `HOST`, `PORT`, `FRONTEND_PORT`.

No `.env` was read. Do not commit secrets.

## 6. Requirement classification

| Requirement | Classification |
|---|---|
| Subscribe to an out-of-stock variant | Implemented, not verified (no route/integration test) |
| Tie subscription to shop, product, variant, email | Implemented and verified in schema + `createStockAlert` |
| Detect inventory becoming available | Implemented (`inventory_levels/update` + live GraphQL check), not verified against Shopify |
| Select eligible subscribers | Implemented (`claimPendingAlerts`), not verified (no DB test) |
| Generate email content | Implemented; template unit tests exist |
| Mailgun | **Missing** |
| Multi-provider send (Resend, Brevo, SendGrid, Klaviyo event) | Implemented, not verified (no provider tests) |
| Failed delivery, 3 attempts, then FAILED | Implemented in `markAlertFailed`, not verified |
| Duplicate webhook suppression | Implemented (`WebhookEvent` + row claim), not verified |
| Provider rate limits | Missing |
| Record success and mark notified | Implemented (`SENT`, `notifiedAt`); provider id not stored |
| Merchant list/manage alerts | Implemented UI, not verified in browser in this audit |
| Configurable plans and quotas | Missing |
| Shopify billing | Missing |
| Managed vs merchant-owned mode | Partial: env fallback vs shop API key, no explicit mode or plan gate |
| SMTP | Missing |
| Test email | Missing |
| Domain verification | Missing |
| Bounce / complaint / suppression | Missing |
| Usage ledger | Missing |
| Queue decoupled from webhook | Missing |
| Restock event idempotency key beyond row status | Missing |
| Per-variant subscriber cap | Partially implemented (stored, not applied on create) |
| Wishlist | Implemented; keep unchanged |

## 7. Recommended provider architecture

Keep one delivery pipeline (`dispatchRestockAlerts` and confirmation sends). Replace the `switch` in `sendEmail` with a registry:

```ts
interface EmailProvider {
  id: string;
  send(input: {
    credentials: ProviderCredentials; // server-only
    from: { email: string; name?: string };
    message: EmailMessage;
  }): Promise<{ ok: true; providerMessageId?: string } | { ok: false; retryable: boolean; errorCode: string }>;
  validateSender?(credentials, fromEmail): Promise<{ ok: boolean; reason?: string }>;
  testConnection?(credentials): Promise<{ ok: boolean; reason?: string }>;
}
```

Adapters (implement only after approval):

1. **Mailgun** — first platform-managed provider, if the business confirms Mailgun. HTTP API, server-side domain and key from env, never from the browser.
2. **Resend, Brevo, SendGrid** — already sketched; wrap them so business logic does not branch on vendor.
3. **SMTP** — host, port, username, password, TLS mode (`starttls` | `tls` | `none` rejected in production). Timeouts required.
4. **Amazon SES, Postmark** — only if approved. Do not add them in the first implementation slice.
5. **Klaviyo** — keep as an explicit “event trigger”, not as proof of delivery. Do not count a 202 from Klaviyo as a delivered email unless product policy says so.

`DeliveryService.sendForShop(shopId, message)` loads the shop’s mode, checks quota (section 8), calls the adapter, and writes a delivery attempt. Dispatch code must not import Mailgun or SMTP.

### Credentials

- New `ShopEmailConfig` (or columns) hold non-secret settings: mode, provider id, sender email, sender name, SMTP host/port/tls, verification status.
- Secrets (API key, SMTP password) stored only as ciphertext (`encryptSecret`) or a secret reference. Responses to the admin client return `{ configured: true, hint: mask }` and never the secret.
- Rotation: a new secret replaces ciphertext; previous value is not logged. Blank form field means “keep existing”.
- Revocation: clearing the secret disables merchant-owned mode and falls back only if the plan allows managed mode.
- Logs: log provider id, shop id, HTTP status, stable error code. Never log request bodies that contain keys or SMTP passwords.

### From address

Activate a config only after `validateSender` succeeds for that provider (Mailgun domain authorized, SES identity, SendGrid verified sender, SMTP auth success). Reject arbitrary From addresses. Managed mode uses the platform’s verified domain (for example `notifications@<platform-domain>` with the store name as the display name) unless a later plan allows a custom verified domain.

### Failures

- Retryable: timeout, 429, 5xx. Attempt row stays retryable; alert returns to `PENDING` only after the attempt is recorded. Backoff: 1 min, 5 min, 30 min, then `FAILED` (max 3 automatic attempts, matching today’s cap unless changed).
- Permanent: 4xx auth, invalid recipient, suppression. Mark `FAILED` immediately and add the address to a shop-scoped suppression list on bounce/complaint webhooks.
- Provider message id stored on the attempt row.

Test email: authenticated admin POST, same shop scope, rate limit (for example 5/hour/shop), does not create a `StockAlert`, does count as a send attempt for quota if policy says test sends count (recommend: **test sends do not consume customer notification quota**, but are rate-limited).

## 8. Plan and quota model

Store plans as data, not scattered constants.

Suggested tables:

- `Plan`: `code` (`starter` | `growth` | `scale`), `monthlyPriceCents`, `allowance`, `allowanceWindow` (`month` | `day`), `allowMerchantProvider` (boolean), `merchantSendsCountTowardQuota` (boolean), `active`.
- Seed values (current product): Starter $0 / 30 per UTC day; Growth $15 / 250 per UTC day; Scale $30 / 1,000 per UTC day (managed). Scale may use a merchant provider for unlimited sends. Editable by migration or admin seed, not by the storefront.

### Billing

Use Shopify Billing API (`appSubscriptionCreate`) on the existing embedded app, with a `returnUrl` to an admin route that confirms the subscription. Persist `BillingSubscription`: `shopId`, `shopifyGid`, `planCode`, `status`, `currentPeriodEnd`, `test` flag. Map Shopify subscription name → `Plan.code`.

- No subscription row → treat as **Starter**.
- Upgrade/downgrade: new Shopify subscription; historical `UsageLedger` rows stay attached to the period they were written in.
- Cancel: Shopify `CANCELLED` → Starter at period end or immediately, matching Shopify’s `replacementBehavior`. **Decision required** (section 12).
- Development stores: Shopify test charges; do not skip server quota.

There is no billing code to reuse. This is new, using Shopify’s standard app subscription flow.

### Usage enforcement service

`app/lib/billing/quota.server.ts` (proposed), called inside the send pipeline **before** the provider HTTP call:

1. Resolve active plan for `shopId` (subscription status `ACTIVE`, else Starter).
2. Window: Starter/Growth/Scale = UTC calendar day. Not a rolling 24h window. Persist counters in UTC. Display those instants in the store’s Shopify timezone, and label the reset as UTC.
3. Ledger table `UsageLedger`: one row per logical notification (`shopId`, `stockAlertId`, `restockEventId`, `periodKey`, `state`).
4. States: `reserved` → `consumed` (provider accepted) or `released` (permanent failure before accept, or reservation expired). A retry of the same logical notification does **not** insert a second consumed row.
5. Reservation uses a transaction with `SELECT … FOR UPDATE` on a `UsageCounter` row `(shopId, periodKey)` so concurrent jobs cannot exceed the cap. Increment `reservedCount` only when `consumedCount + reservedCount < allowance`.
6. Count **attempts** (reservations that reached the provider) and **accepted sends** (`consumed`) separately. A non-2xx is not `consumed`. Retryable failure releases the reservation if the same logical send will retry inside the same period; it stays consumed if the provider accepted the message (2xx) even when a later bounce arrives. Bounces do not refund quota (recommend; decision in section 12).
7. Duplicate webhook: no new reservation if a ledger row already exists for `(stockAlertId, restockEventId)`.
8. Over quota: leave alert `PENDING` (or a new `QUOTA_HELD` status), do not call the provider, surface “Notification limit reached” on the admin home. Do not depend on disabling a button.

**Merchant-owned policy (approved):** Starter and Growth are managed-sender only and always count toward quota. Scale with a configured merchant/custom provider is unlimited (does not reserve quota). Scale on the managed sender still counts toward the 1,000/day allowance.

Platform-managed sends use env Mailgun (once built) and the same quota. Counters are always `shopId`-scoped.

## 9. Reliability design (on top of what exists)

Keep `claimPendingAlerts` as the per-subscriber lock. Add a `RestockEvent` row when a webhook or cron decides a variant is purchasable: `(shopId, variantId, inventoryItemId, observedAvailable, sourceWebhookId)` unique enough to collapse duplicate inventory webhooks that arrive within a short window **or** unique on `(shopId, variantId)` while alerts for that wave are open. Practical rule that matches the current model:

- One logical notification per `StockAlert` id per transition into `SENDING` that ends in `SENT`.
- A later restock requires the row to be `PENDING` again (resubscribe), **unless** product approves auto-rearm after `SENT` when stock hits zero and returns. Today the code does **not** auto-rearm. Call that out as a product decision.

Decouple send from the webhook:

- Webhook verifies, claims webhook id, inserts `RestockEvent`, enqueues work, returns 200 quickly.
- Worker (cron or in-process queue) claims alerts in batches (for example 50) and sends with provider-aware rate limits.
- Until a real queue exists, the first implementation slice may keep inline send but must cap work per request and leave the rest `PENDING` for cron. Cron is already the retry hook; it is not scheduled in-repo.

Also handle: unsubscribe during `SENDING` (re-read status before send), invalid email (permanent fail), stock dropped to zero before send (re-check GraphQL; if not purchasable, release claim back to `PENDING` without counting a successful send).

## 10. Proposed schema, API, and UI deltas

Reuse `Shop`, `StockAlert`, `WebhookEvent`, settings page, and `sendEmail` call sites.

Add (names indicative):

- `Plan`, `BillingSubscription`
- `UsageCounter`, `UsageLedger`
- `EmailDeliveryAttempt` (`stockAlertId`, `restockEventId`, `provider`, `providerMessageId`, `status`, `errorCode`, `createdAt`) — no secrets
- `RestockEvent`
- `EmailSuppression` (`shopId`, `email`, `reason`)
- Shop fields or `ShopEmailConfig`: `deliveryMode` (`managed` | `merchant`), `providerStatus`, SMTP non-secret fields, `credentialsCiphertext` (single blob)

Migration risks: PostgreSQL is already the datasource (not SQLite). Adding tables is additive. Do not rewrite `StockAlert` uniqueness in the first migration. Backfill `deliveryMode = merchant` where `apiKey` is set, else `managed`. Encrypt any legacy plaintext `apiKey` values in a one-off script that does not print secrets.

New or changed routes (all `authenticate.admin` except webhooks):

- Extend `app.settings` action: mode, SMTP fields, test email.
- `GET` usage on `app._index` loader (real counts).
- Billing return route: confirm subscription.
- Optional `POST` provider test.
- Do not add a public route that sends mail without the proxy rate limits.

Indexes: usage `(shopId, periodKey)` unique; ledger unique `(stockAlertId, restockEventId)`; attempts by `(shopId, createdAt)`.

Retention: prune `WebhookEvent` already exists; apply a similar retention to attempt rows (for example 180 days) after approval. Customer emails stay as long as the alert row; GDPR delete path already removes alerts and must also remove attempts and suppression for that customer.

## 11. Admin UI (real data only)

Extend existing Polaris pages; do not add mock charts.

- Home: plan name, sent today, sent this month, remaining allowance, last error count from `EmailDeliveryAttempt`.
- Alerts: existing list; show last error and provider message id when present; keep retry for `FAILED`.
- Settings: managed vs merchant (merchant option disabled with upgrade CTA when `allowMerchantProvider` is false), provider select, credential field (write-only), sender, verification status, test email button, recent failures (last 20 from attempts).
- Billing: current plan and Shopify confirmation redirect. No client-side price math that disagrees with `Plan` rows.

## 12. Approved product decisions

Approved by the product owner. Do not reopen these unless they ask.

1. **Managed provider:** Mailgun. Platform credentials stay in server environment variables. The current repo does not call Mailgun yet; that is new work.
2. **v1 merchant providers:** Resend, Brevo, SendGrid, and SMTP. Amazon SES and Postmark stay out of v1. Klaviyo remains an event trigger only and does not count as a delivered email or as quota consumption.
3. **Who may set their own SMTP (or other merchant provider):** Scale only. Starter and Growth use managed delivery only. The settings screen shows the form locked for Starter/Growth, with an upgrade path to Scale.
4. **Quota:** Starter 30/day, Growth 250/day, Scale 1,000/day on the managed sender. Scale merchant/custom provider sends are unlimited and do not count toward quota.
5. **Merchant log visibility:** every plan can see a notification list with counts (sent today, sent this period, remaining allowance). Starter merchants see only the latest **25** send-log rows, not a full delivery report or export of the log. Growth and Scale see the fuller report (history beyond 25, consistent with the alerts export already in the app).
6. **After a successful notify:** the subscriber stays `SENT` until they sign up again. No auto-rearm when stock hits zero.
7. **Cancellation:** follow Shopify’s recurring app-subscription default. Do not cut the shop to Starter at the moment of cancel. Keep the paid plan until Shopify’s current period end, then treat the shop as Starter. Immediate loss of paid features only if Shopify’s subscription status itself ends immediately.
8. **Test emails:** do not consume customer notification quota. Rate-limit them per shop. **Bounces do not refund quota.**
9. **Time:** persist period keys, counters, and timestamps in **UTC**. When showing “today” and log times to the merchant, convert from UTC into the **store’s Shopify timezone**. Quota windows themselves stay UTC calendar day for Starter, Growth, and Scale, so a shop near a timezone boundary still resets on the UTC boundary. The UI must label that the allowance resets in UTC, and show the store-local equivalent of that reset instant.
10. **SMS:** Twilio stays optional and is outside email plan quotas unless a later decision says otherwise.

## 13. Phased roadmap (after approval)

1. **Billing and plans** — seed `Plan`, Shopify subscription create/confirm/cancel, Starter default. No send-path change yet.
2. **Usage ledger and server enforcement** — reserve/consume/release inside `deliver` before `sendEmail`. Over-quota does not call the provider.
3. **Provider interface** — wrap existing Resend/Brevo/SendGrid; add Mailgun managed mode; SMTP; write-only credentials; sender check; test email.
4. **Delivery attempts + restock event** — persist provider ids; idempotency key; move bulk send off the webhook onto the existing cron (document the external scheduler).
5. **Admin UI** — usage, failures, provider status, plan, using loader data only.
6. **Bounces/unsubscribe suppression** — if provider webhooks are in scope.
7. **Wishlist regression** — run existing wishlist tests; do not edit wishlist behavior.

## 14. Testing and rollout

### Existing automated tests

- `app/models/__tests__/stock-alert.server.test.ts` — status enum only. Does **not** hit the database.
- `app/models/__tests__/wishlist.server.test.ts`
- `app/lib/__tests__/crypto.server.test.ts`
- `app/lib/__tests__/template.server.test.ts`
- `app/lib/__tests__/proxy.server.test.ts`

No test sends email. No webhook fixture test. No billing test.

### Proposed tests (new)

1. Subscribe route rejects in-stock variant and inserts `PENDING` for an out-of-stock variant.
2. Inventory handler dispatches only when GraphQL reports purchasable (mock admin client).
3. N subscribers → N sends, one each (mock provider).
4. Same webhook id twice → one claim.
5. Variant not purchasable at send time → no provider call; row not `SENT`.
6. Managed provider success stores message id; failure stores error and does not mark `SENT`.
7. Invalid API key → permanent or auth failure, no secret in the thrown message.
8. SMTP connect/TLS failure surfaces a stable error code.
9. Switching provider does not delete `StockAlert` rows.
10. From address rejected when sender validation fails.
11. Starter: 31st send in the UTC day is not sent.
12. Growth: 251st send in the UTC day is not sent.
13. Scale managed: 1001st send in the day is not sent; Scale with merchant provider is not capped.
14. Two concurrent reservations cannot both pass when one slot remains.
15. Retry reuses the ledger row; no second `consumed` increment.
16. Subscription cancel resolves the shop to Free.
17. Shop A session cannot read shop B alerts, settings, or usage.
18. Unsubscribe and suppression skip send.
19. Existing wishlist tests still pass.
20. `npm run build` succeeds; webhook tests assert `authenticate.webhook` is used (reject unsigned bodies). Do not send live customer mail in CI.

Rollout: ship quota enforcement before marketing the allowances. Use Shopify test billing on a dev store. Keep merchant provider behind the plan flag. Watch `FAILED` rate and webhook 500s. Do not enable a production Mailgun key until sender domain DNS is verified.

## 15. Gaps this audit did not execute

- Did not run the app, Vitest, or a production build (audit-only; behavior must stay unchanged).
- Did not call Shopify or any email provider.
- Did not inspect host env files or Partner Dashboard webhook registrations beyond `shopify.app.toml`.
- Did not verify the live database matches the Prisma migrations.
