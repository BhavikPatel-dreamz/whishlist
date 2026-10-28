import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  DeliveryMethod,
} from "@shopify/shopify-app-remix/server";

import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { getOrCreateShop } from "./lib/shop.server";
import {
  enqueueStoreEnrichment,
  syncStoreInfo,
} from "./models/store.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  hooks: {
    afterAuth: async ({ session, admin }) => {
      // Keep install → app UI redirect fast: only await essentials.
      await getOrCreateShop(session.shop, session.accessToken);
      await shopify.registerWebhooks({ session });

      // Store profile + enrichers must not block the post-auth redirect.
      void (async () => {
        try {
          const client = admin
            ? admin
            : await shopify.unauthenticated.admin(session.shop).then((ctx) => ctx.admin);
          const { shopId } = await syncStoreInfo(client, session);
          enqueueStoreEnrichment(client, shopId);
        } catch (error) {
          console.error("[afterAuth] store sync failed (install continues)", error);
        }
      })();
    },
  },
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/uninstalled",
    },
    APP_SCOPES_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/scopes_update",
    },
    SHOP_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/shop/update",
    },
    INVENTORY_LEVELS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/inventory",
    },
    PRODUCTS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/products/update",
    },
    ORDERS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders/create",
    },
    ORDERS_PAID: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders/paid",
    },
    ORDERS_CANCELLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders/cancelled",
    },
    ORDERS_UPDATED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders/updated",
    },
    CUSTOMERS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/customers/create",
    },
    CUSTOMERS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/customers/update",
    },
    CUSTOMERS_DATA_REQUEST: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/customers/data_request",
    },
    CUSTOMERS_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/customers/redact",
    },
    SHOP_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/shop/redact",
    },
    // Temporarily disabled unused store-profile sync:
    // themes/publish, locations/*, markets/*
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
