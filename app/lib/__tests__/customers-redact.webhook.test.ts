import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "@remix-run/node";
import { action } from "../../routes/webhooks.customers.redact";

const mocks = vi.hoisted(() => {
  const makeDeleteModel = () => ({ deleteMany: vi.fn().mockResolvedValue({ count: 0 }) });
  const tx = {
    wishlistItem: makeDeleteModel(),
    stockAlert: makeDeleteModel(),
    trackingEvent: makeDeleteModel(),
    notificationLog: makeDeleteModel(),
    wishlistEvent: makeDeleteModel(),
    wishlistShare: makeDeleteModel(),
    wishlistList: makeDeleteModel(),
    shopifyOrderRecord: makeDeleteModel(),
    wishlistOrder: makeDeleteModel(),
    attribution: makeDeleteModel(),
  };
  return {
    authenticateWebhook: vi.fn(),
    unauthenticatedAdmin: vi.fn(),
    deleteWishlistMetafield: vi.fn(),
    tx,
    db: {
      shop: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("../../shopify.server", () => ({
  authenticate: { webhook: mocks.authenticateWebhook },
  unauthenticated: { admin: mocks.unauthenticatedAdmin },
}));
vi.mock("../../db.server", () => ({ default: mocks.db }));
vi.mock("../privacy-shopify.server", () => ({
  deleteCustomerWishlistMetafield: mocks.deleteWishlistMetafield,
}));
vi.mock("../webhooks/auth-response.server", () => ({
  rethrowWebhookAuthResponse: vi.fn(),
}));

function requestArgs(): ActionFunctionArgs {
  return { request: new Request("https://app.example/webhooks/customers/redact"), params: {}, context: {} };
}

describe("customers/redact webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.shop.findUnique.mockResolvedValue({ id: "shop-id", shop: "store.myshopify.com" });
    mocks.unauthenticatedAdmin.mockResolvedValue({ admin: { graphql: vi.fn() } });
    mocks.db.$transaction.mockImplementation(async (work: (tx: typeof mocks.tx) => Promise<void>) => work(mocks.tx));
  });

  it("redacts phone-only alerts and all customer-linked records", async () => {
    mocks.authenticateWebhook.mockResolvedValue({
      shop: "store.myshopify.com",
      topic: "customers/redact",
      payload: { customer: { phone: "+1 (555) 123-4567" } },
    });

    const response = await action(requestArgs());

    expect(response.status).toBe(200);
    expect(mocks.tx.stockAlert.deleteMany).toHaveBeenCalledWith({
      where: {
        shopId: "shop-id",
        OR: expect.arrayContaining([
          { phone: "+15551234567" },
          { contactKey: "sms:+15551234567" },
          { contactKey: "whatsapp:+15551234567" },
        ]),
      },
    });
    expect(mocks.tx.notificationLog.deleteMany).toHaveBeenCalledWith({
      where: { shopId: "shop-id", shopperId: { in: expect.arrayContaining(["+15551234567"]) } },
    });
    expect(mocks.tx.wishlistEvent.deleteMany).not.toHaveBeenCalled();
    expect(mocks.deleteWishlistMetafield).toHaveBeenCalled();
  });

  it("deletes only requested orders when customer identifiers are absent", async () => {
    mocks.authenticateWebhook.mockResolvedValue({
      shop: "store.myshopify.com",
      topic: "customers/redact",
      payload: { orders_to_redact: [101, "202"] },
    });

    const response = await action(requestArgs());

    expect(response.status).toBe(200);
    expect(mocks.tx.shopifyOrderRecord.deleteMany).toHaveBeenCalledWith({
      where: { shopId: "shop-id", OR: [{ orderId: { in: ["101", "202"] } }] },
    });
    expect(mocks.tx.wishlistOrder.deleteMany).toHaveBeenCalledWith({
      where: { shopId: "shop-id", orderId: { in: ["101", "202"] } },
    });
    expect(mocks.tx.wishlistEvent.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.wishlistShare.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.wishlistList.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.stockAlert.deleteMany).not.toHaveBeenCalled();
  });
});