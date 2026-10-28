import db from "../../db.server";
import { getOrCreateShop } from "../shop.server";

type CustomerPayload = Record<string, unknown>;

/**
 * When a shopper creates or updates a customer account, repoint guest wishlist
 * items, stock alerts, and tracking events that were keyed by email onto the
 * customer id. Shared by customers/create and customers/update.
 */
export async function linkGuestIdentityToCustomer(
  shopDomain: string,
  payload: CustomerPayload,
): Promise<void> {
  const shopRecord = await getOrCreateShop(shopDomain);
  const customerId = payload?.id != null ? String(payload.id) : null;
  const emailRaw = payload?.email != null ? String(payload.email) : null;
  const email = emailRaw ? emailRaw.trim().toLowerCase() : null;
  if (!customerId || !email) return;

  const emailContactKey = `email:${email}`;

  await db.$transaction([
    db.wishlistItem.updateMany({
      where: {
        shopId: shopRecord.id,
        customerId: null,
        OR: [{ guestToken: email }, { shopperId: email }],
      },
      data: { customerId, shopperId: customerId },
    }),
    db.stockAlert.updateMany({
      where: {
        shopId: shopRecord.id,
        customerId: null,
        OR: [
          { contactKey: emailContactKey },
          { contactKey: email },
          { email },
        ],
      },
      data: { customerId, shopperId: customerId },
    }),
    db.trackingEvent.updateMany({
      where: {
        shopId: shopRecord.id,
        customerId: null,
        shopperId: email,
      },
      data: { customerId, shopperId: customerId },
    }),
  ]);
}
