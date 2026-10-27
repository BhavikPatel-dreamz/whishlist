import type { GraphqlClient } from "../shopify-data.server";
import db from "../../db.server";
import { getOrCreateShop } from "../shop.server";
import type { PartnerSubscription } from "./partner-subscription";
import { planCodeFromHandles, subscriptionRecordFromPartner } from "./partner-subscription";
import { PLAN_CODES } from "./plan.server";

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, number>();

type AdminClient = Pick<GraphqlClient, "graphql">;

export async function fetchActiveSubscription(shopGid: string): Promise<PartnerSubscription | null> {
  const orgId = process.env.SHOPIFY_PARTNER_ORG_ID;
  const token = process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN;
  const appGid = process.env.SHOPIFY_APP_GID;
  if (!orgId || !token || !appGid) return null;

  const response = await fetch(
    `https://partners.shopify.com/${orgId}/api/2026-07/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: `query ($appId: ID!, $shopId: ID!) {
          activeSubscription(appId: $appId, shopId: $shopId) {
            billingPeriod
            cancelAtEndOfCycle
            currentBillingCycle { endTime }
            items { handle }
          }
        }`,
        variables: { appId: appGid, shopId: shopGid },
      }),
    },
  );

  const body = (await response.json()) as {
    data?: { activeSubscription?: PartnerSubscription | null };
    errors?: unknown;
  };
  if (!response.ok || body.errors) {
    throw new Error("Partner API activeSubscription failed");
  }
  return body.data?.activeSubscription ?? null;
}

/** Saves the plan Shopify appends as plan_handle after the merchant confirms a charge. */
export async function recordPlanHandle(shopDomain: string, handle: string): Promise<void> {
  const planCode = planCodeFromHandles([handle]);
  if (!planCode) return;
  const shop = await getOrCreateShop(shopDomain);
  const localGid = `app-pricing:${shop.id}`;
  if (planCode === PLAN_CODES.starter) {
    await db.billingSubscription.updateMany({
      where: { shopId: shop.id, shopifyGid: localGid, status: { in: ["ACTIVE", "CANCELLED"] } },
      data: { status: "EXPIRED", currentPeriodEnd: new Date() },
    });
    cache.set(shopDomain, Date.now());
    return;
  }
  await db.billingSubscription.upsert({
    where: { shopifyGid: localGid },
    create: {
      shopId: shop.id,
      planCode,
      shopifyGid: localGid,
      status: "ACTIVE",
      currentPeriodEnd: null,
    },
    update: { planCode, status: "ACTIVE", currentPeriodEnd: null },
  });
  cache.set(shopDomain, Date.now());
}

async function syncFromAdminInstallation(admin: AdminClient, shopDomain: string): Promise<void> {
  const response = await admin.graphql(`{
    currentAppInstallation {
      activeSubscriptions { name status currentPeriodEnd }
    }
  }`);
  const body = (await response.json()) as {
    data?: {
      currentAppInstallation?: {
        activeSubscriptions?: Array<{ name?: string | null; status?: string | null; currentPeriodEnd?: string | null }>;
      };
    };
    errors?: unknown;
  };
  if (body.errors) return;
  const active = (body.data?.currentAppInstallation?.activeSubscriptions || []).find(
    (row) => row.status === "ACTIVE",
  );
  if (!active?.name) return;
  const shop = await getOrCreateShop(shopDomain);
  const planCode = planCodeFromHandles([active.name]);
  if (!planCode || planCode === PLAN_CODES.starter) return;
  const periodEnd = active.currentPeriodEnd ? new Date(active.currentPeriodEnd) : null;
  const localGid = `app-pricing:${shop.id}`;
  await db.billingSubscription.upsert({
    where: { shopifyGid: localGid },
    create: {
      shopId: shop.id,
      planCode,
      shopifyGid: localGid,
      status: "ACTIVE",
      currentPeriodEnd: periodEnd && !Number.isNaN(periodEnd.getTime()) ? periodEnd : null,
    },
    update: {
      planCode,
      status: "ACTIVE",
      currentPeriodEnd: periodEnd && !Number.isNaN(periodEnd.getTime()) ? periodEnd : null,
    },
  });
  cache.set(shopDomain, Date.now());
}

/**
 * Writes the live Shopify App Pricing subscription onto BillingSubscription.
 * A null subscription expires the local row so the shop resolves to Starter.
 * Missing Partner API env vars skip the sync. A failed request does not expire a paid row.
 */
export async function syncShopSubscription(params: {
  admin: AdminClient;
  shopDomain: string;
  force?: boolean;
}): Promise<void> {
  const { admin, shopDomain, force = false } = params;
  if (!process.env.SHOPIFY_PARTNER_ORG_ID || !process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN || !process.env.SHOPIFY_APP_GID) {
    await syncFromAdminInstallation(admin, shopDomain).catch(() => {});
    return;
  }

  const cachedAt = cache.get(shopDomain);
  if (!force && cachedAt && Date.now() - cachedAt < CACHE_MS) return;

  const shop = await getOrCreateShop(shopDomain);
  const shopResponse = await admin.graphql(`{ shop { id } }`);
  const payload = (await shopResponse.json()) as { data?: { shop?: { id?: string } } };
  const shopGid = payload.data?.shop?.id;
  if (!shopGid) return;

  let subscription: PartnerSubscription | null;
  try {
    subscription = await fetchActiveSubscription(shopGid);
  } catch (error) {
    console.error(`[billing] subscription sync failed for ${shopDomain}`);
    return;
  }

  const localGid = `app-pricing:${shop.id}`;
  const record = subscription ? subscriptionRecordFromPartner(subscription) : null;

  if (!record) {
    await db.billingSubscription.updateMany({
      where: { shopId: shop.id, shopifyGid: localGid, status: { in: ["ACTIVE", "CANCELLED"] } },
      data: { status: "EXPIRED", currentPeriodEnd: new Date() },
    });
    cache.set(shopDomain, Date.now());
    return;
  }

  await db.billingSubscription.upsert({
    where: { shopifyGid: localGid },
    create: {
      shopId: shop.id,
      planCode: record.planCode,
      shopifyGid: localGid,
      status: record.status,
      currentPeriodEnd: record.currentPeriodEnd,
    },
    update: {
      planCode: record.planCode,
      status: record.status,
      currentPeriodEnd: record.currentPeriodEnd,
    },
  });
  cache.set(shopDomain, Date.now());
}
