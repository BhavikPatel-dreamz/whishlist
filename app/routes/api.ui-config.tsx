import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticateProxyRequest } from "../lib/proxy-auth.server";
import { json, readBody } from "../lib/proxy.server";
import {
  getUIConfigByShopDomain,
  upsertUIConfigForShopDomain,
} from "../models/ui-config.server";
import {
  isExtensionActive,
  type ExtensionActive,
  type ProductCardConfig,
} from "../lib/ui-config.shared";

/**
 * Public storefront endpoint: GET /apps/wishlist-stock/api/ui-config
 * Returns the per-store UI configuration (active extension + product card fields)
 * so the theme extensions can gate and customise their rendering.
 *
 * POST accepts `{ extensionActive, productCardConfig }` — used by the admin though
 * normal admin auth; this proxy path mainly exists so the storefront can read it.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await authenticateProxyRequest(request);
  const config = await getUIConfigByShopDomain(ctx.shop.shop);
  return json({ ok: true, config });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await authenticateProxyRequest(request);
  const body = await readBody(request);
  const payload = typeof body === "string" ? JSON.parse(body) : body;
  if (!payload || typeof payload !== "object") {
    return json({ ok: false, code: "bad_request", message: "Invalid payload" }, { status: 400 });
  }

  const extensionActive: ExtensionActive | undefined = isExtensionActive(payload.extensionActive)
    ? payload.extensionActive
    : undefined;

  const productCardConfig: Partial<ProductCardConfig> | undefined =
    payload.productCardConfig && typeof payload.productCardConfig === "object"
      ? payload.productCardConfig
      : undefined;

  const config = await upsertUIConfigForShopDomain(ctx.shop.shop, {
    extensionActive,
    productCardConfig,
  });
  return json({ ok: true, config });
};