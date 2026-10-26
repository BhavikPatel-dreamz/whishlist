# Wishlist + Back in Stock – Analytics Reports (Build Spec for Cursor)

> Put this file in the repo root (or `/docs`). In Cursor, attach it with `@ANALYTICS_REPORTS_SPEC.md` and build one phase at a time using the prompts in section 11.

## 1. Goal

Add an **Analytics** section to the existing Shopify app (Wishlist + Back in Stock) with 34 reports across 5 groups, all showing standard conversion rates. Merchants must be able to filter by date range, compare with the previous period, and export CSV.

## 2. Assumed stack (change if different)

| Area | Assumption |
|---|---|
| App | Shopify Remix app (Node, TypeScript) |
| UI | Polaris (admin) + Polaris Viz or Recharts for charts |
| DB | PostgreSQL via Prisma |
| Jobs | Cron or queue (BullMQ/Redis) for daily rollups |
| Storefront | Theme app extension + App Proxy for event tracking |
| Webhooks | `orders/create`, `orders/cancelled`, `refunds/create`, `inventory_levels/update`, `products/update`, `customers/update` |

## 3. Core rules (follow in all code)

1. Every table has `shopId` and every query filters by it (multi-tenant).
2. Reports read from **`DailyStat` rollups** where possible, and from raw events only for drill-down tables.
3. All rates go through one helper, `safeRate(numerator, denominator)`, which returns `0` when the denominator is `0`. Never divide inline.
4. Revenue is always labeled `direct` or `estimated` (see section 6).
5. All dates stored in UTC; reports convert to the shop timezone for grouping by day.
6. Attribution window is a per-shop setting. Defaults: back-in-stock 7 days, wishlist 14 days.
7. Webhook handlers must be idempotent (unique keys on order and line item).
8. Every report endpoint supports `from`, `to`, `compare=true|false`, `page`, `pageSize`, `sort`, `format=json|csv`.

## 4. Data model (Prisma)

```prisma
model ShopSettings {
  shopId                String  @id
  wishlistWindowDays    Int     @default(14)
  restockWindowDays     Int     @default(7)
  abandonedAfterDays    Int     @default(30)
  lowStockThreshold     Int     @default(5)
  timezone              String  @default("UTC")
  weeklyReportEmail     Boolean @default(false)
}

// Current state of a saved item
model WishlistItem {
  id          String   @id @default(cuid())
  shopId      String
  shopperId   String            // customerId if logged in, else device id
  customerId  String?
  productId   String
  variantId   String?
  collectionIds String[]
  source      String?           // pdp | collection | search | cart | other
  device      String?           // desktop | mobile | tablet
  isGuest     Boolean  @default(true)
  savedAt     DateTime @default(now())
  removedAt   DateTime?
  @@index([shopId, productId])
  @@index([shopId, shopperId])
  @@unique([shopId, shopperId, productId, variantId])
}

// Append-only event log
model TrackingEvent {
  id         String   @id @default(cuid())
  shopId     String
  shopperId  String
  customerId String?
  type       EventType
  productId  String?
  variantId  String?
  channel    String?           // share channel: link | email | social
  source     String?
  device     String?
  meta       Json?
  createdAt  DateTime @default(now())
  @@index([shopId, type, createdAt])
  @@index([shopId, productId, type])
}

enum EventType {
  PRODUCT_VIEW
  WISHLIST_SAVE
  WISHLIST_REMOVE
  WISHLIST_ADD_TO_CART
  WISHLIST_SHARE
  WISHLIST_SHARE_VISIT
  ALERT_FORM_VIEW
  ALERT_SUBSCRIBE
  NOTIFICATION_CLICK
}

model StockSubscription {
  id           String   @id @default(cuid())
  shopId       String
  shopperId    String
  customerId   String?
  contact      String            // email or phone
  channel      Channel
  productId    String
  variantId    String
  status       SubStatus @default(PENDING)  // PENDING | QUEUED | NOTIFIED | CANCELLED
  pendingReason String?          // out_of_stock | queued | unconfirmed
  confirmed    Boolean  @default(true)      // double opt-in
  source       String?
  device       String?
  createdAt    DateTime @default(now())
  notifiedAt   DateTime?
  @@index([shopId, productId, status])
}

model NotificationLog {
  id             String   @id @default(cuid())
  shopId         String
  kind           NotifKind         // RESTOCK | WISHLIST_REMINDER | PRICE_DROP | LOW_STOCK_NUDGE
  channel        Channel           // EMAIL | SMS | WHATSAPP | PUSH
  subscriptionId String?
  wishlistItemId String?
  shopperId      String
  productId      String
  variantId      String?
  status         String            // queued | sent | delivered | bounced | failed
  errorReason    String?
  retryCount     Int      @default(0)
  restockedAt    DateTime?         // when inventory went back > 0 (for time-to-notify)
  sentAt         DateTime?
  deliveredAt    DateTime?
  openedAt       DateTime?
  clickedAt      DateTime?
  unsubscribedAt DateTime?
  @@index([shopId, kind, sentAt])
}

model Attribution {
  id            String   @id @default(cuid())
  shopId        String
  orderId       String
  lineItemId    String
  orderNumber   String
  customerId    String?
  shopperId     String?
  productId     String
  variantId     String?
  source        AttrSource     // WISHLIST | RESTOCK_ALERT
  type          AttrType       // DIRECT | ESTIMATED
  model         String         // last_click | any_touch
  notificationLogId String?
  wishlistItemId    String?
  revenue       Decimal
  quantity      Int
  orderedAt     DateTime
  touchAt       DateTime       // when the qualifying save/click happened
  @@unique([shopId, lineItemId, source, model])
  @@index([shopId, orderedAt])
}

model InventoryCache {
  shopId     String
  variantId  String
  productId  String
  quantity   Int
  status     String     // in_stock | low_stock | out_of_stock
  price      Decimal?
  updatedAt  DateTime   @updatedAt
  lastOutOfStockAt DateTime?
  lastRestockedAt  DateTime?
  @@id([shopId, variantId])
}

// One row per shop per day (rollup)
model DailyStat {
  shopId   String
  date     DateTime   @db.Date
  productViews Int @default(0)
  wishlistSaves Int @default(0)
  wishlistRemoves Int @default(0)
  uniqueSavers Int @default(0)
  wishlistAddToCart Int @default(0)
  shares Int @default(0)
  shareVisits Int @default(0)
  alertSubscriptions Int @default(0)
  pendingAlerts Int @default(0)
  notificationsSent Int @default(0)
  notificationsDelivered Int @default(0)
  notificationsOpened Int @default(0)
  notificationClicks Int @default(0)
  unsubscribes Int @default(0)
  wishlistOrders Int @default(0)
  restockOrders Int @default(0)
  wishlistRevenueDirect Decimal @default(0)
  wishlistRevenueEstimated Decimal @default(0)
  restockRevenueDirect Decimal @default(0)
  restockRevenueEstimated Decimal @default(0)
  @@id([shopId, date])
}
```

## 5. Event tracking (storefront → backend)

| Event | Trigger | Endpoint |
|---|---|---|
| `PRODUCT_VIEW` | Product page load | `POST /apps/<proxy>/track` |
| `WISHLIST_SAVE` / `REMOVE` | Heart icon toggle | same, also upserts `WishlistItem` |
| `WISHLIST_ADD_TO_CART` | Add to cart from wishlist page | same |
| `WISHLIST_SHARE` / `SHARE_VISIT` | Share action / open of a shared link | same |
| `ALERT_SUBSCRIBE` | Back-in-stock form submit | creates `StockSubscription` |
| `NOTIFICATION_CLICK` | Redirect through tracked link `/r/:logId` | sets `clickedAt`, sets cookie `bis_click` with `logId`, redirects |

Shopper identity: `shopperId = customerId` when logged in, otherwise a first-party device id cookie. When a guest logs in or checks out, **merge**: update `shopperId` on their `WishlistItem`, `StockSubscription` and events to the customer id and set `isGuest=false` (feeds report 2.10).

## 6. Attribution logic (runs in `orders/create`)

For each line item in the order:

1. Resolve shopper: customer id, else cart attribute `_app_shopper_id`, else email match on `StockSubscription.contact`.
2. **Restock alert, DIRECT:** find the latest `NotificationLog` (kind `RESTOCK`) for the same shopper and product with `clickedAt` within `restockWindowDays` before the order. Create `Attribution(source=RESTOCK_ALERT, type=DIRECT)`.
3. **Restock alert, ESTIMATED:** same, but notification was sent (not clicked) within the window and the shopper bought the product.
4. **Wishlist, DIRECT:** a wishlist-reminder/price-drop notification click within `wishlistWindowDays`, or the order came from the wishlist page (cart attribute `_from_wishlist=1`).
5. **Wishlist, ESTIMATED:** the shopper has an active `WishlistItem` for the product saved within `wishlistWindowDays`, and no direct touch exists.
6. One line item gets **one** attribution for `last_click` (priority: direct restock click > direct wishlist > estimated restock > estimated wishlist). For `any_touch`, store every qualifying touch (feeds report 1.5).
7. On `refunds/create` or `orders/cancelled`, reduce or delete the attribution so revenue stays correct.

## 7. Metric definitions (put in `app/lib/metrics.ts`)

```ts
export const safeRate = (n: number, d: number) => (d > 0 ? n / d : 0);

// Every report uses these. Do not re-implement inline.
export const rates = {
  saveRate:            (saves, views)      => safeRate(saves, views),
  saveToCartRate:      (carted, saves)     => safeRate(carted, saves),
  wishlistConversion:  (purchased, saves)  => safeRate(purchased, saves),
  wishlistShopperRate: (buyers, savers)    => safeRate(buyers, savers),
  notificationRate:    (notified, subs)    => safeRate(notified, subs),
  openRate:            (opened, delivered) => safeRate(opened, delivered),
  clickRate:           (clicked, delivered)=> safeRate(clicked, delivered),
  clickToPurchase:     (purchased, clicked)=> safeRate(purchased, clicked),
  restockConversion:   (purchased, subs)   => safeRate(purchased, subs),
  revenuePerNotif:     (revenue, sent)     => safeRate(revenue, sent),
  dropOffRate:         (curr, prev)        => prev > 0 ? 1 - curr / prev : 0,
  demandGap:           (waiting, stock)    => waiting - stock,
};
```

| Metric | Formula |
|---|---|
| Wishlist save rate | Saves ÷ product views |
| Save-to-cart rate | Wishlisted items added to cart ÷ saves |
| Wishlist conversion rate | Purchases of saved items ÷ saves (inside window) |
| Notification rate | Notified ÷ subscribed |
| Open rate | Opened ÷ delivered |
| Click-through rate | Clicked ÷ delivered |
| Click-to-purchase | Purchased ÷ clicked |
| Restock conversion | Purchased ÷ subscribed |
| Revenue per notification | Attributed revenue ÷ sent |
| Drop-off rate | 1 − (stage ÷ previous stage) |
| Waiting demand gap | Waiting shoppers − stock |

## 8. Report catalog

**Phase:** 1 = MVP, 2 = next, 3 = later. **Source:** `DS` = DailyStat, `EV` = TrackingEvent, `WI` = WishlistItem, `SUB` = StockSubscription, `NL` = NotificationLog, `ATT` = Attribution, `INV` = InventoryCache.

### 8.1 Overview

| ID | Report | Phase | Metrics / columns | Source |
|---|---|---|---|---|
| 1.1 | Overview Dashboard | 1 | KPI cards with previous-period delta: saves, unique savers, subscriptions, pending alerts, sent, clicks, orders, attributed revenue, overall conversion. Trend chart, top 5 products, links to detail reports | DS, ATT |
| 1.2 | Activity Trends | 1 | Line chart by day/week/month: saves, subscriptions, sends. Compare toggle | DS |
| 1.3 | Conversion Funnel | 1 | Wishlist: viewed → saved → added to cart → purchased. Back in stock: subscribed → notified → clicked → purchased. Each stage: count, rate from previous, drop-off count and rate | EV, SUB, NL, ATT |
| 1.4 | Revenue & Sales Attribution | 1 | Orders and revenue by source, split direct vs estimated | ATT |
| 1.5 | Attribution Model Comparison | 3 | Last-click vs any-touch revenue; window selector (7/14/30) | ATT |
| 1.6 | Customer-Value Impact | 3 | AOV and repeat-purchase rate: app users vs non-users | Orders, EV |

### 8.2 Wishlist

| ID | Report | Phase | Metrics / columns | Source |
|---|---|---|---|---|
| 2.1 | Wishlisted Products | 1 | Product, saves, unique shoppers, save rate. Filter by collection/date, search by name, sort by saves | WI, EV |
| 2.2 | Shared Wishlists | 3 | Shares by channel, visits, orders after visit, visit-to-order rate | EV, ATT |
| 2.3 | Wishlist Orders | 2 | Order no. (links to Shopify), date, customer, wishlisted products, value | ATT |
| 2.4 | Wishlist Conversion | 1 | Per product: saves, purchases, conversion rate, avg days save → purchase. Rank best/worst | WI, ATT |
| 2.5 | Removed & Abandoned | 2 | Tab A: removes per product. Tab B: saved, not purchased after N days (`abandonedAfterDays`) | WI, ATT |
| 2.6 | Wishlist to Cart | 2 | Add-to-cart rate and moves from wishlist to cart, per product | EV |
| 2.7 | Variant-Level Demand | 2 | Saves by variant (size/color) | WI |
| 2.8 | Save Source Report | 3 | Saves by page source, device, guest vs logged-in | WI |
| 2.9 | Reminder & Price-Drop Performance | 3 | Sent, opened, clicked, converted per kind and channel | NL, ATT |
| 2.10 | Guest-to-Customer Conversion | 3 | Guest saves that became identified customers; merge rate | WI |

### 8.3 Back in Stock

| ID | Report | Phase | Metrics / columns | Source |
|---|---|---|---|---|
| 3.1 | Stock List & Inventory | 2 | Product/variant, quantity, status (in/low/out), waiting count. Filter by status | INV, SUB |
| 3.2 | Alert Subscriptions | 1 | Product, variant, total subs, new subs over time | SUB |
| 3.3 | Pending Alerts | 1 | Shopper, product, variant, signup date, pending reason | SUB |
| 3.4 | Alert Purchases | 2 | Order no., date, customer, product, value, the alert that led to it | ATT, NL |
| 3.5 | Restock Conversion | 1 | Per product: subscribed → notified → clicked → purchased, rates, revenue | SUB, NL, ATT |
| 3.6 | Low Stock Demand | 2 | Flag when stock < waiting (wishlist saves + pending subs). Sort by gap | INV, WI, SUB |
| 3.7 | Notification Delivery | 1 | Sent, delivered, bounced, opened, clicked, unsubscribed by channel. Open, click and bounce rates | NL |
| 3.8 | Time-to-Notify & Time-to-Purchase | 2 | Avg and median minutes: restock → sent, sent → purchase | NL, ATT |
| 3.9 | Lost Sales / Missed Revenue | 2 | Waiting subscribers × price for out-of-stock variants | SUB, INV |
| 3.10 | Sell-Through After Restock | 3 | Time to sell out after restock; subscribers notified who missed stock | INV, NL, ATT |
| 3.11 | Subscription Source Report | 3 | Signups by form type, page, device; double opt-in confirmation rate | SUB |

### 8.4 Customer

| ID | Report | Phase | Metrics / columns | Source |
|---|---|---|---|---|
| 4.1 | Recurring Customer | 2 | Customer, saves, subs, clicks, orders, spend, last activity. Repeat rule: ≥ N actions in range (setting) | All |
| 4.2 | Top Customers by Intent | 3 | Most saves/subs with no purchase yet | WI, SUB, ATT |
| 4.3 | Customer Segments Export | 3 | CSV/sync of "wishlist, no purchase" and "subscribed, no purchase" | WI, SUB, ATT |

### 8.5 Operations

| ID | Report | Phase | Metrics / columns | Source |
|---|---|---|---|---|
| 5.1 | Notification Log | 3 | Every send with status, error, retries | NL |
| 5.2 | Usage vs Plan | 3 | Notifications used vs plan limit | NL |
| 5.3 | Scheduled Email Reports | 3 | Weekly/monthly summary to merchant | DS |
| 5.4 | CSV Export on every report | 3 | `format=csv` on all endpoints | – |

## 9. API contract

All endpoints are authenticated admin routes, e.g. `GET /app/api/reports/:slug`.

**Query params:** `from`, `to` (ISO dates), `compare` (bool), `groupBy` (day|week|month), `collectionId`, `productId`, `status`, `channel`, `q`, `page`, `pageSize`, `sort`, `order`, `format`.

**Response shape:**

```json
{
  "report": "wishlist-conversion",
  "range": { "from": "2026-10-01", "to": "2026-10-22" },
  "compareRange": { "from": "2026-09-09", "to": "2026-09-30" },
  "summary": { "saves": 1800, "purchases": 216, "conversionRate": 0.12, "delta": { "conversionRate": 0.015 } },
  "series": [{ "date": "2026-10-01", "saves": 80 }],
  "rows": [{ "productId": "…", "title": "…", "saves": 120, "purchases": 18, "conversionRate": 0.15 }],
  "pagination": { "page": 1, "pageSize": 25, "total": 340 },
  "revenueLabel": "estimated"
}
```

Slugs: `overview`, `activity-trends`, `conversion-funnel`, `revenue-attribution`, `attribution-models`, `customer-value`, `wishlisted-products`, `shared-wishlists`, `wishlist-orders`, `wishlist-conversion`, `removed-abandoned`, `wishlist-to-cart`, `variant-demand`, `save-sources`, `reminder-performance`, `guest-to-customer`, `stock-list`, `alert-subscriptions`, `pending-alerts`, `alert-purchases`, `restock-conversion`, `low-stock-demand`, `notification-delivery`, `time-to-notify`, `lost-sales`, `sell-through`, `subscription-sources`, `recurring-customers`, `top-intent-customers`, `segments`, `notification-log`, `usage`.

## 10. UI structure

```
/app/analytics                      Overview dashboard (1.1)
/app/analytics/wishlist             Wishlist reports (tabs: Products, Conversion, Orders, Removed/Abandoned, Shares, Sources…)
/app/analytics/back-in-stock        BIS reports (tabs: Subscriptions, Pending, Restock Conversion, Delivery, Stock List…)
/app/analytics/customers            Customer reports
/app/analytics/operations           Notification log, usage, scheduled reports
```

Shared components to build once:

- `DateRangePicker` with "compare to previous period"
- `KpiCard` (value, delta %, sparkline)
- `FunnelChart` (stage count, rate, drop-off)
- `ReportTable` (sorting, pagination, search, CSV export button)
- `RevenueBadge` (Direct / Estimated)
- `EmptyState` per report (no data yet)

## 11. Build order with Cursor prompts

Use each prompt in a new Cursor chat with this file attached.

**Step 1 – Foundation**
> Read @ANALYTICS_REPORTS_SPEC.md sections 3, 4 and 7. Add the Prisma models, run the migration, and create `app/lib/metrics.ts` with `safeRate` and the `rates` helpers plus unit tests. Do not build any UI yet.

**Step 2 – Tracking**
> Using section 5, add the storefront tracking endpoint via App Proxy, event ingestion, guest-to-customer merge, and the tracked redirect `/r/:logId` that records `clickedAt`. Make ingestion idempotent and fast (respond 204 and queue heavy work).

**Step 3 – Webhooks and attribution**
> Using section 6, implement `orders/create`, `orders/cancelled`, `refunds/create` and `inventory_levels/update` handlers. Create attribution rows (direct and estimated) for last_click and any_touch, idempotently. Add tests for each priority rule.

**Step 4 – Rollups**
> Build a job that computes `DailyStat` for each shop per day (and backfills a date range). Schedule it hourly for today and nightly for yesterday.

**Step 5 – Phase 1 report APIs**
> Build the Phase 1 report endpoints from section 8 and the contract in section 9: 1.1, 1.2, 1.3, 1.4, 2.1, 2.4, 3.2, 3.3, 3.5, 3.7. Use `DailyStat` for summaries and trends. Add CSV export and comparison-period support.

**Step 6 – Phase 1 UI**
> Build the shared components in section 10 and the Overview dashboard plus the Wishlist and Back in Stock tabs for the Phase 1 reports, using Polaris. Match the response shape in section 9.

**Step 7 – Phase 2** (reports 2.3, 2.5, 2.6, 2.7, 3.1, 3.4, 3.6, 3.8, 3.9, 4.1)
> Add the Phase 2 reports (API + UI) following the same patterns as Phase 1. Reuse shared components.

**Step 8 – Phase 3** (1.5, 1.6, 2.2, 2.8, 2.9, 2.10, 3.10, 3.11, 4.2, 4.3, 5.x)
> Add the Phase 3 reports and operations pages, then scheduled email reports.

## 12. Suggested `.cursor/rules/analytics.mdc`

```md
---
description: Analytics reports rules
globs: app/**/*.ts, app/**/*.tsx
---
- Every query must filter by shopId.
- Use safeRate/rates from app/lib/metrics.ts; never divide inline.
- Label revenue as direct or estimated.
- Read summaries from DailyStat; use raw tables only for drill-down.
- Webhook handlers must be idempotent.
- Report endpoints support from/to/compare/page/pageSize/sort/format.
```

## 13. Acceptance criteria

- Every report loads in under 1 second for a shop with 1M events (indexed queries and rollups).
- All rates match the definitions in section 7, and show 0 (not NaN) with no data.
- Revenue shown on every report is labeled direct or estimated.
- Funnel stage counts never exceed the previous stage (except documented cases such as multiple purchases).
- Date range, compare mode and CSV export work on every report.
- Webhooks can be replayed without double-counting.
- Guest saves and subscriptions merge into the customer record after login.

## 14. Open decisions

1. Final attribution windows per source (defaults: 7 days back in stock, 14 days wishlist).
2. Which channels ship first (email only, or also SMS, WhatsApp, push).
3. Whether `any_touch` is shown to merchants or kept internal.
4. Repeat rule for recurring customers (default: 3 or more actions in the selected range).
5. Plan limits for notifications (feeds report 5.2).