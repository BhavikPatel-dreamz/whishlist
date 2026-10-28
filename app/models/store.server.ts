/**
 * Install-time Shopify store profile sync.
 * Operational app data stays on `Shop`; merchant Shopify metadata lives on `Store`.
 */
import type { Prisma } from "@prisma/client";
import db from "../db.server";
import type { GraphqlClient } from "../lib/shopify-data.server";

export type StoreInstallEventType =
  | "INSTALL"
  | "REINSTALL"
  | "UNINSTALL"
  | "SCOPES_UPDATE";

/** Minimal session shape used by install sync (offline + optional onlineAccessInfo). */
export type InstallSession = {
  shop: string;
  scope?: string | null;
  accessToken?: string;
  onlineAccessInfo?: {
    associated_user?: {
      id?: number | string;
      first_name?: string;
      last_name?: string;
      email?: string;
      account_owner?: boolean;
      collaborator?: boolean;
      locale?: string;
    };
  };
};

function asJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined;
  return value as Prisma.InputJsonValue;
}

export type ShopifyShopNode = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  contactEmail?: string | null;
  description?: string | null;
  url?: string | null;
  myshopifyDomain?: string | null;
  primaryDomain?: { url?: string | null; host?: string | null } | null;
  currencyCode?: string | null;
  ianaTimezone?: string | null;
  timezoneOffset?: string | null;
  weightUnit?: string | null;
  unitSystem?: string | null;
  taxesIncluded?: boolean | null;
  taxShipping?: boolean | null;
  checkoutApiSupported?: boolean | null;
  setupRequired?: boolean | null;
  shipsToCountries?: string[] | null;
  currencyFormats?: Record<string, unknown> | null;
  features?: Record<string, unknown> | null;
  resourceLimits?: Record<string, unknown> | null;
  paymentSettings?: Record<string, unknown> | null;
  plan?: {
    displayName?: string | null;
    partnerDevelopment?: boolean | null;
    shopifyPlus?: boolean | null;
  } | null;
  billingAddress?: Record<string, unknown> | null;
  enabledPresentmentCurrencies?: string[] | null;
  createdAt?: string | null;
};

type AdminClient = Pick<GraphqlClient, "graphql">;

const APP_VERSION = process.env.npm_package_version || process.env.APP_VERSION || null;

const SHOP_QUERY = `#graphql
  query StoreInstallShop {
    shop {
      id
      name
      email
      contactEmail
      description
      url
      myshopifyDomain
      primaryDomain { url host }
      currencyCode
      ianaTimezone
      timezoneOffset
      weightUnit
      unitSystem
      taxesIncluded
      taxShipping
      checkoutApiSupported
      setupRequired
      shipsToCountries
      currencyFormats {
        moneyFormat
        moneyWithCurrencyFormat
      }
      plan { displayName partnerDevelopment shopifyPlus }
      billingAddress {
        company
        address1
        address2
        city
        province
        country
        countryCodeV2
        zip
        phone
        latitude
        longitude
      }
      enabledPresentmentCurrencies
      createdAt
      features {
        storefront
      }
      resourceLimits {
        maxProductVariants
        locationLimit
      }
      paymentSettings {
        currencyCode
      }
    }
  }
`;

const FALLBACK_SHOP_QUERY = `#graphql
  query StoreInstallShopFallback {
    shop {
      id
      name
      email
      contactEmail
      myshopifyDomain
      primaryDomain { url host }
      currencyCode
      ianaTimezone
      weightUnit
      unitSystem
      plan { displayName partnerDevelopment shopifyPlus }
      billingAddress {
        address1
        address2
        city
        province
        country
        zip
        phone
      }
      enabledPresentmentCurrencies
      createdAt
    }
  }
`;

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Basic GraphQL helper with retry/backoff on 429 / THROTTLED. */
export async function adminGraphqlJson<T>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
  attempts = 4,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await admin.graphql(query, { variables });
      const json = (await response.json()) as {
        data?: T;
        errors?: Array<{ message?: string; extensions?: { code?: string } }>;
      };
      const throttled = json.errors?.some(
        (error) =>
          /throttl/i.test(error.message || "") ||
          error.extensions?.code === "THROTTLED",
      );
      if (throttled) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      if (json.errors?.length) {
        throw new Error(json.errors.map((error) => error.message).join("; "));
      }
      return (json.data || {}) as T;
    } catch (error) {
      lastError = error;
      await sleep(250 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function installerFromSession(session: InstallSession): {
  shopifyUserId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  locale?: string;
  accountOwner?: boolean;
  collaborator?: boolean;
} | null {
  const online = session.onlineAccessInfo?.associated_user;

  if (online?.id || online?.email || online?.first_name) {
    return {
      shopifyUserId: online.id != null ? String(online.id) : undefined,
      firstName: online.first_name || undefined,
      lastName: online.last_name || undefined,
      email: online.email || undefined,
      locale: online.locale || undefined,
      accountOwner: Boolean(online.account_owner),
      collaborator: Boolean(online.collaborator),
    };
  }

  // Offline afterAuth often has no onlineAccessInfo; Session row may still hold online user fields.
  return null;
}

async function upsertInstallerFromOfflineSessionFields(
  storeId: string,
  session: InstallSession,
) {
  // Prisma Session mirror fields when an online login happened in the same browser.
  const row = await db.session.findFirst({
    where: { shop: session.shop, isOnline: true },
    orderBy: { id: "desc" },
  });
  if (!row?.email && !row?.userId && !row?.firstName) return;

  await db.storeInstaller.upsert({
    where: { storeId },
    create: {
      storeId,
      shopifyUserId: row.userId != null ? String(row.userId) : null,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      locale: row.locale,
      accountOwner: Boolean(row.accountOwner),
      collaborator: Boolean(row.collaborator),
    },
    update: {
      shopifyUserId: row.userId != null ? String(row.userId) : null,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      locale: row.locale,
      accountOwner: Boolean(row.accountOwner),
      collaborator: Boolean(row.collaborator),
    },
  });
}

export async function recordStoreInstallEvent(params: {
  storeId: string;
  type: StoreInstallEventType;
  scopes?: string | null;
  utmSource?: string | null;
}) {
  await db.storeInstallEvent.create({
    data: {
      storeId: params.storeId,
      type: params.type,
      scopes: params.scopes || null,
      appVersion: APP_VERSION,
      utmSource: params.utmSource || null,
    },
  });
}

/**
 * Fast path used during afterAuth: upsert Store from the shop query (or domain-only),
 * record installer when available, and emit INSTALL/REINSTALL. Heavy fetchers run later.
 */
export async function syncStoreInfo(
  admin: AdminClient | null,
  session: InstallSession,
  options?: { utmSource?: string | null },
): Promise<{ storeId: string; reinstall: boolean }> {
  const shopDomain = session.shop;
  const existing = await db.store.findUnique({ where: { shopDomain } });
  const reinstall = Boolean(existing && (!existing.isActive || existing.uninstalledAt));

  let shop: ShopifyShopNode | null = null;
  if (admin) {
    try {
      const data = await adminGraphqlJson<{ shop: ShopifyShopNode }>(admin, SHOP_QUERY);
      shop = data.shop;
    } catch (error) {
      console.warn("[store] full shop query failed, trying fallback", error);
      try {
        const data = await adminGraphqlJson<{ shop: ShopifyShopNode }>(
          admin,
          FALLBACK_SHOP_QUERY,
        );
        shop = data.shop;
      } catch (fallbackError) {
        console.error("[store] shop query failed; continuing with domain only", fallbackError);
      }
    }
  }

  const address = shop?.billingAddress
    ? {
        address1: shop.billingAddress.address1 ?? null,
        address2: shop.billingAddress.address2 ?? null,
        city: shop.billingAddress.city ?? null,
        province: shop.billingAddress.province ?? null,
        country: shop.billingAddress.country ?? null,
        zip: shop.billingAddress.zip ?? null,
        phone: shop.billingAddress.phone ?? null,
      }
    : undefined;

  const billingAddress = shop?.billingAddress
    ? {
        company: shop.billingAddress.company ?? null,
        countryCodeV2: shop.billingAddress.countryCodeV2 ?? null,
        latitude: shop.billingAddress.latitude ?? null,
        longitude: shop.billingAddress.longitude ?? null,
        ...address,
      }
    : undefined;

  const store = await db.store.upsert({
    where: { shopDomain },
    create: {
      shopDomain,
      shopifyShopId: shop?.id || null,
      name: shop?.name || null,
      email: shop?.email || null,
      contactEmail: shop?.contactEmail || null,
      description: shop?.description || null,
      url: shop?.url || shop?.primaryDomain?.url || null,
      primaryDomain: shop?.primaryDomain?.url || shop?.primaryDomain?.host || null,
      currency: shop?.currencyCode || null,
      timezone: shop?.ianaTimezone || null,
      timezoneOffset: shop?.timezoneOffset || null,
      weightUnit: shop?.weightUnit || null,
      unitSystem: shop?.unitSystem || null,
      planName: shop?.plan?.displayName || null,
      isDevStore: Boolean(shop?.plan?.partnerDevelopment),
      isShopifyPlus: Boolean(shop?.plan?.shopifyPlus),
      address: asJson(address),
      billingAddress: asJson(billingAddress),
      presentmentCurrencies: asJson(shop?.enabledPresentmentCurrencies),
      currencyFormats: asJson(shop?.currencyFormats),
      taxesIncluded: shop?.taxesIncluded ?? null,
      taxShipping: shop?.taxShipping ?? null,
      checkoutApiSupported: shop?.checkoutApiSupported ?? null,
      setupRequired: shop?.setupRequired ?? null,
      shipsToCountries: asJson(shop?.shipsToCountries),
      features: asJson(shop?.features),
      resourceLimits: asJson(shop?.resourceLimits),
      paymentSettings: asJson(shop?.paymentSettings),
      shopCreatedAt: shop?.createdAt ? new Date(shop.createdAt) : null,
      scopes: session.scope || null,
      isActive: true,
      installCount: 1,
      installedAt: new Date(),
      uninstalledAt: null,
    },
    update: {
      shopifyShopId: shop?.id || undefined,
      name: shop?.name || undefined,
      email: shop?.email || undefined,
      contactEmail: shop?.contactEmail || undefined,
      description: shop?.description || undefined,
      url: shop?.url || shop?.primaryDomain?.url || undefined,
      primaryDomain: shop?.primaryDomain?.url || shop?.primaryDomain?.host || undefined,
      currency: shop?.currencyCode || undefined,
      timezone: shop?.ianaTimezone || undefined,
      timezoneOffset: shop?.timezoneOffset || undefined,
      weightUnit: shop?.weightUnit || undefined,
      unitSystem: shop?.unitSystem || undefined,
      planName: shop?.plan?.displayName || undefined,
      isDevStore: shop?.plan ? Boolean(shop.plan.partnerDevelopment) : undefined,
      isShopifyPlus: shop?.plan ? Boolean(shop.plan.shopifyPlus) : undefined,
      address: asJson(address),
      billingAddress: asJson(billingAddress),
      presentmentCurrencies: asJson(shop?.enabledPresentmentCurrencies),
      currencyFormats: asJson(shop?.currencyFormats),
      taxesIncluded: shop?.taxesIncluded ?? undefined,
      taxShipping: shop?.taxShipping ?? undefined,
      checkoutApiSupported: shop?.checkoutApiSupported ?? undefined,
      setupRequired: shop?.setupRequired ?? undefined,
      shipsToCountries: asJson(shop?.shipsToCountries),
      features: asJson(shop?.features),
      resourceLimits: asJson(shop?.resourceLimits),
      paymentSettings: asJson(shop?.paymentSettings),
      shopCreatedAt: shop?.createdAt ? new Date(shop.createdAt) : undefined,
      scopes: session.scope || undefined,
      isActive: true,
      uninstalledAt: null,
      installedAt: reinstall ? new Date() : undefined,
      installCount: reinstall ? { increment: 1 } : undefined,
    },
  });

  const installer = installerFromSession(session);
  if (installer) {
    await db.storeInstaller.upsert({
      where: { storeId: store.id },
      create: { storeId: store.id, ...installer },
      update: { ...installer },
    });
  } else {
    await upsertInstallerFromOfflineSessionFields(store.id, session).catch((error) => {
      console.warn("[store] installer upsert skipped", error);
    });
  }

  // Only emit install lifecycle events on first install or true reinstall
  // (not on routine re-auth while the app is still active).
  if (!existing || reinstall) {
    await recordStoreInstallEvent({
      storeId: store.id,
      type: reinstall ? "REINSTALL" : "INSTALL",
      scopes: session.scope,
      utmSource: options?.utmSource,
    });
  }

  return { storeId: store.id, reinstall };
}

async function syncCurrentAppInstallation(admin: AdminClient, storeId: string) {
  const data = await adminGraphqlJson<{
    currentAppInstallation: {
      uninstallUrl?: string | null;
      accessScopes?: Array<{ handle?: string | null }> | null;
      activeSubscriptions?: Array<Record<string, unknown>> | null;
    } | null;
  }>(
    admin,
    `#graphql
      query StoreAppInstallation {
        currentAppInstallation {
          uninstallUrl
          accessScopes { handle }
          activeSubscriptions {
            id
            name
            status
            currentPeriodEnd
            trialDays
          }
        }
      }
    `,
  );
  const install = data.currentAppInstallation;
  if (!install) return;
  await db.store.update({
    where: { id: storeId },
    data: {
      uninstallUrl: install.uninstallUrl || null,
      accessScopes: asJson(install.accessScopes),
      activeSubscriptions: asJson(install.activeSubscriptions),
    },
  });
}

async function syncLocations(admin: AdminClient, storeId: string) {
  const data = await adminGraphqlJson<{
    locations: {
      nodes: Array<{
        id: string;
        name?: string | null;
        isActive?: boolean | null;
        isPrimary?: boolean | null;
        address?: Record<string, unknown> | null;
      }>;
    };
  }>(
    admin,
    `#graphql
      query StoreLocations {
        locations(first: 50) {
          nodes {
            id
            name
            isActive
            isPrimary
            address {
              address1
              address2
              city
              province
              country
              zip
              phone
            }
          }
        }
      }
    `,
  );

  for (const location of data.locations?.nodes || []) {
    await db.storeLocation.upsert({
      where: {
        storeId_shopifyLocationId: {
          storeId,
          shopifyLocationId: location.id,
        },
      },
      create: {
        storeId,
        shopifyLocationId: location.id,
        name: location.name || null,
        isActive: location.isActive ?? true,
        isPrimary: location.isPrimary ?? false,
        address: asJson(location.address),
      },
      update: {
        name: location.name || null,
        isActive: location.isActive ?? true,
        isPrimary: location.isPrimary ?? false,
        address: asJson(location.address),
      },
    });
  }
}

async function syncMarkets(admin: AdminClient, storeId: string) {
  const data = await adminGraphqlJson<{
    markets: {
      nodes: Array<{
        id: string;
        name?: string | null;
        handle?: string | null;
        primary?: boolean | null;
        enabled?: boolean | null;
      }>;
    };
  }>(
    admin,
    `#graphql
      query StoreMarkets {
        markets(first: 50) {
          nodes {
            id
            name
            handle
            primary
            enabled
          }
        }
      }
    `,
  );

  for (const market of data.markets?.nodes || []) {
    await db.storeMarket.upsert({
      where: {
        storeId_shopifyMarketId: {
          storeId,
          shopifyMarketId: market.id,
        },
      },
      create: {
        storeId,
        shopifyMarketId: market.id,
        name: market.name || null,
        handle: market.handle || null,
        primary: market.primary ?? false,
        enabled: market.enabled ?? true,
        raw: asJson(market),
      },
      update: {
        name: market.name || null,
        handle: market.handle || null,
        primary: market.primary ?? false,
        enabled: market.enabled ?? true,
        raw: asJson(market),
      },
    });
  }
}

async function syncShopLocales(admin: AdminClient, storeId: string) {
  const data = await adminGraphqlJson<{
    shopLocales: Array<{ locale?: string | null; primary?: boolean | null; published?: boolean | null }>;
  }>(
    admin,
    `#graphql
      query StoreLocales {
        shopLocales { locale primary published }
      }
    `,
  );
  await db.store.update({
    where: { id: storeId },
    data: { shopLocales: asJson(data.shopLocales || []) },
  });
}

async function syncThemes(admin: AdminClient, storeId: string) {
  const data = await adminGraphqlJson<{
    themes: { nodes: Array<{ id?: string | null; name?: string | null; role?: string | null }> };
  }>(
    admin,
    `#graphql
      query StoreThemes {
        themes(first: 25) {
          nodes { id name role }
        }
      }
    `,
  );
  await db.store.update({
    where: { id: storeId },
    data: { themes: asJson(data.themes?.nodes || []) },
  });
}

async function syncPublications(admin: AdminClient, storeId: string) {
  const data = await adminGraphqlJson<{
    publications: {
      nodes: Array<{ id?: string | null; name?: string | null; catalog?: { title?: string | null } | null }>;
    };
  }>(
    admin,
    `#graphql
      query StorePublications {
        publications(first: 25) {
          nodes { id name catalog { title } }
        }
      }
    `,
  );
  await db.store.update({
    where: { id: storeId },
    data: { publications: asJson(data.publications?.nodes || []) },
  });
}

async function syncResourceCounts(admin: AdminClient, storeId: string) {
  const data = await adminGraphqlJson<{
    productsCount?: { count?: number | null } | null;
    collectionsCount?: { count?: number | null } | null;
    ordersCount?: { count?: number | null } | null;
    customersCount?: { count?: number | null } | null;
  }>(
    admin,
    `#graphql
      query StoreCounts {
        productsCount { count }
        collectionsCount { count }
        ordersCount { count }
        customersCount { count }
      }
    `,
  );

  await db.storeStats.create({
    data: {
      storeId,
      productsCount: data.productsCount?.count ?? 0,
      collectionsCount: data.collectionsCount?.count ?? 0,
      ordersCount: data.ordersCount?.count ?? 0,
      customersCount: data.customersCount?.count ?? 0,
      capturedAt: new Date(),
    },
  });
}

/** Heavy install enrichers — each isolated so one failure never blocks the rest. */
export async function enrichStoreProfile(
  admin: AdminClient,
  storeId: string,
): Promise<void> {
  // Temporarily only sync app installation metadata. Locations/markets/locales/
  // themes/publications/counts are unused for now (scopes/webhooks also dropped).
  const tasks: Array<[string, () => Promise<void>]> = [
    ["currentAppInstallation", () => syncCurrentAppInstallation(admin, storeId)],
    // ["locations", () => syncLocations(admin, storeId)],
    // ["markets", () => syncMarkets(admin, storeId)],
    // ["shopLocales", () => syncShopLocales(admin, storeId)],
    // ["themes", () => syncThemes(admin, storeId)],
    // ["publications", () => syncPublications(admin, storeId)],
    // ["counts", () => syncResourceCounts(admin, storeId)],
  ];

  for (const [label, run] of tasks) {
    try {
      await run();
    } catch (error) {
      console.warn(`[store] enrich ${label} failed`, error);
    }
  }
}

export async function resyncStoreLocations(admin: AdminClient, storeId: string) {
  await syncLocations(admin, storeId);
}

export async function resyncStoreMarkets(admin: AdminClient, storeId: string) {
  await syncMarkets(admin, storeId);
}

export async function resyncStoreThemes(admin: AdminClient, storeId: string) {
  await syncThemes(admin, storeId);
}

/** Fire-and-forget after afterAuth so install stays fast. */
export function enqueueStoreEnrichment(
  admin: AdminClient,
  storeId: string,
): void {
  setTimeout(() => {
    void enrichStoreProfile(admin, storeId).catch((error) => {
      console.error("[store] background enrichment failed", error);
    });
  }, 0);
}

export async function markStoreUninstalled(shopDomain: string): Promise<void> {
  const store = await db.store.findUnique({ where: { shopDomain } });
  if (!store) return;
  await db.store.update({
    where: { id: store.id },
    data: { isActive: false, uninstalledAt: new Date() },
  });
  await recordStoreInstallEvent({
    storeId: store.id,
    type: "UNINSTALL",
    scopes: store.scopes,
  });
}

export async function updateStoreScopes(
  shopDomain: string,
  scopes: string[],
): Promise<void> {
  const store = await db.store.findUnique({ where: { shopDomain } });
  if (!store) return;
  const scopeStr = scopes.join(",");
  await db.store.update({
    where: { id: store.id },
    data: {
      scopes: scopeStr,
      accessScopes: asJson(scopes.map((handle) => ({ handle }))),
    },
  });
  await recordStoreInstallEvent({
    storeId: store.id,
    type: "SCOPES_UPDATE",
    scopes: scopeStr,
  });
}

/** Map a shop/update REST webhook payload onto the Store row. */
export async function applyShopUpdateWebhook(
  shopDomain: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const planName =
    typeof payload.plan_name === "string"
      ? payload.plan_name
      : typeof (payload.plan_display_name as string | undefined) === "string"
        ? (payload.plan_display_name as string)
        : undefined;

  await db.store.upsert({
    where: { shopDomain },
    create: {
      shopDomain,
      shopifyShopId: payload.admin_graphql_api_id
        ? String(payload.admin_graphql_api_id)
        : payload.id
          ? `gid://shopify/Shop/${payload.id}`
          : null,
      name: typeof payload.name === "string" ? payload.name : null,
      email: typeof payload.email === "string" ? payload.email : null,
      contactEmail:
        typeof payload.customer_email === "string" ? payload.customer_email : null,
      currency: typeof payload.currency === "string" ? payload.currency : null,
      timezone:
        typeof payload.iana_timezone === "string" ? payload.iana_timezone : null,
      planName: planName || null,
      address: asJson(
        payload.address1 || payload.city
          ? {
              address1: payload.address1 ?? null,
              address2: payload.address2 ?? null,
              city: payload.city ?? null,
              province: payload.province ?? null,
              country: payload.country ?? null,
              zip: payload.zip ?? null,
              phone: payload.phone ?? null,
            }
          : undefined,
      ),
      isActive: true,
    },
    update: {
      name: typeof payload.name === "string" ? payload.name : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
      contactEmail:
        typeof payload.customer_email === "string" ? payload.customer_email : undefined,
      currency: typeof payload.currency === "string" ? payload.currency : undefined,
      timezone:
        typeof payload.iana_timezone === "string" ? payload.iana_timezone : undefined,
      planName: planName,
      address: asJson(
        payload.address1 || payload.city
          ? {
              address1: payload.address1 ?? null,
              address2: payload.address2 ?? null,
              city: payload.city ?? null,
              province: payload.province ?? null,
              country: payload.country ?? null,
              zip: payload.zip ?? null,
              phone: payload.phone ?? null,
            }
          : undefined,
      ),
    },
  });
}

/**
 * GDPR shop/redact — delete Store profile data and the operational Shop (+ cascades).
 * Does not store customer PII beyond what Shopify already sent in the redact payload.
 */
export async function redactShopData(shopDomain: string): Promise<void> {
  await db.$transaction([
    db.store.deleteMany({ where: { shopDomain } }),
    db.session.deleteMany({ where: { shop: shopDomain } }),
    db.shop.deleteMany({ where: { shop: shopDomain } }),
  ]);
}
