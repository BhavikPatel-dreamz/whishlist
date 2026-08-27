import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

type CompliancePayload = {
  customer?: { id?: number | string; email?: string };
  shop_domain?: string;
};

/** Mandatory GDPR/CCPA webhooks for public apps. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const body = payload as CompliancePayload;
  const shopRecord = await db.shop.findUnique({ where: { shop }, select: { id: true } });

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      // Merchants receive the export out of band; log the request for the audit trail.
      console.log(`[compliance] data request for ${shop} customer ${body.customer?.id ?? "?"}`);
      break;
    }
    case "CUSTOMERS_REDACT": {
      if (shopRecord) {
        const customerId = body.customer?.id ? String(body.customer.id) : undefined;
        const email = body.customer?.email?.toLowerCase();
        await db.wishlistItem.deleteMany({
          where: { shopId: shopRecord.id, ...(customerId ? { customerId } : {}) },
        });
        await db.stockAlert.deleteMany({
          where: {
            shopId: shopRecord.id,
            OR: [
              ...(customerId ? [{ customerId }] : []),
              ...(email ? [{ email }] : []),
            ],
          },
        });
      }
      break;
    }
    case "SHOP_REDACT": {
      if (shopRecord) await db.shop.delete({ where: { id: shopRecord.id } }); // cascades
      await db.session.deleteMany({ where: { shop } });
      break;
    }
    default:
      console.log(`[compliance] unhandled topic ${topic} for ${shop}`);
  }

  return new Response();
};
