import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

const DATA_URL = /^data:(image\/(?:png|jpeg));base64,(.+)$/s;

/**
 * Public endpoint that serves the merchant's stored back-in-stock email logo.
 * Email clients strip `data:` URL images, so outbound emails link here instead.
 * Safe to cache: the URL changes meaning only when the merchant replaces the logo.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const shopId = params.shopId || "";
  const config = shopId
    ? await prisma.uIConfig.findUnique({ where: { shopId } })
    : null;
  const raw = config?.productCardConfig;
  const settings =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).backInStockSettings
      : undefined;
  const logoUrl =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>).logoUrl
      : undefined;

  if (typeof logoUrl !== "string" || !logoUrl) {
    throw new Response("Not found", { status: 404 });
  }

  if (/^https:\/\//i.test(logoUrl)) {
    return new Response(null, {
      status: 302,
      headers: { Location: logoUrl, "Cache-Control": "public, max-age=3600" },
    });
  }

  const match = DATA_URL.exec(logoUrl);
  if (!match) throw new Response("Not found", { status: 404 });

  const bytes = Uint8Array.from(Buffer.from(match[2], "base64"));
  return new Response(bytes, {
    headers: {
      "Content-Type": match[1],
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=3600, immutable",
    },
  });
}
