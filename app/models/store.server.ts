/**
 * Install-time Shopify shop profile sync.
 * Profile fields live on the operational `Shop` row (merged from former Store table).
 */
import type { Prisma } from "@prisma/client";
import db from "../db.server";
import type { GraphqlClient } from "../lib/shopify-data.server";
import { getOrCreateShop, invalidateShopCache } from "../lib/shop.server";

export type StoreInstallEventType =
  "INSTALL" | "REINSTALL" | "UNINSTALL" | "SCOPES_UPDATE";

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

const APP_VERSION =
  process.env.npm_package_version || process.env.APP_VERSION || null;

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

  return null;
}

async function upsertInstallerFromOfflineSessionFields(
  shopId: string,
  session: InstallSession,
) {
  const row = await db.session.findFirst({
    where: { shop: session.shop, isOnline: true },
    orderBy: { id: "desc" },
  });
  if (!row?.email && !row?.userId && !row?.firstName) return;

  await db.storeInstaller.upsert({
    where: { shopId },
    create: {
      shopId,
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
  shopId: string;
  type: StoreInstallEventType;
  scopes?: string | null;
  utmSource?: string | null;
}) {
  await db.storeInstallEvent.create({
    data: {
      shopId: params.shopId,
      type: params.type,
      scopes: params.scopes || null,
      appVersion: APP_VERSION,
      utmSource: params.utmSource || null,
    },
  });
}

/**
 * Fast path used during afterAuth: upsert Shop profile from the shop query,
 * record installer when available, and emit INSTALL/REINSTALL. Heavy fetchers run later.
 */
export async function syncStoreInfo(
  admin: AdminClient | null,
  session: InstallSession,
  options?: { utmSource?: string | null },
): Promise<{ shopId: string; reinstall: boolean }> {
  const shopDomain = session.shop;
  const existing = await db.shop.findUnique({ where: { shop: shopDomain } });
  const reinstall = Boolean(
    existing && (!existing.isActive || existing.uninstalledAt),
  );

  let profile: ShopifyShopNode | null = null;
  if (admin) {
    try {
      const data = await adminGraphqlJson<{ shop: ShopifyShopNode }>(
        admin,
        SHOP_QUERY,
      );
      profile = data.shop;
    } catch (error) {
      console.warn("[store] full shop query failed, trying fallback", error);
      try {
        const data = await adminGraphqlJson<{ shop: ShopifyShopNode }>(
          admin,
          FALLBACK_SHOP_QUERY,
        );
        profile = data.shop;
      } catch (fallbackError) {
        console.error(
          "[store] shop query failed; continuing with domain only",
          fallbackError,
        );
      }
    }
  }

  const address = profile?.billingAddress
    ? {
        address1: profile.billingAddress.address1 ?? null,
        address2: profile.billingAddress.address2 ?? null,
        city: profile.billingAddress.city ?? null,
        province: profile.billingAddress.province ?? null,
        country: profile.billingAddress.country ?? null,
        zip: profile.billingAddress.zip ?? null,
        phone: profile.billingAddress.phone ?? null,
      }
    : undefined;

  const billingAddress = profile?.billingAddress
    ? {
        company: profile.billingAddress.company ?? null,
        countryCodeV2: profile.billingAddress.countryCodeV2 ?? null,
        latitude: profile.billingAddress.latitude ?? null,
        longitude: profile.billingAddress.longitude ?? null,
        ...address,
      }
    : undefined;

  const profileData = {
    shopifyShopId: profile?.id || null,
    name: profile?.name || null,
    email: profile?.email || null,
    contactEmail: profile?.contactEmail || null,
    description: profile?.description || null,
    url: profile?.url || profile?.primaryDomain?.url || null,
    primaryDomain:
      profile?.primaryDomain?.url || profile?.primaryDomain?.host || null,
    currency: profile?.currencyCode || null,
    timezone: profile?.ianaTimezone || null,
    timezoneOffset: profile?.timezoneOffset || null,
    weightUnit: profile?.weightUnit || null,
    unitSystem: profile?.unitSystem || null,
    planName: profile?.plan?.displayName || null,
    isDevStore: Boolean(profile?.plan?.partnerDevelopment),
    isShopifyPlus: Boolean(profile?.plan?.shopifyPlus),
    address: asJson(address),
    billingAddress: asJson(billingAddress),
    presentmentCurrencies: asJson(profile?.enabledPresentmentCurrencies),
    currencyFormats: asJson(profile?.currencyFormats),
    taxesIncluded: profile?.taxesIncluded ?? null,
    taxShipping: profile?.taxShipping ?? null,
    checkoutApiSupported: profile?.checkoutApiSupported ?? null,
    setupRequired: profile?.setupRequired ?? null,
    shipsToCountries: asJson(profile?.shipsToCountries),
    features: asJson(profile?.features),
    resourceLimits: asJson(profile?.resourceLimits),
    paymentSettings: asJson(profile?.paymentSettings),
    shopCreatedAt: profile?.createdAt ? new Date(profile.createdAt) : null,
    scopes: session.scope || null,
    isActive: true,
    uninstalledAt: null as Date | null,
  };

  const shop = await db.shop.upsert({
    where: { shop: shopDomain },
    create: {
      shop: shopDomain,
      accessToken: session.accessToken || null,
      installCount: 1,
      installedAt: new Date(),
      ...profileData,
    },
    update: {
      ...(session.accessToken ? { accessToken: session.accessToken } : {}),
      shopifyShopId: profile?.id || undefined,
      name: profile?.name || undefined,
      email: profile?.email || undefined,
      contactEmail: profile?.contactEmail || undefined,
      description: profile?.description || undefined,
      url: profile?.url || profile?.primaryDomain?.url || undefined,
      primaryDomain:
        profile?.primaryDomain?.url ||
        profile?.primaryDomain?.host ||
        undefined,
      currency: profile?.currencyCode || undefined,
      timezone: profile?.ianaTimezone || undefined,
      timezoneOffset: profile?.timezoneOffset || undefined,
      weightUnit: profile?.weightUnit || undefined,
      unitSystem: profile?.unitSystem || undefined,
      planName: profile?.plan?.displayName || undefined,
      isDevStore: profile?.plan
        ? Boolean(profile.plan.partnerDevelopment)
        : undefined,
      isShopifyPlus: profile?.plan
        ? Boolean(profile.plan.shopifyPlus)
        : undefined,
      address: asJson(address),
      billingAddress: asJson(billingAddress),
      presentmentCurrencies: asJson(profile?.enabledPresentmentCurrencies),
      currencyFormats: asJson(profile?.currencyFormats),
      taxesIncluded: profile?.taxesIncluded ?? undefined,
      taxShipping: profile?.taxShipping ?? undefined,
      checkoutApiSupported: profile?.checkoutApiSupported ?? undefined,
      setupRequired: profile?.setupRequired ?? undefined,
      shipsToCountries: asJson(profile?.shipsToCountries),
      features: asJson(profile?.features),
      resourceLimits: asJson(profile?.resourceLimits),
      paymentSettings: asJson(profile?.paymentSettings),
      shopCreatedAt: profile?.createdAt
        ? new Date(profile.createdAt)
        : undefined,
      scopes: session.scope || undefined,
      isActive: true,
      uninstalledAt: null,
      installedAt: reinstall ? new Date() : undefined,
      installCount: reinstall ? { increment: 1 } : undefined,
    },
  });
  invalidateShopCache(shopDomain);

  const installer = installerFromSession(session);
  if (installer) {
    await db.storeInstaller.upsert({
      where: { shopId: shop.id },
      create: { shopId: shop.id, ...installer },
      update: { ...installer },
    });
  } else {
    await upsertInstallerFromOfflineSessionFields(shop.id, session).catch(
      (error) => {
        console.warn("[store] installer upsert skipped", error);
      },
    );
  }

  if (!existing || reinstall) {
    await recordStoreInstallEvent({
      shopId: shop.id,
      type: reinstall ? "REINSTALL" : "INSTALL",
      scopes: session.scope,
      utmSource: options?.utmSource,
    });
  }

  return { shopId: shop.id, reinstall };
}

async function syncCurrentAppInstallation(admin: AdminClient, shopId: string) {
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
  await db.shop.update({
    where: { id: shopId },
    data: {
      uninstallUrl: install.uninstallUrl || null,
      accessScopes: asJson(install.accessScopes),
      activeSubscriptions: asJson(install.activeSubscriptions),
    },
  });
}

async function syncLocations(admin: AdminClient, shopId: string) {
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
        shopId_shopifyLocationId: {
          shopId,
          shopifyLocationId: location.id,
        },
      },
      create: {
        shopId,
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

async function syncMarkets(admin: AdminClient, shopId: string) {
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
        shopId_shopifyMarketId: {
          shopId,
          shopifyMarketId: market.id,
        },
      },
      create: {
        shopId,
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

async function syncShopLocales(admin: AdminClient, shopId: string) {
  const data = await adminGraphqlJson<{
    shopLocales: Array<{
      locale?: string | null;
      primary?: boolean | null;
      published?: boolean | null;
    }>;
  }>(
    admin,
    `#graphql
      query StoreLocales {
        shopLocales { locale primary published }
      }
    `,
  );
  await db.shop.update({
    where: { id: shopId },
    data: { shopLocales: asJson(data.shopLocales || []) },
  });
}

async function syncThemes(admin: AdminClient, shopId: string) {
  const data = await adminGraphqlJson<{
    themes: {
      nodes: Array<{
        id?: string | null;
        name?: string | null;
        role?: string | null;
      }>;
    };
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
  await db.shop.update({
    where: { id: shopId },
    data: { themes: asJson(data.themes?.nodes || []) },
  });
}

async function syncPublications(admin: AdminClient, shopId: string) {
  const data = await adminGraphqlJson<{
    publications: {
      nodes: Array<{
        id?: string | null;
        name?: string | null;
        catalog?: { title?: string | null } | null;
      }>;
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
  await db.shop.update({
    where: { id: shopId },
    data: { publications: asJson(data.publications?.nodes || []) },
  });
}

async function syncResourceCounts(admin: AdminClient, shopId: string) {
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
      shopId,
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
  shopId: string,
): Promise<void> {
  // Temporarily only sync app installation metadata. Locations/markets/locales/
  // themes/publications/counts are unused for now (scopes/webhooks also dropped).
  const tasks: Array<[string, () => Promise<void>]> = [
    ["currentAppInstallation", () => syncCurrentAppInstallation(admin, shopId)],
    // ["locations", () => syncLocations(admin, shopId)],
    // ["markets", () => syncMarkets(admin, shopId)],
    // ["shopLocales", () => syncShopLocales(admin, shopId)],
    // ["themes", () => syncThemes(admin, shopId)],
    // ["publications", () => syncPublications(admin, shopId)],
    // ["counts", () => syncResourceCounts(admin, shopId)],
  ];

  for (const [label, run] of tasks) {
    try {
      await run();
    } catch (error) {
      console.warn(`[store] enrich ${label} failed`, error);
    }
  }
}

export async function resyncStoreLocations(admin: AdminClient, shopId: string) {
  await syncLocations(admin, shopId);
}

export async function resyncStoreMarkets(admin: AdminClient, shopId: string) {
  await syncMarkets(admin, shopId);
}

export async function resyncStoreThemes(admin: AdminClient, shopId: string) {
  await syncThemes(admin, shopId);
}

/** Fire-and-forget after afterAuth so install stays fast. */
export function enqueueStoreEnrichment(
  admin: AdminClient,
  shopId: string,
): void {
  setTimeout(() => {
    void enrichStoreProfile(admin, shopId).catch((error) => {
      console.error("[store] background enrichment failed", error);
    });
  }, 0);
}

export async function markStoreUninstalled(shopDomain: string): Promise<void> {
  const shop = await db.shop.findUnique({ where: { shop: shopDomain } });
  if (!shop) return;
  await db.shop.update({
    where: { id: shop.id },
    data: { isActive: false, uninstalledAt: new Date(), accessToken: null },
  });
  invalidateShopCache(shopDomain);
  await recordStoreInstallEvent({
    shopId: shop.id,
    type: "UNINSTALL",
    scopes: shop.scopes,
  });
}

export async function updateStoreScopes(
  shopDomain: string,
  scopes: string[],
): Promise<void> {
  const shop = await db.shop.findUnique({ where: { shop: shopDomain } });
  if (!shop) return;
  const scopeStr = scopes.join(",");
  await db.shop.update({
    where: { id: shop.id },
    data: {
      scopes: scopeStr,
      accessScopes: asJson(scopes.map((handle) => ({ handle }))),
    },
  });
  invalidateShopCache(shopDomain);
  await recordStoreInstallEvent({
    shopId: shop.id,
    type: "SCOPES_UPDATE",
    scopes: scopeStr,
  });
}

/** Map a shop/update REST webhook payload onto the Shop profile fields. */
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

  const address = asJson(
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
  );

  await getOrCreateShop(shopDomain);
  await db.shop.update({
    where: { shop: shopDomain },
    data: {
      shopifyShopId: payload.admin_graphql_api_id
        ? String(payload.admin_graphql_api_id)
        : payload.id
          ? `gid://shopify/Shop/${payload.id}`
          : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
      contactEmail:
        typeof payload.customer_email === "string"
          ? payload.customer_email
          : undefined,
      currency:
        typeof payload.currency === "string" ? payload.currency : undefined,
      timezone:
        typeof payload.iana_timezone === "string"
          ? payload.iana_timezone
          : undefined,
      planName: planName,
      address,
    },
  });
  invalidateShopCache(shopDomain);
}

/**
 * GDPR shop/redact — delete the Shop row (cascades profile children + operational data)
 * and sessions for that domain.
 */
export async function redactShopData(shopDomain: string): Promise<void> {
  await db.$transaction([
    db.session.deleteMany({ where: { shop: shopDomain } }),
    db.shop.deleteMany({ where: { shop: shopDomain } }),
  ]);
  invalidateShopCache(shopDomain);
}
