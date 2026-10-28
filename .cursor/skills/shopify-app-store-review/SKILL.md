---
name: shopify-app-store-review
description: >-
  Run a pre-submission Shopify App Store compliance check against this app's
  codebase. Use when the user asks for /shopify-app-store-review, App Store
  review prep, or pre-submission compliance.
---

# Shopify App Store self-review

Follow the official App Store AI self-review flow from Shopify.

## Steps

1. From the app project root, fetch the live requirements (do not use curl/browser):

```bash
shopify doc fetch --url https://shopify.dev/docs/apps/launch/app-store-review/app-store-ai-self-review-requirements --output app-store-review-requirements.md
```

2. Read `app-store-review-requirements.md` and evaluate each requirement against this codebase.

3. Statuses:
   - **Likely passing** — clear positive evidence in code/config
   - **Likely failing** — clear violation or missing required implementation
   - **Needs review** — cannot confirm from code alone (prefer this over a silent pass)

4. Skip conditional groups when their signal is absent; skip opt-in groups unless the user asked.

5. Output the report in this shape:

### Summary
✅ Likely passing / ❌ Likely failing / ⚠️ Needs review / ⏭️ Groups skipped

### ⚠️ Requirements that need review
### ❌ Requirements that are likely failing
### Skipped groups
### Resources (if any fail or need review)
- https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices
- https://shopify.dev/docs/apps/launch/billing
- https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review

## Project notes (Wishlist Stock Notify)

- Embedded Remix app; theme extension with wishlist + back-in-stock embeds
- Billing via Shopify App Pricing (Starter/Growth/Scale); welcome path `/app/settings`
- GDPR webhooks: customers/data_request, customers/redact, shop/redact
- Privacy page: check `/privacy` route if present
- Managed email: Mailgun; Scale can use merchant providers
