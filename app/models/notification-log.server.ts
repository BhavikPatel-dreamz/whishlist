import type { Channel, NotifKind, StockAlert } from "@prisma/client";
import db from "../db.server";

function channelForAlert(channel: string): Channel {
  if (channel === "sms") return "SMS";
  if (channel === "whatsapp") return "WHATSAPP";
  return "EMAIL";
}

/** Records one delivery attempt for the merchant notification log / report. */
export async function recordRestockNotificationLog(params: {
  alert: Pick<
    StockAlert,
    | "id"
    | "shopId"
    | "channel"
    | "email"
    | "phone"
    | "contactKey"
    | "shopperId"
    | "customerId"
    | "productId"
    | "variantId"
  >;
  status: "sent" | "failed";
  errorReason?: string | null;
}): Promise<void> {
  const { alert, status, errorReason } = params;
  const shopperId =
    alert.shopperId ||
    alert.customerId ||
    alert.email ||
    alert.phone ||
    alert.contactKey ||
    "unknown";

  await db.notificationLog.create({
    data: {
      shopId: alert.shopId,
      kind: "RESTOCK" satisfies NotifKind,
      channel: channelForAlert(alert.channel),
      subscriptionId: alert.id,
      shopperId,
      productId: alert.productId,
      variantId: alert.variantId,
      status,
      errorReason: errorReason ? errorReason.slice(0, 500) : null,
      sentAt: status === "sent" ? new Date() : null,
    },
  });
}
