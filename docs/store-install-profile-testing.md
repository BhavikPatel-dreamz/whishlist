# Store install profile — testing checklist

## Prerequisites

1. Apply the migration and regenerate the client:

```bash
npx prisma migrate deploy
npx prisma generate
```

2. Deploy config so Partner Dashboard picks up scopes + webhooks:

```bash
shopify app deploy
# or during local dev: shopify app dev
```

3. Re-approve scopes on the dev store after `read_locales`, `read_markets`, and `read_publications` were added.

## Install (first time)

- [ ] Install the app on a clean / previously uninstalled dev store.
- [ ] Confirm `afterAuth` completes quickly (app loads; no long hang).
- [ ] `Shop` row exists for the domain with profile fields (name, currency, timezone, plan, address).
- [ ] `StoreInstallEvent` has type `INSTALL`, scopes, and `appVersion` if set (`shopId` → Shop).
- [ ] `installCount` is `1`, `isActive` is `true`, `uninstalledAt` is null.
- [ ] If an online session was available, `StoreInstaller` has user id / name / email / locale / flags; otherwise the row may be absent (expected).
- [ ] Within a few seconds (background enrichers), confirm:
  - [ ] `accessScopes` / `activeSubscriptions` / `uninstallUrl` filled when available
  - [ ] (optional / currently disabled) locations, markets, locales, themes, publications, stats

## Reinstall

- [ ] Uninstall, then reinstall the same shop.
- [ ] Same `Shop.shop` row is updated (no duplicate).
- [ ] `installCount` increments by 1.
- [ ] New `StoreInstallEvent` with type `REINSTALL`.
- [ ] `isActive` true again; `uninstalledAt` cleared; `installedAt` refreshed.

## Uninstall

- [ ] Uninstall from Admin → Apps.
- [ ] `app/uninstalled` returns 200.
- [ ] `Shop.isActive` false, `uninstalledAt` set, `UNINSTALL` event created.
- [ ] Sessions for that shop are deleted; `Shop.accessToken` cleared.
- [ ] Wishlist / stock-alert data still present until `shop/redact` (by design).

## shop/update

- [ ] Edit store name or address in Shopify Admin → Settings → Store details.
- [ ] Confirm `shop/update` webhook fires and `Shop` name/address/currency/timezone update.

## app/scopes_update

- [ ] Change granted scopes (or re-auth with updated scopes).
- [ ] `Shop.scopes` / `accessScopes` update and a `SCOPES_UPDATE` event is recorded.

## Optional sync webhooks

- [ ] Publish a theme → `themes` JSON refreshes.
- [ ] Create/update/delete a location → `StoreLocation` stays in sync (when webhook enabled).
- [ ] Create/update/delete a market → `StoreMarket` stays in sync (when webhook enabled).

## GDPR compliance

- [ ] From Partner Dashboard → App setup → Compliance webhooks (or Shopify’s GDPR test tools), fire:
  - [ ] `customers/data_request` → 200 (ack; no standalone PII profiles to export).
  - [ ] `customers/redact` → wishlist / stock-alert / tracking / notification rows for that customer removed.
  - [ ] `shop/redact` → `Shop` (+ installer/locations/markets/stats/events cascades) and `Session` deleted for that domain.

## Failure isolation

- [ ] Temporarily revoke `read_markets` (or break one GraphQL field): install still succeeds; only that enricher logs a warning.
- [ ] Throttling: with heavy Admin traffic, retries with backoff should recover without failing the whole enrich pass.

## Notes

- API version: Admin client uses `ApiVersion.October25` (`2025-10`); webhook `api_version` in `shopify.app.toml` matches.
- Extended `shop` fields fall back to a smaller query if the full selection set fails on a given API version.
- Do not store customer emails/names beyond what installer online session and existing alert contacts already require; `StoreStats` is counts only.
